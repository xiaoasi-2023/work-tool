import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hasManagementData, validateManagementState, type ManagementMutation, type ManagementState } from '../shared/management'
import { ManagementService, MANAGEMENT_STORAGE_KEY } from './management'

export const WEB_MANAGEMENT_FILE = 'management.json'
const basePath = '/api/management'
const bodyLimit = 30 * 1024 * 1024

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

class WebManagementStorage {
  private file: string
  constructor(public directory: string) { this.file = path.join(directory, WEB_MANAGEMENT_FILE) }
  get<T>(_key: string, fallback: T): T {
    let content: string
    try { content = fs.readFileSync(this.file, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error }
    const saved: unknown = JSON.parse(content)
    if (!saved || typeof saved !== 'object') throw new Error('管理数据文件格式无效')
    return saved as T
  }
  set(_key: string, value: unknown) {
    fs.mkdirSync(this.directory, { recursive: true })
    const temporary = path.join(this.directory, `management-${randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8')
      fs.renameSync(temporary, this.file)
    } catch (error) {
      try { fs.unlinkSync(temporary) } catch { /* Preserve the write error. */ }
      throw error
    }
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, '请使用JSON格式提交管理数据')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size <= bodyLimit) chunks.push(buffer)
  }
  if (size > bodyLimit) throw new HttpError(413, '管理数据不能超过30 MB')
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new HttpError(400, '管理数据JSON格式无效') }
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(value))
}

export function createWebManagementMiddleware(directory: string) {
  const storage = new WebManagementStorage(directory)
  const service = new ManagementService(storage, 'browser')
  const read = (): ManagementState => {
    try { return service.read() }
    catch { throw new HttpError(500, '无法读取本机管理数据，请检查数据文件或备份；原文件未被覆盖') }
  }
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url || '/', 'http://127.0.0.1'), pathname = url.pathname
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) { next(); return }
    try {
      const host = request.headers.host || ''
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host) || request.headers.origin && request.headers.origin !== `http://${host}`) throw new HttpError(403, '只允许从本机工具页面访问管理数据')
      if (pathname === basePath && request.method === 'GET') { json(response, 200, read()); return }
      if (pathname === `${basePath}/backup` && request.method === 'GET') {
        const state = read()
        service.backup(state, 'export')
        json(response, 200, state)
        return
      }
      if (pathname === `${basePath}/backups` && request.method === 'GET') {
        json(response, 200, service.listBackups(Number(url.searchParams.get('page') || 1)))
        return
      }
      if (pathname === `${basePath}/backups` && request.method === 'POST') {
        await readBody(request)
        json(response, 201, service.createBackup())
        return
      }
      const backupRoute = pathname.match(/^\/api\/management\/backups\/([^/]+)(\/restore)?$/)
      if (backupRoute && request.method === 'GET' && !backupRoute[2]) {
        json(response, 200, service.readBackup(decodeURIComponent(backupRoute[1])))
        return
      }
      if (backupRoute && request.method === 'POST' && backupRoute[2]) {
        const body = await readBody(request) as { revision?: number }
        if (!body || !Number.isSafeInteger(body.revision) || body.revision! < 0) throw new HttpError(400, '管理数据修订号无效，请刷新后重试')
        if (body.revision !== read().revision) throw new HttpError(409, '管理数据已更新，请刷新后重试，避免覆盖其他修改')
        json(response, 200, service.restoreBackup(decodeURIComponent(backupRoute[1]), body.revision!))
        return
      }
      if (backupRoute) throw new HttpError(405, '不支持的请求方法')
      if (pathname === `${basePath}/migrate` && request.method === 'POST') {
        const body = await readBody(request) as { data?: unknown }
        const current = read()
        if (hasManagementData(current)) { json(response, 200, current); return }
        const legacy = validateManagementState(body?.data)
        if (!hasManagementData(legacy)) { json(response, 200, current); return }
        service.backup(current, 'migration')
        service.backup(legacy, 'migration')
        storage.set(MANAGEMENT_STORAGE_KEY, legacy)
        json(response, 200, read())
        return
      }
      if (pathname === `${basePath}/mutate` && request.method === 'POST') {
        const body = await readBody(request) as ManagementMutation
        if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new HttpError(400, '管理数据修订号无效，请刷新后重试')
        if (body.revision !== read().revision) throw new HttpError(409, '管理数据已更新，请刷新后重试，避免覆盖其他修改')
        json(response, 200, service.mutate(body))
        return
      }
      if ([basePath, `${basePath}/backup`, `${basePath}/backups`, `${basePath}/migrate`, `${basePath}/mutate`].includes(pathname)) throw new HttpError(405, '不支持的请求方法')
      throw new HttpError(404, '管理数据接口不存在')
    } catch (error) {
      const status = error instanceof HttpError ? error.status : (error as NodeJS.ErrnoException).code ? 500 : 400
      json(response, status, { error: error instanceof Error ? error.message : '管理数据处理失败' })
    }
  }
}
