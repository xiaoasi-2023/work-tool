<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Pencil, ArrowRight, Calculator, CheckCheck, Download, ChevronLeft, ChevronRight, CalendarDays, SlidersHorizontal, Trash2 } from 'lucide-vue-next'
import { useManagement } from '../../management-store'
import { addWeeks, getWeekSummary, weekStart, managementRoles, managementStages, roleLabels, sortManagementPeople, stageLabels, sumHours } from '../../../shared/management'
import type { ManagementCommand, ManagementPlan, ManagementState } from '../../../shared/management'
import ManagementSchedule from './ManagementSchedule.vue'
import ManagementWeekReport from './ManagementWeekReport.vue'
import ManagementWeekEffort from './ManagementWeekEffort.vue'
import { getManagementWeekReport, getWeekReportWorkText, reportColumns, type WeekReportCell, type WeekReportSection } from '../../../shared/management-week-report'
import { formatScheduleWeek, getEffortWorkContent, getPlanEfforts, getPlansForWeek, getPlanSchedule, getScopeSchedule, preparePlanReview, scheduleStatusLabels, type ScheduleStatus } from '../../../shared/management-schedule'

const emit = defineEmits<{ 'open-requirement': [id: string]; 'open-effort': [id: string] }>()
const manager = useManagement(), query = ref(''), snapshotId = ref('')
const viewMode = ref<'review' | 'next' | 'arrangements'>('review'), showExtra = ref(false)
const scheduleFilter = ref<ScheduleStatus | ''>(''), showCancelled = ref(false)
const actualWeek = ref(''), actualHours = ref<number | null>(null), completedTaskIds = ref<string[]>([]), completedWeek = ref('')
const actualContent = ref('')
const weekEffortDialog = ref(false), weekEffortPerson = ref('')
const dialog = ref(false), carryDialog = ref(false), capacityDialog = ref(false), formElement = ref<HTMLFormElement>()
const complexityDialog = ref(false), complexityForm = ref<{ id: string; complexity: string }[]>([])
const complexityTasks = computed(() => complexityForm.value.flatMap(field => {
  const task = manager.state.tasks.find(task => task.id === field.id)
  const requirement = manager.state.requirements.find(requirement => requirement.id === task?.requirementId)
  return task && requirement ? [{ field, task, requirement }] : []
}))
const reason = ref(''), source = ref<ManagementPlan | null>(null), carryWeek = ref(''), carryHours = ref<number | null>(null), carryGoal = ref('')
const selectedSnapshot = computed(() => manager.state.snapshots.find(s => s.id === snapshotId.value))
const viewState = computed<ManagementState>(() => selectedSnapshot.value ? { ...manager.state, ...selectedSnapshot.value.data, weekActuals: selectedSnapshot.value.data.weekActuals || [] } : manager.state)
const snapshots = computed(() => manager.state.snapshots.filter(s => s.week === manager.week).slice().reverse())
const summary = computed(() => getWeekSummary(viewState.value, manager.week))
const report = computed(() => getManagementWeekReport(viewState.value, manager.week, selectedSnapshot.value?.createdAt.slice(0, 10)))
const displayWeek = computed(() => viewMode.value === 'next' ? report.value.nextWeek : manager.week)
const capacityPeople = computed(() => viewMode.value === 'next' ? report.value.nextPeople : summary.value.people)
const formPeople = computed(() => sortManagementPeople(manager.state.people))
const reportSection = computed(() => viewMode.value === 'next' ? report.value.next : report.value.actual)
function filterReport(section: WeekReportSection): WeekReportSection {
  const text = query.value.trim().toLocaleLowerCase()
  return { ...section, rows: section.rows.filter(row => {
    const cells = reportColumns.flatMap(role => row.cells[role])
    return (!text || `${row.project} ${row.module} ${getWeekReportWorkText(row)} ${row.platforms} ${row.stage} ${cells.map(cell => cell.person).join(' ')}`.toLocaleLowerCase().includes(text)) && (!scheduleFilter.value || cells.some(cell => cell.tone === scheduleFilter.value))
  }) }
}
const reportPreview = computed(() => filterReport(reportSection.value))
const extraSection = computed(() => viewMode.value === 'next' ? report.value.advanced : report.value.unfinished)
const extraPreview = computed(() => filterReport(extraSection.value))
const reportCounts = computed(() => Object.fromEntries(Object.keys(scheduleStatusLabels).map(status => [status, reportSection.value.rows.filter(row => reportColumns.some(role => row.cells[role].some(cell => cell.tone === status))).length])))
const allRows = computed(() => getPlansForWeek(viewState.value, manager.week).filter(p => (showCancelled.value || p.status !== 'cancelled') && `${p.title} ${project(p.projectId)} ${person(p.personId)} ${p.goal} ${p.taskIds.map(id => { const task = viewState.value.tasks.find(task => task.id === id); return viewState.value.requirements.find(requirement => requirement.id === task?.requirementId)?.code || '' }).join(' ')}`.toLowerCase().includes(query.value.toLowerCase())))
const schedules = computed(() => new Map(allRows.value.map(plan => [plan.id, getPlanSchedule(viewState.value, plan)])))
const rows = computed(() => allRows.value.filter(plan => !scheduleFilter.value || schedules.value.get(plan.id)?.status === scheduleFilter.value))
const scheduleCounts = computed(() => Object.fromEntries(Object.keys(scheduleStatusLabels).map(status => [status, allRows.value.filter(plan => schedules.value.get(plan.id)?.status === status).length])))
const outcomeLabels = { pending: '未开始', partial: '部分完成', done: '本周目标完成', blocked: '阻塞', cancelled: '已撤销' }
const statusLabels = { draft: '草稿', confirmed: '已确认', cancelled: '已撤销' }
function project(id: string) { return viewState.value.projects.find(p => p.id === id)?.name || '未指定' }
function person(id: string) { return viewState.value.people.find(p => p.id === id)?.name || '未分配' }
function openWeekEffort(id = '') { weekEffortPerson.value = id; weekEffortDialog.value = true }
function weekActual(id: string) { return viewState.value.weekActuals.find(entry => entry.personId === id && entry.week === manager.week) }
function weekActualDrift(id: string, actualHours: number) { const entry = weekActual(id); return entry ? sumHours([actualHours, -entry.hours]) !== 0 : false }
function version(id: string) { const v = viewState.value.versions.find(v => v.id === id); return v ? `${v.code} · ${v.name}` : '' }
function blank(): ManagementPlan { return { id: '', projectId: manager.projectId, versionId: '', week: displayWeek.value, personId: '', role: 'frontend', stage: 'frontend', taskIds: [], title: '', goal: '', plannedHours: null, status: 'draft', outcome: 'pending', source: 'planned', sourcePlanId: '', notes: '' } }
const form = ref<ManagementPlan>(blank())
const formVersions = computed(() => manager.state.versions.filter(v => v.projectId === form.value.projectId && (v.status === 'active' || v.id === form.value.versionId)))
const taskOptions = computed(() => manager.state.tasks.filter(t => {
  const r = manager.state.requirements.find(r => r.id === t.requirementId)
  return r?.projectId === form.value.projectId && r.versionId === form.value.versionId && t.role === form.value.role && t.stage === form.value.stage && (t.status !== 'cancelled' || form.value.taskIds.includes(t.id))
}))
const capacity = ref({ personId: '', hours: 40, notes: '', week: manager.week })
function editById(id: string) { const plan = manager.state.plans.find(plan => plan.id === id); if (plan && !snapshotId.value) edit(plan) }
function carryById(id: string) { const plan = manager.state.plans.find(plan => plan.id === id); if (plan && !snapshotId.value) carry(plan) }
function editReportCell(cell: WeekReportCell) {
  if (snapshotId.value || manager.busy) return
  if (cell.planId) editById(cell.planId)
  else if (cell.effortId) emit('open-effort', cell.effortId)
  else {
    const task = manager.state.tasks.find(task => cell.taskIds.includes(task.id))
    if (task) emit('open-requirement', task.requirementId)
  }
}
function editComplexity(taskIds: string[]) {
  if (snapshotId.value || manager.busy) return
  complexityForm.value = manager.state.tasks.filter(task => taskIds.includes(task.id)).map(task => ({ id: task.id, complexity: task.complexity }))
  if (complexityForm.value.length) complexityDialog.value = true
}
async function saveComplexity() {
  if (snapshotId.value || manager.busy) return
  if (complexityTasks.value.length !== complexityForm.value.length) { ElMessage.error('角色任务已变更，请重新打开后编辑'); return }
  const commands: ManagementCommand[] = complexityTasks.value.filter(({ field, task }) => field.complexity !== task.complexity)
    .map(({ field }) => ({ type: 'upsert', entity: 'tasks', value: { id: field.id, complexity: field.complexity } }))
  if (!commands.length) { complexityDialog.value = false; return }
  if (await manager.execute({ type: 'batch', commands })) { complexityDialog.value = false; ElMessage.success('任务复杂度已保存') }
}
function edit(plan?: ManagementPlan) {
  form.value = plan ? JSON.parse(JSON.stringify(plan)) : blank(); reason.value = ''
  const efforts = plan ? getPlanEfforts(manager.state, plan) : []
  actualWeek.value = efforts.map(entry => entry.week).sort().at(-1) || manager.week
  completedWeek.value = plan?.completedWeek || actualWeek.value
  actualHours.value = efforts.some(entry => entry.week === actualWeek.value) ? sumHours(efforts.filter(entry => entry.week === actualWeek.value).map(entry => entry.hours)) : null
  actualContent.value = efforts.filter(entry => entry.week === actualWeek.value).map(entry => getEffortWorkContent(entry, plan)).filter(Boolean).join('\n')
  completedTaskIds.value = []; dialog.value = true
}
function loadActualWeek() {
  if (!actualWeek.value) return
  actualWeek.value = weekStart(actualWeek.value)
  const efforts = getPlanEfforts(manager.state, form.value).filter(entry => entry.week === actualWeek.value)
  actualHours.value = efforts.length ? sumHours(efforts.map(entry => entry.hours)) : null
  actualContent.value = efforts.map(entry => getEffortWorkContent(entry, form.value)).filter(Boolean).join('\n')
  completedWeek.value = actualWeek.value
}
function rowClass({ row }: { row: ManagementPlan }) { return `mg-schedule-row schedule-${schedules.value.get(row.id)?.status || 'unscheduled'}` }
function relatedTasks(plan: ManagementPlan) { return viewState.value.tasks.filter(task => plan.taskIds.includes(task.id)) }
function wholeOutcome(plan: ManagementPlan) {
  const tasks = relatedTasks(plan).filter(task => task.status !== 'cancelled'), done = tasks.filter(task => task.status === 'done').length
  return !tasks.length ? '未关联角色任务' : done === tasks.length ? '角色任务全部完成' : done ? `角色任务部分完成 ${done}/${tasks.length}` : '角色任务尚未全部完成'
}
function projectChanged() { form.value.versionId = ''; form.value.taskIds = [] }
function rangeChanged() { form.value.taskIds = form.value.taskIds.filter(id => taskOptions.value.some(t => t.id === id)) }
async function save() {
  if (!formElement.value?.reportValidity()) return
  try {
    const value = { ...form.value, week: weekStart(form.value.week), plannedHours: form.value.plannedHours === null || (form.value.plannedHours as unknown) === '' ? null : Number(form.value.plannedHours) }
    const hours = actualHours.value === null || (actualHours.value as unknown) === '' ? null : Number(actualHours.value)
    const command = preparePlanReview(JSON.parse(JSON.stringify(manager.state)), { plan: value, actualWeek: actualWeek.value || value.week, actualHours: hours, actualContent: actualContent.value, completedTaskIds: completedTaskIds.value.filter(id => value.taskIds.includes(id)), completedWeek: completedWeek.value || actualWeek.value || value.week, reason: reason.value })
    if (await manager.execute(command)) { dialog.value = false; ElMessage.success('排期与复盘已保存') }
  } catch (error) { ElMessage.error((error as Error).message) }
}
function carry(plan: ManagementPlan) { source.value = plan; carryWeek.value = addWeeks(manager.week); carryHours.value = null; carryGoal.value = plan.goal; carryDialog.value = true }
async function saveCarry() {
  if (!source.value) return
  try {
    const hours = carryHours.value === null || (carryHours.value as unknown) === '' ? null : Number(carryHours.value)
    if (await manager.execute({ type: 'carryover', planId: source.value.id, week: weekStart(carryWeek.value), plannedHours: hours, goal: carryGoal.value, reason: '周复盘确认结转' })) { carryDialog.value = false; ElMessage.success('已结转，原周结果与投入保留') }
  } catch (e) { ElMessage.error((e as Error).message) }
}
async function confirmWeek() {
  try {
    await ElMessageBox.confirm(`保存 ${formatScheduleWeek(manager.week, true)} 的实际工作、复盘结果，以及 ${formatScheduleWeek(report.value.nextWeek, true)} 的下周安排？后续修改不会覆盖此版本。`, '确认周报', { confirmButtonText: '确认并保存', cancelButtonText: '取消' })
    if (await manager.execute({ type: 'snapshot', week: manager.week, note: '周五复盘与下周排期确认' })) { snapshotId.value = manager.state.snapshots.filter(item => item.week === manager.week).at(-1)?.id || ''; ElMessage.success('周报确认版本已保存') }
  } catch {}
}
async function remove(plan: ManagementPlan) {
  try { await ElMessageBox.confirm(`删除未使用排期「${plan.title}」？已有投入或结转引用时请改为撤销。`, '删除排期', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }); await manager.remove('plans', plan.id, '删除未使用排期') } catch {}
}
async function exportWeek(kind: 'report' | 'week' = 'report') {
  try { const { exportManagementWorkbook } = await import('../../management-io'); await exportManagementWorkbook(viewState.value, manager.week, kind, { snapshotRevision: selectedSnapshot.value?.revision, confirmedAt: selectedSnapshot.value?.createdAt }) }
  catch (e) { ElMessage.error((e as Error).message) }
}
function editCapacity(personId: string, hours: number) { capacity.value = { personId, hours, notes: '', week: displayWeek.value }; capacityDialog.value = true }
async function saveCapacity() {
  const previous = manager.state.capacities.find(c => c.personId === capacity.value.personId && c.week === capacity.value.week)
  if (await manager.save('capacities', { ...capacity.value, id: previous?.id || '' })) capacityDialog.value = false
}
watch(() => manager.week, () => { snapshotId.value = '' })
watch(snapshotId, () => { complexityDialog.value = false })
watch(viewMode, () => { showExtra.value = false; scheduleFilter.value = '' })
function selectWeek(event: Event) { const value = (event.target as HTMLInputElement).value; if (value) manager.week = weekStart(value) }
</script>

<template>
  <section class="mg-section">
    <div class="mg-toolbar">
      <div class="mg-week-picker"><button class="icon-button" title="上一复盘周" @click="manager.week = addWeeks(manager.week, -1)"><ChevronLeft :size="17" /></button><CalendarDays :size="16" /><input type="date" :value="manager.week" aria-label="选择复盘周" @change="selectWeek" /><span>至 {{ formatScheduleWeek(manager.week).split('–')[1] }}</span><button class="icon-button" title="下一复盘周" @click="manager.week = addWeeks(manager.week)"><ChevronRight :size="17" /></button></div>
      <button class="mg-text-button" @click="manager.week = weekStart(); viewMode = 'review'">回到本周</button><span class="toolbar-spacer" />
      <select v-model="snapshotId" class="mg-native-select" aria-label="周记录版本"><option value="">实时数据</option><option v-for="s in snapshots" :key="s.id" :value="s.id">确认版本 {{ s.revision }} · {{ s.createdAt.slice(0, 10) }}</option></select>
      <el-button :disabled="manager.busy" @click="exportWeek(viewMode === 'arrangements' ? 'week' : 'report')"><Download :size="14" />{{ viewMode === 'arrangements' ? '导出排期明细' : '导出整周周报' }}</el-button><el-button :disabled="!!snapshotId || manager.busy" @click="openWeekEffort()"><Calculator :size="14" />核对周工时</el-button><el-button :disabled="!!snapshotId || manager.busy" @click="confirmWeek"><CheckCheck :size="14" />确认周报</el-button><el-button type="primary" :disabled="!!snapshotId || manager.busy" @click="edit()"><Plus :size="15" />新增排期</el-button>
    </div>
    <div class="mg-week-view-tabs" role="tablist" aria-label="周工作视图"><button role="tab" :aria-selected="viewMode === 'review'" :class="{ active: viewMode === 'review' }" @click="viewMode = 'review'">本周复盘 <small>{{ formatScheduleWeek(report.week) }}</small></button><button role="tab" :aria-selected="viewMode === 'next'" :class="{ active: viewMode === 'next' }" @click="viewMode = 'next'">下周计划 <small>{{ formatScheduleWeek(report.nextWeek) }}</small></button><button role="tab" :aria-selected="viewMode === 'arrangements'" :class="{ active: viewMode === 'arrangements' }" @click="viewMode = 'arrangements'">排期管理</button></div>
    <div class="mg-metric-strip"><template v-if="viewMode === 'next'"><span>待执行需求 <strong>{{ report.next.rows.length }}</strong></span><span>已确认预计 <strong>{{ report.next.hours }} h</strong></span><span>草稿预计 <strong>{{ report.next.draftHours }} h</strong></span><span>已提前完成安排 <strong>{{ report.advanced.cells.length }}</strong></span></template><template v-else-if="viewMode === 'review'"><span>本周实际 <strong>{{ report.actual.hours }} h</strong></span><span>原排期预计 <strong>{{ summary.plannedHours }} h</strong></span><span>开展事项 <strong>{{ report.actual.rows.length }}</strong></span><span>未完成安排 <strong>{{ report.unfinished.cells.length }}</strong></span><span>工时待补录 <strong>{{ report.actual.cells.filter(cell => cell.hours === null).length }}</strong></span></template><template v-else><span>已确认排期 <strong>{{ summary.plans }}</strong></span><span>计划 <strong>{{ summary.plannedHours }} h</strong></span><span>实际 <strong>{{ summary.actualHours }} h</strong></span><span>本周目标完成 <strong>{{ summary.completed }}</strong></span></template><span v-if="snapshotId" class="text-warning">历史确认版本</span></div>
    <div class="mg-week-layout">
      <div class="mg-week-main"><div class="mg-sub-toolbar"><input v-model="query" class="mg-search-input" placeholder="查找项目、编号、人员、工作内容" aria-label="查找排期" /><select v-model="scheduleFilter" class="mg-native-select" aria-label="筛选周排期表现"><option value="">全部排期表现</option><option v-for="(label, status) in scheduleStatusLabels" :key="status" :value="status">{{ label }}（{{ (viewMode === 'arrangements' ? scheduleCounts[status] : reportCounts[status]) || 0 }}）</option></select><el-checkbox v-if="viewMode === 'arrangements'" v-model="showCancelled">含已撤销</el-checkbox><span class="muted">{{ viewMode === 'arrangements' ? `${rows.length} 条安排` : `${reportPreview.rows.length} 项工作` }}</span></div>
        <ManagementWeekReport v-if="viewMode !== 'arrangements'" :section="reportPreview" :kind="viewMode === 'next' ? 'plan' : 'actual'" :readonly="!!snapshotId || manager.busy" @edit="editReportCell" @carry="carryById" @complexity="editComplexity" @open-requirement="emit('open-requirement', $event)" />
        <div v-if="viewMode !== 'arrangements' && extraSection.rows.length" class="mg-week-extra" :class="{ open: showExtra }"><button class="mg-week-extra-toggle" :aria-expanded="showExtra" @click="showExtra = !showExtra"><ChevronRight :size="14" :class="{ expanded: showExtra }" /><strong>{{ viewMode === 'next' ? '原计划下周，已提前完成' : '本周未完成与待结转' }}</strong><span>{{ extraSection.rows.length }} 项工作</span></button><ManagementWeekReport v-if="showExtra" :section="extraPreview" :kind="viewMode === 'next' ? 'advanced' : 'unfinished'" :readonly="!!snapshotId || manager.busy" compact @edit="editReportCell" @carry="carryById" @complexity="editComplexity" @open-requirement="emit('open-requirement', $event)" /></div>
        <div v-if="viewMode === 'arrangements'" class="mg-table-region"><el-table :data="rows" height="100%" row-key="id" :row-class-name="rowClass" empty-text="本周暂无匹配排期">
          <el-table-column type="expand" width="36"><template #default="{ row }"><div class="mg-plan-task-list"><div v-for="task in relatedTasks(row)" :key="task.id" class="mg-plan-task-item"><strong>{{ viewState.requirements.find(requirement => requirement.id === task.requirementId)?.title }} / {{ task.name }}</strong><span class="mg-cell-secondary">{{ person(task.ownerId) }}</span><ManagementSchedule :summary="getScopeSchedule(viewState, [task.id])" /></div><span v-if="!row.taskIds.length" class="muted">未关联角色任务</span></div></template></el-table-column>
          <el-table-column label="工作内容" min-width="260"><template #default="{row}"><strong class="mg-cell-title">{{ row.title }}</strong><span class="mg-cell-secondary">{{ project(row.projectId) }} / {{ version(row.versionId) }}</span><span v-if="row.taskIds.length > 1" class="mg-small-tag">组合排期 · {{ row.taskIds.length }} 项</span></template></el-table-column>
          <el-table-column label="人员 / 环节" width="125"><template #default="{row}">{{ person(row.personId) }}<span class="mg-cell-secondary">{{ stageLabels[row.stage as keyof typeof stageLabels] }}</span></template></el-table-column>
          <el-table-column label="计划 / 实际工作周" width="205"><template #default="{ row }"><ManagementSchedule :summary="schedules.get(row.id)!" mode="weeks" compact /><span v-if="row.baselineWeek && row.week !== row.baselineWeek" class="mg-cell-secondary">当前目标 {{ formatScheduleWeek(row.week) }}</span></template></el-table-column>
          <el-table-column label="预计 / 实际用时" width="155"><template #default="{ row }"><ManagementSchedule :summary="schedules.get(row.id)!" mode="hours" compact /></template></el-table-column>
          <el-table-column label="周目标 / 整项完成" width="180"><template #default="{row}"><span :class="['mg-status', row.outcome]">{{ outcomeLabels[row.outcome as keyof typeof outcomeLabels] }}</span><span class="mg-cell-secondary">{{ wholeOutcome(row) }}</span><span class="mg-cell-secondary">{{ statusLabels[row.status as keyof typeof statusLabels] }}</span></template></el-table-column>
          <el-table-column label="操作" width="116" fixed="right"><template #default="{row}"><div class="button-row"><button class="icon-button" title="编辑排期与复盘" :disabled="!!snapshotId || manager.busy" @click="edit(row)"><Pencil :size="14" /></button><button class="icon-button" title="结转到未来周" :disabled="!!snapshotId || manager.busy || row.status === 'cancelled'" @click="carry(row)"><ArrowRight :size="15" /></button><button class="icon-button danger-hover" title="删除未使用排期" :disabled="!!snapshotId || manager.busy" @click="remove(row)"><Trash2 :size="14" /></button></div></template></el-table-column>
        </el-table></div>
      </div>
      <aside class="mg-capacity">
        <h3>{{ viewMode === 'next' ? '下周人员负荷' : '本周人员负荷' }}<span>{{ capacityPeople.length }}</span></h3>
        <div class="mg-capacity-list"><div v-for="p in capacityPeople" :key="p.personId" class="mg-capacity-row">
          <div><strong>{{ person(p.personId) }}</strong><div class="button-row"><button v-if="viewMode !== 'next'" class="icon-button" :title="`核对${person(p.personId)}本周实际工时`" :aria-label="`核对${person(p.personId)}本周实际工时`" :disabled="!!snapshotId || manager.busy" @click="openWeekEffort(p.personId)"><Calculator :size="13" /></button><button class="icon-button" title="调整该周可用工时" :disabled="!!snapshotId || manager.busy" @click="editCapacity(p.personId, p.capacity)"><SlidersHorizontal :size="13" /></button></div></div>
          <div class="mg-load-track"><span :class="{ overload: p.plannedHours > p.capacity }" :style="{ width: `${Math.min(100, p.load == null ? p.plannedHours ? 100 : 0 : p.load * 100)}%` }" /></div>
          <p><span>{{ p.plannedHours }} / {{ p.capacity }} h</span><strong :class="{ 'text-warning': p.plannedHours > p.capacity }">{{ p.load == null ? '—' : `${Math.round(p.load * 100)}%` }}</strong></p><small>{{ viewMode === 'next' ? '已确认待执行' : `实际 ${p.actualHours} h` }}</small>
          <small v-if="viewMode !== 'next' && weekActual(p.personId)" :class="{ 'text-warning': weekActualDrift(p.personId, p.actualHours) }">核定 {{ weekActual(p.personId)!.hours }} h · {{ weekActualDrift(p.personId, p.actualHours) ? '待重新核对' : weekActual(p.personId)!.basis === 'standard' ? '按标准周回填' : '已核对' }}</small>
        </div><div v-if="!capacityPeople.length" class="mg-empty">暂无人员</div></div>
      </aside>
    </div>
    <ManagementWeekEffort v-model="weekEffortDialog" :week="manager.week" :person-id="weekEffortPerson" />
    <el-dialog v-model="complexityDialog" title="任务复杂度" width="620px" :close-on-click-modal="false" destroy-on-close>
      <form class="mg-form-grid" @submit.prevent="saveComplexity"><label v-for="entry in complexityTasks" :key="entry.task.id" class="wide"><span>{{ entry.requirement.code }} · {{ entry.requirement.title }} / {{ entry.task.name }}</span><select v-model="entry.field.complexity" :aria-label="`${entry.requirement.title}的${entry.task.name}复杂度`"><option value="">未评估</option><option v-for="value in ['A', 'B', 'C']" :key="value" :value="value">{{ value }}</option></select></label></form>
      <template #footer><el-button :disabled="manager.busy" @click="complexityDialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" :disabled="!!snapshotId || !complexityTasks.length" @click="saveComplexity">保存</el-button></template>
    </el-dialog>
    <el-dialog v-model="dialog" :title="form.id ? '编辑排期与本周结果' : '新增周排期'" width="720px" :close-on-click-modal="false"><form ref="formElement" class="mg-form-grid" @submit.prevent="save">
      <label><span>当前排期周 *</span><input v-model="form.week" type="date" required /></label><label><span>执行人员</span><select v-model="form.personId"><option value="">待分配</option><option v-for="p in formPeople" :key="p.id" :value="p.id" :disabled="!p.active && p.id !== form.personId">{{ p.name }}</option></select></label>
      <div v-if="form.baselineWeek" class="wide mg-plan-baseline"><span>原计划 {{ formatScheduleWeek(form.baselineWeek, true) }}</span><strong>原预计 {{ form.baselineHours ?? '—' }} h</strong></div>
      <label><span>项目 *</span><select v-model="form.projectId" required @change="projectChanged"><option value="">选择项目</option><option v-for="p in manager.state.projects" :key="p.id" :value="p.id">{{ p.name }}</option></select></label><label><span>专项版本 *</span><select v-model="form.versionId" required @change="rangeChanged"><option value="">选择版本</option><option v-for="v in formVersions" :key="v.id" :value="v.id">{{ v.code }} · {{ v.name }}</option></select></label>
      <label><span>工作环节</span><select v-model="form.stage" @change="rangeChanged"><option v-for="s in managementStages" :key="s" :value="s">{{ stageLabels[s] }}</option></select></label><label><span>投入角色</span><select v-model="form.role" @change="rangeChanged"><option v-for="r in managementRoles" :key="r" :value="r">{{ roleLabels[r] }}</option></select></label>
      <label class="wide"><span>工作内容 *</span><input v-model="form.title" required maxlength="300" /></label>
      <label class="wide"><span>关联任务</span><el-select v-model="form.taskIds" multiple :multiple-limit="Math.max(5, manager.state.plans.find(plan => plan.id === form.id)?.taskIds.length || 0)" filterable clearable placeholder="单项或组合任务，最多5项"><el-option v-for="t in taskOptions" :key="t.id" :value="t.id" :label="`${manager.state.requirements.find(r => r.id === t.requirementId)?.code || ''} · ${manager.state.requirements.find(r => r.id === t.requirementId)?.title} / ${t.name}`" /></el-select></label>
      <label class="wide"><span>本周目标（选填）</span><textarea v-model="form.goal" rows="2" maxlength="2000" /></label><label><span>本周预计工时(h)</span><input v-model.number="form.plannedHours" type="number" min="0" step="0.25" /></label><label><span>计划状态</span><select v-model="form.status"><option v-for="(name,key) in statusLabels" :key="key" :value="key">{{ name }}</option></select></label>
      <label><span>本周结果</span><select v-model="form.outcome"><option v-for="(name,key) in outcomeLabels" :key="key" :value="key">{{ name }}</option></select></label><label><span>工作来源</span><select v-model="form.source"><option value="planned">原计划</option><option value="urgent">临时插入</option><option v-if="form.source === 'carryover'" value="carryover">跨周结转</option></select></label>
      <div class="wide mg-plan-form-heading">实际工作与完成</div>
      <label><span>实际工作周</span><input v-model="actualWeek" type="date" required @change="loadActualWeek" /></label><label><span>该周实际用时(h)</span><input v-model.number="actualHours" type="number" min="0" step="0.0001" :disabled="form.status === 'cancelled'" /></label>
      <label class="wide"><span>该周实际工作内容</span><textarea v-model="actualContent" rows="3" maxlength="4000" :disabled="form.status === 'cancelled'" /></label>
      <label v-if="form.outcome === 'done' || completedTaskIds.length"><span>实际完成周</span><input v-model="completedWeek" type="date" required @change="completedWeek = weekStart(completedWeek)" /></label>
      <fieldset v-if="form.taskIds.length" class="wide mg-plan-completion"><legend>本次确认全部完成的角色任务</legend><label v-for="task in taskOptions.filter(item => form.taskIds.includes(item.id))" :key="task.id"><input v-model="completedTaskIds" type="checkbox" :value="task.id" :disabled="task.status === 'done' || form.status === 'cancelled'" /><span>{{ manager.state.requirements.find(requirement => requirement.id === task.requirementId)?.title }} / {{ task.name }}</span><small>{{ task.status === 'done' ? '已完成' : `${task.progress}%` }}</small></label></fieldset>
      <label class="wide"><span>进展、阻塞或延期说明</span><textarea v-model="form.notes" rows="2" maxlength="4000" /></label><label v-if="form.id" class="wide"><span>修改原因</span><input v-model="reason" maxlength="500" /></label>
    </form><template #footer><el-button @click="dialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" @click="save">保存</el-button></template></el-dialog>
    <el-dialog v-model="carryDialog" title="确认跨周安排" width="480px" :close-on-click-modal="false"><div class="mg-form-grid"><label><span>目标周 *</span><input v-model="carryWeek" type="date" /></label><label><span>剩余预计工时(h)</span><input v-model.number="carryHours" type="number" min="0" step="0.25" /></label><label class="wide"><span>新周目标（选填）</span><textarea v-model="carryGoal" rows="3" /></label></div><template #footer><el-button @click="carryDialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" @click="saveCarry">确认结转</el-button></template></el-dialog>
    <el-dialog v-model="capacityDialog" title="本周可用工时" width="400px"><div class="mg-form-grid"><label class="wide"><span>{{ manager.personName(capacity.personId) }}</span><input v-model.number="capacity.hours" type="number" min="0" step="0.25" /></label><label class="wide"><span>调整说明</span><input v-model="capacity.notes" /></label></div><template #footer><el-button @click="capacityDialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" @click="saveCapacity">保存</el-button></template></el-dialog>
  </section>
</template>
