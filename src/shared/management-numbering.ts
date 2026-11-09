import type { ManagementCommand, ManagementState } from './management'

type NumberedEntity = 'projects' | 'requirements'
const token = '(?:销\\d{6}-\\d+|[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+)'
const prefixPattern = new RegExp(`^(${token})(?=$|[\\s·:：、])(?:\\s*[·:：、]\\s*|\\s+)?(.*)$`, 'i')
const bracketPattern = new RegExp(`^[\\[【(（]\\s*(${token})\\s*[\\]】)）]\\s*[·:：、]?\\s*(.*)$`, 'i')

export function normalizeManagementCode(value: unknown, label: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > 80) throw new Error(`${label}格式无效，最多80个字符`)
  const code = value.trim().toUpperCase()
  if (code && !/^[\p{L}\p{N}][\p{L}\p{N}._:/-]*$/u.test(code)) throw new Error(`${label}只允许文字、数字和 . _ : / -，不能包含空格`)
  return code
}

export function extractRequirementCode(title: string): { code: string; title: string } | null {
  const value = title.trim()
  const tapd = /^(?:TAPD\s+|TAPD\s*[-_#：:]\s*)(\d+)(?=$|[\s·:：、])(?:\s*[·:：、]\s*|\s+)?(.*)$/i.exec(value)
  if (tapd) return { code: normalizeManagementCode(`TAPD-${tapd[1]}`, '需求编号'), title: tapd[2].trim() || value }
  const match = bracketPattern.exec(value) || prefixPattern.exec(value)
  if (!match || !/\d/.test(match[1])) return null
  return { code: normalizeManagementCode(match[1], '需求编号'), title: match[2].trim() || value }
}

export function nextManagementCode(state: ManagementState, entity: NumberedEntity): string {
  const prefix = entity === 'projects' ? 'PRJ-' : 'REQ-', width = entity === 'projects' ? 4 : 6
  const used = new Set<string>()
  const remember = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') return
    const record = entry as Record<string, unknown>
    if (typeof record.code === 'string' && record.code.trim()) used.add(record.code.trim().toUpperCase())
    else if (entity === 'requirements' && typeof record.title === 'string') {
      const embedded = extractRequirementCode(record.title)
      if (embedded) used.add(embedded.code)
    }
  }
  state[entity].forEach(remember)
  for (const entry of state.audit) if (entry.action.startsWith(`${entity}.`)) { remember(entry.before); remember(entry.after) }
  let sequence = 0
  for (const code of used) if (code.startsWith(prefix) && /^\d+$/.test(code.slice(prefix.length))) {
    const value = Number(code.slice(prefix.length))
    if (Number.isSafeInteger(value)) sequence = Math.max(sequence, value)
  }
  if (!Number.isSafeInteger(sequence + 1)) throw new Error('自动编号已超出可用范围，请手动填写编号')
  return `${prefix}${String(sequence + 1).padStart(width, '0')}`
}

export function prepareManagementNumberingBackfill(state: ManagementState): ManagementCommand | null {
  const working = structuredClone(state), commands: ManagementCommand[] = []
  // Reserve every embedded identifier before assigning generated numbers.
  for (const requirement of working.requirements) if (!requirement.code) requirement.code = extractRequirementCode(requirement.title)?.code || ''
  for (const entity of ['projects', 'requirements'] as const) {
    for (const entry of working[entity]) {
      const original = state[entity].find(item => item.id === entry.id)!
      entry.code ||= nextManagementCode(working, entity)
      const value: Record<string, unknown> = { id: entry.id }
      if (original.code !== entry.code) value.code = entry.code
      if (entity === 'requirements' && 'title' in entry) {
        const embedded = extractRequirementCode(entry.title)
        if (embedded?.code === entry.code && embedded.title !== entry.title) value.title = embedded.title
      }
      if (Object.keys(value).length > 1) commands.push({ type: 'upsert', entity, value })
    }
  }
  return commands.length ? { type: 'batch', commands, reason: '补齐项目与需求编号，提取既有编号并从需求标题中移出；其余记录生成唯一编号' } : null
}
