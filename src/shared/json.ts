import { isLosslessNumber, parse, stringify, type LosslessNumber } from 'lossless-json'

export type JsonValue = null | boolean | string | LosslessNumber | JsonValue[] | { [key: string]: JsonValue }
export type JsonPath = (string | number)[]
export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
export type JsonMutation =
  | { action: 'edit'; path: JsonPath; key?: string; value: JsonValue }
  | { action: 'add'; path: JsonPath; key: string; value: JsonValue }
  | { action: 'delete'; path: JsonPath }

export function parseJson(text: string): JsonValue { return parse(text) as JsonValue }
export function printJson(value: JsonValue, indent: number | string = 2): string { return stringify(value, undefined, indent) ?? 'null' }
export function jsonKind(value: JsonValue): JsonKind {
  if (value === null) return 'null'
  if (isLosslessNumber(value)) return 'number'
  if (Array.isArray(value)) return 'array'
  return typeof value as 'object' | 'boolean' | 'string'
}
export function isContainer(value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !isLosslessNumber(value)
}
export function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson)
  if (isContainer(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]))
  return value
}
export function jsonPointer(path: JsonPath): string { return path.map(key => `/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('') }
export function valueAt(root: JsonValue, path: JsonPath): JsonValue {
  let value = root
  for (const key of path) {
    if (!isContainer(value) || !Object.hasOwn(value, key)) throw new Error('字段已不存在')
    value = (value as Record<string | number, JsonValue>)[key]
  }
  return value
}
export function mutateJson(text: string, mutation: JsonMutation, indent: number | string = 2): string {
  let root = parseJson(text)
  if (mutation.action === 'add') {
    const target = valueAt(root, mutation.path)
    if (!isContainer(target)) throw new Error('只能向对象或数组添加内容')
    if (Array.isArray(target)) {
      if (!/^(0|[1-9]\d*)$/.test(mutation.key)) throw new Error('请输入有效的数组索引')
      const index = Number(mutation.key)
      if (!Number.isSafeInteger(index) || index > target.length) throw new Error('数组索引超出范围')
      target.splice(index, 0, mutation.value)
    } else {
      if (Object.hasOwn(target, mutation.key)) throw new Error('字段名已存在')
      Object.defineProperty(target, mutation.key, { value: mutation.value, enumerable: true, configurable: true, writable: true })
    }
  } else if (!mutation.path.length) {
    if (mutation.action === 'delete') throw new Error('根节点不能删除，请编辑根节点')
    root = mutation.value
  } else {
    const key = mutation.path[mutation.path.length - 1]
    const parent = valueAt(root, mutation.path.slice(0, -1))
    if (!isContainer(parent) || !Object.hasOwn(parent, key)) throw new Error('字段已不存在')
    if (Array.isArray(parent)) {
      if (typeof key !== 'number') throw new Error('数组索引无效')
      if (mutation.action === 'delete') parent.splice(key, 1)
      else parent[key] = mutation.value
    } else if (mutation.action === 'delete') delete parent[key]
    else {
      const nextKey = mutation.key ?? String(key)
      if (nextKey !== String(key) && Object.hasOwn(parent, nextKey)) throw new Error('字段名已存在')
      if (nextKey !== String(key)) delete parent[key]
      Object.defineProperty(parent, nextKey, { value: mutation.value, enumerable: true, configurable: true, writable: true })
    }
  }
  return printJson(root, indent)
}

export function parseField(text: string, kind: JsonKind): JsonValue {
  if (kind === 'string') return text
  if (kind === 'null') return null
  const value = parseJson(text)
  if (jsonKind(value) !== kind) throw new Error(`值的类型必须是 ${kind}`)
  return value
}
