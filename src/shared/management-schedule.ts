import {
  applyManagementCommand, getEffortTaskIds, getTaskEffortSummary, managementToday, sortManagementPeople, sumHours, weekStart,
  type ManagementCommand, type ManagementEffort, type ManagementPlan, type ManagementState,
} from './management'

export const scheduleStatusLabels = { early: '提前', 'on-time': '按期完成', late: '延期完成', overdue: '逾期未完成', due: '本周到期', active: '进行中', planned: '待开展', unscheduled: '未排期', missing: '待补录', paused: '已暂停 / 撤销' } as const
export type ScheduleStatus = keyof typeof scheduleStatusLabels
export interface ManagementScheduleSummary {
  allocatedHours?: number;
  plannedStartWeek: string; plannedEndWeek: string; actualWeeks: string[]; completedWeek: string; complete: boolean;
  estimatedHours: number | null; sharedEstimatedHours: number; sharedEstimateCount: number;
  actualHours: number | null; sharedActualHours: number; sharedActualCount: number;
  weeksDelta: number | null; status: ScheduleStatus; label: string;
  hoursDelta: number | null; costStatus: 'saved' | 'over' | 'matched' | 'pending' | 'missing'; costLabel: string; sharedComparison: boolean;
}
const ordered = (values: string[]) => [...new Set(values.filter(Boolean))].sort()
const first = (values: string[]) => ordered(values)[0] || ''
const last = (values: string[]) => ordered(values).at(-1) || ''
const weekOf = (date: string | undefined) => date ? weekStart(date) : ''
export function formatScheduleWeek(week: string, year = false): string {
  if (!week) return '—'
  const start = weekStart(week), end = new Date(`${start}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 4)
  const endDate = end.toISOString().slice(0, 10)
  return `${year ? start.replaceAll('-', '/') : start.slice(5).replace('-', '/')}–${year && start.slice(0, 4) !== endDate.slice(0, 4) ? endDate.replaceAll('-', '/') : endDate.slice(5).replace('-', '/')}`
}
export function formatScheduleSpan(start: string, end: string): string {
  if (!start && !end) return '未排期'
  if (!start || start === end) return formatScheduleWeek(end || start)
  return `${start.slice(5).replace('-', '/')}–${formatScheduleWeek(end).split('–')[1]}`
}
export function formatActualWeeks(weeks: string[]): string {
  if (!weeks.length) return '未开展'
  return `${formatScheduleWeek(weeks[0])}${weeks.length > 1 ? ` 等${weeks.length}周` : ''}`
}
export function scheduleWeekDelta(planned: string, actual: string): number {
  return Math.round((Date.parse(`${weekStart(actual)}T00:00:00Z`) - Date.parse(`${weekStart(planned)}T00:00:00Z`)) / 604800000)
}
function statusFor(plannedStart: string, plannedEnd: string, actualWeeks: string[], completed: string, complete: boolean, today: string) {
  let status: ScheduleStatus, weeksDelta: number | null = null, label: string
  if (complete) {
    if (!plannedEnd || !completed) return { status: 'missing' as const, weeksDelta, label: '已完成 · 待补周次' }
    weeksDelta = scheduleWeekDelta(plannedEnd, completed)
    status = weeksDelta < 0 ? 'early' : weeksDelta > 0 ? 'late' : 'on-time'
    label = weeksDelta < 0 ? `提前 ${-weeksDelta} 周完成` : weeksDelta > 0 ? `延期 ${weeksDelta} 周完成` : '按期完成'
  } else if (plannedEnd && weekStart(today) > plannedEnd) {
    status = 'overdue'; weeksDelta = scheduleWeekDelta(plannedEnd, today); label = `已逾期 ${weeksDelta} 周`
  } else if (actualWeeks.length && plannedStart && actualWeeks[0] < plannedStart) {
    status = 'early'; weeksDelta = scheduleWeekDelta(plannedStart, actualWeeks[0]); label = `提前 ${-weeksDelta} 周开展`
  } else if (plannedEnd === weekStart(today)) { status = 'due'; label = '本周到期' }
  else if (actualWeeks.length) { status = 'active'; label = '进行中' }
  else if (plannedEnd || plannedStart) { status = 'planned'; label = '待开展' }
  else { status = 'unscheduled'; label = '未排期' }
  return { status, weeksDelta, label }
}
function costFor(estimated: number | null, actual: number | null, complete: boolean) {
  if (estimated === null || actual === null) return { hoursDelta: null, costStatus: 'missing' as const, costLabel: '—' }
  const hoursDelta = sumHours([actual, -estimated])
  if (hoursDelta > 0) return { hoursDelta, costStatus: 'over' as const, costLabel: `超时 ${hoursDelta} h` }
  if (!complete) return { hoursDelta: null, costStatus: 'pending' as const, costLabel: '进行中' }
  return { hoursDelta, costStatus: hoursDelta < 0 ? 'saved' as const : 'matched' as const, costLabel: hoursDelta < 0 ? `节省 ${-hoursDelta} h` : '符合预计' }
}
function baselinePlans(state: ManagementState, ids: Set<string>): ManagementPlan[] {
  const plans = state.plans.filter(plan => plan.status !== 'cancelled' && plan.taskIds.some(id => ids.has(id)))
  const roots = new Map<string, ManagementPlan>()
  for (const plan of plans) {
    let root = plan
    const visited = new Set<string>()
    while (root.sourcePlanId && !visited.has(root.id)) {
      visited.add(root.id)
      const parent = state.plans.find(item => item.id === root.sourcePlanId)
      if (!parent || parent.status === 'cancelled') break
      root = parent
    }
    roots.set(root.id, root)
  }
  return [...roots.values()]
}
export function getScopeSchedule(state: ManagementState, taskIds: string[], today = managementToday()): ManagementScheduleSummary {
  const scope = new Set(taskIds), tasks = state.tasks.filter(task => scope.has(task.id) && task.status !== 'cancelled')
  const effort = getTaskEffortSummary(state, tasks.map(task => task.id))
  const plans = baselinePlans(state, scope), covered = new Set(plans.flatMap(plan => plan.taskIds))
  const exactPlans = plans.filter(plan => plan.taskIds.every(id => scope.has(id)))
  const sharedPlans = plans.filter(plan => !plan.taskIds.every(id => scope.has(id)))
  const estimates = [...exactPlans.map(plan => plan.baselineHours === undefined ? plan.plannedHours : plan.baselineHours), ...tasks.filter(task => !covered.has(task.id)).map(task => task.estimatedHours)]
  const estimatedHours = estimates.length && estimates.every((value): value is number => value !== null) ? sumHours(estimates) : null
  const sharedEstimatedHours = sumHours(sharedPlans.map(plan => plan.baselineHours ?? plan.plannedHours ?? 0))
  const actualWeeks = ordered([...effort.efforts, ...effort.sharedEfforts].filter(entry => entry.hours > 0).map(entry => entry.week).concat(effort.baselines.filter(entry => entry.hours > 0).map(entry => weekStart(entry.asOf))))
  const complete = tasks.length > 0 && tasks.every(task => task.status === 'done')
  if (!effort.efforts.length && !effort.sharedEfforts.length) actualWeeks.push(...ordered(tasks.flatMap(task => [weekOf(task.startedAt), task.status === 'done' ? task.completedWeek || weekOf(task.completedAt) : ''])).filter(week => !actualWeeks.includes(week)))
  actualWeeks.sort()
  const completions = tasks.map(task => task.completedWeek || weekOf(task.completedAt))
  const completedWeek = complete && completions.every(Boolean) ? last(completions) : ''
  const plannedStartWeek = first(tasks.map(task => task.plannedStartWeek || first(plans.filter(plan => plan.taskIds.includes(task.id)).map(plan => plan.baselineWeek || plan.week)) || task.plannedEndWeek || weekOf(task.dueDate)))
  const plannedEndWeek = last(tasks.map(task => task.plannedEndWeek || weekOf(task.dueDate) || last(plans.filter(plan => plan.taskIds.includes(task.id)).map(plan => plan.baselineWeek || plan.week))))
  const signature = (ids: string[]) => [...ids].sort().join('\u0000')
  const expectedScopes = [...new Set(sharedPlans.map(plan => signature(plan.taskIds)))].sort()
  const actualScopes = [...new Set(effort.sharedEfforts.map(entry => signature(getEffortTaskIds(state, entry))))].sort()
  const sharedComparison = estimatedHours === null && effort.hours === null && sharedPlans.length > 0 && expectedScopes.length === actualScopes.length && expectedScopes.every((value, index) => value === actualScopes[index])
  const hasShared = sharedPlans.length > 0 || effort.sharedEfforts.length > 0
  const sharedComplete = sharedComparison && state.tasks.filter(task => sharedPlans.some(plan => plan.taskIds.includes(task.id))).every(task => task.status === 'done' || task.status === 'cancelled')
  const cost = hasShared && !sharedComparison ? { hoursDelta: null, costStatus: 'missing' as const, costLabel: '组合工时未拆分' }
    : costFor(sharedComparison ? sharedEstimatedHours : estimatedHours, sharedComparison ? effort.sharedHours : effort.hours, sharedComparison ? sharedComplete : complete)
  return { plannedStartWeek, plannedEndWeek, actualWeeks, completedWeek, complete,
    estimatedHours, sharedEstimatedHours, sharedEstimateCount: sharedPlans.length, actualHours: effort.hours, sharedActualHours: effort.sharedHours, sharedActualCount: effort.sharedEfforts.length,
    allocatedHours: sumHours([...effort.efforts, ...effort.sharedEfforts].filter(entry => entry.hoursSource === 'allocated').map(entry => entry.hours)),
    ...statusFor(plannedStartWeek, plannedEndWeek, actualWeeks, completedWeek, complete, today), ...cost,
    costLabel: sharedComparison && cost.hoursDelta !== null ? `共用${cost.costLabel}` : cost.costLabel, sharedComparison }
}
export function requirementScheduleTaskIds(state: ManagementState, requirementId: string): string[] {
  const tasks = state.tasks.filter(task => task.requirementId === requirementId && task.status !== 'cancelled')
  const dev = tasks.filter(task => task.stage === 'frontend' || task.stage === 'backend')
  const product = tasks.filter(task => task.stage === 'design' || task.stage === 'documentation')
  return (dev.length ? dev : product.length ? product : tasks).map(task => task.id)
}
export function getRequirementSchedule(state: ManagementState, requirementId: string, today = managementToday()): ManagementScheduleSummary {
  const requirement = state.requirements.find(item => item.id === requirementId)
  if (!requirement) throw new Error('需求不存在')
  const ids = requirementScheduleTaskIds(state, requirementId), result = getScopeSchedule(state, ids, today)
  const plannedStartWeek = requirement.plannedStartWeek || result.plannedStartWeek
  const plannedEndWeek = requirement.plannedEndWeek || result.plannedEndWeek
  const complete = ids.length ? result.complete : ['developed', 'integration', 'testing', 'release', 'released', 'accepted'].includes(requirement.phase) || !!requirement.devCompletedAt || !!requirement.completedWeek
  const completedWeek = complete ? result.completedWeek || requirement.completedWeek || weekOf(requirement.devCompletedAt) : ''
  const status = requirement.status !== 'active' ? { status: 'paused' as const, label: requirement.status === 'paused' ? '已暂停' : '已取消', weeksDelta: null }
    : statusFor(plannedStartWeek, plannedEndWeek, result.actualWeeks, completedWeek, complete, today)
  return { ...result, plannedStartWeek, plannedEndWeek, complete, completedWeek, ...status }
}
export function getPlanEfforts(state: ManagementState, plan: ManagementPlan): ManagementEffort[] {
  const ids = new Set(plan.taskIds)
  return state.efforts.filter(entry => {
    if (entry.planId) return entry.planId === plan.id
    if (plan.status === 'cancelled' || entry.versionId !== plan.versionId || entry.personId !== plan.personId || entry.role !== plan.role || entry.stage !== plan.stage || !entry.taskIds.length || !entry.taskIds.every(id => ids.has(id))) return false
    const candidates = state.plans.filter(item => item.status !== 'cancelled' && item.versionId === entry.versionId && item.personId === entry.personId && item.role === entry.role && item.stage === entry.stage && entry.taskIds.every(id => item.taskIds.includes(id)))
    const sameWeek = candidates.filter(item => item.week === entry.week), matches = sameWeek.length ? sameWeek : candidates
    return matches.length === 1 && matches[0].id === plan.id
  })
}
export function getPlanSchedule(state: ManagementState, plan: ManagementPlan, today = managementToday()): ManagementScheduleSummary {
  const scope = getScopeSchedule(state, plan.taskIds, today), efforts = getPlanEfforts(state, plan)
  const actualWeeks = ordered(efforts.filter(entry => entry.hours > 0).map(entry => entry.week)), complete = plan.outcome === 'done'
  const plannedWeek = plan.baselineWeek || plan.week, completedWeek = complete ? plan.completedWeek || last(actualWeeks) || scope.completedWeek : ''
  if (!actualWeeks.length && completedWeek) actualWeeks.push(completedWeek)
  const estimatedHours = plan.baselineHours === undefined ? plan.plannedHours : plan.baselineHours
  const actualHours = efforts.length ? sumHours(efforts.map(entry => entry.hours)) : null
  const status = plan.status === 'cancelled' ? { status: 'paused' as const, label: '已撤销', weeksDelta: null } : statusFor(plannedWeek, plannedWeek, actualWeeks, completedWeek, complete, today)
  return { ...scope, plannedStartWeek: plannedWeek, plannedEndWeek: plannedWeek, actualWeeks, completedWeek, complete,
    estimatedHours, actualHours, sharedEstimatedHours: 0, sharedActualHours: 0, sharedEstimateCount: 0, sharedActualCount: 0, sharedComparison: false,
    allocatedHours: sumHours(efforts.filter(entry => entry.hoursSource === 'allocated').map(entry => entry.hours)), ...status, ...costFor(estimatedHours, actualHours, complete) }
}
export function getPlansForWeek(state: ManagementState, week: string): ManagementPlan[] {
  week = weekStart(week)
  const peopleOrder = new Map(sortManagementPeople(state.people).map((person, index) => [person.id, index]))
  const plans = state.plans.filter(plan => plan.week === week || plan.baselineWeek === week || getPlanEfforts(state, plan).some(entry => entry.week === week))
  const completionOrder = new Map(plans.map(plan => {
    const schedule = getPlanSchedule(state, plan)
    return [plan.id, Number(schedule.complete && schedule.status === 'early')]
  }))
  return plans.sort((a, b) => completionOrder.get(a.id)! - completionOrder.get(b.id)! || (peopleOrder.get(a.personId) ?? peopleOrder.size) - (peopleOrder.get(b.personId) ?? peopleOrder.size))
}
export function getEffortWorkContent(effort: ManagementEffort, plan?: ManagementPlan): string {
  if (effort.workContent !== undefined) return effort.workContent
  return plan?.outcome === 'done' && (plan.completedWeek || plan.week) === effort.week ? plan.goal : ''
}
function completionCommands(state: ManagementState, taskIds: string[], completedWeek: string): ManagementCommand[] {
  completedWeek = weekStart(completedWeek)
  const ids = new Set(taskIds), commands: ManagementCommand[] = []
  for (const id of ids) {
    const task = state.tasks.find(item => item.id === id)
    if (!task || task.status === 'cancelled') throw new Error('完成范围包含无效任务')
    commands.push({ type: 'upsert', entity: 'tasks', value: { id, status: 'done', progress: 100, remainingHours: 0,
      completedWeek: task.completedWeek || weekOf(task.completedAt) || completedWeek } })
  }
  for (const requirementId of new Set(state.tasks.filter(task => ids.has(task.id)).map(task => task.requirementId))) {
    const requirement = state.requirements.find(item => item.id === requirementId)!
    const relevant = requirementScheduleTaskIds(state, requirementId).map(id => state.tasks.find(task => task.id === id)!)
    const allDone = relevant.length && relevant.every(task => task.status === 'done' || ids.has(task.id))
    const advanced = ['integration', 'testing', 'release', 'released', 'accepted'].includes(requirement.phase)
    if (allDone) commands.push({ type: 'upsert', entity: 'requirements', value: { id: requirementId,
      ...(!advanced && relevant.some(task => task.stage === 'frontend' || task.stage === 'backend') ? { phase: 'developed' } : {}),
      completedWeek: last(relevant.map(task => task.completedWeek || weekOf(task.completedAt) || completedWeek)) } })
    else if (requirement.phase === 'ready' || requirement.phase === 'discovery') commands.push({ type: 'upsert', entity: 'requirements', value: { id: requirementId, phase: 'development' } })
  }
  for (const plan of state.plans.filter(plan => plan.status !== 'cancelled' && plan.outcome !== 'done' && plan.taskIds.some(id => ids.has(id)))) {
    const tasks = state.tasks.filter(task => plan.taskIds.includes(task.id) && task.status !== 'cancelled')
    const carried = state.plans.some(item => item.sourcePlanId === plan.id && item.status !== 'cancelled')
    if (!carried && tasks.length && tasks.every(task => task.status === 'done' || ids.has(task.id)) && (plan.week >= completedWeek || getPlanEfforts(state, plan).some(entry => entry.week === completedWeek))) {
      commands.push({ type: 'upsert', entity: 'plans', value: { id: plan.id, outcome: 'done', completedWeek: last(tasks.map(task => task.completedWeek || weekOf(task.completedAt) || completedWeek)) } })
    }
  }
  return commands
}
export function prepareScheduleCompletion(state: ManagementState, taskIds: string[], completedWeek: string, reason = '确认角色任务实际完成周'): ManagementCommand {
  return { type: 'batch', commands: completionCommands(state, taskIds, completedWeek), reason }
}
export function preparePlanReview(state: ManagementState, input: { plan: ManagementPlan; actualWeek: string; actualHours: number | null; actualContent?: string; completedTaskIds: string[]; completedWeek: string; reason?: string }): ManagementCommand {
  const actualWeek = weekStart(input.actualWeek)
  const plan = { ...input.plan, id: input.plan.id || globalThis.crypto.randomUUID(), completedWeek: input.plan.outcome === 'done' ? weekStart(input.completedWeek || actualWeek) : '' }
  if (input.completedTaskIds.some(id => !plan.taskIds.includes(id))) throw new Error('完成任务不属于本次排期')
  if (input.actualHours === null && input.actualContent?.trim()) throw new Error('请填写该周实际用时后保存实际工作内容')
  const commands: ManagementCommand[] = [{ type: 'upsert', entity: 'plans', value: { ...plan } }]
  if (input.actualHours !== null) {
    const entries = getPlanEfforts(state, plan).filter(entry => entry.week === actualWeek)
    if (entries.length > 1) throw new Error('该排期本周有多条实际记录，请先合并')
    const existing = entries[0]
    const value = existing ? { id: existing.id, hours: input.actualHours, planId: plan.id, ...(existing.hours === input.actualHours ? {} : { hoursSource: 'reported' }) } : {
      projectId: plan.projectId, versionId: plan.versionId, personId: plan.personId, role: plan.role, stage: plan.stage,
      week: actualWeek, hours: input.actualHours, planId: plan.id, taskIds: [...plan.taskIds], kind: 'normal', notes: plan.notes, hoursSource: 'reported',
    }
    commands.push({ type: 'upsert', entity: 'efforts', value: { ...value, ...(input.actualContent === undefined ? {} : { workContent: input.actualContent }) } })
  }
  if (input.completedTaskIds.length) {
    const working = applyManagementCommand(state, { type: 'batch', commands, reason: input.reason || '登记周复盘' })
    commands.push(...completionCommands(working, input.completedTaskIds, input.completedWeek || actualWeek))
  }
  return { type: 'batch', commands, reason: input.reason || '更新周排期、实际投入与角色完成情况' }
}
