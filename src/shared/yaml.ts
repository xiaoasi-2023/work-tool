import { isLosslessNumber, isSafeNumber } from 'lossless-json'
import { parseDocument, stringify } from 'yaml'
import { parseJson, printJson, type JsonValue } from './json'

export function jsonToYaml(text: string): string {
  function convert(value: JsonValue): unknown {
    if (isLosslessNumber(value)) {
      if (/^-?\d+$/.test(value.value)) return BigInt(value.value)
      if (!isSafeNumber(value.value)) throw new Error('此数值超出 YAML 转换的精度范围，请保留 JSON 或改为字符串')
      return Number(value.value)
    }
    if (Array.isArray(value)) return value.map(convert)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)]))
    return value
  }
  return stringify(convert(parseJson(text)), { lineWidth: 0 })
}
export function yamlToJson(text: string, indent: number | string = 2): string {
  const document = parseDocument(text, { intAsBigInt: true, uniqueKeys: true })
  if (document.errors.length) throw new Error(document.errors[0]!.message)
  const ancestors = new Set<object>()
  function convert(value: unknown): JsonValue {
    if (typeof value === 'bigint') return parseJson(String(value))
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('JSON 不支持 Infinity 或 NaN')
      return parseJson(String(value))
    }
    if (value && typeof value === 'object') {
      if (ancestors.has(value)) throw new Error('JSON 不支持循环引用')
      ancestors.add(value)
      try {
        if (Array.isArray(value)) return value.map(convert)
        if (value instanceof Map) {
          if ([...value.keys()].some(key => typeof key !== 'string')) throw new Error('JSON 仅支持字符串键的对象')
          return Object.fromEntries([...value.entries()].map(([key, item]) => [key, convert(item)]))
        }
        throw new Error('此 YAML 类型不能转换为 JSON')
      } finally { ancestors.delete(value) }
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    throw new Error('此 YAML 类型不能转换为 JSON')
  }
  // Reject rounded floating-point scalars before conversion.
  const check = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (typeof node.value === 'number' && Number.isFinite(node.value) && typeof node.source === 'string') {
      const source = node.source.replace(/_/g, '').replace(/^\+/, '').replace(/^(-?)\./, (_: string, sign: string) => `${sign}0.`).replace(/\.(?=[eE]|$)/, '.0')
      if (!isSafeNumber(source)) throw new Error('YAML 小数超出安全精度范围，请将其改为字符串')
    }
    if (Array.isArray(node.items)) node.items.forEach(check)
    if ('key' in node) check(node.key)
    if ('value' in node && node.value && typeof node.value === 'object') check(node.value)
  }
  check(document.contents)
  return printJson(convert(document.toJS({ maxAliasCount: 100, mapAsMap: true })), indent)
}
