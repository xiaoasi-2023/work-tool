import { extractRequirementCode, nextManagementCode, normalizeManagementCode } from './management-numbering'

export const managementRoles = ['product', 'frontend', 'backend', 'qa', 'other'] as const
export type ManagementRole = typeof managementRoles[number]
export const managementStages = ['design', 'documentation', 'frontend', 'backend', 'integration', 'testing', 'release', 'other'] as const
export type ManagementStage = typeof managementStages[number]
export const roleLabels: Record<ManagementRole, string> = { product: '产品', frontend: '前端', backend: '后端', qa: '测试', other: '其他' }
export const stageLabels: Record<ManagementStage, string> = { design: '原型设计', documentation: 'TAPD文档', frontend: '前端开发', backend: '后端开发', integration: '联调', testing: '测试', release: '上线', other: '其他' }
export const productStageLabels = { design: '原型设计', documentation: 'TAPD文档', unclassified: '产品未细分' } as const
export const taskStatusLabels = { pending: '未开始', active: '进行中', blocked: '阻塞', done: '已完成', cancelled: '已取消' } as const
export type ManagementTaskStatus = keyof typeof taskStatusLabels
export const phaseLabels = { discovery: '需求确认', ready: '待开发', development: '开发中', developed: '开发完成', integration: '联调中', testing: '测试中', release: '待上线', released: '已上线', accepted: '已验收' } as const
export type ManagementPhase = keyof typeof phaseLabels
export const requirementPhaseLabels = { ...phaseLabels, completed: '已完成' } as const
export type ManagementRequirementPhase = keyof typeof requirementPhaseLabels

export interface ManagementProject { id: string; code: string; name: string; ownerId: string; modules: string[]; status: 'active' | 'paused' | 'archived'; notes: string }
export interface ManagementPerson { id: string; name: string; roles: ManagementRole[]; weeklyCapacity: number; active: boolean; notes: string; sortOrder?: number }
export interface ManagementVersion {
  id: string; projectId: string; code: string; name: string; ownerId: string; scope: string; notes: string;
  status: 'active' | 'paused' | 'archived' | 'cancelled'; plannedStart: string; plannedDevEnd: string; plannedTestEnd: string; plannedRelease: string;
  startedAt: string; devCompletedAt: string; submittedAt: string; testStartedAt: string; testCompletedAt: string; releasedAt: string; estimatedHours: number | null;
}
export interface ManagementRequirement {
  id: string; code: string; projectId: string; versionId: string; title: string; module: string; platforms: string[]; kind: string;
  priority: 'urgent' | 'high' | 'normal' | 'low'; ownerId: string; description: string; acceptance: string; externalUrl: string;
  phase: ManagementPhase; status: 'active' | 'paused' | 'cancelled'; closing: 'release' | 'acceptance'; dueDate: string;
  nextAction: string; nextOwnerId: string; followUpDate: string; devCompletedAt: string; submittedAt: string; testCompletedAt: string; releasedAt: string; notes: string;
  plannedStartWeek?: string; plannedEndWeek?: string; completedWeek?: string;
}
export interface ManagementTask {
  id: string; requirementId: string; name: string; stage: ManagementStage; role: ManagementRole; ownerId: string;
  complexity: string; estimatedHours: number | null; remainingHours: number | null; status: ManagementTaskStatus; progress: number;
  dependencies: string[]; dueDate: string; startedAt: string; completedAt: string; blockedReason: string; notes: string;
  plannedStartWeek?: string; plannedEndWeek?: string; completedWeek?: string;
}
export interface ManagementPlan {
  id: string; projectId: string; versionId: string; week: string; personId: string; role: ManagementRole; stage: ManagementStage;
  taskIds: string[]; title: string; goal: string; plannedHours: number | null; status: 'draft' | 'confirmed' | 'cancelled';
  outcome: 'pending' | 'partial' | 'done' | 'blocked' | 'cancelled'; source: 'planned' | 'carryover' | 'urgent'; sourcePlanId: string; notes: string;
  baselineWeek?: string; baselineHours?: number | null; completedWeek?: string;
}
export interface ManagementEffort {
  id: string; projectId: string; versionId: string; personId: string; role: ManagementRole; stage: ManagementStage; week: string;
  hours: number; planId: string; taskIds: string[]; kind: 'normal' | 'rework' | 'support' | 'other'; notes: string; workContent?: string; coveredStart?: string; coveredEnd?: string;
  hoursSource?: 'reported' | 'allocated'; allocationWeight?: number;
}
export interface ManagementBaseline {
  id: string; projectId: string; versionId: string; personId: string; peopleLabel: string; role: ManagementRole; stage?: ManagementStage; taskId?: string; hours: number; asOf: string; source: string; notes: string;
}
export interface ManagementCapacity { id: string; personId: string; week: string; hours: number; notes: string }
export interface ManagementWeekActual { id: string; personId: string; week: string; hours: number; basis: 'confirmed' | 'standard'; notes: string }
export interface ManagementAudit { id: string; time: string; action: string; entityId: string; reason: string; before: unknown; after: unknown }
export interface ManagementSnapshot {
  id: string; week: string; revision: number; createdAt: string; note: string;
  data: { projects: ManagementProject[]; people: ManagementPerson[]; versions: ManagementVersion[]; requirements: ManagementRequirement[]; tasks: ManagementTask[]; plans: ManagementPlan[]; efforts: ManagementEffort[]; baselines: ManagementBaseline[]; capacities: ManagementCapacity[]; weekActuals?: ManagementWeekActual[] };
}
export interface ManagementState {
  schemaVersion: 1; revision: number; projects: ManagementProject[]; people: ManagementPerson[]; versions: ManagementVersion[];
  requirements: ManagementRequirement[]; tasks: ManagementTask[]; plans: ManagementPlan[]; efforts: ManagementEffort[];
  baselines: ManagementBaseline[]; capacities: ManagementCapacity[]; weekActuals: ManagementWeekActual[]; snapshots: ManagementSnapshot[]; audit: ManagementAudit[];
}
export const managementEntities = ['projects', 'people', 'versions', 'requirements', 'tasks', 'plans', 'efforts', 'baselines', 'capacities', 'weekActuals'] as const
export type ManagementEntity = typeof managementEntities[number]
export type ManagementCommand =
  | { type: 'upsert'; entity: ManagementEntity; value: Record<string, unknown>; reason?: string }
  | { type: 'delete'; entity: ManagementEntity; id: string; reason?: string }
  | { type: 'carryover'; planId: string; week: string; plannedHours: number | null; goal?: string; reason?: string }
  | { type: 'snapshot'; week: string; note?: string }
  | { type: 'clear-requirement-details'; requirementIds: string[]; reason: string }
  | { type: 'clear-requirement-history'; requirementIds: string[]; reason: string }
  | { type: 'project-module'; projectId: string; action: 'create'; name: string; reason?: string }
  | { type: 'project-module'; projectId: string; action: 'rename'; name: string; newName: string; reason?: string }
  | { type: 'project-module'; projectId: string; action: 'delete'; name: string; targetModule: string; confirmedRequirementIds: string[]; reason: string }
  | { type: 'batch'; commands: ManagementCommand[]; reason?: string }
  | { type: 'restore'; data: unknown; reason?: string }
export interface ManagementMutation { revision: number; command: ManagementCommand }
export interface ManagementAlert { id: string; severity: 'warning' | 'danger' | 'info'; title: string; detail: string; entity: 'requirement' | 'task' | 'version' | 'person' | 'plan'; entityId: string; projectId: string }
export interface ManagementVersionSummary { versionId: string; hours: number; days: number; baselineHours: number; plannedHours: number; byRole: Record<ManagementRole, number>; byProductStage: Record<keyof typeof productStageLabels, number>; developmentDays: number | null }
export interface ManagementTaskEffortSummary { hours: number | null; sharedHours: number; efforts: ManagementEffort[]; sharedEfforts: ManagementEffort[]; baselines: ManagementBaseline[] }
export interface ManagementTaskEffortWeek { week: string; coveredStart: string; coveredEnd: string; hours: number; cumulativeHours: number; efforts: ManagementEffort[] }
export interface ManagementProductContribution { personId: string; peopleLabel: string; stage: ManagementStage; hours: number }
export interface ManagementRequirementRoleWork extends ManagementTaskEffortSummary { taskIds: string[]; ownerIds: string[] }
export interface ManagementRequirementWork {
  byRole: Record<ManagementRole, ManagementRequirementRoleWork>;
  versionProduct: { ownerIds: string[]; peopleLabels: string[]; hours: number | null };
}
export interface ManagementModuleSummary { name: string; requirementIds: string[]; activeCount: number }
export interface ManagementWeekSummary { week: string; plannedHours: number; actualHours: number; plans: number; completed: number; people: { personId: string; plannedHours: number; actualHours: number; capacity: number; load: number | null }[] }

export function emptyManagementState(): ManagementState {
  return { schemaVersion: 1, revision: 0, projects: [], people: [], versions: [], requirements: [], tasks: [], plans: [], efforts: [], baselines: [], capacities: [], weekActuals: [], snapshots: [], audit: [] }
}

export function hasManagementData(state: ManagementState): boolean {
  return state.revision > 0 || managementEntities.some(entity => state[entity].length > 0) || state.snapshots.length > 0 || state.audit.length > 0
}

export function sortManagementPeople(people: readonly ManagementPerson[]): ManagementPerson[] {
  return people.map((person, index) => ({ person, index, order: person.sortOrder ?? index + 1 }))
    .sort((a, b) => a.order - b.order || a.index - b.index).map(item => item.person)
}
export function nextPersonSortOrder(people: readonly ManagementPerson[]): number {
  return Math.min(1000000, people.reduce((highest, person, index) => Math.max(highest, person.sortOrder ?? index + 1), 0) + 1)
}

type Entry = ManagementState[ManagementEntity][number]
type JsonRecord = Record<string, unknown>
function object(value: unknown, label = '数据'): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式无效`)
  return value as JsonRecord
}
function text(value: unknown, label: string, fallback = '', required = false, max = 10000): string {
  if (value === undefined) value = fallback
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}格式无效`)
  const result = value.trim()
  if (required && !result) throw new Error(`请填写${label}`)
  return result
}
function choice<T extends string>(value: unknown, options: readonly T[], fallback: T, label: string): T {
  if (value === undefined) return fallback
  if (!options.includes(value as T)) throw new Error(`${label}无效`)
  return value as T
}
function amount(value: unknown, label: string, fallback: number | null = 0, nullable = false): number | null {
  if (value === undefined) return fallback
  if (value === null && nullable) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000) throw new Error(`${label}必须为非负有效数字`)
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}
function hours(value: unknown, label = '工时', fallback = 0): number { return amount(value, label, fallback) as number }
function strings(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 1000) throw new Error(`${label}格式无效`)
  const result = value.map(v => text(v, label, '', true, 500))
  if (new Set(result).size !== result.length) throw new Error(`${label}包含重复项`)
  return result
}
function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error('启用状态格式无效')
  return value
}
function identifier(value: unknown, required = false): string {
  const id = text(value, '编号', '', required, 128)
  if (id && !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id)) throw new Error('编号包含无效字符')
  return id
}
export function isManagementDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function managementToday(value = new Date()): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function dateValue(value: unknown, label: string, required = false): string {
  const date = text(value, label)
  if ((!date && required) || (date && !isManagementDate(date))) throw new Error(`${label}必须是有效日期`)
  return date
}
export function weekStart(value: string | Date = new Date()): string {
  const source = typeof value === 'string' ? value : managementToday(value)
  if (!isManagementDate(source)) throw new Error('周次必须是有效日期')
  const date = new Date(`${source}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return date.toISOString().slice(0, 10)
}
export function addWeeks(week: string, count = 1): string {
  if (!Number.isInteger(count) || Math.abs(count) > 10000) throw new Error('周数无效')
  const date = new Date(`${weekStart(week)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count * 7)
  return date.toISOString().slice(0, 10)
}
export function weekEnd(week: string): string {
  const date = new Date(`${weekStart(week)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 6)
  return date.toISOString().slice(0, 10)
}
function weekValue(value: unknown): string {
  const date = dateValue(value, '所属周', true)
  if (weekStart(date) !== date) throw new Error('所属周请使用周一日期')
  return date
}
function scheduleWeeks(raw: JsonRecord): { plannedStartWeek?: string; plannedEndWeek?: string; completedWeek?: string } {
  const result: { plannedStartWeek?: string; plannedEndWeek?: string; completedWeek?: string } = {}
  for (const key of ['plannedStartWeek', 'plannedEndWeek', 'completedWeek'] as const) if (raw[key] !== undefined) result[key] = raw[key] === '' ? '' : weekValue(raw[key])
  checkOrder(result.plannedStartWeek || '', result.plannedEndWeek || '', '计划完成周')
  return result
}
export function sumHours(values: number[]): number { return Math.round(values.reduce((sum, n) => sum + Math.round(n * 10000), 0)) / 10000 }
export function hoursToDays(value: number): number { return Math.round(value / 8 * 10000) / 10000 }
export function developmentDays(start: string, end: string): number | null {
  if (!isManagementDate(start) || !isManagementDate(end) || end < start) return null
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
}
function normalize(entity: ManagementEntity, raw: JsonRecord, id: string): Entry {
  const t = (key: string, label = key, required = false) => text(raw[key], label, '', required)
  const ref = (key: string) => identifier(raw[key])
  const d = (key: string, label = key) => dateValue(raw[key], label)
  const role = () => choice(raw.role, managementRoles, 'other', '投入角色')
  const stage = () => choice(raw.stage, managementStages, 'other', '工作环节')
  switch (entity) {
    case 'projects': return { id, code: normalizeManagementCode(raw.code, '项目编号'), name: t('name', '项目名称', true), ownerId: ref('ownerId'), modules: strings(raw.modules, '模块'), status: choice(raw.status, ['active', 'paused', 'archived'], 'active', '项目状态'), notes: t('notes') }
    case 'people': {
      if (raw.sortOrder !== undefined && (typeof raw.sortOrder !== 'number' || !Number.isSafeInteger(raw.sortOrder) || raw.sortOrder < 0 || raw.sortOrder > 1000000)) throw new Error('人员排序必须为0至1000000的整数')
      return { id, name: t('name', '姓名', true), roles: strings(raw.roles, '角色').map(r => choice(r, managementRoles, 'other', '角色')), weeklyCapacity: hours(raw.weeklyCapacity, '每周可用工时', 40), active: flag(raw.active, true), notes: t('notes'), ...(raw.sortOrder === undefined ? {} : { sortOrder: raw.sortOrder as number }) }
    }
    case 'versions': return {
      id, projectId: ref('projectId'), code: t('code', '版本标识') || `UPD-${id.slice(0, 8)}`, name: t('name', '版本名称', true), ownerId: ref('ownerId'), scope: t('scope'), notes: t('notes'),
      status: choice(raw.status, ['active', 'paused', 'archived', 'cancelled'], 'active', '版本状态'), plannedStart: d('plannedStart', '计划开始日期'), plannedDevEnd: d('plannedDevEnd', '计划开发完成日期'), plannedTestEnd: d('plannedTestEnd', '计划测试完成日期'), plannedRelease: d('plannedRelease', '计划上线日期'),
      startedAt: d('startedAt', '开发开始日期'), devCompletedAt: d('devCompletedAt', '开发完成日期'), submittedAt: d('submittedAt', '提测日期'), testStartedAt: d('testStartedAt', '测试开始日期'), testCompletedAt: d('testCompletedAt', '测试完成日期'), releasedAt: d('releasedAt', '实际上线日期'), estimatedHours: amount(raw.estimatedHours, '预计投入', null, true)
    }
    case 'requirements': return {
      code: normalizeManagementCode(raw.code, '需求编号'),
      id, projectId: ref('projectId'), versionId: ref('versionId'), title: t('title', '需求标题', true), module: t('module'), platforms: strings(raw.platforms, '需求端'), kind: t('kind') || '功能', priority: choice(raw.priority, ['urgent', 'high', 'normal', 'low'], 'normal', '优先级'), ownerId: ref('ownerId'), description: t('description'), acceptance: t('acceptance'), externalUrl: t('externalUrl'),
      phase: choice(raw.phase, Object.keys(phaseLabels) as ManagementPhase[], 'discovery', '需求阶段'), status: choice(raw.status, ['active', 'paused', 'cancelled'], 'active', '需求状态'), closing: choice(raw.closing, ['release', 'acceptance'], 'release', '结束条件'), dueDate: d('dueDate', '交付日期'), nextAction: t('nextAction'), nextOwnerId: ref('nextOwnerId'), followUpDate: d('followUpDate', '跟进日期'), devCompletedAt: d('devCompletedAt', '开发完成日期'), submittedAt: d('submittedAt', '提测日期'), testCompletedAt: d('testCompletedAt', '测试完成日期'), releasedAt: d('releasedAt', '上线日期'), notes: t('notes'), ...scheduleWeeks(raw)
    }
    case 'tasks': {
      const status = choice(raw.status, Object.keys(taskStatusLabels) as ManagementTaskStatus[], 'pending', '任务状态')
      let progress = amount(raw.progress, '进度', 0) as number
      if (progress > 100) throw new Error('进度不能超过100%')
      if (status === 'pending') progress = 0
      else if (status === 'done') progress = 100
      else if (status !== 'cancelled' && progress === 100) throw new Error('进行中任务请先确认完成再设为100%')
      const blockedReason = t('blockedReason')
      if (status === 'blocked' && !blockedReason) throw new Error('请填写阻塞原因')
      return { id, requirementId: ref('requirementId'), name: t('name', '任务名称', true), stage: stage(), role: role(), ownerId: ref('ownerId'), complexity: t('complexity'), estimatedHours: amount(raw.estimatedHours, '预计工时', null, true), remainingHours: amount(raw.remainingHours, '剩余工时', null, true), status, progress, dependencies: strings(raw.dependencies, '前置任务'), dueDate: d('dueDate', '任务计划完成日期'), startedAt: d('startedAt', '任务开始日期'), completedAt: d('completedAt', '任务完成日期'), blockedReason, notes: t('notes'), ...scheduleWeeks(raw) }
    }
    case 'plans': return { id, projectId: ref('projectId'), versionId: ref('versionId'), week: weekValue(raw.week), personId: ref('personId'), role: role(), stage: stage(), taskIds: strings(raw.taskIds, '任务范围'), title: t('title', '排期标题', true), goal: t('goal'), plannedHours: amount(raw.plannedHours, '预计工时', null, true), status: choice(raw.status, ['draft', 'confirmed', 'cancelled'], 'draft', '计划状态'), outcome: choice(raw.outcome, ['pending', 'partial', 'done', 'blocked', 'cancelled'], 'pending', '本周结果'), source: choice(raw.source, ['planned', 'carryover', 'urgent'], 'planned', '工作来源'), sourcePlanId: ref('sourcePlanId'), notes: t('notes'),
      ...(raw.baselineWeek === undefined ? {} : { baselineWeek: raw.baselineWeek === '' ? '' : weekValue(raw.baselineWeek) }), ...(raw.baselineHours === undefined ? {} : { baselineHours: amount(raw.baselineHours, '原预计工时', null, true) }), ...(raw.completedWeek === undefined ? {} : { completedWeek: raw.completedWeek === '' ? '' : weekValue(raw.completedWeek) }) }
    case 'efforts': {
      const week = weekValue(raw.week), end = weekEnd(week)
      const coveredStart = raw.coveredStart === undefined || raw.coveredStart === '' ? week : dateValue(raw.coveredStart, '投入覆盖开始日期', true)
      const coveredEnd = raw.coveredEnd === undefined || raw.coveredEnd === '' ? end : dateValue(raw.coveredEnd, '投入覆盖结束日期', true)
      if (coveredStart < week || coveredEnd > end || coveredEnd < coveredStart) throw new Error('投入覆盖日期必须按先后顺序落在所属周内')
      const hoursSource = raw.hoursSource === undefined ? undefined : choice(raw.hoursSource, ['reported', 'allocated'], 'reported', '工时来源')
      return { id, projectId: ref('projectId'), versionId: ref('versionId'), personId: ref('personId'), role: role(), stage: stage(), week, hours: hours(raw.hours, '实际投入'), planId: ref('planId'), taskIds: strings(raw.taskIds, '关联任务'), kind: choice(raw.kind, ['normal', 'rework', 'support', 'other'], 'normal', '投入类型'), notes: t('notes'), ...(raw.workContent === undefined ? {} : { workContent: t('workContent', '实际工作内容') }), coveredStart, coveredEnd,
        ...(hoursSource ? { hoursSource } : {}), ...(hoursSource === 'allocated' ? { allocationWeight: hours(raw.allocationWeight, '分摊权重') } : {}) }
    }
    case 'baselines': return { id, projectId: ref('projectId'), versionId: ref('versionId'), personId: ref('personId'), peopleLabel: t('peopleLabel'), role: role(), ...(raw.stage === undefined ? {} : { stage: stage() }), ...(raw.taskId === undefined || raw.taskId === '' ? {} : { taskId: ref('taskId') }), hours: hours(raw.hours, '期初投入'), asOf: dateValue(raw.asOf, '截至日期', true), source: t('source'), notes: t('notes') }
    case 'capacities': return { id, personId: ref('personId'), week: weekValue(raw.week), hours: hours(raw.hours, '本周可用工时'), notes: t('notes') }
    case 'weekActuals': return { id, personId: ref('personId'), week: weekValue(raw.week), hours: hours(raw.hours, '本周总实际投入'), basis: choice(raw.basis, ['confirmed', 'standard'], 'confirmed', '周工时确认依据'), notes: t('notes') }
  }
}

function requireRef<T extends { id: string }>(items: T[], id: string, label: string, optional = false): T | undefined {
  if (!id && optional) return undefined
  const entry = items.find(v => v.id === id)
  if (!entry) throw new Error(`${label}不存在或已被移除`)
  return entry
}
function checkOrder(start: string, end: string, label: string) { if (start && end && end < start) throw new Error(`${label}不能早于开始日期`) }
function unique(values: string[], label: string) { if (new Set(values).size !== values.length) throw new Error(`${label}重复`) }
function sameEffortBucket(a: ManagementEffort, b: ManagementEffort) { return a.versionId === b.versionId && a.personId === b.personId && a.role === b.role && a.week === b.week }
function commandEntity(value: unknown): ManagementEntity {
  if (value === undefined) throw new Error('请指定数据类别')
  return choice(value, managementEntities, 'projects', '数据类别')
}
function checkPlanAssignment(state: ManagementState, plan: ManagementPlan, previous: ManagementPlan | null = null) {
  if (plan.status === 'cancelled') return
  const changed = !previous || previous.status === 'cancelled' || plan.status === 'confirmed' && previous.status !== 'confirmed' || ['projectId', 'versionId', 'personId', 'week', 'role', 'stage'].some(key => plan[key as keyof ManagementPlan] !== previous[key as keyof ManagementPlan]) || plan.taskIds.some(id => !previous.taskIds.includes(id))
  if (!changed) return
  const project = requireRef(state.projects, plan.projectId, '排期项目')!, version = requireRef(state.versions, plan.versionId, '排期专项版本')!
  const person = requireRef(state.people, plan.personId, '排期人员', plan.status === 'draft')
  if (project.status === 'archived' || version.status === 'archived' || version.status === 'cancelled') throw new Error('已归档项目或已归档、取消版本不能新增安排')
  if (person && !person.active) throw new Error('停用人员不能新增安排，请更换执行人员')
  for (const id of plan.taskIds) {
    const task = requireRef(state.tasks, id, '排期任务')!, requirement = requireRef(state.requirements, task.requirementId, '需求')!
    if (requirement.versionId !== plan.versionId) throw new Error('新排期的任务必须属于同一专项版本')
    if (task.status === 'cancelled' || requirement.status === 'cancelled') throw new Error('已取消需求或任务不能新增安排')
  }
}
function checkEffortAssignment(state: ManagementState, effort: ManagementEffort, previous: ManagementEffort | null = null) {
  const changed = !previous || ['projectId', 'versionId', 'personId', 'week', 'role', 'planId'].some(key => effort[key as keyof ManagementEffort] !== previous[key as keyof ManagementEffort]) || effort.taskIds.some(id => !previous.taskIds.includes(id))
  if (!changed) return
  const plan = state.plans.find(p => p.id === effort.planId)
  for (const id of effort.taskIds) {
    const task = requireRef(state.tasks, id, '投入任务')!, requirement = requireRef(state.requirements, task.requirementId, '需求')!
    const historicalPlan = plan?.versionId === effort.versionId && plan.taskIds.includes(id)
    if (requirement.versionId !== effort.versionId && !historicalPlan) throw new Error('新投入关联任务必须属于同一专项版本，历史排期补录请关联原排期')
  }
}
function checkBaselineAssignment(state: ManagementState, baseline: ManagementBaseline, previous: ManagementBaseline | null = null) {
  if (!baseline.taskId || previous && baseline.taskId === previous.taskId && baseline.versionId === previous.versionId) return
  const task = requireRef(state.tasks, baseline.taskId, '期初关联任务')!
  const requirement = requireRef(state.requirements, task.requirementId, '需求')!
  if (requirement.versionId !== baseline.versionId) throw new Error('期初关联任务必须属于同一专项版本')
}
function checkRelations(state: ManagementState) {
  unique(state.projects.map(v => v.name.toLowerCase()), '项目名称')
  unique(state.projects.map(v => v.code).filter(Boolean), '项目编号')
  unique(state.requirements.map(v => v.code).filter(Boolean), '需求编号')
  unique(state.versions.map(v => `${v.projectId}\u0000${v.code.toLowerCase()}`), '项目内版本标识')
  unique(state.capacities.map(v => `${v.personId}\u0000${v.week}`), '人员本周可用工时')
  unique(state.weekActuals.map(v => `${v.personId}\u0000${v.week}`), '人员本周总实际投入')
  unique(state.baselines.map(v => `${v.versionId}\u0000${v.role}\u0000${v.personId || v.peopleLabel}`), '期初投入范围')
  for (const p of state.projects) requireRef(state.people, p.ownerId, '项目负责人', true)
  for (const v of state.versions) {
    requireRef(state.projects, v.projectId, '所属项目'); requireRef(state.people, v.ownerId, '版本负责人', true)
    checkOrder(v.startedAt, v.devCompletedAt, '开发完成日期'); checkOrder(v.plannedStart, v.plannedDevEnd, '计划开发完成日期'); checkOrder(v.testStartedAt, v.testCompletedAt, '测试完成日期')
    checkOrder(v.devCompletedAt, v.releasedAt, '实际上线日期'); checkOrder(v.testCompletedAt, v.releasedAt, '实际上线日期')
  }
  for (const r of state.requirements) {
    requireRef(state.projects, r.projectId, '需求项目'); requireRef(state.people, r.ownerId, '需求负责人', true); requireRef(state.people, r.nextOwnerId, '下一步负责人', true)
    const version = requireRef(state.versions, r.versionId, '专项版本', true)
    if (version && version.projectId !== r.projectId) throw new Error('需求与专项版本不属于同一项目')
    checkOrder(r.devCompletedAt, r.releasedAt, '需求上线日期'); checkOrder(r.testCompletedAt, r.releasedAt, '需求上线日期')
    if (r.completedWeek && r.devCompletedAt && r.completedWeek !== weekStart(r.devCompletedAt)) throw new Error('需求实际完成周与开发完成日期不一致')
    if (r.externalUrl && !/^https?:\/\//i.test(r.externalUrl)) throw new Error('外部链接只允许http或https地址')
  }
  for (const t of state.tasks) {
    requireRef(state.requirements, t.requirementId, '任务所属需求'); requireRef(state.people, t.ownerId, '任务负责人', true)
    checkOrder(t.startedAt, t.completedAt, '任务完成日期')
    if (t.completedWeek && t.completedAt && t.completedWeek !== weekStart(t.completedAt)) throw new Error('任务实际完成周与完成日期不一致')
    if (t.completedWeek && t.status !== 'done') throw new Error('未完成任务不能填写实际完成周')
    for (const dep of t.dependencies) { requireRef(state.tasks, dep, '前置任务'); if (dep === t.id) throw new Error('任务不能依赖自己') }
  }
  const visiting = new Set<string>(), visited = new Set<string>()
  function visit(task: ManagementTask) {
    if (visiting.has(task.id)) throw new Error('前置任务形成循环依赖')
    if (visited.has(task.id)) return
    visiting.add(task.id); for (const id of task.dependencies) visit(state.tasks.find(t => t.id === id)!); visiting.delete(task.id); visited.add(task.id)
  }
  state.tasks.forEach(visit)
  for (const p of state.plans) {
    const project = requireRef(state.projects, p.projectId, '排期项目')!
    const version = requireRef(state.versions, p.versionId, '排期专项版本')!
    if (project.id !== version.projectId) throw new Error('排期项目与专项版本不匹配')
    requireRef(state.people, p.personId, '排期人员', p.status === 'draft')
    if (p.status === 'confirmed' && p.plannedHours === null) throw new Error('确认排期前请填写预计工时')
    if (p.completedWeek && p.outcome !== 'done') throw new Error('周目标未完成时不能填写目标完成周')
    if (p.sourcePlanId) {
      const source = requireRef(state.plans, p.sourcePlanId, '来源排期')!
      if (source.week >= p.week || source.id === p.id) throw new Error('结转目标必须在来源排期之后')
    }
    for (const id of p.taskIds) {
      const task = requireRef(state.tasks, id, '排期任务')!
      const requirement = requireRef(state.requirements, task.requirementId, '需求')!
      if (requirement.projectId !== p.projectId) throw new Error('组合排期的任务必须属于同一项目')
      if (task.role !== p.role || task.stage !== p.stage) throw new Error('组合排期的任务必须属于相同角色和工作环节')
    }
  }
  for (const e of state.efforts) {
    const version = requireRef(state.versions, e.versionId, '投入专项版本')!
    requireRef(state.projects, e.projectId, '投入项目'); requireRef(state.people, e.personId, '投入人员')
    if (version.projectId !== e.projectId) throw new Error('投入项目与专项版本不匹配')
    const plan = requireRef(state.plans, e.planId, '关联排期', true)
    if (plan && (plan.projectId !== e.projectId || plan.versionId !== e.versionId || plan.personId !== e.personId || plan.role !== e.role)) throw new Error('实际投入与关联排期的项目、版本、人员或角色不一致')
    for (const id of e.taskIds) {
      const task = requireRef(state.tasks, id, '关联任务')!
      const req = requireRef(state.requirements, task.requirementId, '需求')!
      if (req.projectId !== e.projectId || task.role !== e.role) throw new Error('实际投入关联任务的项目或角色不一致')
    }
    const overlapping = state.efforts.filter(other => other.id !== e.id && sameEffortBucket(e, other))
    for (const other of overlapping) {
      if (!e.planId && !e.taskIds.length && !other.planId && !other.taskIds.length && e.stage === other.stage) throw new Error('该人员、版本、角色和周次已有汇总投入，请修改原记录，避免重复累计')
      if (e.planId && e.planId === other.planId) throw new Error('该排期已有实际投入，请修改原记录')
      if (getEffortTaskIds(state, e).some(id => getEffortTaskIds(state, other).includes(id))) throw new Error('同一任务范围已有实际投入，不能同时记录整组与子项工时')
      if (e.stage === other.stage && ((!e.planId && !e.taskIds.length) !== (!other.planId && !other.taskIds.length))) throw new Error('同一范围不能同时使用汇总投入和任务明细，请先调整分配')
    }
    const baseline = state.baselines.find(b => b.versionId === e.versionId && b.role === e.role && (!b.personId || b.personId === e.personId) && (e.coveredStart || e.week) <= b.asOf)
    if (baseline) throw new Error('实际投入与历史期初范围重叠，请将覆盖开始日期设为期初截至日期之后')
  }
  for (const b of state.baselines) {
    const version = requireRef(state.versions, b.versionId, '期初专项版本')!
    requireRef(state.projects, b.projectId, '期初项目'); requireRef(state.people, b.personId, '期初人员', true)
    if (version.projectId !== b.projectId) throw new Error('期初项目与专项版本不匹配')
    if (b.taskId) {
      const task = requireRef(state.tasks, b.taskId, '期初关联任务')!
      const requirement = requireRef(state.requirements, task.requirementId, '需求')!
      if (requirement.projectId !== b.projectId || task.role !== b.role || b.stage && task.stage !== b.stage) throw new Error('期初关联任务的项目、角色或工作环节不一致')
    }
    if (!b.personId && !b.peopleLabel) throw new Error('期初投入请填写人员或共同人员名称')
    const names = (b.personId ? state.people.find(p => p.id === b.personId)!.name : b.peopleLabel).split(/[、,，;；/\n&＆]+/).map(name => name.trim()).filter(Boolean)
    if (state.baselines.some(other => other.id !== b.id && other.versionId === b.versionId && other.role === b.role &&
      (other.personId ? state.people.find(p => p.id === other.personId)?.name || '' : other.peopleLabel).split(/[、,，;；/\n&＆]+/).some(name => names.includes(name.trim())))) throw new Error('期初共同投入与个人投入的人员范围重叠，请先核对累计范围')
  }
  for (const c of state.capacities) requireRef(state.people, c.personId, '可用工时人员')
  for (const actual of state.weekActuals) requireRef(state.people, actual.personId, '周工时人员')
}

export function validateManagementState(input: unknown): ManagementState {
  const raw = object(input, '管理数据')
  if (raw.schemaVersion !== 1 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0) throw new Error('管理数据版本或修订号无效')
  const state = emptyManagementState(); state.revision = raw.revision as number
  for (const entity of managementEntities) {
    const list = raw[entity] ?? (entity === 'weekActuals' ? [] : undefined)
    if (!Array.isArray(list) || list.length > 50000) throw new Error(`${entity}数据格式无效或数量过多`)
    const ids: string[] = []
    const normalized = list.map(v => { const record = object(v); const id = identifier(record.id, true); ids.push(id); return normalize(entity, record, id) })
    unique(ids, `${entity}编号`)
    ;(state[entity] as Entry[]) = normalized
  }
  if (!Array.isArray(raw.snapshots) || !Array.isArray(raw.audit) || raw.snapshots.length > 10000 || raw.audit.length > 100000) throw new Error('周记录或变更记录格式无效')
  state.snapshots = raw.snapshots.map(value => {
    const v = object(value, '周记录'), data = object(v.data, '周记录内容')
    if (!Number.isSafeInteger(v.revision) || Number(v.revision) < 1) throw new Error('周记录版本无效')
    const snapshotState = { ...emptyManagementState(), ...data, revision: 0, snapshots: [], audit: [] }
    const validated = validateSnapshotData(snapshotState)
    return { id: identifier(v.id, true), week: weekValue(v.week), revision: v.revision as number, createdAt: text(v.createdAt, '确认时间', '', true), note: text(v.note, '确认说明'), data: validated }
  })
  unique(state.snapshots.map(s => s.id), '周记录编号')
  unique(state.snapshots.map(s => `${s.week}:${s.revision}`), '周记录版本')
  state.audit = raw.audit.map(value => {
    const a = object(value, '变更记录')
    return { id: identifier(a.id, true), time: text(a.time, '变更时间', '', true), action: text(a.action, '变更类型', '', true), entityId: text(a.entityId, '变更对象'), reason: text(a.reason, '变更说明'), before: a.before ?? null, after: a.after ?? null }
  })
  checkRelations(state)
  return state
}
function validateSnapshotData(value: ManagementState): ManagementSnapshot['data'] {
  const data = {} as ManagementSnapshot['data']
  for (const entity of managementEntities) {
    const list = value[entity] ?? (entity === 'baselines' || entity === 'weekActuals' ? [] : undefined)
    if (!Array.isArray(list) || list.length > 50000) throw new Error('周记录明细格式无效')
    const normalized = list.map(v => { const raw = object(v); return normalize(entity, raw, identifier(raw.id, true)) })
    unique(normalized.map(v => v.id), '周记录明细编号')
    ;(data[entity] as Entry[]) = normalized
  }
  return data
}

export function applyManagementCommand(current: ManagementState, command: ManagementCommand, now = new Date().toISOString(), createId: () => string = () => globalThis.crypto.randomUUID()): ManagementState {
  const state = structuredClone(current)
  state.weekActuals ??= []
  const input = object(command, '操作')
  const appendAudit = (action: string, id: string, before: unknown, after: unknown, reason = '') => state.audit.push({ id: createId(), time: now, action, entityId: id, reason, before: structuredClone(before ?? null), after: structuredClone(after ?? null) })
  const requirementAssignments = new Map<string, string>()
  function syncRequirementAssignments() {
    if (!requirementAssignments.size) return
    const tasks = new Map(state.tasks.map(task => [task.id, task]))
    const requirements = new Map(state.requirements.map(requirement => [requirement.id, requirement]))
    const affectedTasks = new Set(state.tasks.filter(task => requirementAssignments.has(task.requirementId)).map(task => task.id))
    const affectedPlans = new Set(state.plans.filter(plan => plan.taskIds.some(id => affectedTasks.has(id))).map(plan => plan.id))
    for (const effort of state.efforts) if (effort.planId && getEffortTaskIds(state, effort).some(id => affectedTasks.has(id))) affectedPlans.add(effort.planId)
    function move(entity: 'plans' | 'efforts' | 'baselines', entry: ManagementPlan | ManagementEffort | ManagementBaseline, taskIds: string[]) {
      const scope = [...new Set(taskIds.map(id => tasks.get(id)?.requirementId))].map(id => requirements.get(id || '')).filter((requirement): requirement is ManagementRequirement => !!requirement)
      if (!scope.length) return
      const target = scope[0]
      if (scope.some(requirement => requirement.projectId !== target.projectId || requirement.versionId !== target.versionId)) throw new Error('该需求与其他需求共用排期或工时，请先拆分共用记录，或将整组需求调整到同一专项版本')
      if (!target.versionId) throw new Error('需求已关联排期或投入，请选择专项版本后保存')
      if (entry.projectId === target.projectId && entry.versionId === target.versionId) return
      const before = structuredClone(entry)
      entry.projectId = target.projectId; entry.versionId = target.versionId
      const reason = scope.map(requirement => requirementAssignments.get(requirement.id)).find(Boolean) || '随需求同步调整所属项目与专项版本'
      appendAudit(`${entity}.update`, entry.id, before, entry, reason)
    }
    // Shared hours move once with their whole scope; confirmed week snapshots remain unchanged.
    for (const plan of state.plans) if (affectedPlans.has(plan.id)) {
      const effortTasks = state.efforts.filter(effort => effort.planId === plan.id).flatMap(effort => getEffortTaskIds(state, effort))
      move('plans', plan, [...plan.taskIds, ...effortTasks])
    }
    for (const effort of state.efforts) {
      const taskIds = getEffortTaskIds(state, effort)
      if (affectedPlans.has(effort.planId) || taskIds.some(id => affectedTasks.has(id))) {
        const planTasks = state.plans.find(plan => plan.id === effort.planId)?.taskIds || []
        move('efforts', effort, [...taskIds, ...planTasks])
      }
    }
    for (const baseline of state.baselines) if (baseline.taskId && affectedTasks.has(baseline.taskId)) move('baselines', baseline, [baseline.taskId])
    requirementAssignments.clear()
  }
  function apply(raw: JsonRecord, depth = 0) {
    if (depth > 4) throw new Error('批量操作嵌套过深')
    const reason = text(raw.reason, '变更原因')
    switch (raw.type) {
      case 'upsert': {
        const entity = commandEntity(raw.entity)
        const value = object(raw.value), id = identifier(value.id) || createId()
        const rows = state[entity] as Entry[], index = rows.findIndex(v => v.id === id), before = index < 0 ? null : rows[index]
        const merged: JsonRecord = { ...before, ...value }
        if (entity === 'people' && !before && merged.sortOrder === undefined) merged.sortOrder = nextPersonSortOrder(state.people)
        const entry = normalize(entity, merged, id)
        if (entity === 'projects' || entity === 'requirements') {
          const numbered = entry as ManagementProject | ManagementRequirement
          if (!numbered.code) numbered.code = (before as typeof numbered | null)?.code || (entity === 'requirements' ? extractRequirementCode((entry as ManagementRequirement).title)?.code : '') || nextManagementCode(state, entity)
          if (entity === 'requirements') {
            const requirement = entry as ManagementRequirement, embedded = extractRequirementCode(requirement.title)
            if (embedded?.code === requirement.code) requirement.title = embedded.title
          }
        }
        if (entity === 'projects' && before) {
          const project = entry as ManagementProject, previous = before as ManagementProject
          const removed = previous.modules.filter(name => !project.modules.includes(name))
          if (state.requirements.some(requirement => requirement.projectId === id && removed.includes(requirement.module))) throw new Error('模块下仍有关联需求，请在模块管理中确认转移后删除或重命名')
        }
        if (entity === 'tasks') {
          const task = entry as ManagementTask, old = before as ManagementTask | null
          if (old && (['plannedStartWeek', 'plannedEndWeek'] as const).some(key => old[key] && old[key] !== task[key]) && !reason) throw new Error('修正原计划周请填写调整原因')
          const explained = reason || task.notes && task.notes !== old?.notes
          if (old?.status === 'done' && task.status !== 'done' && !explained) throw new Error('重新打开任务请填写返工原因')
          if (old && task.status === 'cancelled' && old.status !== 'cancelled' && !explained) throw new Error('取消任务请填写原因')
          if (task.status === 'done' && !task.completedAt && !task.completedWeek && old?.status !== 'done') task.completedAt = managementToday(new Date(now))
          if (task.status === 'done' && task.completedAt && !task.completedWeek) task.completedWeek = weekStart(task.completedAt)
          if (task.status === 'done' && value.completedAt && value.completedWeek === undefined) task.completedWeek = weekStart(task.completedAt)
          if (task.status === 'active' && !task.startedAt && old?.status !== 'active') task.startedAt = managementToday(new Date(now))
          if (task.status !== 'done' && old?.status === 'done') { task.completedAt = ''; task.completedWeek = '' }
        }
        if (entity === 'plans') {
          const p = entry as ManagementPlan, old = before as ManagementPlan | null
          if ((!old || p.taskIds.some(id => !old.taskIds.includes(id))) && p.taskIds.length > 5) throw new Error('组合排期最多关联5项任务，请拆分工作组')
          if (old?.baselineWeek && (p.baselineWeek !== old.baselineWeek || p.baselineHours !== old.baselineHours) && !reason) throw new Error('修改原计划基准请填写调整原因')
          if (p.status === 'confirmed' && !p.baselineWeek) { p.baselineWeek = p.week; p.baselineHours = p.plannedHours }
          if (p.outcome !== 'done') p.completedWeek = ''
          checkPlanAssignment(state, p, old)
          const rangeChanged = !old || p.week !== old.week || p.personId !== old.personId || p.taskIds.some(id => !old.taskIds.includes(id)) || old.status === 'cancelled'
          if (p.status !== 'cancelled' && rangeChanged && state.plans.some(other => other.id !== p.id && other.status !== 'cancelled' && other.week === p.week && other.personId === p.personId && p.taskIds.some(id => other.taskIds.includes(id))) && !reason) throw new Error('同一人员本周已有相关任务排期，确认重复安排时请填写原因')
        }
        if (entity === 'efforts') checkEffortAssignment(state, entry as ManagementEffort, before as ManagementEffort | null)
        if (entity === 'baselines') checkBaselineAssignment(state, entry as ManagementBaseline, before as ManagementBaseline | null)
        if (entity === 'versions' || entity === 'requirements') {
          const milestone = entry as ManagementVersion | ManagementRequirement
          if (milestone.devCompletedAt && milestone.devCompletedAt !== (before as typeof milestone | null)?.devCompletedAt) {
            const reqIds = entity === 'requirements' ? [id] : state.requirements.filter(r => r.versionId === id && r.status !== 'cancelled').map(r => r.id)
            if (state.tasks.some(t => reqIds.includes(t.requirementId) && ['frontend', 'backend'].includes(t.stage) && t.status !== 'done' && t.status !== 'cancelled')) throw new Error('必要开发任务尚未完成，不能确认开发完成日期')
          }
        }
        if (entity === 'requirements') {
          const r = entry as ManagementRequirement
          const old = before as ManagementRequirement | null
          if (old && (value.projectId !== undefined || value.versionId !== undefined)) requirementAssignments.set(id, reason)
          if (old && (['plannedStartWeek', 'plannedEndWeek'] as const).some(key => old[key] && old[key] !== r[key]) && !reason) throw new Error('修正原计划周请填写调整原因')
          if (value.devCompletedAt && value.completedWeek === undefined) r.completedWeek = weekStart(r.devCompletedAt)
          if (before && r.status !== 'active' && r.status !== (before as ManagementRequirement).status && !reason && (!r.notes || r.notes === (before as ManagementRequirement).notes)) throw new Error('暂停或取消需求请填写原因')
          if (r.phase === 'released' && !r.releasedAt) r.releasedAt = managementToday(new Date(now))
        }
        if (index < 0) rows.push(entry); else rows[index] = entry
        appendAudit(`${entity}.${before ? 'update' : 'create'}`, id, before, entry, reason)
        return
      }
      case 'project-module': {
        const project = requireRef(state.projects, identifier(raw.projectId, true), '模块所属项目')!
        const name = text(raw.name, '模块名称', '', true, 500)
        const action = choice(text(raw.action, '模块操作', '', true), ['create', 'rename', 'delete'], 'create', '模块操作')
        const requirements = state.requirements.filter(requirement => requirement.projectId === project.id && requirement.module === name)
        const configured = project.modules.includes(name)
        const previousProject = structuredClone(project)
        let target = ''
        if (action === 'create') {
          if (configured) throw new Error('模块名称已存在')
          if (project.modules.length >= 1000) throw new Error('项目模块不能超过1000个')
          project.modules.push(name)
        } else {
          if (!configured) throw new Error('模块不存在，请刷新后重试')
          if (action === 'rename') {
            target = text(raw.newName, '新模块名称', '', true, 500)
            if (target === name) throw new Error('请填写不同的新模块名称')
            if (project.modules.includes(target) || state.requirements.some(requirement => requirement.projectId === project.id && requirement.module === target)) throw new Error('模块名称已存在，请使用需求转移合并模块')
            project.modules = project.modules.map(module => module === name ? target : module)
          } else {
            if (!reason) throw new Error('删除模块请填写原因')
            target = text(raw.targetModule, '需求转入模块', '', false, 500)
            if (target === name || target && !project.modules.includes(target)) throw new Error('请选择有效的需求转入模块')
            const confirmedIds = new Set(strings(raw.confirmedRequirementIds, '已确认的关联需求'))
            if (confirmedIds.size !== requirements.length || requirements.some(requirement => !confirmedIds.has(requirement.id))) throw new Error('关联需求已变化，请重新确认删除模块及需求转移范围')
            project.modules = project.modules.filter(module => module !== name)
          }
        }
        if (project.modules.some((module, index) => module !== previousProject.modules[index]) || project.modules.length !== previousProject.modules.length) appendAudit('projects.update', project.id, previousProject, project, reason)
        if (action !== 'create') for (const requirement of requirements) {
          const previous = structuredClone(requirement)
          requirement.module = target
          appendAudit('requirements.update', requirement.id, previous, requirement, reason)
        }
        return
      }
      case 'delete': {
        const entity = commandEntity(raw.entity), id = identifier(raw.id, true)
        const rows = state[entity] as Entry[], index = rows.findIndex(v => v.id === id)
        if (index < 0) throw new Error('需要删除的记录不存在')
        if (['efforts', 'baselines'].includes(entity) && !reason) throw new Error('删除投入记录请填写原因')
        const [before] = rows.splice(index, 1)
        appendAudit(`${entity}.delete`, id, before, null, reason)
        return
      }
      case 'carryover': {
        const source = requireRef(state.plans, identifier(raw.planId, true), '来源排期')!, week = weekValue(raw.week)
        if (week <= source.week) throw new Error('结转目标必须是后续周')
        if (source.status === 'cancelled' || source.outcome === 'cancelled') throw new Error('已撤销的排期不能结转')
        if (state.plans.some(p => p.sourcePlanId === source.id && p.week === week && p.status !== 'cancelled')) throw new Error('这条排期已经结转到目标周')
        const next = normalize('plans', { ...source, id: '', week, baselineWeek: '', baselineHours: undefined, completedWeek: '', plannedHours: raw.plannedHours, goal: raw.goal === undefined ? source.goal : raw.goal, outcome: 'pending', source: 'carryover', sourcePlanId: source.id, status: 'draft' }, createId()) as ManagementPlan
        if (next.plannedHours === null) throw new Error('结转时请确认剩余预计工时')
        checkPlanAssignment(state, next)
        if (state.plans.some(p => p.week === week && p.personId === next.personId && p.status !== 'cancelled' && next.taskIds.some(id => p.taskIds.includes(id)))) throw new Error('目标周已有相关任务安排，请先核对并合并')
        state.plans.push(next); appendAudit('plans.carryover', next.id, source, next, reason)
        return
      }
      case 'snapshot': {
        syncRequirementAssignments()
        const week = weekValue(raw.week), data = validateSnapshotData(state)
        // Keep related weeks and historical effort so comparisons remain fixed after later edits.
        data.capacities = data.capacities.filter(c => c.week === week || c.week === addWeeks(week))
        const snapshot: ManagementSnapshot = { id: createId(), week, revision: Math.max(0, ...state.snapshots.filter(s => s.week === week).map(s => s.revision)) + 1, createdAt: now, note: text(raw.note, '确认说明'), data }
        state.snapshots.push(snapshot); appendAudit('week.confirm', snapshot.id, null, { week, revision: snapshot.revision }, snapshot.note)
        return
      }
      case 'clear-requirement-details':
      case 'clear-requirement-history': {
        const historyOnly = raw.type === 'clear-requirement-history'
        if (!reason) throw new Error(historyOnly ? '清理需求变更记录请填写原因' : '清理需求关联、备注与变更记录请填写原因')
        const ids = new Set(strings(raw.requirementIds, '清理需求'))
        if (!ids.size) throw new Error('请选择要清理的需求')
        const requirements = [...ids].map(id => requireRef(state.requirements, id, '清理需求')!)
        const historyIds = new Set(ids)
        const taskIds = new Set(state.tasks.filter(task => ids.has(task.requirementId)).map(task => task.id))
        for (const id of taskIds) historyIds.add(id)
        for (const baseline of state.baselines) if (baseline.taskId && taskIds.has(baseline.taskId)) historyIds.add(baseline.id)
        const cleared = { requirementIds: [...ids], history: state.audit.filter(item => historyIds.has(item.entityId)).length,
          ...(!historyOnly ? { links: requirements.filter(item => item.externalUrl).length, notes: requirements.filter(item => item.notes).length } : {}) }
        if (!historyOnly) for (const requirement of requirements) { requirement.externalUrl = ''; requirement.notes = '' }
        state.audit = state.audit.filter(item => !historyIds.has(item.entityId))
        appendAudit(historyOnly ? 'requirements.clear-history' : 'requirements.clear-details', '', cleared, historyOnly ? { history: 0 } : { links: 0, notes: 0, history: 0 }, reason)
        return
      }
      case 'batch': {
        if (!Array.isArray(raw.commands) || raw.commands.length === 0 || raw.commands.length > 10000) throw new Error('批量操作内容无效或数量过多')
        for (const nested of raw.commands) {
          const next = object(nested)
          if (next.type === 'restore') throw new Error('恢复备份不能嵌套在批量操作中')
          apply({ ...next, reason: next.reason || reason }, depth + 1)
        }
        return
      }
      case 'restore': {
        const restored = validateManagementState(raw.data)
        const revision = state.revision, previousAudit = state.audit
        Object.assign(state, restored, { revision })
        state.audit = [...previousAudit, ...restored.audit.filter(a => !previousAudit.some(old => old.id === a.id))]
        appendAudit('backup.restore', '', { revision }, { restoredRevision: restored.revision }, reason)
        return
      }
      default: throw new Error('未知管理操作')
    }
  }
  apply(input)
  syncRequirementAssignments()
  checkRelations(state)
  state.revision = current.revision + 1
  return state
}

export function getRequirementPhase(state: ManagementState, requirementId: string): ManagementRequirementPhase {
  const requirement = requireRef(state.requirements, requirementId, '需求')!
  if (requirement.phase !== 'discovery' && requirement.phase !== 'ready') return requirement.phase
  const tasks = state.tasks.filter(t => t.requirementId === requirementId && t.status !== 'cancelled')
  return tasks.length && tasks.every(t => (t.role === 'product' || t.role === 'qa') && t.status === 'done') ? 'completed' : requirement.phase
}

export function isRequirementClosed(state: ManagementState, requirementId: string): boolean {
  const requirement = requireRef(state.requirements, requirementId, '需求')!, phase = getRequirementPhase(state, requirementId)
  return requirement.status === 'cancelled' || phase === 'completed' || phase === 'accepted' || requirement.closing === 'release' && phase === 'released'
}

export function getVersionPhase(state: ManagementState, versionId: string): string {
  const version = requireRef(state.versions, versionId, '专项版本')!
  if (version.status !== 'active') return { paused: '暂停', archived: '已归档', cancelled: '已取消' }[version.status]
  if (version.releasedAt) return '已上线'
  if (version.testCompletedAt) return '待上线'
  if (version.testStartedAt || version.submittedAt) return '测试中'
  const requirements = state.requirements.filter(r => {
    if (r.versionId !== versionId || r.status === 'cancelled') return false
    const tasks = state.tasks.filter(t => t.requirementId === r.id && t.status !== 'cancelled')
    // Completed product records do not hold back the development lifecycle.
    return !tasks.length || !tasks.every(t => t.status === 'done' && (t.stage === 'design' || t.stage === 'documentation'))
  })
  const afterDevelopment: ManagementPhase[] = ['developed', 'integration', 'testing', 'release', 'released', 'accepted']
  if (requirements.length && requirements.every(r => r.status === 'active' && afterDevelopment.includes(r.phase))) {
    return requirements.some(r => r.phase === 'testing') ? '测试中' : '开发完成'
  }
  if (version.devCompletedAt) return '开发完成'
  if (requirements.some(r => r.phase !== 'discovery' && r.phase !== 'ready')) return '开发中'
  return version.startedAt ? '开发中' : '未开始'
}

export function getVersionSummary(state: ManagementState, versionId: string): ManagementVersionSummary {
  const version = requireRef(state.versions, versionId, '专项版本')!, efforts = state.efforts.filter(e => e.versionId === versionId), baseline = state.baselines.filter(b => b.versionId === versionId)
  const byRole = Object.fromEntries(managementRoles.map(role => [role, sumHours([...efforts.filter(e => e.role === role).map(e => e.hours), ...baseline.filter(e => e.role === role).map(e => e.hours)])])) as Record<ManagementRole, number>
  const productEfforts = efforts.filter(e => e.role === 'product')
  const productBaselines = baseline.filter(b => b.role === 'product')
  const byProductStage = {
    design: sumHours([...productEfforts.filter(e => e.stage === 'design').map(e => e.hours), ...productBaselines.filter(b => b.stage === 'design').map(b => b.hours)]),
    documentation: sumHours([...productEfforts.filter(e => e.stage === 'documentation').map(e => e.hours), ...productBaselines.filter(b => b.stage === 'documentation').map(b => b.hours)]),
    unclassified: sumHours([...productEfforts.filter(e => e.stage !== 'design' && e.stage !== 'documentation').map(e => e.hours), ...productBaselines.filter(b => b.stage !== 'design' && b.stage !== 'documentation').map(b => b.hours)])
  }
  const actual = sumHours(Object.values(byRole))
  return { versionId, hours: actual, days: hoursToDays(actual), baselineHours: sumHours(baseline.map(b => b.hours)), plannedHours: sumHours(state.plans.filter(p => p.versionId === versionId && p.status === 'confirmed').map(p => p.plannedHours || 0)), byRole, byProductStage, developmentDays: developmentDays(version.startedAt, version.devCompletedAt) }
}

export function getEffortTaskIds(state: ManagementState, effort: ManagementEffort): string[] {
  return effort.taskIds.length ? effort.taskIds : state.plans.find(p => p.id === effort.planId)?.taskIds || []
}

export function getTaskWeekEffort(state: ManagementState, taskId: string, personId: string, week: string): ManagementEffort | null {
  const task = requireRef(state.tasks, taskId, '任务')!, requirement = requireRef(state.requirements, task.requirementId, '需求')!
  week = weekStart(week)
  const entries = state.efforts.filter(e => e.versionId === requirement.versionId && e.personId === personId && e.role === task.role && e.week === week)
  const linked = entries.filter(e => getEffortTaskIds(state, e).includes(taskId))
  if (linked.length > 1 || linked.some(e => getEffortTaskIds(state, e).length !== 1 || e.stage !== task.stage)) throw new Error('该任务本周已计入共用工时，请在实际投入中调整原记录，避免重复登记')
  if (!linked.length && entries.some(e => e.stage === task.stage && !getEffortTaskIds(state, e).length)) throw new Error('该人员本周已有未关联任务的汇总工时，请先在实际投入中关联原记录')
  return linked[0] || null
}

export function prepareTaskWeekEffort(state: ManagementState, input: { taskId: string; personId: string; week: string; hours: number; notes: string; reason?: string }): ManagementCommand {
  const task = requireRef(state.tasks, input.taskId, '任务')!, requirement = requireRef(state.requirements, task.requirementId, '需求')!
  requireRef(state.people, input.personId, '投入人员')
  if (!requirement.versionId) throw new Error('请先为需求选择专项版本')
  if (task.status === 'cancelled' || requirement.status === 'cancelled') throw new Error('已取消的需求或任务不能登记新工时')
  const week = weekStart(input.week), actualHours = hours(input.hours, '本周实际投入'), previous = getTaskWeekEffort(state, task.id, input.personId, week)
  const candidates = state.plans.filter(p => p.status !== 'cancelled' && p.versionId === requirement.versionId && p.personId === input.personId && p.role === task.role && p.stage === task.stage && p.taskIds.length === 1 && p.taskIds[0] === task.id)
  const sameWeek = candidates.filter(p => p.week === week), plans = sameWeek.length ? sameWeek : candidates
  return { type: 'upsert', entity: 'efforts', reason: input.reason || (previous ? '调整任务周工时' : '登记任务周工时'), value: previous
    ? { id: previous.id, hours: actualHours, notes: input.notes, ...(previous.hours === actualHours ? {} : { hoursSource: 'reported' }) }
    : { projectId: requirement.projectId, versionId: requirement.versionId, personId: input.personId, role: task.role, stage: task.stage,
      week, hours: actualHours, notes: input.notes, taskIds: [task.id], planId: plans.length === 1 ? plans[0].id : '', kind: 'normal', hoursSource: 'reported' }
  }
}

export function getVersionProductContributions(state: ManagementState, versionId: string): ManagementProductContribution[] {
  const rows = new Map<string, ManagementProductContribution>()
  const entries = [...state.efforts, ...state.baselines].filter(entry => entry.versionId === versionId && entry.role === 'product')
  for (const entry of entries) {
    const peopleLabel = 'peopleLabel' in entry ? entry.peopleLabel : ''
    const stage = entry.stage || 'other'
    const key = JSON.stringify([entry.personId, entry.personId ? '' : peopleLabel, stage])
    const existing = rows.get(key)
    if (existing) existing.hours = sumHours([existing.hours, entry.hours])
    else rows.set(key, { personId: entry.personId, peopleLabel, stage, hours: entry.hours })
  }
  return [...rows.values()]
}

export function getTaskEffortSummary(state: ManagementState, taskIds: string[]): ManagementTaskEffortSummary {
  const scope = new Set(taskIds)
  const linked = state.efforts.filter(e => getEffortTaskIds(state, e).some(id => scope.has(id)))
  // A shared record belongs to this scope only after every linked task is included.
  const efforts = linked.filter(e => getEffortTaskIds(state, e).every(id => scope.has(id)))
  const sharedEfforts = linked.filter(e => !getEffortTaskIds(state, e).every(id => scope.has(id)))
  const baselines = state.baselines.filter(b => b.taskId && scope.has(b.taskId))
  return { hours: efforts.length || baselines.length ? sumHours([...efforts.map(e => e.hours), ...baselines.map(b => b.hours)]) : null, sharedHours: sumHours(sharedEfforts.map(e => e.hours)), efforts, sharedEfforts, baselines }
}

// Weekly cumulative hours exclude historical baselines and cross-scope shared records.
export function getTaskEffortWeeks(state: ManagementState, taskIds: string[]): ManagementTaskEffortWeek[] {
  const weeks = new Map<string, ManagementEffort[]>()
  for (const effort of getTaskEffortSummary(state, taskIds).efforts) {
    const entries = weeks.get(effort.week) || []
    entries.push(effort); weeks.set(effort.week, entries)
  }
  let cumulativeHours = 0
  return [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, efforts]) => {
    const hours = sumHours(efforts.map(entry => entry.hours))
    cumulativeHours = sumHours([cumulativeHours, hours])
    return { week, hours, cumulativeHours, efforts,
      coveredStart: efforts.map(entry => entry.coveredStart || week).sort()[0],
      coveredEnd: efforts.map(entry => entry.coveredEnd || weekEnd(week)).sort().at(-1)! }
  })
}

export function getRequirementWork(state: ManagementState, requirementId: string): ManagementRequirementWork {
  const requirement = requireRef(state.requirements, requirementId, '需求')!
  const tasks = state.tasks.filter(t => t.requirementId === requirementId)
  const byRole = Object.fromEntries(managementRoles.map(role => {
    const roleTasks = tasks.filter(t => t.role === role), taskIds = roleTasks.map(t => t.id), scope = new Set(taskIds)
    const summary = getTaskEffortSummary(state, taskIds)
    const plans = state.plans.filter(p => p.role === role && p.status !== 'cancelled' && p.taskIds.some(id => scope.has(id)))
    const ownerIds = [...new Set([
      ...roleTasks.filter(t => t.status !== 'cancelled').map(t => t.ownerId),
      ...plans.map(p => p.personId), ...summary.efforts.map(e => e.personId), ...summary.sharedEfforts.map(e => e.personId), ...summary.baselines.map(b => b.personId)
    ].filter(Boolean))]
    return [role, { taskIds, ownerIds, ...summary }]
  })) as Record<ManagementRole, ManagementRequirementRoleWork>
  const versionRequirements = new Set(state.requirements.filter(r => requirement.versionId && r.versionId === requirement.versionId).map(r => r.id))
  const productTasks = state.tasks.filter(t => versionRequirements.has(t.requirementId) && t.role === 'product' && t.status !== 'cancelled')
  const productPlans = state.plans.filter(p => requirement.versionId && p.versionId === requirement.versionId && p.role === 'product' && p.status !== 'cancelled')
  const productEfforts = state.efforts.filter(e => requirement.versionId && e.versionId === requirement.versionId && e.role === 'product')
  const productBaselines = state.baselines.filter(b => requirement.versionId && b.versionId === requirement.versionId && b.role === 'product')
  return { byRole, versionProduct: {
    ownerIds: [...new Set([...productTasks.map(t => t.ownerId), ...productPlans.map(p => p.personId), ...productEfforts.map(e => e.personId), ...productBaselines.map(b => b.personId)].filter(Boolean))],
    peopleLabels: [...new Set(productBaselines.filter(b => !b.personId).map(b => b.peopleLabel).filter(Boolean))],
    hours: productEfforts.length || productBaselines.length ? sumHours([...productEfforts.map(e => e.hours), ...productBaselines.map(b => b.hours)]) : null
  } }
}

export function getProjectModules(state: ManagementState, projectId: string): ManagementModuleSummary[] {
  const project = state.projects.find(item => item.id === projectId)
  if (!project) return []
  const requirements = state.requirements.filter(item => item.projectId === projectId)
  return project.modules.map(name => {
    const linked = requirements.filter(item => item.module === name)
    return { name, requirementIds: linked.map(item => item.id), activeCount: linked.filter(item => item.status === 'active' && !isRequirementClosed(state, item.id)).length }
  })
}

export function getWeekSummary(state: ManagementState, week: string): ManagementWeekSummary {
  week = weekStart(week)
  const plans = state.plans.filter(p => p.week === week && p.status === 'confirmed'), efforts = state.efforts.filter(e => e.week === week)
  return { week, plannedHours: sumHours(plans.map(p => p.plannedHours || 0)), actualHours: sumHours(efforts.map(e => e.hours)), plans: plans.length, completed: plans.filter(p => p.outcome === 'done').length,
    people: sortManagementPeople(state.people).filter(person => person.active || plans.some(p => p.personId === person.id) || efforts.some(e => e.personId === person.id)).map(person => {
      const plannedHours = sumHours(plans.filter(p => p.personId === person.id).map(p => p.plannedHours || 0)), actualHours = sumHours(efforts.filter(e => e.personId === person.id).map(e => e.hours)), capacity = state.capacities.find(c => c.week === week && c.personId === person.id)?.hours ?? person.weeklyCapacity
      return { personId: person.id, plannedHours, actualHours, capacity, load: capacity > 0 ? plannedHours / capacity : null }
    }) }
}
export function getManagementAlerts(state: ManagementState, today = managementToday()): ManagementAlert[] {
  if (!isManagementDate(today)) throw new Error('提醒日期无效')
  const week = weekStart(today), day = new Date(`${today}T00:00:00Z`).getUTCDay(), reviewTime = day === 0 || day >= 5, alerts: ManagementAlert[] = []
  const add = (id: string, title: string, detail: string, entity: ManagementAlert['entity'], entityId: string, projectId: string, severity: ManagementAlert['severity'] = 'warning') => alerts.push({ id, title, detail, entity, entityId, projectId, severity })
  for (const r of state.requirements) {
    if (r.status !== 'active' || state.projects.find(p => p.id === r.projectId)?.status !== 'active') continue
    const tasks = state.tasks.filter(t => t.requirementId === r.id && t.status !== 'cancelled'), pending = tasks.filter(t => t.status !== 'done')
    if ((r.devCompletedAt || r.testCompletedAt || r.releasedAt || r.phase === 'accepted') && pending.some(t => ['frontend', 'backend'].includes(t.stage))) add(`review:${r.id}`, '开发返工需复核里程碑', `${r.title} · 仍有开发任务未完成`, 'requirement', r.id, r.projectId)
    if (isRequirementClosed(state, r.id)) continue
    if (r.followUpDate && r.followUpDate <= today) add(`follow:${r.id}`, '已到跟进日期', `${r.title} · ${r.nextAction || '请确认下一步'}`, 'requirement', r.id, r.projectId)
    if (r.dueDate && r.dueDate < today) add(`due:${r.id}`, '需求交付逾期', `${r.title} · 目标 ${r.dueDate}`, 'requirement', r.id, r.projectId, 'danger')
    for (const task of pending) {
      const hasFuture = state.plans.some(p => p.status !== 'cancelled' && p.week >= week && p.taskIds.includes(task.id))
      const needsCarryover = reviewTime && state.plans.some(p => p.status !== 'cancelled' && p.week === week && p.taskIds.includes(task.id)) && !state.plans.some(p => p.status !== 'cancelled' && p.week > week && p.taskIds.includes(task.id))
      const dependenciesReady = task.dependencies.every(id => state.tasks.find(t => t.id === id)?.status === 'done')
      if (!hasFuture && dependenciesReady) add(`unscheduled:${task.id}`, '后续任务待安排', `${r.title} · ${task.name}`, 'task', task.id, r.projectId)
      if (needsCarryover) add(`carryover:${task.id}`, '本周未完成任务待续排', `${r.title} · ${task.name}`, 'task', task.id, r.projectId)
      if (task.status === 'blocked') add(`blocked:${task.id}`, '任务阻塞', `${task.name} · ${task.blockedReason}`, 'task', task.id, r.projectId, 'danger')
      if (task.dueDate && task.dueDate < today) add(`taskdue:${task.id}`, '任务完成逾期', `${task.name} · 目标 ${task.dueDate}`, 'task', task.id, r.projectId, 'danger')
    }
    const dev = tasks.filter(t => t.stage === 'frontend' || t.stage === 'backend')
    if (dev.length && dev.every(t => t.status === 'done') && !['testing', 'release', 'released', 'accepted'].includes(r.phase) && !r.submittedAt && !r.testCompletedAt && !r.releasedAt) add(`handoff:${r.id}`, '开发完成待衔接', `${r.title} · ${r.nextAction || '确认联调或提测安排'}`, 'requirement', r.id, r.projectId, 'info')
    if (r.testCompletedAt && !r.releasedAt && r.closing === 'release') add(`release:${r.id}`, '测试通过待上线', r.title, 'requirement', r.id, r.projectId, 'info')
  }
  for (const v of state.versions) {
    if (v.status !== 'active' || state.projects.find(p => p.id === v.projectId)?.status !== 'active') continue
    if (v.devCompletedAt && state.tasks.some(t => ['frontend', 'backend'].includes(t.stage) && !['done', 'cancelled'].includes(t.status) && state.requirements.some(r => r.id === t.requirementId && r.versionId === v.id && r.status !== 'cancelled'))) add(`review:${v.id}`, '版本开发完成状态需复核', `${v.name} · 范围内仍有开发任务未完成`, 'version', v.id, v.projectId)
    for (const [key, actual, label] of [[v.plannedDevEnd, v.devCompletedAt, '开发'], [v.plannedTestEnd, v.testCompletedAt, '测试'], [v.plannedRelease, v.releasedAt, '上线']]) {
      if (key && key < today && !actual) add(`${label}:${v.id}`, `${label}阶段逾期`, `${v.name} · 目标 ${key}`, 'version', v.id, v.projectId, 'danger')
    }
  }
  for (const p of state.plans.filter(p => p.status === 'confirmed' && p.week <= week && p.outcome !== 'cancelled')) {
    const recorded = state.efforts.some(e => e.planId === p.id || (!e.planId && e.versionId === p.versionId && e.personId === p.personId && e.role === p.role && e.week === p.week))
    if ((p.week < week || reviewTime) && p.outcome === 'pending') add(`reviewplan:${p.id}`, '排期结果待复盘', p.title, 'plan', p.id, p.projectId)
    if ((p.outcome !== 'pending' || p.week < week || reviewTime) && !recorded) add(`effort:${p.id}`, '实际投入未填写', p.title, 'plan', p.id, p.projectId)
  }
  for (const person of getWeekSummary(state, week).people) if (person.plannedHours > person.capacity) add(`capacity:${person.personId}`, '本周排期超量', `${state.people.find(p => p.id === person.personId)?.name} · 已排 ${person.plannedHours}h / 可用 ${person.capacity}h`, 'person', person.personId, '', 'danger')
  return alerts
}

export const versionSummary = getVersionSummary
export const weekSummary = getWeekSummary
export const managementAlerts = getManagementAlerts
