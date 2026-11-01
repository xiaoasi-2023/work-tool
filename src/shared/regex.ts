export interface RegexMatch { index: number; value: string; groups: (string | undefined)[]; named?: Record<string, string> }
export function executeRegex(pattern: string, flags: string, text: string, replacement: string) {
  if (text.length > 200000 || pattern.length > 2000) throw new Error('文本上限 20 万字符，表达式上限 2000 字符')
  const expression = new RegExp(pattern, flags)
  const matches: RegexMatch[] = []
  let match: RegExpExecArray | null, truncated = false
  while ((match = expression.exec(text))) {
    if (matches.length >= 1000) { truncated = true; break }
    matches.push({ index: match.index, value: match[0], groups: match.slice(1), named: match.groups })
    if (!expression.global) break
    if (!match[0]) {
      const point = text.codePointAt(expression.lastIndex)
      expression.lastIndex += expression.unicode && point !== undefined && point > 0xffff ? 2 : 1
    }
  }
  return { matches, truncated, output: text.replace(new RegExp(pattern, flags), replacement) }
}
