import { encode, decode } from 'he'
import { jwtDecode, type JwtPayload } from 'jwt-decode'
import { v4, v7 } from 'uuid'

export type Codec = 'base64' | 'base64url' | 'url' | 'unicode' | 'html'
export function convertText(text: string, codec: Codec, decoding: boolean): string {
  if (codec === 'url') return decoding ? decodeURIComponent(text) : encodeURIComponent(text)
  if (codec === 'html') return decoding ? decode(text) : encode(text, { useNamedReferences: true })
  if (codec === 'unicode') {
    if (!decoding) return text.split('').map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')
    return text.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g, (_, point, unit) => {
      const value = parseInt(point || unit, 16)
      if (value > 0x10ffff) throw new Error('Unicode 码点超出范围')
      return point ? String.fromCodePoint(value) : String.fromCharCode(value)
    })
  }
  if (decoding) {
    const source = text.replace(/\s/g, '')
    const alphabet = codec === 'base64url' ? /^[\w-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/
    if (!alphabet.test(source) || source.replace(/=/g, '').length % 4 === 1) throw new Error('Base64 格式无效')
    const raw = atob(source.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0)))
  }
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const result = btoa(binary)
  return codec === 'base64url' ? result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : result
}

export function inspectJwt(text: string) {
  const token = text.trim().replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts.every(part => /^[\w-]*$/.test(part))) throw new Error('请输入三段式 JWT')
  const header = jwtDecode<Record<string, unknown>>(token, { header: true })
  const payload = jwtDecode<JwtPayload & Record<string, unknown>>(token)
  if (!header || typeof header !== 'object' || Array.isArray(header) || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Header 和 Payload 必须为 JSON 对象')
  for (const claim of ['exp', 'nbf', 'iat']) if (payload[claim] !== undefined && (typeof payload[claim] !== 'number' || !Number.isFinite(payload[claim]) || Math.abs(payload[claim] as number) > 8640000000000)) throw new Error(`${claim} 必须是有效的秒时间戳`)
  return { header, payload, signature: parts[2] }
}
export function jwtStatus(payload: JwtPayload, now = Date.now() / 1000) {
  if (payload.exp !== undefined && now >= payload.exp) return '已过期'
  if (payload.nbf !== undefined && now < payload.nbf) return '尚未生效'
  return payload.exp === undefined ? '未设置过期时间' : '有效期内'
}

function randomIndex(max: number) {
  const limit = 0x100000000 - (0x100000000 % max), bytes = new Uint32Array(1)
  do { crypto.getRandomValues(bytes) } while (bytes[0]! >= limit)
  return bytes[0]! % max
}
export function randomString(length: number, groups: string[]) {
  if (!Number.isInteger(length) || length < 1 || length > 1024) throw new Error('长度范围为 1–1024')
  const sets = groups.filter(Boolean)
  if (!sets.length) throw new Error('至少选择一种字符')
  const alphabet = [...new Set(sets.join(''))].join('')
  if (alphabet.length > 256 || length < sets.length) throw new Error('长度不能少于所选字符种类数')
  const chars = sets.map(set => set[randomIndex(set.length)]!)
  while (chars.length < length) chars.push(alphabet[randomIndex(alphabet.length)]!)
  for (let i = chars.length - 1; i > 0; i--) { const j = randomIndex(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!] }
  return chars.join('')
}
export function generateValues(kind: 'v4' | 'v7' | 'string' | 'password', count: number, length: number, groups: string[], uppercase = false, hyphens = true) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('生成数量范围为 1–1000')
  return Array.from({ length: count }, () => {
    if (kind === 'string' || kind === 'password') return randomString(length, groups)
    let value = kind === 'v4' ? v4() : v7()
    if (!hyphens) value = value.replace(/-/g, '')
    return uppercase ? value.toUpperCase() : value
  }).join('\n')
}

export type TextAction = 'dedupe' | 'trim' | 'empty' | 'asc' | 'desc' | 'reverse' | 'upper' | 'lower' | 'number' | 'prefix'
export function processText(text: string, action: TextAction, options: { trim: boolean; ignoreEmpty: boolean; ignoreCase: boolean; sort: string; prefix?: string; suffix?: string }) {
  if (action === 'upper') return text.toUpperCase()
  if (action === 'lower') return text.toLowerCase()
  let lines = text.split(/\r?\n/)
  if (action === 'dedupe') {
    const seen = new Set<string>()
    lines = lines.map(line => options.trim ? line.trim() : line).filter(line => {
      if (options.ignoreEmpty && !line.trim()) return false
      const key = options.ignoreCase ? line.toLowerCase() : line
      if (seen.has(key)) return false
      seen.add(key); return true
    })
    if (options.sort !== 'none') lines.sort((a, b) => a.localeCompare(b, 'zh-CN') * (options.sort === 'asc' ? 1 : -1))
  } else if (action === 'trim') lines = lines.map(line => line.trim())
  else if (action === 'empty') lines = lines.filter(line => line.trim())
  else if (action === 'reverse') lines.reverse()
  else if (action === 'asc' || action === 'desc') lines.sort((a, b) => a.localeCompare(b, 'zh-CN') * (action === 'asc' ? 1 : -1))
  else if (action === 'number') lines = lines.map((line, i) => `${i + 1}. ${line}`)
  else if (action === 'prefix') lines = lines.map(line => `${options.prefix || ''}${line}${options.suffix || ''}`)
  return lines.join('\n')
}
