import { developmentDays, getEffortTaskIds, weekStart, type ManagementRequirement, type ManagementState, type ManagementTask } from './management'
import { formatScheduleWeek, scheduleWeekDelta } from './management-schedule'

export interface ManagementVersionMilestone { date: string; week: string; label: string }
export interface ManagementVersionTimeline {
  developmentStart: ManagementVersionMilestone; developmentEnd: ManagementVersionMilestone;
  testEnd: ManagementVersionMilestone; release: ManagementVersionMilestone;
  developmentState: 'unplanned' | 'pending' | 'active' | 'complete';
  developmentDays: number | null; developmentWeeks: number | null;
}
function milestone(date = '', week = '', label = ''): ManagementVersionMilestone {
  return { date, week: date ? weekStart(date) : week, label }
}
function boundary(points: ManagementVersionMilestone[], edge: 'first' | 'last', label: string): ManagementVersionMilestone {
  const weeks = points.map(point => point.week).filter(Boolean).sort()
  const week = (edge === 'first' ? weeks[0] : weeks.at(-1)) || ''
  if (!week) return milestone('', '', label)
  const candidates = points.filter(point => point.week === week)
  // A week-only record cannot establish the exact first or last workday.
  if (candidates.some(point => !point.date)) return milestone('', week)
  const dates = candidates.map(point => point.date).sort()
  return milestone(edge === 'first' ? dates[0] : dates.at(-1))
}
function taskCompletion(tasks: ManagementTask[], requirements: Map<string, ManagementRequirement>, field: 'devCompletedAt' | 'testCompletedAt') {
  const points = tasks.map(task => task.completedAt || task.completedWeek
    ? milestone(task.completedAt, task.completedWeek)
    : milestone(requirements.get(task.requirementId)?.[field]))
  return points.every(point => point.week) ? boundary(points, 'last', '已完成 · 日期未记录') : milestone('', '', '已完成 · 日期未记录')
}
export function getVersionTimeline(state: ManagementState, versionId: string): ManagementVersionTimeline {
  const version = state.versions.find(item => item.id === versionId)
  if (!version) throw new Error('专项版本不存在')
  const requirements = new Map(state.requirements.filter(item => item.versionId === versionId && item.status !== 'cancelled').map(item => [item.id, item]))
  const tasks = state.tasks.filter(task => requirements.has(task.requirementId) && task.status !== 'cancelled')
  const development = tasks.filter(task => task.stage === 'frontend' || task.stage === 'backend')
  const developmentIds = new Set(development.map(task => task.id))
  const testing = tasks.filter(task => task.stage === 'testing')
  const efforts = state.efforts.filter(entry => entry.versionId === versionId && entry.hours > 0)
  const developmentEfforts = efforts.filter(entry => {
    const ids = getEffortTaskIds(state, entry)
    return (entry.stage === 'frontend' || entry.stage === 'backend') && (!ids.length || ids.some(id => developmentIds.has(id)))
  })
  const deliveredRequirements = [...requirements.values()].filter(requirement => development.some(task => task.requirementId === requirement.id))
  const released = !!version.releasedAt || !!deliveredRequirements.length && deliveredRequirements.every(requirement => requirement.releasedAt || requirement.phase === 'released')
  const hasDevelopment = !!(development.length || developmentEfforts.length || version.startedAt || version.devCompletedAt || version.submittedAt || version.testStartedAt || version.testCompletedAt || version.releasedAt)
  // Follow-up tasks can remain open after a confirmed release without reopening that release.
  const developmentComplete = released || !!version.devCompletedAt || !!development.length && development.every(task => task.status === 'done') ||
    !development.length && !!(version.submittedAt || version.testStartedAt || version.testCompletedAt || version.releasedAt)
  const developmentActive = !!(version.startedAt || developmentEfforts.length || development.some(task => task.startedAt || task.status === 'active' || task.status === 'done' || task.status === 'blocked'))
  const developmentState = !hasDevelopment ? 'unplanned' : developmentComplete ? 'complete' : developmentActive ? 'active' : 'pending'
  const developmentStart = version.startedAt ? milestone(version.startedAt) : boundary([
    ...development.filter(task => task.startedAt).map(task => milestone(task.startedAt)),
    ...developmentEfforts.map(entry => milestone('', entry.week)),
  ], 'first', developmentState === 'unplanned' ? '未安排开发' : developmentActive || developmentComplete ? '开始未记录' : '未开始')
  const developmentEnd = version.devCompletedAt ? milestone(version.devCompletedAt) : developmentComplete
    ? development.length ? taskCompletion(development, requirements, 'devCompletedAt') : milestone('', '', '已完成 · 日期未记录')
    : milestone('', '', developmentState === 'unplanned' ? '未安排开发' : developmentActive ? '开发中' : '未完成')
  const requirementTestsComplete = !testing.length && !!deliveredRequirements.length && deliveredRequirements.every(requirement => requirement.testCompletedAt)
  const testingComplete = !!testing.length && testing.every(task => task.status === 'done') || requirementTestsComplete
  const testingActive = !!(version.testStartedAt || version.submittedAt || testing.some(task => task.startedAt || task.status === 'active' || task.status === 'blocked' || task.status === 'done') ||
    efforts.some(entry => entry.stage === 'testing') || [...requirements.values()].some(requirement => requirement.phase === 'testing' || requirement.submittedAt))
  const testEnd = version.testCompletedAt ? milestone(version.testCompletedAt) : requirementTestsComplete
    ? boundary(deliveredRequirements.map(requirement => milestone(requirement.testCompletedAt)), 'last', '完成日期未记录')
    : testingComplete ? taskCompletion(testing, requirements, 'testCompletedAt')
    : milestone('', '', released ? '完成日期未记录' : testingActive ? '测试中' : developmentComplete ? '待测试' : '未开始')
  const release = version.releasedAt ? milestone(version.releasedAt) : deliveredRequirements.length && deliveredRequirements.every(requirement => requirement.releasedAt)
    ? boundary(deliveredRequirements.map(requirement => milestone(requirement.releasedAt)), 'last', '上线日期未记录')
    : milestone('', '', released ? '已上线 · 日期未记录' : deliveredRequirements.some(requirement => requirement.releasedAt) ? '部分上线' : version.testCompletedAt || testingComplete ? '待上线' : '未上线')
  const days = developmentStart.date && developmentEnd.date ? developmentDays(developmentStart.date, developmentEnd.date) : null
  const weeks = developmentStart.week && developmentEnd.week && developmentStart.week <= developmentEnd.week
    ? scheduleWeekDelta(developmentStart.week, developmentEnd.week) + 1 : null
  return { developmentStart, developmentEnd, testEnd, release, developmentState, developmentDays: days, developmentWeeks: weeks }
}
export function formatVersionMilestone(point: ManagementVersionMilestone, year = false): string {
  return point.date || (point.week ? `${formatScheduleWeek(point.week, year)} 周` : point.label)
}
export function formatVersionDevelopmentSpan(timeline: ManagementVersionTimeline): string {
  if (timeline.developmentDays !== null) return `${timeline.developmentDays} 天`
  if (timeline.developmentWeeks !== null) return `跨 ${timeline.developmentWeeks} 周`
  return { unplanned: '未安排开发', pending: '未开始', active: '开发中', complete: '日期待补录' }[timeline.developmentState]
}
