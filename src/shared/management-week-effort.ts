import { getEffortTaskIds, sumHours, weekEnd, weekStart, type ManagementCommand, type ManagementEffort, type ManagementPlan, type ManagementState } from './management'
import { getPlanEfforts, getScopeSchedule } from './management-schedule'

export interface WeekEffortRow {
  key: string; effort?: ManagementEffort; plan?: ManagementPlan; title: string; projectId: string; versionId: string;
  estimatedHours: number | null; weight: number; early: boolean; included: boolean; known: boolean;
}
export interface WeekEffortSettlementInput {
  personId: string; week: string; totalHours: number; known: { key: string; hours: number }[];
  planIds?: string[]; basis?: 'confirmed' | 'standard'; notes?: string;
}
export interface WeekEffortAllocation {
  rows: (WeekEffortRow & { hours: number; fixed: boolean })[];
  previousHours: number; totalHours: number; knownHours: number; allocatedHours: number;
}
function hourUnits(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000) throw new Error('工时必须为非负有效数字')
  return Math.round(value * 10000)
}

export function getWeekEffortRows(state: ManagementState, personId: string, week: string): WeekEffortRow[] {
  week = weekStart(week)
  const efforts = state.efforts.filter(entry => entry.personId === personId && entry.week === week)
  const plans = state.plans.filter(plan => plan.personId === personId && plan.status !== 'cancelled')
  const make = (effort: ManagementEffort | undefined, plan: ManagementPlan | undefined): WeekEffortRow => {
    const ids = effort ? getEffortTaskIds(state, effort) : plan!.taskIds
    const scope = getScopeSchedule(state, ids, weekEnd(week))
    const requirements = [...new Set(state.tasks.filter(task => ids.includes(task.id)).map(task => state.requirements.find(item => item.id === task.requirementId)!))]
    const estimatedHours = plan ? plan.baselineHours === undefined ? plan.plannedHours : plan.baselineHours : scope.estimatedHours
    const early = scope.complete && scope.status === 'early' && !!scope.completedWeek && scope.completedWeek <= week
    const included = !!effort || plan!.outcome !== 'pending' && (!plan!.completedWeek || plan!.completedWeek === week)
    return { key: effort ? `effort:${effort.id}` : `plan:${plan!.id}`, effort, plan,
      title: requirements.length ? requirements.map(item => `${item.title}（${item.code}）`).join('；') : plan?.title || '未关联需求的实际投入',
      projectId: effort?.projectId || plan!.projectId, versionId: effort?.versionId || plan!.versionId,
      estimatedHours, weight: estimatedHours ?? effort?.allocationWeight ?? effort?.hours ?? 0,
      early, included, known: !!effort && effort.hoursSource !== 'allocated' }
  }
  const result = efforts.map(effort => {
    const candidates = plans.filter(plan => getPlanEfforts(state, plan).some(entry => entry.id === effort.id))
    return make(effort, candidates.length === 1 ? candidates[0] : undefined)
  })
  for (const plan of plans) {
    if (plan.status !== 'confirmed' || getPlanEfforts(state, plan).some(entry => entry.week === week)) continue
    if (plan.outcome === 'done' && plan.completedWeek && plan.completedWeek < week) continue
    if (plan.week === week || plan.outcome === 'done' && plan.completedWeek === week) result.push(make(undefined, plan))
  }
  return result
}

export function getWeekEffortDefaultHours(state: ManagementState, personId: string, week: string): number {
  week = weekStart(week)
  const actual = state.weekActuals.find(entry => entry.personId === personId && entry.week === week)
  if (actual) return actual.hours
  const rows = getWeekEffortRows(state, personId, week).filter(row => row.included)
  if (rows.length && rows.every(row => row.known)) return sumHours(rows.map(row => row.effort!.hours))
  return state.capacities.find(entry => entry.personId === personId && entry.week === week)?.hours
    ?? state.people.find(person => person.id === personId)?.weeklyCapacity ?? 40
}

export function previewWeekEffortSettlement(state: ManagementState, input: WeekEffortSettlementInput): WeekEffortAllocation {
  if (!state.people.some(person => person.id === input.personId)) throw new Error('周工时人员不存在')
  const target = hourUnits(input.totalHours), all = getWeekEffortRows(state, input.personId, input.week)
  if (new Set(input.planIds || []).size !== (input.planIds || []).length) throw new Error('本周任务选择重复')
  if (input.planIds?.some(id => !all.some(row => !row.effort && row.plan?.id === id))) throw new Error('选择的排期不属于本人员本周可核算范围')
  const rows = all.filter(row => row.effort || (input.planIds ? input.planIds.includes(row.plan!.id) : row.included))
  const known = new Map(input.known.map(item => [item.key, hourUnits(item.hours)]))
  if (known.size !== input.known.length || input.known.some(item => !rows.some(row => row.key === item.key))) throw new Error('已知工时范围无效或重复')
  const knownUnits = [...known.values()].reduce((sum, value) => sum + value, 0), remaining = target - knownUnits
  if (remaining < 0) throw new Error('已知工时超过本周总实际投入，请核对总工时或已知工时')
  const unknown = rows.filter(row => !known.has(row.key)), totalWeight = sumHours(unknown.map(row => row.weight))
  if (remaining && !unknown.length) throw new Error('全部工时已锁定，但与本周总投入不一致')
  if (remaining && totalWeight <= 0) throw new Error('待分摊任务缺少预计工时，请补充预计或填写已知工时')
  // Largest remainders keep four-decimal allocations exact without changing known hours.
  const shares = unknown.map((row, index) => {
    const exact = totalWeight > 0 ? remaining * row.weight / totalWeight : 0
    return { key: row.key, units: Math.floor(exact), fraction: exact - Math.floor(exact), index }
  })
  const rest = remaining - shares.reduce((sum, row) => sum + row.units, 0)
  const ordered = shares.slice().sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let index = 0; index < rest; index++) ordered[index % ordered.length].units++
  const allocated = new Map(shares.map(row => [row.key, row.units]))
  return { rows: rows.map(row => ({ ...row, hours: (known.get(row.key) ?? allocated.get(row.key)!) / 10000, fixed: known.has(row.key) })),
    previousHours: sumHours(rows.map(row => row.effort?.hours || 0)), totalHours: target / 10000, knownHours: knownUnits / 10000, allocatedHours: remaining / 10000 }
}

export function prepareWeekEffortSettlement(state: ManagementState, input: WeekEffortSettlementInput): ManagementCommand {
  const preview = previewWeekEffortSettlement(state, input), week = weekStart(input.week)
  const commands: ManagementCommand[] = preview.rows.map(row => ({ type: 'upsert', entity: 'efforts', value: {
    ...(row.effort ? { id: row.effort.id } : { projectId: row.projectId, versionId: row.versionId, personId: input.personId,
      role: row.plan!.role, stage: row.plan!.stage, week, taskIds: [...row.plan!.taskIds], planId: row.plan!.id, kind: 'normal', notes: '' }),
    hours: row.hours, hoursSource: row.fixed ? 'reported' : 'allocated', ...(!row.fixed ? { allocationWeight: row.weight } : {})
  } }))
  const existing = state.weekActuals?.find(entry => entry.personId === input.personId && entry.week === week)
  commands.push({ type: 'upsert', entity: 'weekActuals', value: { id: existing?.id || crypto.randomUUID(), personId: input.personId, week,
    hours: preview.totalHours, basis: input.basis || 'confirmed', notes: input.notes === undefined ? existing?.notes || '' : input.notes } })
  return { type: 'batch', commands, reason: `核算${week}周实际投入：总计${preview.totalHours}H，已知${preview.knownHours}H，按原预计比例分摊${preview.allocatedHours}H${input.notes ? `；${input.notes}` : ''}` }
}
