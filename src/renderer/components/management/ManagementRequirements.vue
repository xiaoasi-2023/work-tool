<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElCheckbox, ElDialog, ElMessage, ElMessageBox, ElOption, ElSelect, ElInputNumber } from 'element-plus'
import { ArrowDownRight, ArrowUpRight, Check, CircleAlert, ClipboardList, Clock3, Copy, GitBranch, Link2, Pencil, Plus, Search, Trash2, X } from 'lucide-vue-next'
import { useManagement } from '../../management-store'
import { copyText } from '../../tool-io'
import ManagementTaskWeekEffort from './ManagementTaskWeekEffort.vue'
import ManagementSchedule from './ManagementSchedule.vue'
import { formatScheduleWeek, getRequirementSchedule, getScopeSchedule, prepareScheduleCompletion, scheduleStatusLabels, type ScheduleStatus } from '../../../shared/management-schedule'
import { applyManagementCommand, getEffortTaskIds, getRequirementPhase, getRequirementWork, getTaskEffortSummary, getTaskEffortWeeks, isRequirementClosed, managementRoles, managementStages, phaseLabels, requirementPhaseLabels, roleLabels, stageLabels, sumHours, taskStatusLabels, weekStart,
  type ManagementCommand, type ManagementRequirement, type ManagementRole, type ManagementStage, type ManagementTask } from '../../../shared/management'

const props = defineProps<{ focusId?: string }>()
const manager = useManagement()
const query = ref('')
const projectFilter = ref('')
const versionFilter = ref('')
const moduleFilter = ref<string | null>(null)
const phaseFilter = ref('')
const scheduleFilter = ref<ScheduleStatus | ''>('')
const includeClosed = ref(false)
const selectedId = ref('')
const requirementDialog = ref(false)
const taskDialog = ref(false)
const requirementFormElement = ref<HTMLFormElement>()
const taskFormElement = ref<HTMLFormElement>()
const reason = ref('')
const taskReason = ref('')
const effortDialog = ref(false)
const weeklyDialog = ref(false), weeklyTaskIds = ref<string[]>([])
const effortScope = ref({ title: '', subtitle: '', taskIds: [] as string[] })
const deliveryRoles = ['product', 'frontend', 'backend', 'qa'] as const
const platformOptions = ['PC端', '小程序', 'App', '服务端', '无界面']
const priorities = { urgent: '紧急', high: '高', normal: '普通', low: '低' }
const requirementStates = { active: '进行中', paused: '暂停', cancelled: '已取消' }
const selectedStages = ref<ManagementStage[]>(['frontend', 'backend', 'testing', 'release'])
const stageComplexities = ref<Partial<Record<ManagementStage, string>>>({})
function emptyRequirement(): ManagementRequirement {
  const version = manager.state.versions.find(item => item.id === versionFilter.value)
  const projectId = projectFilter.value || version?.projectId || ''
  const modules = manager.state.projects.find(project => project.id === projectId)?.modules || []
  const module = moduleFilter.value && modules.includes(moduleFilter.value) ? moduleFilter.value : ''
  return { id: '', code: '', projectId, versionId: version?.id || '', title: '', module, platforms: [], kind: '功能需求', priority: 'normal', ownerId: '', description: '', acceptance: '', externalUrl: '', phase: 'ready', status: 'active', closing: 'release', dueDate: '', nextAction: '', nextOwnerId: '', followUpDate: '', devCompletedAt: '', submittedAt: '', testCompletedAt: '', releasedAt: '', notes: '' }
}
const requirementForm = ref<ManagementRequirement>(emptyRequirement())
function roleFor(stage: ManagementStage): ManagementRole {
  return stage === 'design' || stage === 'documentation' ? 'product' : stage === 'frontend' ? 'frontend' : stage === 'backend' ? 'backend' : stage === 'testing' ? 'qa' : 'other'
}
function emptyTask(requirementId = ''): ManagementTask {
  return { id: '', requirementId, name: '前端开发', stage: 'frontend', role: 'frontend', ownerId: '', complexity: '', estimatedHours: null, remainingHours: null, status: 'pending', progress: 0, dependencies: [], dueDate: '', startedAt: '', completedAt: '', blockedReason: '', notes: '' }
}
const taskForm = ref<ManagementTask>(emptyTask())
const workByRequirement = computed(() => new Map(manager.state.requirements.map(requirement => {
  const work = getRequirementWork(manager.state, requirement.id)
  const roles = deliveryRoles.map(role => {
    const summary = work.byRole[role]
    const names = [...new Set([...summary.ownerIds.map(personName), ...summary.baselines.filter(entry => !entry.personId).map(entry => entry.peopleLabel)])]
    const sharedRequirements = [...new Set(summary.sharedEfforts.flatMap(entry => getEffortTaskIds(manager.state, entry))
      .map(id => manager.state.tasks.find(task => task.id === id)?.requirementId).filter(Boolean))]
    const sharedLabel = sharedRequirements.length > 1 ? `${sharedRequirements.length}项需求合计` : '多个任务合计'
    const sharedTitle = sharedRequirements.map(id => manager.state.requirements.find(item => item.id === id)?.title).filter(Boolean).join('；')
    return { ...summary, role, people: names.join('、') || (summary.taskIds.length ? '未分配' : '—'), sharedLabel, sharedTitle, schedule: getScopeSchedule(manager.state, summary.taskIds) }
  })
  return [requirement.id, roles] as const
})))
const effortSummary = computed(() => getTaskEffortSummary(manager.state, effortScope.value.taskIds))
const effortRows = computed(() => {
  const weekly = [
    ...effortSummary.value.efforts.map(entry => ({ entry, shared: false })),
    ...effortSummary.value.sharedEfforts.map(entry => ({ entry, shared: true }))
  ].map(row => ({ ...row, historical: false, peopleLabel: '', requirements: [...new Set(getEffortTaskIds(manager.state, row.entry).map(id => manager.state.tasks.find(task => task.id === id)?.requirementId).filter((id): id is string => !!id))]
    .map(id => manager.state.requirements.find(requirement => requirement.id === id)!).filter(Boolean) }))
  const historical = effortSummary.value.baselines.map(baseline => {
    const task = manager.state.tasks.find(item => item.id === baseline.taskId)!
    return { entry: { id: baseline.id, week: baseline.asOf, personId: baseline.personId, hours: baseline.hours, notes: baseline.notes }, shared: false, historical: true, peopleLabel: baseline.peopleLabel,
      requirements: [manager.state.requirements.find(requirement => requirement.id === task.requirementId)!] }
  })
  return [...weekly, ...historical].sort((a, b) => b.entry.week.localeCompare(a.entry.week))
})
const schedules = computed(() => new Map(manager.state.requirements.map(item => [item.id, getRequirementSchedule(manager.state, item.id)])))
const taskSchedules = computed(() => new Map(manager.state.tasks.map(task => [task.id, getScopeSchedule(manager.state, [task.id])])))
const filteredList = computed(() => manager.state.requirements.filter(item =>
  (!projectFilter.value || item.projectId === projectFilter.value) && (!versionFilter.value || item.versionId === versionFilter.value) &&
  (moduleFilter.value === null || item.module === moduleFilter.value) &&
  (!phaseFilter.value || getRequirementPhase(manager.state, item.id) === phaseFilter.value) && (includeClosed.value || !isRequirementClosed(manager.state, item.id)) &&
  `${item.code} ${item.title} ${item.module} ${item.nextAction} ${item.description} ${roleCells(item.id).map(role => role.people).join(' ')}`.toLowerCase().includes(query.value.toLowerCase())
))
const list = computed(() => filteredList.value.filter(item => !scheduleFilter.value || schedules.value.get(item.id)?.status === scheduleFilter.value))
const scheduleCounts = computed(() => Object.fromEntries(Object.keys(scheduleStatusLabels).map(status => [status, filteredList.value.filter(item => schedules.value.get(item.id)?.status === status).length])))
const selected = computed(() => manager.state.requirements.find(item => item.id === selectedId.value))
const tasks = computed(() => manager.state.tasks.filter(task => task.requirementId === selectedId.value))
const weeklyEfforts = computed(() => getTaskEffortWeeks(manager.state, tasks.value.map(task => task.id)).map(row => ({
  ...row,
  allocated: row.efforts.some(entry => entry.hoursSource === 'allocated'),
  people: [...new Set(row.efforts.map(entry => `${personName(entry.personId)} · ${stageLabels[entry.stage]}`))].join('；'),
  goals: [...new Set(row.efforts.map(entry => manager.state.plans.find(plan => plan.id === entry.planId)?.goal).filter(Boolean))],
  details: row.efforts.filter(entry => entry.notes).map(entry => ({ id: entry.id, notes: entry.notes }))
})))
const unrecordedPlans = computed(() => {
  const scope = new Set(tasks.value.map(task => task.id))
  return manager.state.plans.filter(plan => plan.status !== 'cancelled' && plan.taskIds.some(id => scope.has(id)) && !manager.state.efforts.some(entry => entry.planId === plan.id))
    .slice().sort((a, b) => a.week.localeCompare(b.week))
})
const historicalHours = computed(() => sumHours(getTaskEffortSummary(manager.state, tasks.value.map(task => task.id)).baselines.map(entry => entry.hours)))
const dependencyOptions = computed(() => manager.state.tasks.filter(task => task.id !== taskForm.value.id && task.requirementId === taskForm.value.requirementId))
const taskCounts = computed(() => ({ total: tasks.value.filter(task => task.status !== 'cancelled').length, done: tasks.value.filter(task => task.status === 'done').length }))
const versions = computed(() => manager.state.versions.filter(version => !projectFilter.value || version.projectId === projectFilter.value))
const moduleOptions = computed(() => {
  const projectId = projectFilter.value || manager.state.versions.find(version => version.id === versionFilter.value)?.projectId || ''
  return [...new Set(manager.state.projects.filter(project => !projectId || project.id === projectId).flatMap(project => project.modules))]
})
const hasFilters = computed(() => !!(query.value || projectFilter.value || versionFilter.value || phaseFilter.value || scheduleFilter.value) || moduleFilter.value !== null)
const formVersions = computed(() => manager.state.versions.filter(version => version.projectId === requirementForm.value.projectId))
const formConfiguredModules = computed(() => manager.state.projects.find(project => project.id === requirementForm.value.projectId)?.modules || [])
const recordHistory = computed(() => {
  const ids = new Set([selectedId.value, ...tasks.value.map(task => task.id)])
  for (const baseline of manager.state.baselines) if (baseline.taskId && ids.has(baseline.taskId)) ids.add(baseline.id)
  return manager.state.audit.filter(item => ids.has(item.entityId)).slice().reverse().slice(0, 12)
})
function projectName(id: string) { return manager.state.projects.find(project => project.id === id)?.name || '—' }
function versionName(id: string) { const version = manager.state.versions.find(item => item.id === id); return version ? `${version.code} · ${version.name}` : '待定版本' }
function personName(id: string) { return manager.state.people.find(person => person.id === id)?.name || '未指定' }
function roleCells(id: string) { return workByRequirement.value.get(id) || [] }
function displayHours(hours: number) { return hours.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) }
function taskActual(task: ManagementTask) { return getTaskEffortSummary(manager.state, [task.id]) }
function weeklyTasks(taskIds: string[]) {
  return taskIds.filter(id => {
    const task = manager.state.tasks.find(item => item.id === id)
    if (!task || task.status === 'done' || task.status === 'cancelled') return false
    const requirement = manager.state.requirements.find(item => item.id === task.requirementId)
    return requirement && requirement.status !== 'cancelled' && !['released', 'accepted'].includes(requirement.phase) && !requirement.releasedAt
  })
}
function openWeeklyEffort(taskIds: string[]) {
  const available = weeklyTasks(taskIds)
  if (!available.length) return
  weeklyTaskIds.value = available; weeklyDialog.value = true
}
function openRoleEffort(requirementId: string, role: ManagementRole) {
  const requirement = manager.state.requirements.find(item => item.id === requirementId)
  const work = roleCells(requirementId).find(item => item.role === role)
  if (!requirement || !work) return
  effortScope.value = { title: `${roleLabels[role]}实际投入`, subtitle: requirement.title, taskIds: [...work.taskIds] }; effortDialog.value = true
}
function openTaskEffort(task: ManagementTask) {
  effortScope.value = { title: '任务实际投入', subtitle: `${selected.value?.title || ''} / ${task.name}`, taskIds: [task.id] }; effortDialog.value = true
}
function focusRequirement(id: string) {
  query.value = ''; projectFilter.value = ''; versionFilter.value = ''; moduleFilter.value = null; phaseFilter.value = ''; scheduleFilter.value = ''; includeClosed.value = true; selectedId.value = id; effortDialog.value = false
}
function taskCount(id: string) { const items = manager.state.tasks.filter(task => task.requirementId === id && task.status !== 'cancelled'); return `${items.filter(task => task.status === 'done').length}/${items.length}` }
function requirementPhase(requirement: ManagementRequirement) { return requirementPhaseLabels[getRequirementPhase(manager.state, requirement.id)] }
function dates(requirement: ManagementRequirement) { return [{ name: '开发完成', date: requirement.devCompletedAt }, { name: '提测', date: requirement.submittedAt }, { name: '测试完成', date: requirement.testCompletedAt }, { name: '实际上线', date: requirement.releasedAt }] }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function editRequirement(item?: ManagementRequirement) {
  requirementForm.value = item ? clone(item) : emptyRequirement()
  if (item) { const summary = schedules.value.get(item.id)!; requirementForm.value.plannedStartWeek ||= summary.plannedStartWeek; requirementForm.value.plannedEndWeek ||= summary.plannedEndWeek }
  if (requirementForm.value.module && !formConfiguredModules.value.includes(requirementForm.value.module)) requirementForm.value.module = ''
  selectedStages.value = ['frontend', 'backend', 'testing', 'release']; stageComplexities.value = {}; reason.value = ''; requirementDialog.value = true
}
function projectChanged() { requirementForm.value.versionId = ''; requirementForm.value.module = '' }
async function saveRequirement() {
  if (!requirementFormElement.value?.reportValidity()) return
  const id = requirementForm.value.id || crypto.randomUUID()
  const value = { ...clone(requirementForm.value), id, title: requirementForm.value.title.trim() }
  const commands: ManagementCommand[] = [{ type: 'upsert', entity: 'requirements', value, reason: reason.value }]
  if (!requirementForm.value.id) for (const stage of selectedStages.value) commands.push({ type: 'upsert', entity: 'tasks', value: { ...emptyTask(id), id: crypto.randomUUID(), name: stageLabels[stage], stage, role: roleFor(stage), complexity: stageComplexities.value[stage] || '' } })
  if (await manager.execute({ type: 'batch', commands, reason: reason.value })) { requirementDialog.value = false; selectedId.value = id; ElMessage.success('需求已保存') }
}
function editTask(item?: ManagementTask) {
  if (!selected.value) return
  taskForm.value = item ? clone(item) : emptyTask(selected.value.id)
  if (item) { const summary = taskSchedules.value.get(item.id)!; taskForm.value.plannedStartWeek ||= summary.plannedStartWeek; taskForm.value.plannedEndWeek ||= summary.plannedEndWeek; taskForm.value.completedWeek ||= summary.completedWeek }
  taskReason.value = ''; taskDialog.value = true
}
function stageChanged() { taskForm.value.role = roleFor(taskForm.value.stage); if (!taskForm.value.name || Object.values(stageLabels).includes(taskForm.value.name)) taskForm.value.name = stageLabels[taskForm.value.stage] }
function taskStatusChanged() {
  if (taskForm.value.status === 'done') { taskForm.value.progress = 100; if (!taskForm.value.completedWeek) taskForm.value.completedWeek = taskForm.value.completedAt ? weekStart(taskForm.value.completedAt) : manager.week }
  else { if (taskForm.value.progress === 100) taskForm.value.progress = taskForm.value.status === 'pending' ? 0 : 50; if (taskForm.value.status === 'pending') taskForm.value.progress = 0; taskForm.value.completedAt = ''; taskForm.value.completedWeek = '' }
  if (taskForm.value.status === 'active' && !taskForm.value.startedAt) taskForm.value.startedAt = localDate()
}
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
async function saveTask() {
  if (!taskFormElement.value?.reportValidity()) return
  try {
    const value = { ...clone(taskForm.value), id: taskForm.value.id || crypto.randomUUID(), name: taskForm.value.name.trim() }
    const command: ManagementCommand = { type: 'upsert', entity: 'tasks', value, reason: taskReason.value }
    const commands: ManagementCommand[] = [command]
    if (value.status === 'done' && value.completedWeek) commands.push(prepareScheduleCompletion(applyManagementCommand(clone(manager.state), command), [value.id], value.completedWeek, taskReason.value || '更新角色完成周'))
    if (await manager.execute({ type: 'batch', commands, reason: taskReason.value })) { taskDialog.value = false; ElMessage.success('任务已保存') }
  } catch (error) { ElMessage.error((error as Error).message) }
}
function normalizeScheduleWeek(target: ManagementRequirement | ManagementTask, key: 'plannedStartWeek' | 'plannedEndWeek' | 'completedWeek') { if (target[key]) target[key] = weekStart(target[key]!) }
function taskCompletedDateChanged() { taskForm.value.completedWeek = taskForm.value.completedAt ? weekStart(taskForm.value.completedAt) : taskForm.value.completedWeek }
async function deleteTask(task: ManagementTask) {
  try { await ElMessageBox.confirm(`删除「${task.name}」？已关联排期或投入的任务无法删除，可改为取消。`, '删除任务', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '保留' }); if (await manager.remove('tasks', task.id, '删除未使用任务')) taskDialog.value = false } catch { /* User cancelled. */ }
}
function taskPlans(taskId: string) {
  return manager.state.plans.filter(plan => plan.taskIds.includes(taskId) && plan.status !== 'cancelled').sort((a, b) => a.week.localeCompare(b.week)).map(plan => `${plan.week} ${personName(plan.personId)}`).join('；')
}
watch(list, items => { if (selectedId.value && !items.some(item => item.id === selectedId.value)) selectedId.value = '' })
watch(projectFilter, () => { versionFilter.value = ''; moduleFilter.value = null })
watch(versionFilter, id => { if (id) includeClosed.value = true })
watch(moduleOptions, modules => { if (moduleFilter.value && !modules.includes(moduleFilter.value)) moduleFilter.value = null })
watch(phaseFilter, phase => { if (['completed', 'released', 'accepted'].includes(phase)) includeClosed.value = true })
watch(scheduleFilter, status => { if (['early', 'on-time', 'late', 'missing'].includes(status)) includeClosed.value = true })
watch(() => props.focusId, id => {
  if (!id) return
  focusRequirement(id)
}, { immediate: true })
</script>

<template>
  <section class="mg-requirements">
    <div class="mg-toolbar requirement-toolbar">
      <label class="requirement-search"><Search :size="15" /><input v-model="query" placeholder="搜索编号、需求或人员" aria-label="搜索编号、需求或人员" /></label>
      <el-select v-model="projectFilter" clearable placeholder="全部项目" aria-label="筛选项目" style="width:150px"><el-option v-for="project in manager.state.projects" :key="project.id" :label="project.name" :value="project.id" /></el-select>
      <el-select v-model="versionFilter" clearable placeholder="全部专项版本" aria-label="筛选版本" style="width:180px"><el-option v-for="version in versions" :key="version.id" :label="`${version.code} · ${version.name}`" :value="version.id" /></el-select>
      <el-select v-model="moduleFilter" clearable :empty-values="[null, undefined]" :value-on-clear="null" placeholder="全部模块" aria-label="筛选模块" style="width:160px"><el-option label="未关联模块" value="" /><el-option v-for="module in moduleOptions" :key="module" :label="module" :value="module" /></el-select>
      <el-select v-model="phaseFilter" clearable placeholder="全部阶段" aria-label="筛选阶段" style="width:130px"><el-option v-for="(label, phase) in requirementPhaseLabels" :key="phase" :label="label" :value="phase" /></el-select>
      <el-select v-model="scheduleFilter" clearable placeholder="全部排期表现" aria-label="筛选排期表现" style="width:155px"><el-option v-for="(label, status) in scheduleStatusLabels" :key="status" :label="`${label}（${scheduleCounts[status] || 0}）`" :value="status" /></el-select>
      <el-checkbox v-model="includeClosed">含已结束</el-checkbox><span class="requirement-spacer" /><el-button type="primary" :disabled="manager.busy" @click="editRequirement()"><Plus :size="15" />新增需求</el-button>
    </div>
    <div class="requirement-layout" :class="{ 'has-selection': !!selected }">
      <div class="mg-scroll requirement-list" tabindex="0" aria-label="需求列表">
        <table class="mg-table requirement-table">
          <colgroup><col class="requirement-code-column" /><col class="requirement-title-column" /><col class="requirement-phase-column" /><col class="requirement-schedule-column" /><col class="requirement-hours-column" /><col v-for="role in deliveryRoles" :key="role" class="requirement-role-column" /><col class="requirement-date-column" /></colgroup>
          <thead><tr><th scope="col">需求编号</th><th scope="col">需求 / 模块 / 专项版本</th><th scope="col">阶段 / 任务</th><th scope="col">计划 / 实际工作周</th><th scope="col">预计 / 实际用时</th><th v-for="role in deliveryRoles" :key="role" scope="col">{{ roleLabels[role] }} / 累计用时</th><th scope="col">跟进日期</th></tr></thead>
          <tbody>
            <tr v-for="item in list" :key="item.id" :class="[{ selected: item.id === selectedId }, `mg-schedule-row schedule-${schedules.get(item.id)!.status}`]" tabindex="0" @click="selectedId = item.id" @keydown.enter.self="selectedId = item.id">
              <td class="requirement-code-cell">{{ item.code || '—' }}</td>
              <td><strong class="requirement-title" :title="item.title">{{ item.title }}</strong><small class="requirement-context">{{ projectName(item.projectId) }} · <span :class="{ 'requirement-module': !!item.module }">{{ item.module || '未关联模块' }}</span></small><small>{{ versionName(item.versionId) }}</small></td>
              <td><span class="mg-badge" :class="{ success: ['completed', 'released', 'accepted'].includes(getRequirementPhase(manager.state, item.id)), warning: item.status === 'paused' }">{{ item.status === 'active' ? requirementPhase(item) : requirementStates[item.status] }}</span><small>任务 {{ taskCount(item.id) }}<span v-if="item.priority === 'urgent' || item.priority === 'high'" class="priority-text"> · {{ priorities[item.priority] }}</span></small></td>
              <td><ManagementSchedule :summary="schedules.get(item.id)!" mode="weeks" compact /></td>
              <td><ManagementSchedule :summary="schedules.get(item.id)!" mode="hours" compact /></td>
              <td v-for="role in roleCells(item.id)" :key="role.role" class="requirement-role-cell">
                <div class="role-owner-line">
                  <span class="role-people" :class="{ unassigned: ['未分配', '—'].includes(role.people) }">{{ role.people }}</span>
                  <span v-if="role.taskIds.length && ['early', 'late', 'overdue'].includes(role.schedule.status)" class="mg-schedule-badge" :class="`schedule-${role.schedule.status}`" :title="`${roleLabels[role.role]} · 计划完成：${formatScheduleWeek(role.schedule.plannedEndWeek, true)}；实际完成：${role.schedule.complete ? formatScheduleWeek(role.schedule.completedWeek, true) : '未完成'}`">
                    <ArrowUpRight v-if="role.schedule.status === 'early'" :size="12" /><ArrowDownRight v-else-if="role.schedule.status === 'late'" :size="12" /><CircleAlert v-else :size="12" />{{ role.schedule.label }}
                  </span>
                </div>
                <div v-if="role.taskIds.length" class="role-hours">
                  <span v-if="role.schedule.estimatedHours !== null" class="role-missing-hours">预计 {{ displayHours(role.schedule.estimatedHours) }} h</span><span v-else-if="role.schedule.sharedEstimateCount" class="role-missing-hours">共用预计 {{ displayHours(role.schedule.sharedEstimatedHours) }} h</span>
                  <button v-if="role.hours !== null" class="role-actual-link" title="查看实际投入明细" @click.stop="openRoleEffort(item.id, role.role)"><strong>{{ displayHours(role.hours) }}</strong><span>h</span></button>
                  <span v-else-if="!role.sharedEfforts.length" class="role-missing-hours">未登记</span>
                  <button v-if="role.sharedEfforts.length" class="role-shared-link" :title="`${role.sharedTitle}；这些需求共用 ${displayHours(role.sharedHours)} 小时，尚未拆分到单项`" @click.stop="openRoleEffort(item.id, role.role)"><Link2 :size="12" /><span>共用 {{ displayHours(role.sharedHours) }} h<small class="role-shared-caption">{{ role.sharedLabel }}</small></span></button>
                  <button v-if="weeklyTasks(role.taskIds).length" class="weekly-entry-button" title="登记或修改周工时" :aria-label="`${item.title}的${roleLabels[role.role]}周工时`" :disabled="manager.busy || !item.versionId" @click.stop="openWeeklyEffort(role.taskIds)"><Clock3 :size="12" />登记周工时</button>
                </div>
              </td>
              <td class="date-cell">{{ item.followUpDate || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!list.length" class="mg-empty"><ClipboardList :size="30" /><strong>{{ hasFilters ? '没有匹配的需求' : '暂无需求' }}</strong><el-button v-if="!hasFilters" @click="editRequirement()"><Plus :size="14" />新增需求</el-button></div>
      </div>
      <aside v-if="selected" class="requirement-detail">
        <header><div><span class="requirement-kicker">{{ selected.code }} · {{ projectName(selected.projectId) }} · {{ selected.module || '未关联模块' }}</span><h2>{{ selected.title }}</h2></div><div class="requirement-detail-actions"><button class="icon-button" title="编辑需求" :disabled="manager.busy" @click="editRequirement(selected)"><Pencil :size="16" /></button><button class="icon-button" title="收起详情" aria-label="收起需求详情" @click="selectedId = ''"><X :size="16" /></button></div></header>
        <div class="mg-scroll requirement-detail-body">
          <dl class="requirement-facts"><div><dt>专项版本</dt><dd>{{ versionName(selected.versionId) }}</dd></div><div><dt>负责人</dt><dd>{{ personName(selected.ownerId) }}</dd></div><div><dt>阶段 / 优先级</dt><dd>{{ requirementPhase(selected) }} · {{ priorities[selected.priority] }}</dd></div><div><dt>目标交付</dt><dd>{{ selected.dueDate || '未确定' }}</dd></div><div v-if="selected.platforms.length"><dt>需求端</dt><dd>{{ selected.platforms.join('、') }}</dd></div></dl>
          <section class="requirement-section"><h3>排期与用时对比</h3><ManagementSchedule :summary="schedules.get(selected.id)!" /></section>
          <section class="requirement-section requirement-role-overview">
            <h3>参与人员与实际投入</h3>
            <div v-for="role in roleCells(selected.id).filter(item => item.taskIds.length)" :key="role.role" class="requirement-role-row">
              <span class="role-label">{{ roleLabels[role.role] }}</span>
              <div class="role-owner-line"><span class="role-people">{{ role.people }}</span></div>
              <div class="role-hours">
                <button v-if="role.hours !== null" class="role-actual-link" title="查看实际投入明细" @click="openRoleEffort(selected.id, role.role)"><strong>{{ displayHours(role.hours) }}</strong><span>h</span></button>
                <span v-else-if="!role.sharedEfforts.length" class="role-missing-hours">未登记</span>
                <button v-if="role.sharedEfforts.length" class="role-shared-link" :title="`${role.sharedTitle}；这些需求共用 ${displayHours(role.sharedHours)} 小时，尚未拆分到单项`" @click="openRoleEffort(selected.id, role.role)"><Link2 :size="12" /><span>共用 {{ displayHours(role.sharedHours) }} h<small class="role-shared-caption">{{ role.sharedLabel }}</small></span></button>
                <button v-if="weeklyTasks(role.taskIds).length" class="weekly-entry-button" :disabled="manager.busy || !selected.versionId" @click="openWeeklyEffort(role.taskIds)"><Clock3 :size="12" />登记周工时</button>
              </div>
              <ManagementSchedule class="role-schedule-detail" :summary="role.schedule" />
            </div>
          </section>
          <section v-if="weeklyEfforts.length || unrecordedPlans.length" class="requirement-section requirement-weekly-section">
            <h3>每周投入</h3>
            <p v-if="historicalHours" class="requirement-weekly-history">历史投入 <strong>{{ displayHours(historicalHours) }} h</strong></p>
            <table v-if="weeklyEfforts.length" class="requirement-weekly-table" aria-label="需求每周投入与周累计工时">
              <thead><tr><th scope="col">投入日期 / 阶段记录</th><th scope="col" class="number">本周 (h)</th><th scope="col" class="number">周累计 (h)</th></tr></thead>
              <tbody><template v-for="row in weeklyEfforts" :key="row.week">
                <tr><td><time :datetime="row.coveredStart">{{ row.coveredStart }}</time><small>至 {{ row.coveredEnd }}</small><small>{{ row.people }}</small><span v-for="goal in row.goals" :key="goal" class="requirement-weekly-goal">{{ goal }}</span></td>
                  <td class="number">{{ displayHours(row.hours) }}<small v-if="row.allocated" title="本周投入含按原预计比例分配的工时">含分摊</small></td><td class="number"><strong>{{ displayHours(row.cumulativeHours) }}</strong></td></tr>
                <tr v-if="row.details.length" class="requirement-weekly-notes"><td colspan="3"><p v-for="detail in row.details" :key="detail.id" class="requirement-weekly-note">{{ detail.notes }}</p></td></tr>
              </template></tbody>
            </table>
            <div v-for="plan in unrecordedPlans" :key="plan.id" class="requirement-weekly-plan">
              <div><time :datetime="plan.week">{{ plan.week }} 当周</time><strong>计划 {{ plan.plannedHours === null ? '待定' : `${displayHours(plan.plannedHours)} h` }}</strong></div>
              <p class="requirement-weekly-note">{{ plan.goal || plan.title }}</p><p v-if="plan.notes" class="requirement-weekly-note">{{ plan.notes }}</p>
            </div>
          </section>
          <div class="requirement-next"><span class="section-label"><Clock3 :size="14" />下一步</span><p>{{ selected.nextAction || '尚未安排下一步' }}</p><small>{{ personName(selected.nextOwnerId) }}<span v-if="selected.followUpDate"> · {{ selected.followUpDate }} 跟进</span></small></div>
          <section class="requirement-section">
            <div class="requirement-section-heading"><h3><GitBranch :size="15" />角色任务 <span>{{ taskCounts.done }}/{{ taskCounts.total }}</span></h3><button class="icon-button" title="新增角色任务" :disabled="manager.busy" @click="editTask()"><Plus :size="16" /></button></div>
            <div v-for="task in tasks" :key="task.id" class="requirement-task">
              <button class="task-main" @click="editTask(task)"><span :class="['task-dot', task.status]" /><span><strong>{{ task.name }}</strong><small>{{ personName(task.ownerId) }} · {{ roleLabels[task.role] }}<span v-if="task.remainingHours !== null"> · 剩余 {{ task.remainingHours }}h</span></small></span><span :class="['mg-badge', { success: task.status === 'done', warning: task.status === 'blocked' }]">{{ taskStatusLabels[task.status] }}<template v-if="(task.status === 'active' || task.status === 'blocked') && task.progress > 0"> {{ task.progress }}%</template></span></button>
              <div class="task-hours">
                <span v-if="task.estimatedHours !== null">预计 {{ displayHours(task.estimatedHours) }} h</span>
                <button v-if="taskActual(task).hours !== null" class="role-actual-link" title="查看任务实际投入" @click="openTaskEffort(task)">实际 <strong>{{ displayHours(taskActual(task).hours!) }}</strong><span>h</span></button>
                <span v-else-if="task.role !== 'product' && !taskActual(task).sharedEfforts.length">实际未登记</span>
                <button v-if="taskActual(task).sharedEfforts.length" class="role-shared-link" title="查看共用工时及关联任务" @click="openTaskEffort(task)"><Link2 :size="12" /><span>共用 {{ displayHours(taskActual(task).sharedHours) }} h</span></button>
                <button v-if="weeklyTasks([task.id]).length" class="weekly-entry-button" :disabled="manager.busy || !selected.versionId" @click="openWeeklyEffort([task.id])"><Clock3 :size="12" />登记周工时</button>
              </div>
              <ManagementSchedule class="task-schedule-detail" :summary="taskSchedules.get(task.id)!" mode="weeks" /><span class="mg-schedule-cost task-schedule-detail" :class="`cost-${taskSchedules.get(task.id)!.costStatus}`">{{ taskSchedules.get(task.id)!.costLabel }}</span>
              <div v-if="task.blockedReason && task.status === 'blocked'" class="task-blocked">{{ task.blockedReason }}</div><div v-if="taskPlans(task.id)" class="task-schedule" :title="taskPlans(task.id)">{{ taskPlans(task.id) }}</div>
            </div>
            <p v-if="!tasks.length" class="requirement-placeholder">暂无角色任务</p>
          </section>
          <section class="requirement-section"><h3>交付里程碑</h3><dl class="requirement-milestones"><div v-for="milestone in dates(selected)" :key="milestone.name" :class="{ complete: milestone.date }"><dt>{{ milestone.name }}</dt><dd>{{ milestone.date || '—' }}</dd></div></dl></section>
          <section v-if="selected.description || selected.acceptance" class="requirement-section"><h3>需求与验收</h3><p class="requirement-description">{{ selected.description || '—' }}</p><p v-if="selected.acceptance" class="requirement-description">{{ selected.acceptance }}</p></section>
          <section v-if="selected.externalUrl || selected.notes" class="requirement-section"><h3>关联与备注</h3><button v-if="selected.externalUrl" class="requirement-external" title="复制外部需求链接" @click="copyText(selected.externalUrl)"><Copy :size="13" /><span>{{ selected.externalUrl }}</span></button><p v-if="selected.notes" class="requirement-description">{{ selected.notes }}</p></section>
          <section v-if="recordHistory.length" class="requirement-section"><h3>最近变更</h3><div v-for="entry in recordHistory" :key="entry.id" class="requirement-history"><time>{{ new Date(entry.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</time><span>{{ entry.reason || entry.action }}</span></div></section>
        </div>
      </aside>
    </div>
    <ManagementTaskWeekEffort v-model="weeklyDialog" :task-ids="weeklyTasks(weeklyTaskIds)" />
    <el-dialog v-model="requirementDialog" :title="requirementForm.id ? '编辑需求' : '新增需求'" width="840px" :close-on-click-modal="false" destroy-on-close>
      <form ref="requirementFormElement" class="mg-form requirement-form" @submit.prevent="saveRequirement"><div class="requirement-form-grid">
        <label class="wide"><span>需求标题 <b>*</b></span><input v-model="requirementForm.title" required maxlength="240" /></label>
        <label><span>需求编号</span><input v-model="requirementForm.code" maxlength="80" placeholder="自动生成" /></label>
        <label><span>所属项目 <b>*</b></span><select v-model="requirementForm.projectId" required @change="projectChanged"><option value="" disabled>选择项目</option><option v-for="project in manager.state.projects" :key="project.id" :value="project.id" :disabled="project.status === 'archived' && project.id !== requirementForm.projectId">{{ project.name }}</option></select></label>
        <label><span>专项版本</span><select v-model="requirementForm.versionId"><option value="">待定版本</option><option v-for="version in formVersions" :key="version.id" :value="version.id">{{ version.code }} · {{ version.name }}</option></select></label>
        <label><span>所属模块（选填）</span><select v-model="requirementForm.module" :disabled="!requirementForm.projectId"><option value="">未关联模块</option><option v-for="module in formConfiguredModules" :key="module" :value="module">{{ module }}</option></select></label>
        <label><span>需求类型</span><select v-model="requirementForm.kind"><option v-for="kind in ['功能需求', '缺陷', '优化', '调研', '运维', '其他']" :key="kind" :value="kind">{{ kind }}</option></select></label>
        <label><span>负责人</span><select v-model="requirementForm.ownerId"><option value="">未指定</option><option v-for="person in manager.state.people" :key="person.id" :value="person.id">{{ person.name }}</option></select></label>
        <label><span>优先级</span><select v-model="requirementForm.priority"><option v-for="(label, value) in priorities" :key="value" :value="value">{{ label }}</option></select></label>
        <label><span>当前阶段</span><select v-model="requirementForm.phase"><option v-for="(label, value) in phaseLabels" :key="value" :value="value">{{ label }}</option></select></label>
        <label><span>需求状态</span><select v-model="requirementForm.status"><option v-for="(label, value) in requirementStates" :key="value" :value="value">{{ label }}</option></select></label>
        <label><span>结束条件</span><select v-model="requirementForm.closing"><option value="release">实际上线</option><option value="acceptance">验收完成</option></select></label>
        <label><span>目标交付日期</span><input v-model="requirementForm.dueDate" type="date" /></label>
        <div class="requirement-form-section wide">排期与完成</div>
        <label><span>原计划开始周</span><input v-model="requirementForm.plannedStartWeek" type="date" @change="normalizeScheduleWeek(requirementForm, 'plannedStartWeek')" /></label>
        <label><span>原计划完成周</span><input v-model="requirementForm.plannedEndWeek" type="date" @change="normalizeScheduleWeek(requirementForm, 'plannedEndWeek')" /></label>
        <label v-if="requirementForm.id && manager.state.tasks.some(task => task.requirementId === requirementForm.id)"><span>实际完成周</span><input :value="schedules.get(requirementForm.id)?.completedWeek || ''" type="date" readonly aria-label="角色任务汇总的实际完成周" /></label>
        <label v-else-if="requirementForm.id"><span>实际完成周</span><input v-model="requirementForm.completedWeek" type="date" @change="normalizeScheduleWeek(requirementForm, 'completedWeek')" /></label>
        <div class="wide"><span class="field-label">需求端</span><div class="requirement-checks"><label v-for="platform in platformOptions" :key="platform"><input v-model="requirementForm.platforms" type="checkbox" :value="platform" />{{ platform }}</label></div></div>
        <div v-if="!requirementForm.id" class="wide"><span class="field-label">创建角色任务</span><div class="requirement-checks"><label v-for="stage in managementStages" :key="stage"><input v-model="selectedStages" type="checkbox" :value="stage" />{{ stageLabels[stage] }}</label></div></div>
        <template v-if="!requirementForm.id"><label v-for="stage in selectedStages" :key="stage"><span>{{ stageLabels[stage] }}复杂度</span><select v-model="stageComplexities[stage]" :aria-label="`${stageLabels[stage]}复杂度`"><option :value="undefined">未评估</option><option v-for="value in ['A','B','C']" :key="value" :value="value">{{ value }}</option></select></label></template>
        <label class="wide"><span>需求说明</span><textarea v-model="requirementForm.description" rows="3" maxlength="8000" /></label><label class="wide"><span>验收条件</span><textarea v-model="requirementForm.acceptance" rows="2" maxlength="4000" /></label>
        <div class="requirement-form-section wide">后续跟踪</div><label class="wide"><span>下一步行动</span><input v-model="requirementForm.nextAction" maxlength="500" /></label><label><span>下一步负责人</span><select v-model="requirementForm.nextOwnerId"><option value="">未指定</option><option v-for="person in manager.state.people" :key="person.id" :value="person.id">{{ person.name }}</option></select></label><label><span>下次跟进日期</span><input v-model="requirementForm.followUpDate" type="date" /></label>
        <div class="requirement-form-section wide">交付里程碑</div><label><span>开发完成</span><input v-model="requirementForm.devCompletedAt" type="date" /></label><label><span>提测</span><input v-model="requirementForm.submittedAt" type="date" /></label><label><span>测试完成</span><input v-model="requirementForm.testCompletedAt" type="date" /></label><label><span>实际上线</span><input v-model="requirementForm.releasedAt" type="date" /></label>
        <label class="wide"><span>外部需求链接</span><input v-model="requirementForm.externalUrl" type="url" maxlength="2000" /></label><label class="wide"><span>备注</span><textarea v-model="requirementForm.notes" rows="2" maxlength="4000" /></label><label v-if="requirementForm.id || requirementForm.status !== 'active'" class="wide"><span>调整 / 暂停 / 取消原因</span><input v-model="reason" maxlength="1000" :required="requirementForm.status !== 'active'" /></label>
      </div></form>
      <template #footer><el-button :disabled="manager.busy" @click="requirementDialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" @click="saveRequirement"><Check :size="15" />保存需求</el-button></template>
    </el-dialog>
    <el-dialog v-model="effortDialog" :title="effortScope.title" width="900px" destroy-on-close>
      <p class="requirement-effort-subtitle">{{ effortScope.subtitle }}</p>
      <div class="requirement-effort-totals"><span>本项单独工时 <strong>{{ effortSummary.hours === null ? '—' : `${displayHours(effortSummary.hours)} h` }}</strong></span><span v-if="effortSummary.sharedEfforts.length">与其他项共用工时 <strong>{{ displayHours(effortSummary.sharedHours) }} h</strong></span></div>
      <div class="requirement-effort-region" tabindex="0" aria-label="实际投入明细">
        <table class="mg-table requirement-effort-table">
          <thead><tr><th scope="col">周次 / 截至日</th><th scope="col" class="number">实际（小时）</th><th scope="col">投入范围</th><th scope="col">关联需求</th></tr></thead>
          <tbody><tr v-for="row in effortRows" :key="row.entry.id">
            <td class="date-cell">{{ row.entry.week }}<small>{{ row.entry.personId ? personName(row.entry.personId) : row.peopleLabel }}</small><small v-if="row.historical">历史累计</small></td><td class="number">{{ displayHours(row.entry.hours) }}</td>
            <td><span :class="{ 'shared-effort-label': row.shared }">{{ row.shared ? '多项共用' : '本项单独工时' }}</span><small v-if="row.shared">{{ row.requirements.length > 1 ? `${row.requirements.length} 项需求合计，未单独拆分` : '多个任务合计，未单独拆分' }}</small><small v-if="row.entry.notes" class="requirement-effort-note" :title="row.entry.notes">{{ row.entry.notes }}</small></td>
            <td><button v-for="requirement in row.requirements" :key="requirement.id" class="requirement-effort-link" @click="focusRequirement(requirement.id)">{{ requirement.title }}</button></td>
          </tr></tbody>
        </table>
        <p v-if="!effortRows.length" class="requirement-placeholder">暂无实际投入记录</p>
      </div>
    </el-dialog>
    <el-dialog v-model="taskDialog" :title="taskForm.id ? '编辑角色任务' : '新增角色任务'" width="720px" :close-on-click-modal="false" destroy-on-close>
      <form ref="taskFormElement" class="mg-form requirement-form" @submit.prevent="saveTask"><div class="requirement-form-grid">
        <label class="wide"><span>任务名称 <b>*</b></span><input v-model="taskForm.name" required maxlength="200" /></label><label><span>工作环节</span><select v-model="taskForm.stage" @change="stageChanged"><option v-for="stage in managementStages" :key="stage" :value="stage">{{ stageLabels[stage] }}</option></select></label><label><span>投入角色</span><select v-model="taskForm.role"><option v-for="role in managementRoles" :key="role" :value="role">{{ roleLabels[role] }}</option></select></label>
        <label><span>主要负责人</span><select v-model="taskForm.ownerId"><option value="">未指定</option><option v-for="person in manager.state.people" :key="person.id" :value="person.id">{{ person.name }}</option></select></label><label><span>复杂度</span><select v-model="taskForm.complexity"><option value="">未评估</option><option v-for="value in ['A','B','C']" :key="value" :value="value">{{ value }}</option></select></label>
        <label><span>执行状态</span><select v-model="taskForm.status" @change="taskStatusChanged"><option v-for="(label, value) in taskStatusLabels" :key="value" :value="value">{{ label }}</option></select></label><label><span>进度（%）</span><el-input-number v-model="taskForm.progress" :min="0" :max="100" :step="5" :disabled="['pending','done'].includes(taskForm.status)" /></label><label><span>总预计工时（小时）</span><el-input-number v-model="taskForm.estimatedHours" :min="0" :precision="2" :step="1" /></label><label><span>剩余预计工时（小时）</span><el-input-number v-model="taskForm.remainingHours" :min="0" :precision="2" :step="1" /></label>
        <div class="requirement-form-section wide">排期与完成</div>
        <label><span>原计划开始周</span><input v-model="taskForm.plannedStartWeek" type="date" @change="normalizeScheduleWeek(taskForm, 'plannedStartWeek')" /></label><label><span>原计划完成周</span><input v-model="taskForm.plannedEndWeek" type="date" @change="normalizeScheduleWeek(taskForm, 'plannedEndWeek')" /></label>
        <label><span>实际完成周</span><input v-model="taskForm.completedWeek" type="date" :disabled="taskForm.status !== 'done'" @change="normalizeScheduleWeek(taskForm, 'completedWeek')" /></label><label><span>计划完成日期（选填）</span><input v-model="taskForm.dueDate" type="date" /></label>
        <label><span>实际开始日期（选填）</span><input v-model="taskForm.startedAt" type="date" /></label><label><span>实际完成日期（选填）</span><input v-model="taskForm.completedAt" type="date" @change="taskCompletedDateChanged" /></label><label class="wide"><span>前置任务</span><el-select v-model="taskForm.dependencies" multiple clearable placeholder="无前置任务" aria-label="前置任务"><el-option v-for="task in dependencyOptions" :key="task.id" :label="task.name" :value="task.id" /></el-select></label>
        <label v-if="taskForm.status === 'blocked'" class="wide"><span>阻塞原因 <b>*</b></span><textarea v-model="taskForm.blockedReason" rows="2" required maxlength="2000" /></label><label class="wide"><span>进展 / 验收说明</span><textarea v-model="taskForm.notes" rows="3" maxlength="4000" /></label><label v-if="taskForm.id" class="wide"><span>调整 / 返工 / 取消原因</span><input v-model="taskReason" maxlength="1000" /></label>
      </div></form>
      <template #footer><div class="task-dialog-footer"><el-button v-if="taskForm.id" type="danger" plain :disabled="manager.busy" @click="deleteTask(taskForm)"><Trash2 :size="14" />删除</el-button><span /><el-button :disabled="manager.busy" @click="taskDialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" @click="saveTask"><Check :size="15" />保存任务</el-button></div></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.mg-requirements { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; }
.requirement-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; flex-shrink:0; padding:14px 20px; border-bottom:1px solid var(--line); }.requirement-spacer { flex:1; }
.requirement-search { display:flex; align-items:center; gap:8px; height:34px; border:1px solid var(--line); border-radius:5px; padding:0 10px; color:var(--muted); }.requirement-search input { width:170px; min-width:0; border:0; background:none; outline:0; color:var(--text); font-size:12px; }
.requirement-layout { display:grid; grid-template-columns:minmax(0,1fr); flex:1; min-height:0; min-width:0; overflow:hidden; }.requirement-layout.has-selection { grid-template-columns:minmax(0,1fr) 380px; }
.requirement-list { min-height:0; overflow:auto; overscroll-behavior:contain; }.requirement-table { width:100%; border-collapse:collapse; text-align:left; font-size:12px; }.requirement-table th { position:sticky; top:0; z-index:1; background:var(--bg); color:var(--muted); font-weight:500; font-size:11px; white-space:nowrap; }.requirement-table th,.requirement-table td { padding:12px 14px; border-bottom:1px solid var(--line); }.requirement-table tbody tr { cursor:pointer; }.requirement-table tbody tr:hover { background:var(--hover); }.requirement-table tbody tr.selected { background:var(--accent-soft); }.requirement-table td:first-child { min-width:180px; }.requirement-title { display:block; font-size:12px; font-weight:550; overflow-wrap:anywhere; }.requirement-table small { display:block; font-size:10px; color:var(--muted); margin-top:5px; }.number { text-align:right; font-variant-numeric:tabular-nums; }.date-cell { white-space:nowrap; font-size:11px; }.priority-text { color:#ad7734 !important; }
.requirement-table { min-width:1640px; table-layout:fixed; }.requirement-code-column { width:140px; }.requirement-title-column { width:280px; }.requirement-phase-column { width:110px; }.requirement-schedule-column { width:205px; }.requirement-hours-column { width:155px; }.requirement-role-column { width:150px; }.requirement-date-column { width:100px; }
.requirement-table .requirement-code-cell { min-width:0; color:var(--accent); font-size:11px; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.role-schedule-detail { grid-column:2/-1; }.task-schedule-detail { margin:8px 0 0 16px; }
.requirement-context { overflow-wrap:anywhere; }.requirement-module { color:var(--accent); }
.weekly-entry-button { display:inline-flex; align-items:center; gap:4px; min-height:24px; max-width:100%; padding:0; border:0; background:none; color:var(--accent); font-size:10px; text-align:left; }.weekly-entry-button svg { flex-shrink:0; }.weekly-entry-button:hover:not(:disabled) { text-decoration:underline; }.weekly-entry-button:disabled { color:var(--muted); cursor:default; }.weekly-entry-button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.role-owner-line { display:flex; flex-wrap:wrap; align-items:baseline; gap:3px 5px; min-height:20px; min-width:0; }.role-people { min-width:0; overflow-wrap:anywhere; font-size:12px; line-height:1.6; font-weight:500; }.role-people.unassigned { color:var(--muted); font-weight:400; }.role-source { color:var(--muted); font-size:10px; flex-shrink:0; }.role-hours { display:flex; flex-direction:column; align-items:flex-start; gap:3px; margin-top:4px; min-width:0; font-variant-numeric:tabular-nums; }.role-actual-link,.role-shared-link { display:inline-flex; align-items:center; gap:4px; min-height:20px; max-width:100%; padding:0; border:0; background:none; color:var(--text); font-size:11px; line-height:1.5; text-align:left; }.role-actual-link strong { font-weight:600; }.role-actual-link > span { color:var(--muted); }.role-shared-link { color:var(--muted); }.role-shared-link svg { flex-shrink:0; }.role-shared-link > span { min-width:0; overflow-wrap:anywhere; }.role-actual-link:hover,.role-shared-link:hover { color:var(--accent); text-decoration:underline; }.role-missing-hours,.role-product-hours { color:var(--muted); font-size:10px; line-height:1.6; }.role-actual-link:focus-visible,.role-shared-link:focus-visible,.requirement-effort-link:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.mg-badge { display:inline-flex; white-space:nowrap; border-radius:4px; background:var(--hover); color:var(--muted); padding:1px 6px; font-size:10px; line-height:20px; }.mg-badge.success { color:var(--green); background:var(--soft-green); }.mg-badge.warning { color:#a8742f; background:var(--el-color-warning-light-9); }
.requirement-detail { display:flex; flex-direction:column; min-height:0; min-width:0; border-left:1px solid var(--line); background:var(--surface); }.requirement-detail > header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:18px 20px; flex-shrink:0; border-bottom:1px solid var(--line); }.requirement-kicker { font-size:11px; color:var(--muted); }.requirement-detail h2 { font-size:15px; line-height:1.6; font-weight:600; margin:5px 0 0; overflow-wrap:anywhere; }.requirement-detail-body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:0 20px; }
.requirement-facts { margin:0; padding:17px 0; }.requirement-facts > div { display:flex; gap:14px; margin:8px 0; font-size:11px; }.requirement-facts dt { width:78px; flex-shrink:0; color:var(--muted); }.requirement-facts dd { margin:0; min-width:0; overflow-wrap:anywhere; }
.requirement-detail-actions { display:flex; flex-shrink:0; gap:2px; }.requirement-role-overview { margin-bottom:8px; }.requirement-role-row { display:grid; grid-template-columns:38px minmax(0,1fr) minmax(75px,auto); align-items:start; gap:8px; padding:9px 0; border-bottom:1px solid var(--line); }.requirement-role-row:last-child { border-bottom:0; }.role-label { color:var(--muted); font-size:11px; line-height:20px; }.requirement-role-row .role-people { font-size:11px; }.requirement-role-row .role-hours { margin-top:0; align-items:flex-end; max-width:118px; }.requirement-role-row .role-product-hours { text-align:right; max-width:118px; line-height:20px; font-variant-numeric:tabular-nums; }
.requirement-next { border-left:2px solid var(--accent); background:var(--bg); padding:12px; margin-bottom:20px; }.section-label { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--accent); }.requirement-next p { margin:8px 0; font-size:12px; overflow-wrap:anywhere; }.requirement-next small { color:var(--muted); font-size:10px; }
.requirement-section { padding:17px 0; border-top:1px solid var(--line); }.requirement-section h3 { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; margin:0 0 12px; }.requirement-section-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:5px; }.requirement-section-heading h3 { margin:0; }.requirement-section-heading h3 span { color:var(--muted); font-size:10px; font-weight:400; }
.requirement-weekly-table { width:100%; table-layout:fixed; border-collapse:collapse; text-align:left; font-size:11px; line-height:1.6; }.requirement-weekly-table th { padding:0 0 8px; color:var(--muted); font-size:10px; font-weight:400; }.requirement-weekly-table th.number { width:66px; }.requirement-weekly-table td { padding:10px 0; border-top:1px solid var(--line); vertical-align:top; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }.requirement-weekly-table td:first-child { padding-right:10px; }.requirement-weekly-table time { white-space:nowrap; }.requirement-weekly-table small { display:block; color:var(--muted); font-size:10px; }.requirement-weekly-table strong { font-weight:600; }.requirement-weekly-goal { display:block; margin-top:4px; color:var(--accent); font-size:10px; overflow-wrap:anywhere; }.requirement-weekly-history { display:flex; justify-content:space-between; margin:0 0 12px; color:var(--muted); font-size:11px; }.requirement-weekly-history strong { color:var(--text); font-weight:500; font-variant-numeric:tabular-nums; }
.requirement-weekly-table .requirement-weekly-notes td { padding:0 0 12px; border-top:0; }.requirement-weekly-note { margin:5px 0 0; color:var(--muted); font-size:11px; line-height:1.7; white-space:pre-wrap; overflow-wrap:anywhere; }.requirement-weekly-plan { padding:12px 0; border-top:1px solid var(--line); }.requirement-weekly-plan:last-child { padding-bottom:0; }.requirement-weekly-plan > div { display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px 12px; font-size:11px; font-variant-numeric:tabular-nums; }.requirement-weekly-plan strong { color:var(--accent); font-weight:500; }
.requirement-task { padding:10px 0; border-bottom:1px solid var(--line); }.requirement-task:last-child { border-bottom:0; }.task-main { display:flex; align-items:center; gap:9px; padding:0; width:100%; border:0; background:none; text-align:left; }.task-main > span:nth-child(2) { flex:1; min-width:0; }.task-main strong { display:block; font-size:12px; font-weight:500; overflow-wrap:anywhere; }.task-main small { display:block; color:var(--muted); font-size:10px; margin-top:4px; }.task-dot { width:7px; height:7px; border:1px solid var(--subtle); border-radius:50%; flex-shrink:0; }.task-dot.active { border-color:var(--accent); background:var(--accent); }.task-dot.done { border-color:var(--green); background:var(--green); }.task-dot.blocked { border-color:#bc8843; background:#bc8843; }.task-dot.cancelled { opacity:.4; }.task-schedule,.task-blocked { font-size:10px; color:var(--muted); margin:7px 0 0 16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.task-blocked { color:#ad7734; white-space:normal; }.unscheduled { color:#ad7734; }
.task-hours { display:flex; flex-wrap:wrap; align-items:center; gap:3px 10px; margin:6px 0 0 16px; color:var(--muted); font-size:10px; font-variant-numeric:tabular-nums; }.task-hours .role-actual-link,.task-hours .role-shared-link { font-size:10px; }
.role-shared-link { align-items:flex-start; }.role-shared-link > svg { margin-top:3px; }.role-shared-caption,.requirement-table .role-shared-caption { display:block; margin-top:2px; color:var(--muted); font-size:10px; line-height:1.4; }
.requirement-milestones { margin:0; }.requirement-milestones > div { display:flex; justify-content:space-between; gap:12px; padding:7px 0; font-size:11px; color:var(--muted); }.requirement-milestones dd { margin:0; font-variant-numeric:tabular-nums; }.requirement-milestones .complete dd { color:var(--text); }.requirement-description { font-size:12px; line-height:1.8; white-space:pre-wrap; overflow-wrap:anywhere; margin:7px 0; color:var(--muted); }.requirement-external { display:flex; gap:6px; align-items:center; max-width:100%; border:0; background:none; padding:0; color:var(--accent); font-size:11px; }.requirement-external span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.requirement-history { display:flex; gap:10px; padding:6px 0; font-size:10px; color:var(--muted); }.requirement-history time { flex-shrink:0; }.requirement-history span { overflow-wrap:anywhere; }.requirement-placeholder { color:var(--muted); font-size:12px; margin:15px 0; }
.requirement-form { max-height:min(65vh,690px); overflow:auto; padding:2px 5px; }.requirement-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }.wide { grid-column:1/-1; }.requirement-form label { display:flex; flex-direction:column; gap:7px; min-width:0; }.requirement-form label > span,.field-label { font-size:12px; color:var(--muted); }.requirement-form b { font-weight:500; color:var(--el-color-danger); }.requirement-form input,.requirement-form select,.requirement-form textarea { min-width:0; width:100%; min-height:35px; border:1px solid var(--line); border-radius:5px; background:var(--surface); color:var(--text); padding:7px 10px; font-size:13px; outline:0; }.requirement-form input:focus,.requirement-form select:focus,.requirement-form textarea:focus { border-color:var(--accent); }.requirement-form textarea { resize:vertical; }.requirement-form :deep(.el-input-number) { width:100%; }.requirement-form-section { border-top:1px solid var(--line); padding:12px 0 0; font-size:12px; font-weight:600; }.requirement-checks { display:flex; flex-wrap:wrap; gap:12px 18px; padding-top:10px; }.requirement-checks label { flex-direction:row; align-items:center; gap:6px; font-size:12px; }.requirement-checks input { width:14px; min-height:14px; height:14px; padding:0; accent-color:var(--accent); }.task-dialog-footer { display:flex; align-items:center; gap:8px; }.task-dialog-footer > span { flex:1; }
.mg-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:70px 20px; color:var(--muted); }.mg-empty strong { font-size:13px; font-weight:500; }
.requirement-effort-subtitle { margin:0 0 13px; font-size:13px; line-height:1.7; overflow-wrap:anywhere; }.requirement-effort-totals { display:flex; flex-wrap:wrap; gap:10px 28px; padding:12px 0; border-block:1px solid var(--line); color:var(--muted); font-size:12px; }.requirement-effort-totals strong { margin-left:8px; color:var(--text); font-weight:600; font-variant-numeric:tabular-nums; }.requirement-effort-region { max-height:55vh; min-height:100px; overflow:auto; overscroll-behavior:contain; }.requirement-effort-table { min-width:650px; }.requirement-effort-table th:first-child { width:120px; }.requirement-effort-table th:nth-child(2) { width:110px; }.requirement-effort-table th:nth-child(3) { width:180px; }.shared-effort-label { color:var(--accent); }.requirement-effort-note { display:block; max-width:170px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.requirement-effort-link { display:block; width:100%; border:0; padding:3px 0; background:none; text-align:left; color:var(--accent); font-size:12px; line-height:1.6; overflow-wrap:anywhere; }.requirement-effort-link:hover { text-decoration:underline; }
@media(max-width:1150px) { .requirement-layout.has-selection { grid-template-columns:minmax(0,1fr) 320px; }.requirement-detail > header { padding-inline:15px; }.requirement-detail-body { padding-inline:15px; }.requirement-table th,.requirement-table td { padding-inline:10px; } }
@media(max-width:900px) { .requirement-layout.has-selection { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(150px,1fr) minmax(180px,1fr); }.requirement-detail { border-left:0; border-top:1px solid var(--line); }.requirement-detail > header { padding-block:10px; }.requirement-toolbar { padding:12px; } }
@media(max-width:600px) { .requirement-form-grid { grid-template-columns:minmax(0,1fr); }.requirement-search { flex-basis:100%; }.requirement-search input { width:100%; }.requirement-toolbar { gap:8px; } }
</style>
