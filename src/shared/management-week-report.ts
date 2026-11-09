import {
  addWeeks, getEffortTaskIds, getWeekSummary, managementToday, sortManagementPeople, stageLabels, sumHours, weekEnd, weekStart,
  type ManagementPlan, type ManagementRole, type ManagementStage, type ManagementState, type ManagementTask,
} from './management'
import { getEffortWorkContent, getScopeSchedule, type ScheduleStatus } from './management-schedule'

export const reportColumns = ['frontend', 'backend', 'product'] as const
export type ReportColumn = typeof reportColumns[number]
export interface WeekReportCell {
  id: string; planId: string; effortId: string; taskIds: string[]; personId: string; person: string; personOrder: number; complexity: string; hours: number | null;
  plannedHours: number | null; shared: boolean; group: string; status: string; tone: ScheduleStatus; notes: string;
  role: ManagementRole; stage: ManagementStage; draft: boolean; workContent: string; allocated?: boolean;
}
export interface WeekReportRow {
  id: string; requirementId: string; projectId: string; project: string; versionId: string; module: string;
  code: string; title: string; platforms: string; stage: string; cells: Record<ReportColumn, WeekReportCell[]>;
  groupedRows?: WeekReportRow[];
}
export interface WeekReportSection { rows: WeekReportRow[]; cells: WeekReportCell[]; hours: number; draftHours: number }
export interface WeekReportLayout { rows: WeekReportRow[]; hourSpans: Record<ReportColumn, number>[] }
export interface ManagementWeekReport {
  week: string; nextWeek: string; actual: WeekReportSection; unfinished: WeekReportSection;
  next: WeekReportSection; advanced: WeekReportSection; nextPeople: ReturnType<typeof getWeekSummary>['people'];
}
interface Unit {
  id: string; plan?: ManagementPlan; effortId?: string; taskIds: string[]; projectId: string; versionId: string; personId: string;
  role: ManagementRole; stage: ManagementStage; hours: number | null; title: string; notes: string; workContent: string; kind: 'actual' | 'plan' | 'completion'; partial?: boolean; allocated?: boolean;
}
const columnFor = (role: ManagementRole): ReportColumn => role === 'frontend' || role === 'backend' ? role : 'product'
const stageKey = (stage: ManagementStage) => stage === 'frontend' || stage === 'backend' ? 'development' : stage
const stageName = (stage: ManagementStage) => stage === 'frontend' || stage === 'backend' ? '开发阶段' : stage === 'testing' ? '项目测试' : stage === 'design' ? '需求设计' : stage === 'documentation' ? '文档编写' : stageLabels[stage]
const completionWeek = (task: ManagementTask) => task.completedWeek || (task.completedAt ? weekStart(task.completedAt) : '')
const doneBy = (task: ManagementTask, week: string) => task.status === 'done' && !!completionWeek(task) && completionWeek(task) <= week
const rowPersonOrder = (row: WeekReportRow) => Math.min(...reportColumns.flatMap(role => row.cells[role].map(cell => cell.personOrder)))
const rowHasEarlyCompletion = (row: WeekReportRow) => reportColumns.some(role => row.cells[role].some(cell => cell.tone === 'early'))

export function getWeekReportEditCells(row: WeekReportRow): WeekReportCell[] {
  const cells = new Map<string, WeekReportCell>()
  for (const role of reportColumns) for (const cell of row.cells[role]) {
    const key = cell.planId ? `plan:${cell.planId}` : cell.effortId ? `effort:${cell.effortId}` : cell.taskIds.length ? `tasks:${[...cell.taskIds].sort().join(',')}` : ''
    if (key && !cells.has(key)) cells.set(key, cell)
  }
  return [...cells.values()]
}

export function getWeekReportWorkDetails(row: WeekReportRow): string[] {
  const cells = reportColumns.flatMap(role => row.cells[role]).filter(cell => !cell.shared && cell.workContent.trim() && cell.workContent.trim() !== row.title.trim())
  const details = new Map<string, Set<string>>()
  for (const cell of cells) {
    const content = cell.workContent.trim(), people = details.get(content) || new Set<string>()
    people.add(cell.person); details.set(content, people)
  }
  const multiplePeople = new Set(cells.map(cell => cell.personId)).size > 1
  return [...details].map(([content, people]) => multiplePeople ? `${[...people].join('、')}：${content}` : content)
}
export function getWeekReportWorkText(row: WeekReportRow): string {
  if (row.groupedRows) return row.groupedRows.map((item, index) => `${index + 1}、${getWeekReportWorkText(item)}`).join('\n')
  return [`${row.title}${row.code ? `（${row.code}）` : ''}`, ...getWeekReportWorkDetails(row)].join('\n')
}

function groupEarlyRows(rows: WeekReportRow[]): WeekReportRow[] {
  const keyFor = (row: WeekReportRow) => {
    const cells = reportColumns.flatMap(role => row.cells[role])
    if (!cells.length || cells.some(cell => cell.tone !== 'early' || !cell.status.startsWith('已完成') || cell.hours === null)) return ''
    const people = reportColumns.map(role => [...new Set(row.cells[role].map(cell => `${cell.role}:${cell.personId}`))].sort())
    return JSON.stringify([row.projectId, row.module, row.platforms, row.stage, people])
  }
  const keys = new Map(rows.map(row => [row, keyFor(row)])), scopes = new Map<string, Set<string>>()
  for (const row of rows) for (const role of reportColumns) for (const cell of row.cells[role]) {
    if (!scopes.has(cell.id)) scopes.set(cell.id, new Set())
    scopes.get(cell.id)!.add(keys.get(row)!)
  }
  const groups = new Map<string, WeekReportRow[]>(), result: WeekReportRow[] = []
  for (const row of rows) {
    const key = keys.get(row)!
    // Leave scopes shared with other statuses or people to the regular merged-hour layout.
    if (!key || reportColumns.some(role => row.cells[role].some(cell => scopes.get(cell.id)!.size > 1))) { result.push(row); continue }
    groups.set(key, [...(groups.get(key) || []), row])
  }
  for (const [key, members] of groups) {
    if (members.length === 1) { result.push(members[0]); continue }
    const cells = Object.fromEntries(reportColumns.map(role => {
      const entries = new Map<string, WeekReportCell>()
      for (const row of members) for (const cell of row.cells[role]) {
        const previous = entries.get(cell.id)
        entries.set(cell.id, previous ? { ...previous, taskIds: [...new Set([...previous.taskIds, ...cell.taskIds])], complexity: [...new Set([...previous.complexity.split(' / '), ...cell.complexity.split(' / ')])].join(' / ') } : { ...cell })
      }
      return [role, [...entries.values()]]
    })) as Record<ReportColumn, WeekReportCell[]>
    result.push({ ...members[0], id: `early-project:${key}`, requirementId: '', code: '', title: '已完成（提前）', cells, groupedRows: members })
  }
  return result
}

export function getWeekReportLayout(sourceRows: WeekReportRow[], options: { groupEarly?: boolean } = {}): WeekReportLayout {
  if (options.groupEarly) sourceRows = groupEarlyRows(sourceRows)
  const occurrences = new Map<string, number>()
  for (const row of sourceRows) for (const role of reportColumns) for (const cell of row.cells[role]) occurrences.set(cell.id, (occurrences.get(cell.id) || 0) + 1)
  const idsFor = (row: WeekReportRow) => reportColumns.flatMap(role => row.cells[role].map(cell => cell.id))
  const isolate = (row: WeekReportRow, role: ReportColumn, cells: WeekReportCell[], suffix: string): WeekReportRow => ({ ...row, id: `${row.id}:report:${role}:${suffix}`, cells: { frontend: [], backend: [], product: [], [role]: cells } })
  // Separate a shared amount from additional work on just one member of its scope.
  const rows = sourceRows.flatMap(row => reportColumns.some(role => row.cells[role].length > 1 && row.cells[role].some(cell => occurrences.get(cell.id)! > 1))
    ? reportColumns.flatMap(role => {
      const shared = row.cells[role].filter(cell => occurrences.get(cell.id)! > 1), individual = row.cells[role].filter(cell => occurrences.get(cell.id) === 1)
      return [...shared.map((cell, index) => isolate(row, role, [cell], String(index))), ...(individual.length ? [isolate(row, role, individual, 'individual')] : [])]
    }) : [row])
  const members = new Map<string, number[]>()
  rows.forEach((row, index) => idsFor(row).forEach(id => members.set(id, [...(members.get(id) || []), index])))
  const groupsFor = rows.map(row => idsFor(row).filter(id => members.get(id)!.length > 1))
  const orderedBlocks: WeekReportRow[][] = [], visited = new Set<number>()
  for (let start = 0; start < rows.length; start++) {
    if (visited.has(start)) continue
    const component: number[] = [], queue = [start]
    visited.add(start)
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]; component.push(current)
      for (const id of groupsFor[current]) for (const neighbor of members.get(id)!) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor) }
    }
    component.sort((a, b) => a - b)
    const remaining = new Set(component), placed = new Map<string, number>(), order: number[] = []
    let attempts = 0
    // Keep each amount's entire scope contiguous, including overlapping frontend/backend groups.
    function arrange(): boolean {
      if (!remaining.size) return true
      if (++attempts > 4096 || component.length > 64) return false
      const open = [...placed].filter(([id, count]) => count > 0 && count < members.get(id)!.length).map(([id]) => id)
      for (const index of component) {
        if (!remaining.has(index) || !open.every(id => groupsFor[index].includes(id))) continue
        remaining.delete(index); order.push(index)
        for (const id of groupsFor[index]) placed.set(id, (placed.get(id) || 0) + 1)
        if (arrange()) return true
        for (const id of groupsFor[index]) placed.set(id, placed.get(id)! - 1)
        order.pop(); remaining.add(index)
      }
      return false
    }
    const samePersonOrder = component.every(index => rowPersonOrder(rows[index]) === rowPersonOrder(rows[component[0]]))
    if (samePersonOrder && arrange()) orderedBlocks.push(order.map(index => rows[index]))
    else {
      // Conflicting role scopes get separate display rows; never merge through unrelated work.
      for (const role of reportColumns) {
        const blocks = new Map<string, WeekReportRow[]>()
        for (const index of component) {
          const row = rows[index], cells = row.cells[role]
          if (!cells.length) continue
          const key = cells.length === 1 && occurrences.get(cells[0].id)! > 1 ? cells[0].id : `row:${row.id}`
          blocks.set(key, [...(blocks.get(key) || []), isolate(row, role, cells, 'role')])
        }
        orderedBlocks.push(...blocks.values())
      }
    }
  }
  const result = orderedBlocks.sort((a, b) => Number(a.some(rowHasEarlyCompletion)) - Number(b.some(rowHasEarlyCompletion)) || rowPersonOrder(a[0]) - rowPersonOrder(b[0])).flat()
  const hourSpans = result.map(() => ({ frontend: 1, backend: 1, product: 1 }))
  for (const role of reportColumns) for (let index = 0; index < result.length;) {
    const cells = result[index].cells[role]
    let end = index + 1
    if (cells.length === 1) while (end < result.length && result[end].cells[role].length === 1 && result[end].cells[role][0].id === cells[0].id) end++
    hourSpans[index][role] = end - index
    for (let continuation = index + 1; continuation < end; continuation++) hourSpans[continuation][role] = 0
    index = end
  }
  return { rows: result, hourSpans }
}

function planUnit(plan: ManagementPlan, taskIds = plan.taskIds): Unit {
  return { id: `plan:${plan.id}`, plan, taskIds, projectId: plan.projectId, versionId: plan.versionId, personId: plan.personId,
    role: plan.role, stage: plan.stage, hours: plan.plannedHours, title: plan.title, notes: plan.notes, workContent: plan.goal, kind: 'plan', partial: taskIds.length < plan.taskIds.length }
}
function outcome(state: ManagementState, unit: Unit, tasks: ManagementTask[], week: string, asOfDate: string) {
  const plan = unit.plan, activeTasks = tasks.filter(task => task.status !== 'cancelled')
  if (activeTasks.length && activeTasks.every(task => doneBy(task, week))) {
    const schedule = getScopeSchedule(state, activeTasks.map(task => task.id), weekEnd(week))
    const status = schedule.status === 'early' ? '已完成（提前）' : schedule.status === 'late' ? `已完成（延期${schedule.weeksDelta}周）` : '已完成'
    return { status, tone: schedule.status }
  }
  if (unit.kind === 'plan' && plan?.status === 'draft') return { status: '待确认', tone: 'planned' as const }
  if (unit.kind === 'plan') {
    if (plan && plan.week <= week) return { status: plan.outcome === 'blocked' ? '阻塞，待处理' : '未完成，待结转', tone: 'overdue' as const }
    if (unit.partial) return { status: '待核对组合剩余工时', tone: 'planned' as const }
    const partiallyDone = activeTasks.some(task => doneBy(task, week))
    return { status: partiallyDone ? '部分完成，待核对剩余工时' : plan?.source === 'carryover' ? '结转继续' : '待开展', tone: 'planned' as const }
  }
  if (plan?.outcome === 'blocked' || activeTasks.some(task => task.status === 'blocked')) return { status: '阻塞', tone: 'overdue' as const }
  if (plan?.outcome === 'done' && (!plan.completedWeek || plan.completedWeek <= week)) return { status: activeTasks.length ? '本周目标完成，整项进行中' : '本周目标完成', tone: 'active' as const }
  const completed = activeTasks.filter(task => doneBy(task, week)).length
  if (completed) return { status: `部分完成 ${completed}/${activeTasks.length}`, tone: 'active' as const }
  const progress = week === weekStart(asOfDate) && activeTasks.length === 1 && activeTasks[0].progress < 100 ? activeTasks[0].progress : null
  return { status: progress ? `进行中（${progress}%）` : '进行中', tone: 'active' as const }
}
function section(state: ManagementState, units: Unit[], week: string, asOfDate: string): WeekReportSection {
  const rows = new Map<string, WeekReportRow>(), groups = new Map<string, string>()
  const peopleOrder = new Map(sortManagementPeople(state.people).map((person, index) => [person.id, index]))
  const tasksById = new Map(state.tasks.map(task => [task.id, task])), requirements = new Map(state.requirements.map(item => [item.id, item]))
  for (const unit of units) {
    const partitions = new Map<string, ManagementTask[]>()
    for (const id of unit.taskIds) {
      const task = tasksById.get(id)
      if (!task) continue
      const key = `${task.requirementId}:${stageKey(task.stage)}`
      partitions.set(key, [...(partitions.get(key) || []), task])
    }
    if (!partitions.size) partitions.set(`unlinked:${unit.id}`, [])
    const shared = partitions.size > 1 || !!unit.partial
    if (shared && !groups.has(unit.id)) groups.set(unit.id, `G${String(groups.size + 1).padStart(2, '0')}`)
    for (const [key, tasks] of partitions) {
      const requirement = requirements.get(tasks[0]?.requirementId)
      if (!rows.has(key)) rows.set(key, {
        id: key, requirementId: requirement?.id || '', projectId: unit.projectId,
        project: state.projects.find(project => project.id === unit.projectId)?.name || '未指定项目', versionId: requirement?.versionId || unit.versionId,
        module: requirement?.module || '', code: requirement?.code || '', title: requirement?.title || unit.title,
        platforms: requirement?.platforms.join('、') || '—', stage: stageName(tasks[0]?.stage || unit.stage),
        cells: { frontend: [], backend: [], product: [] },
      })
      const row = rows.get(key)!, role = columnFor(unit.role)
      const person = state.people.find(person => person.id === unit.personId)?.name || '未分配'
      row.cells[role].push({ id: unit.id, planId: unit.plan?.id || '', effortId: unit.effortId || '', taskIds: tasks.map(task => task.id), personId: unit.personId, person, personOrder: peopleOrder.get(unit.personId) ?? peopleOrder.size,
        complexity: [...new Set(tasks.map(task => task.complexity).filter(Boolean))].join(' / ') || '—', hours: unit.hours,
        plannedHours: unit.plan?.plannedHours ?? null, shared, group: groups.get(unit.id) || '', ...outcome(state, unit, tasks, week, asOfDate),
        notes: [unit.notes, unit.plan?.goal].filter(Boolean).join('\n'), workContent: unit.workContent, role: unit.role, stage: unit.stage, draft: unit.kind === 'plan' && unit.plan?.status === 'draft', ...(unit.allocated ? { allocated: true } : {}) })
    }
  }
  const result = [...rows.values()].sort((a, b) => Number(rowHasEarlyCompletion(a)) - Number(rowHasEarlyCompletion(b)) || rowPersonOrder(a) - rowPersonOrder(b) || a.project.localeCompare(b.project, 'zh-CN') || a.module.localeCompare(b.module, 'zh-CN') || a.stage.localeCompare(b.stage, 'zh-CN') || a.code.localeCompare(b.code, 'zh-CN') || a.id.localeCompare(b.id))
  const cells = [...new Map(result.flatMap(row => reportColumns.flatMap(role => row.cells[role])).map(cell => [cell.id, cell])).values()]
  return { rows: result, cells, hours: sumHours(cells.filter(cell => !cell.draft).map(cell => cell.hours ?? 0)), draftHours: sumHours(cells.filter(cell => cell.draft).map(cell => cell.hours ?? 0)) }
}
export function getManagementWeekReport(state: ManagementState, selectedWeek: string, asOfDate = managementToday()): ManagementWeekReport {
  const week = weekStart(selectedWeek), nextWeek = addWeeks(week)
  const actualUnits: Unit[] = [], unfinished: Unit[] = [], next: Unit[] = [], advanced: Unit[] = []
  const linkedTasks = new Set<string>()
  for (const effort of state.efforts.filter(effort => effort.week === week)) {
    const ids = getEffortTaskIds(state, effort), plan = state.plans.find(plan => plan.id === effort.planId)
    ids.forEach(id => linkedTasks.add(id))
    actualUnits.push({ id: `effort:${effort.id}`, plan, effortId: effort.id, taskIds: ids, projectId: effort.projectId, versionId: effort.versionId,
      personId: effort.personId, role: effort.role, stage: effort.stage, hours: effort.hours,
      title: plan?.title || `${stageLabels[effort.stage]}（未关联需求）`, notes: effort.notes, workContent: getEffortWorkContent(effort, plan), kind: 'actual', allocated: effort.hoursSource === 'allocated' })
  }
  for (const task of state.tasks.filter(task => task.status === 'done' && completionWeek(task) === week && !linkedTasks.has(task.id))) {
    const requirement = state.requirements.find(item => item.id === task.requirementId)!
    const plan = state.plans.find(plan => plan.status !== 'cancelled' && plan.taskIds.includes(task.id) && (plan.week === week || plan.completedWeek === week))
    actualUnits.push({ id: `completion:${task.id}`, plan, taskIds: [task.id], projectId: requirement.projectId, versionId: requirement.versionId,
      personId: task.ownerId, role: task.role, stage: task.stage, hours: null, title: requirement.title, notes: '本周完成，未登记本周实际工时。', workContent: plan?.outcome === 'done' ? plan.goal : '', kind: 'completion' })
  }
  for (const plan of state.plans.filter(plan => plan.status !== 'cancelled')) {
    const tasks = state.tasks.filter(task => plan.taskIds.includes(task.id) && task.status !== 'cancelled')
    if (plan.taskIds.length && !tasks.length) continue
    const completedBeforeNext = tasks.length ? tasks.every(task => doneBy(task, week)) : plan.outcome === 'done' && !!plan.completedWeek && plan.completedWeek < nextWeek
    if (plan.week === nextWeek) {
      if (completedBeforeNext) advanced.push(planUnit(plan))
      else if (!plan.taskIds.length || tasks.length) {
        const completed = tasks.filter(task => doneBy(task, week)), pending = tasks.filter(task => !doneBy(task, week))
        next.push(planUnit(plan, pending.map(task => task.id)))
        if (completed.length) advanced.push({ ...planUnit(plan, completed.map(task => task.id)), hours: null, notes: '组合中部分任务已提前完成，剩余预计工时待核对，不对原组合工时自动均分。' })
      }
    }
    if (plan.week !== week && plan.baselineWeek !== week) continue
    const goalDone = plan.outcome === 'done' && (!plan.completedWeek || plan.completedWeek <= week)
    if (!goalDone && !(tasks.length && tasks.every(task => doneBy(task, week)))) unfinished.push(planUnit(plan))
  }
  const nextSection = section(state, next, week, asOfDate)
  const nextPeople = getWeekSummary(state, nextWeek).people.map(person => {
    const plannedHours = sumHours(nextSection.cells.filter(cell => !cell.draft && cell.personId === person.personId).map(cell => cell.hours ?? 0))
    return { ...person, plannedHours, load: person.capacity > 0 ? plannedHours / person.capacity : null }
  })
  return { week, nextWeek, actual: section(state, actualUnits, week, asOfDate), unfinished: section(state, unfinished, week, asOfDate),
    next: nextSection, advanced: section(state, advanced, week, asOfDate), nextPeople }
}
