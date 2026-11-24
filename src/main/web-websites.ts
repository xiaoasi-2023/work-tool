import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebsitesService } from './websites'
import type { WebsitesMutation } from '../shared/websites'
import { writeFileAtomic } from './atomic-file'

export function createWebWebsitesMiddleware(directory: string) {
  const file = path.join(directory, 'websites.json')
  const service = new WebsitesService({ directory,
    get<T>(_key: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('无法读取网站数据，原文件已保留，请检查数据文件或备份') } },
    set(_key: string, value: unknown) {
      fs.mkdirSync(directory, { recursive: true }); writeFileAtomic(file, JSON.stringify(value))
    }
  })
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    if (pathname !== '/api/websites' && pathname !== '/api/websites/mutate') { next(); return }
    const send = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
    try {
      const host = request.headers.host || ''
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host) || request.headers.origin && request.headers.origin !== 'http://' + host) { send(403, { error: '只允许从本机工具页面访问网站数据' }); return }
      if (pathname === '/api/websites' && request.method === 'GET') { send(200, service.read()); return }
      if (pathname !== '/api/websites/mutate' || request.method !== 'POST') { send(405, { error: '不支持的请求方法' }); return }
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { send(415, { error: '请使用 JSON 格式' }); return }
      const chunks: Buffer[] = []; let size = 0
      for await (const part of request) { const buffer = Buffer.from(part); size += buffer.length; if (size <= 20 * 1024 ** 2) chunks.push(buffer) }
      if (size > 20 * 1024 ** 2) { send(413, { error: '网站数据不能超过 20 MiB' }); return }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WebsitesMutation
      send(200, service.mutate(body))
    } catch (error) { const message = (error as Error).message; send(message.includes('数据已更新') ? 409 : message.includes('无法读取') ? 500 : 400, { error: message }) }
  }
}
