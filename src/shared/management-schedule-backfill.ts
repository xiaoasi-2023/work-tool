import { applyManagementCommand, getTaskEffortSummary, sumHours, weekStart, type ManagementCommand, type ManagementState } from './management'
import { getPlanEfforts, getRequirementSchedule } from './management-schedule'

const uniqueWeeks = (values: string[]) => [...new Set(values.filter(Boolean))].sort()
const dateWeek = (value: string) => value ? weekStart(value) : ''

// Only historical metadata is inferred. Pending work never acquires invented actual effort.
export function prepareHistoricalScheduleBackfill(state: ManagementState): ManagementCommand | null {
  const commands: ManagementCommand[] = []
  const working = structuredClone(state)
  const patch = (entity: 'plans' | 'tasks' | 'requirements', original: { id: string }, fields: Record<string, unknown>) => {
    const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== undefined && value !== (original as unknown as Record<string, unknown>)[key]))
    if (!Object.keys(changes).length) return
    commands.push({ type: 'upsert', entity, value: { id: original.id, ...changes } })
    Object.assign(original, changes)
  }
  for (const plan of working.plans) {
    const efforts = getPlanEfforts(working, plan)
    patch('plans', plan, {
      ...(plan.status !== 'draft' ? { baselineWeek: plan.baselineWeek || plan.week,
        baselineHours: plan.baselineHours === undefined ? plan.plannedHours ?? (efforts.length ? sumHours(efforts.map(entry => entry.hours)) : null) : plan.baselineHours } : {}),
      ...(plan.outcome === 'done' ? { completedWeek: plan.completedWeek || uniqueWeeks(efforts.map(entry => entry.week)).at(-1) || plan.week } : {}),
    })
  }
  for (const task of working.tasks) {
    if (task.status === 'cancelled') continue
    const requirement = working.requirements.find(item => item.id === task.requirementId)!
    const plans = working.plans.filter(plan => plan.status !== 'cancelled' && plan.taskIds.includes(task.id) && !plan.sourcePlanId)
    const effort = getTaskEffortSummary(working, [task.id])
    const actualWeeks = uniqueWeeks([...effort.efforts, ...effort.sharedEfforts].map(entry => entry.week).concat(effort.baselines.map(entry => weekStart(entry.asOf))))
    const completedWeek = task.status === 'done' ? task.completedWeek || dateWeek(task.completedAt) || actualWeeks.at(-1) || dateWeek(requirement.devCompletedAt) || plans.map(plan => plan.baselineWeek || plan.week).sort().at(-1) || dateWeek(task.dueDate) : ''
    const plannedWeeks = uniqueWeeks(plans.map(plan => plan.baselineWeek || plan.week))
    const plannedEndWeek = task.plannedEndWeek || dateWeek(task.dueDate) || plannedWeeks.at(-1) || requirement.plannedEndWeek || dateWeek(requirement.dueDate) || actualWeeks.at(-1) || completedWeek || ''
    const plannedStartWeek = task.plannedStartWeek || plannedWeeks[0] || requirement.plannedStartWeek || dateWeek(task.startedAt) || actualWeeks[0] || plannedEndWeek
    const exclusive = plans.filter(plan => plan.taskIds.length === 1)
    const estimatedHours = task.estimatedHours ?? (exclusive.length && exclusive.every(plan => plan.baselineHours != null) ? sumHours(exclusive.map(plan => plan.baselineHours!)) : !plans.length ? effort.hours : null)
    patch('tasks', task, {
      ...(plannedStartWeek ? { plannedStartWeek } : {}), ...(plannedEndWeek ? { plannedEndWeek } : {}),
      ...(completedWeek ? { completedWeek } : {}), ...(estimatedHours !== null ? { estimatedHours } : {}),
    })
  }
  for (const requirement of working.requirements) {
    const schedule = getRequirementSchedule(working, requirement.id)
    patch('requirements', requirement, {
      ...(schedule.plannedStartWeek ? { plannedStartWeek: requirement.plannedStartWeek || schedule.plannedStartWeek } : {}),
      ...(schedule.plannedEndWeek ? { plannedEndWeek: requirement.plannedEndWeek || schedule.plannedEndWeek } : {}),
      ...(schedule.complete && schedule.completedWeek ? { completedWeek: requirement.completedWeek || schedule.completedWeek } : {}),
    })
  }
  const command: ManagementCommand | null = commands.length ? { type: 'batch', commands, reason: '补齐历史计划基准与实际完成周；缺失计划按已登记工作周和工时回填，保留已知偏差和原实际投入' } : null
  if (command) applyManagementCommand(state, command)
  return command
}
