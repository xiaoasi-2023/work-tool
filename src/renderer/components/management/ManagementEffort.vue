<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect } from 'element-plus'
import { ChartNoAxesCombined, Check, Clock3, Download, History, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-vue-next'
import { useManagement } from '../../management-store'
import { getVersionSummary, hoursToDays, managementRoles, managementStages, productStageLabels, roleLabels, stageLabels, sumHours, weekStart, weekEnd,
  type ManagementBaseline, type ManagementEffort, type ManagementStage } from '../../../shared/management'
import { formatScheduleWeek } from '../../../shared/management-schedule'
import { formatVersionDevelopmentSpan, formatVersionMilestone, getVersionTimeline } from '../../../shared/management-timeline'

const props = defineProps<{ focusId?: string }>()
const emit = defineEmits<{ import: []; focused: [] }>()
const manager = useManagement()
const tab = ref<'summary' | 'entries' | 'baselines'>('summary')
const query = ref(''), projectFilter = ref(''), versionFilter = ref(''), personFilter = ref(''), roleFilter = ref(''), weekFilter = ref('')
const stageFilter = ref<ManagementStage | ''>('')
const otherRoles = managementRoles.filter(role => role !== 'product')
const dialog = ref(false), baselineDialog = ref(false), exporting = ref(false)
const effortElement = ref<HTMLFormElement>(), baselineElement = ref<HTMLFormElement>()
const changeReason = ref(''), baselineReason = ref('')
const kindLabels = { normal: '正常投入', rework: '返工', support: '支持协助', other: '其他' }
function today() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function projectName(id: string) { return manager.state.projects.find(p => p.id === id)?.name || '未指定' }
function personName(id: string) { return manager.state.people.find(p => p.id === id)?.name || '未指定' }
function versionName(id: string) { const v = manager.state.versions.find(v => v.id === id); return v ? `${v.code} · ${v.name}` : '未指定' }
function displayHours(value: number) { return value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) }
const versions = computed(() => manager.state.versions.filter(v => !projectFilter.value || v.projectId === projectFilter.value))
const filteredVersions = computed(() => versions.value.filter(v => (!versionFilter.value || v.id === versionFilter.value) && `${v.code} ${v.name} ${projectName(v.projectId)}`.toLowerCase().includes(query.value.toLowerCase())))
const summaries = computed(() => filteredVersions.value.map(version => ({ version, summary: getVersionSummary(manager.state, version.id), timeline: getVersionTimeline(manager.state, version.id) })))
const summaryHours = computed(() => sumHours(summaries.value.map(item => item.summary.hours)))
const efforts = computed(() => manager.state.efforts.filter(e => (!projectFilter.value || e.projectId === projectFilter.value) &&
  (!versionFilter.value || e.versionId === versionFilter.value) && (!personFilter.value || e.personId === personFilter.value) &&
  (!roleFilter.value || e.role === roleFilter.value) && (!stageFilter.value || e.stage === stageFilter.value) && (!weekFilter.value || e.week === weekStart(weekFilter.value)) &&
  `${projectName(e.projectId)} ${versionName(e.versionId)} ${personName(e.personId)} ${e.notes}`.toLowerCase().includes(query.value.toLowerCase()))
  .slice().sort((a, b) => b.week.localeCompare(a.week)))
const baselines = computed(() => manager.state.baselines.filter(b => (!projectFilter.value || b.projectId === projectFilter.value) &&
  (!versionFilter.value || b.versionId === versionFilter.value) && (!personFilter.value || b.personId === personFilter.value) &&
  (!roleFilter.value || b.role === roleFilter.value) && (!stageFilter.value || (b.stage || 'other') === stageFilter.value) && `${projectName(b.projectId)} ${versionName(b.versionId)} ${b.personId ? personName(b.personId) : b.peopleLabel} ${b.taskId ? taskLabel(b.taskId) : ''} ${b.source} ${b.notes}`.toLowerCase().includes(query.value.toLowerCase()))
  .slice().sort((a, b) => b.asOf.localeCompare(a.asOf)))
const filteredHours = computed(() => tab.value === 'summary' ? summaryHours.value : sumHours((tab.value === 'entries' ? efforts.value : baselines.value).map(entry => entry.hours)))
function newEffort(): ManagementEffort {
  const week = weekFilter.value ? weekStart(weekFilter.value) : manager.week
  return { id: '', projectId: projectFilter.value, versionId: versionFilter.value, personId: personFilter.value, role: stageFilter.value === 'design' || stageFilter.value === 'documentation' ? 'product' : 'other', stage: stageFilter.value || 'other',
    week, coveredStart: week, coveredEnd: weekEnd(week), hours: 0, planId: '', taskIds: [], kind: 'normal', notes: '' }
}
function newBaseline(): ManagementBaseline {
  return { id: '', projectId: projectFilter.value, versionId: versionFilter.value, personId: personFilter.value, peopleLabel: '', role: stageFilter.value === 'design' || stageFilter.value === 'documentation' ? 'product' : 'other', stage: stageFilter.value || 'other', taskId: '', hours: 0, asOf: today(), source: '', notes: '' }
}
const effortForm = ref<ManagementEffort>(newEffort()), baselineForm = ref<ManagementBaseline>(newBaseline())
const effortVersions = computed(() => manager.state.versions.filter(v => v.projectId === effortForm.value.projectId))
const baselineVersions = computed(() => manager.state.versions.filter(v => v.projectId === baselineForm.value.projectId))
const baselineTasks = computed(() => manager.state.tasks.filter(task => {
  const requirement = manager.state.requirements.find(item => item.id === task.requirementId)
  return requirement?.projectId === baselineForm.value.projectId && task.role === baselineForm.value.role &&
    (requirement.versionId === baselineForm.value.versionId || task.id === baselineForm.value.taskId) &&
    (task.status !== 'cancelled' || task.id === baselineForm.value.taskId)
}))
const availablePlans = computed(() => manager.state.plans.filter(p => (p.status !== 'cancelled' || p.id === effortForm.value.planId) &&
  (!effortForm.value.projectId || p.projectId === effortForm.value.projectId) && (!effortForm.value.versionId || p.versionId === effortForm.value.versionId) &&
  (!effortForm.value.personId || p.personId === effortForm.value.personId)))
const availableTasks = computed(() => manager.state.tasks.filter(task => {
  const requirement = manager.state.requirements.find(r => r.id === task.requirementId)
  return requirement?.projectId === effortForm.value.projectId && task.role === effortForm.value.role &&
    (requirement.versionId === effortForm.value.versionId || effortForm.value.taskIds.includes(task.id)) &&
    (task.status !== 'cancelled' || effortForm.value.taskIds.includes(task.id))
}))
function taskLabel(id: string) { const task = manager.state.tasks.find(t => t.id === id); const r = manager.state.requirements.find(r => r.id === task?.requirementId); return task ? `${r?.code || ''} · ${r?.title || ''} / ${task.name}` : id }
function baselineRequirement(entry: ManagementBaseline) { const task = manager.state.tasks.find(item => item.id === entry.taskId); return manager.state.requirements.find(item => item.id === task?.requirementId) }
function planLabel(id: string) { return manager.state.plans.find(p => p.id === id)?.title || '未关联排期' }
function editEffort(entry?: ManagementEffort) { effortForm.value = entry ? clone(entry) : newEffort(); changeReason.value = ''; dialog.value = true }
function editBaseline(entry?: ManagementBaseline) { baselineForm.value = entry ? { ...clone(entry), stage: entry.stage || 'other' } : newBaseline(); baselineReason.value = ''; baselineDialog.value = true }
function projectChanged() { versionFilter.value = '' }
function effortProjectChanged() { effortForm.value.versionId = ''; effortForm.value.planId = ''; effortForm.value.taskIds = [] }
function effortScopeChanged() { effortForm.value.planId = '' }
function effortVersionChanged() { effortForm.value.planId = ''; effortForm.value.taskIds = [] }
function effortRoleChanged() { effortForm.value.planId = ''; effortForm.value.taskIds = [] }
function baselineProjectChanged() { baselineForm.value.versionId = ''; baselineForm.value.taskId = '' }
function chooseBaselineTask() {
  const task = manager.state.tasks.find(item => item.id === baselineForm.value.taskId)
  if (task) baselineForm.value.stage = task.stage
}
function choosePlan() {
  const plan = manager.state.plans.find(p => p.id === effortForm.value.planId)
  if (!plan) return
  Object.assign(effortForm.value, { projectId: plan.projectId, versionId: plan.versionId, personId: plan.personId,
    role: plan.role, stage: plan.stage, taskIds: [...plan.taskIds] })
}
function normalizeWeek() {
  if (effortForm.value.week) { effortForm.value.week = weekStart(effortForm.value.week); effortForm.value.coveredStart = effortForm.value.week; effortForm.value.coveredEnd = weekEnd(effortForm.value.week) }
}
async function saveEffort() {
  if (!effortElement.value?.reportValidity()) return
  if (!Number.isFinite(effortForm.value.hours)) { ElMessage.warning('请填写实际投入小时'); return }
  const previous = manager.state.efforts.find(entry => entry.id === effortForm.value.id)
  if (await manager.save('efforts', { ...clone(effortForm.value), ...(previous?.hours === effortForm.value.hours ? {} : { hoursSource: 'reported' }), id: effortForm.value.id || crypto.randomUUID() }, changeReason.value)) { dialog.value = false; ElMessage.success('实际投入已保存') }
}
async function saveBaseline() {
  if (!baselineElement.value?.reportValidity()) return
  if (!baselineForm.value.personId && !baselineForm.value.peopleLabel.trim()) { ElMessage.warning('请选择人员或填写共同人员名称'); return }
  if (!Number.isFinite(baselineForm.value.hours)) { ElMessage.warning('请填写期初投入小时'); return }
  if (await manager.save('baselines', { ...clone(baselineForm.value), taskId: baselineForm.value.taskId || '', id: baselineForm.value.id || crypto.randomUUID() }, baselineReason.value)) { baselineDialog.value = false; ElMessage.success('期初投入已保存') }
}
async function removeEntry(entity: 'efforts' | 'baselines', entry: ManagementEffort | ManagementBaseline) {
  try {
    const requirement = entity === 'baselines' ? baselineRequirement(entry as ManagementBaseline) : undefined
    const message = requirement ? `这 ${displayHours(entry.hours)} 小时是「${requirement.title}」的实际投入来源。删除后，该需求和版本的累计投入都会减少，请填写删除原因。` : `删除「${versionName(entry.versionId)}」的 ${displayHours(entry.hours)} 小时投入，请填写原因。`
    const result = await ElMessageBox.prompt(message, '删除投入记录',
      { type: 'warning', inputPlaceholder: '删除原因', inputValidator: value => !!value?.trim() || '请填写删除原因', confirmButtonText: '删除', cancelButtonText: '取消' })
    if (await manager.remove(entity, entry.id, result.value.trim())) { dialog.value = false; baselineDialog.value = false; ElMessage.success('已删除') }
  } catch { /* User cancelled. */ }
}
async function exportAll() {
  exporting.value = true
  try { const { exportManagementWorkbook } = await import('../../management-io'); await exportManagementWorkbook(clone(manager.state), manager.week, 'effort'); ElMessage.success('投入统计已导出') }
  catch (error) { ElMessage.error((error as Error).message) }
  finally { exporting.value = false }
}
watch(() => props.focusId, id => {
  if (!id) return
  const effort = manager.state.efforts.find(entry => entry.id === id)
  if (effort) {
    tab.value = 'entries'; query.value = ''; projectFilter.value = effort.projectId; versionFilter.value = effort.versionId
    personFilter.value = effort.personId; roleFilter.value = effort.role; stageFilter.value = effort.stage; weekFilter.value = effort.week
    editEffort(effort)
  } else ElMessage.warning('实际投入记录不存在，请刷新后重试')
  emit('focused')
}, { immediate: true })
</script>

<template>
  <section class="mg-section effort-page">
    <div class="mg-toolbar effort-tabs-toolbar">
      <div class="effort-tabs" role="tablist" aria-label="投入统计视图">
        <button :class="{ active: tab === 'summary' }" role="tab" :aria-selected="tab === 'summary'" @click="tab = 'summary'"><ChartNoAxesCombined :size="15" />版本投入</button>
        <button :class="{ active: tab === 'entries' }" role="tab" :aria-selected="tab === 'entries'" @click="tab = 'entries'"><Clock3 :size="15" />实际投入</button>
        <button :class="{ active: tab === 'baselines' }" role="tab" :aria-selected="tab === 'baselines'" @click="tab = 'baselines'"><History :size="15" />期初投入</button>
      </div><span class="effort-spacer" />
      <el-button :disabled="manager.busy" @click="emit('import')"><Upload :size="14" />导入期初</el-button>
      <el-button :loading="exporting" @click="exportAll"><Download :size="14" />导出全部投入</el-button>
      <el-button v-if="tab === 'entries'" type="primary" :disabled="manager.busy" @click="editEffort()"><Plus :size="14" />登记实际投入</el-button>
      <el-button v-if="tab === 'baselines'" type="primary" :disabled="manager.busy" @click="editBaseline()"><Plus :size="14" />新增期初</el-button>
    </div>
    <div class="mg-toolbar effort-filter-toolbar">
      <label class="effort-search"><Search :size="14" /><input v-model="query" placeholder="搜索项目、版本或备注" aria-label="搜索投入" /></label>
      <el-select v-model="projectFilter" clearable placeholder="全部项目" aria-label="筛选项目" style="width:150px" @change="projectChanged"><el-option v-for="project in manager.state.projects" :key="project.id" :label="project.name" :value="project.id" /></el-select>
      <el-select v-model="versionFilter" clearable placeholder="全部专项版本" aria-label="筛选专项版本" style="width:180px"><el-option v-for="version in versions" :key="version.id" :label="`${version.code} · ${version.name}`" :value="version.id" /></el-select>
      <template v-if="tab !== 'summary'"><el-select v-model="personFilter" clearable placeholder="全部人员" aria-label="筛选人员" style="width:130px"><el-option v-for="person in manager.state.people" :key="person.id" :label="person.name" :value="person.id" /></el-select><el-select v-model="roleFilter" clearable placeholder="全部角色" aria-label="筛选角色" style="width:120px"><el-option v-for="role in managementRoles" :key="role" :label="roleLabels[role]" :value="role" /></el-select></template>
      <el-select v-if="tab !== 'summary'" v-model="stageFilter" clearable placeholder="全部环节" aria-label="筛选工作环节" style="width:140px"><el-option v-for="stage in managementStages" :key="stage" :label="stageLabels[stage]" :value="stage" /></el-select>
      <label v-if="tab === 'entries'" class="effort-week">归属周<input v-model="weekFilter" type="date" aria-label="筛选投入周" @change="weekFilter && (weekFilter = weekStart(weekFilter))" /><button v-if="weekFilter" title="清除周筛选" aria-label="清除周筛选" @click="weekFilter = ''"><X :size="13" /></button></label>
      <span class="effort-spacer" /><div class="effort-total"><span>{{ tab === 'summary' ? '累计实际投入' : '筛选合计' }}</span><strong>{{ displayHours(filteredHours) }}<small> h</small></strong><span>{{ displayHours(hoursToDays(filteredHours)) }} 人天</span></div>
    </div>
    <div class="mg-table-region effort-table-region">
      <table v-if="tab === 'summary'" class="mg-table effort-table summary-table">
        <thead><tr><th>专项版本 / 项目</th><th>开发开始</th><th>开发完成</th><th>开发周期</th><th>测试完成</th><th>实际上线</th><th class="number">产品合计 h</th><th v-for="(label, stage) in productStageLabels" :key="stage" class="number">{{ label }} h</th><th v-for="role in otherRoles" :key="role" class="number">{{ roleLabels[role] }} h</th><th class="number">累计小时</th><th class="number">累计人天</th></tr></thead>
        <tbody><tr v-for="item in summaries" :key="item.version.id">
          <td><strong>{{ item.version.name }}</strong><small>{{ projectName(item.version.projectId) }} · {{ item.version.code }}</small></td>
          <td class="effort-milestone" :class="{ 'is-pending': !item.timeline.developmentStart.week }" :title="formatVersionMilestone(item.timeline.developmentStart, true)">{{ formatVersionMilestone(item.timeline.developmentStart) }}</td>
          <td class="effort-milestone" :class="{ 'is-pending': !item.timeline.developmentEnd.week }" :title="formatVersionMilestone(item.timeline.developmentEnd, true)">{{ formatVersionMilestone(item.timeline.developmentEnd) }}</td>
          <td class="effort-milestone">{{ formatVersionDevelopmentSpan(item.timeline) }}</td>
          <td class="effort-milestone" :class="{ 'is-pending': !item.timeline.testEnd.week }" :title="formatVersionMilestone(item.timeline.testEnd, true)">{{ formatVersionMilestone(item.timeline.testEnd) }}</td>
          <td class="effort-milestone" :class="{ 'is-pending': !item.timeline.release.week }" :title="formatVersionMilestone(item.timeline.release, true)">{{ formatVersionMilestone(item.timeline.release) }}</td>
          <td class="number">{{ displayHours(item.summary.byRole.product) }}</td><td v-for="(_label, stage) in productStageLabels" :key="stage" class="number">{{ displayHours(item.summary.byProductStage[stage]) }}</td><td v-for="role in otherRoles" :key="role" class="number">{{ displayHours(item.summary.byRole[role]) }}</td><td class="number total-cell">{{ displayHours(item.summary.hours) }}<small v-if="item.summary.baselineHours">含期初 {{ displayHours(item.summary.baselineHours) }} h</small></td><td class="number">{{ displayHours(item.summary.days) }}</td>
        </tr></tbody>
      </table>
      <table v-else-if="tab === 'entries'" class="mg-table effort-table">
        <thead><tr><th>归属周 / 覆盖日期</th><th>专项版本 / 项目</th><th>人员</th><th>角色 / 环节</th><th class="number">实际小时</th><th>关联范围</th><th>类型</th><th>备注</th><th class="effort-actions-column">操作</th></tr></thead>
        <tbody><tr v-for="entry in efforts" :key="entry.id">
          <td class="date-cell">{{ entry.week }}<small v-if="entry.coveredStart !== entry.week || entry.coveredEnd !== weekEnd(entry.week)">{{ entry.coveredStart?.slice(5) }} 至 {{ entry.coveredEnd?.slice(5) }}</small></td><td><strong>{{ versionName(entry.versionId) }}</strong><small>{{ projectName(entry.projectId) }}</small></td><td>{{ personName(entry.personId) }}</td><td>{{ roleLabels[entry.role] }}<small>{{ stageLabels[entry.stage] }}</small></td>
          <td class="number total-cell">{{ displayHours(entry.hours) }}<small v-if="entry.hoursSource === 'allocated'" title="按本周总实际投入扣除已知用时后，按原预计比例分配">分摊工时</small></td>
          <td><span class="effort-cell-note" :title="entry.planId ? planLabel(entry.planId) : entry.taskIds.map(taskLabel).join('；')">{{ entry.planId ? planLabel(entry.planId) : entry.taskIds.length ? `${entry.taskIds.length} 项任务` : '周汇总' }}</span></td><td>{{ kindLabels[entry.kind] }}</td><td><span class="effort-cell-note" :title="entry.notes">{{ entry.notes || '—' }}</span></td><td><div class="effort-actions"><button class="icon-button" title="编辑投入" :disabled="manager.busy" @click="editEffort(entry)"><Pencil :size="14" /></button><button class="icon-button" title="删除投入" :disabled="manager.busy" @click="removeEntry('efforts', entry)"><Trash2 :size="14" /></button></div></td>
        </tr></tbody>
      </table>
      <table v-else class="mg-table effort-table"><thead><tr><th>截至日期</th><th>专项版本 / 项目</th><th>关联需求</th><th>人员 / 共同人员</th><th>角色 / 环节</th><th class="number">累计小时</th><th class="number">人天</th><th>来源</th><th>备注</th><th class="effort-actions-column">操作</th></tr></thead><tbody><tr v-for="entry in baselines" :key="entry.id"><td class="date-cell">{{ entry.asOf }}</td><td><strong>{{ versionName(entry.versionId) }}</strong><small>{{ projectName(entry.projectId) }}</small></td><td class="effort-linked-requirement"><template v-if="baselineRequirement(entry)"><strong>{{ baselineRequirement(entry)!.title }}</strong><small>{{ baselineRequirement(entry)!.code }}</small></template><span v-else class="muted">版本汇总</span></td><td>{{ entry.personId ? personName(entry.personId) : entry.peopleLabel }}<small v-if="!entry.personId">共同投入</small></td><td>{{ roleLabels[entry.role] }}<small>{{ entry.stage ? stageLabels[entry.stage] : '未细分' }}</small></td><td class="number total-cell">{{ displayHours(entry.hours) }}</td><td class="number">{{ displayHours(hoursToDays(entry.hours)) }}</td><td><span class="effort-cell-note" :title="entry.source">{{ entry.source || '手工登记' }}</span></td><td><span class="effort-cell-note" :title="entry.notes">{{ entry.notes || '—' }}</span></td><td><div class="effort-actions"><button class="icon-button" title="编辑期初" :disabled="manager.busy" @click="editBaseline(entry)"><Pencil :size="14" /></button><button class="icon-button" title="删除期初" :disabled="manager.busy" @click="removeEntry('baselines', entry)"><Trash2 :size="14" /></button></div></td></tr></tbody></table>
      <div v-if="tab === 'summary' ? !summaries.length : tab === 'entries' ? !efforts.length : !baselines.length" class="mg-empty effort-empty"><Clock3 :size="29" /><strong>{{ tab === 'summary' ? '暂无专项版本投入' : tab === 'entries' ? '暂无实际投入记录' : '暂无期初投入记录' }}</strong><el-button v-if="tab !== 'summary'" @click="tab === 'entries' ? editEffort() : editBaseline()"><Plus :size="14" />{{ tab === 'entries' ? '登记实际投入' : '新增期初' }}</el-button></div>
    </div>
    <el-dialog v-model="dialog" :title="effortForm.id ? '编辑实际投入' : '登记实际投入'" width="760px" :close-on-click-modal="false" destroy-on-close>
      <form ref="effortElement" class="mg-form effort-form" @submit.prevent="saveEffort"><div class="effort-form-grid">
        <label><span>归属周 <b>*</b></span><input v-model="effortForm.week" type="date" required @change="normalizeWeek" /></label><label><span>投入人员 <b>*</b></span><select v-model="effortForm.personId" required @change="effortScopeChanged"><option value="" disabled>选择人员</option><option v-for="person in manager.state.people" :key="person.id" :value="person.id">{{ person.name }}{{ person.active ? '' : '（已停用）' }}</option></select></label>
        <label><span>业务项目 <b>*</b></span><select v-model="effortForm.projectId" required @change="effortProjectChanged"><option value="" disabled>选择项目</option><option v-for="project in manager.state.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label><label><span>专项版本 <b>*</b></span><select v-model="effortForm.versionId" required @change="effortVersionChanged"><option value="" disabled>选择专项版本</option><option v-for="version in effortVersions" :key="version.id" :value="version.id">{{ version.code }} · {{ version.name }}</option></select></label>
        <label class="wide"><span>关联排期</span><el-select v-model="effortForm.planId" clearable filterable placeholder="不关联排期" aria-label="关联排期" @change="choosePlan"><el-option v-for="plan in availablePlans" :key="plan.id" :label="`${formatScheduleWeek(plan.baselineWeek || plan.week)} · ${personName(plan.personId)} · ${plan.title}`" :value="plan.id" /></el-select></label>
        <label><span>投入角色 <b>*</b></span><select v-model="effortForm.role" @change="effortRoleChanged"><option v-for="role in managementRoles" :key="role" :value="role">{{ roleLabels[role] }}</option></select></label><label><span>工作环节</span><select v-model="effortForm.stage"><option v-for="stage in managementStages" :key="stage" :value="stage">{{ stageLabels[stage] }}</option></select></label>
        <label><span>实际投入（小时）<b>*</b></span><el-input-number v-model="effortForm.hours" :min="0" :max="1000000" :precision="4" :step="1" /></label><label><span>投入类型</span><select v-model="effortForm.kind"><option v-for="(label, value) in kindLabels" :key="value" :value="value">{{ label }}</option></select></label>
        <label><span>投入覆盖开始日期</span><input v-model="effortForm.coveredStart" type="date" :min="effortForm.week" :max="effortForm.week ? weekEnd(effortForm.week) : undefined" required /></label><label><span>投入覆盖结束日期</span><input v-model="effortForm.coveredEnd" type="date" :min="effortForm.coveredStart || effortForm.week" :max="effortForm.week ? weekEnd(effortForm.week) : undefined" required /></label>
        <label class="wide"><span>关联任务</span><el-select v-model="effortForm.taskIds" multiple clearable filterable placeholder="不关联任务，按人员和专项版本汇总" aria-label="关联投入任务"><el-option v-for="task in availableTasks" :key="task.id" :label="taskLabel(task.id)" :value="task.id" /></el-select></label><label class="wide"><span>该周实际工作内容（选填）</span><textarea v-model="effortForm.workContent" rows="3" maxlength="4000" /></label><label class="wide"><span>投入说明</span><textarea v-model="effortForm.notes" rows="3" maxlength="4000" /></label><label v-if="effortForm.id" class="wide"><span>调整原因</span><input v-model="changeReason" maxlength="1000" /></label>
      </div></form><template #footer><el-button :disabled="manager.busy" @click="dialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" @click="saveEffort"><Check :size="14" />保存投入</el-button></template>
    </el-dialog>
    <el-dialog v-model="baselineDialog" :title="baselineForm.id ? '编辑期初投入' : '新增期初投入'" width="720px" :close-on-click-modal="false" destroy-on-close>
      <form ref="baselineElement" class="mg-form effort-form" @submit.prevent="saveBaseline"><div class="effort-form-grid">
        <label><span>业务项目 <b>*</b></span><select v-model="baselineForm.projectId" required @change="baselineProjectChanged"><option value="" disabled>选择项目</option><option v-for="project in manager.state.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label><label><span>专项版本 <b>*</b></span><select v-model="baselineForm.versionId" required @change="baselineForm.taskId = ''"><option value="" disabled>选择专项版本</option><option v-for="version in baselineVersions" :key="version.id" :value="version.id">{{ version.code }} · {{ version.name }}</option></select></label>
        <label><span>截至日期 <b>*</b></span><input v-model="baselineForm.asOf" type="date" required /></label><label><span>投入角色</span><select v-model="baselineForm.role" @change="baselineForm.taskId = ''"><option v-for="role in managementRoles" :key="role" :value="role">{{ roleLabels[role] }}</option></select></label>
        <label class="wide"><span>工作环节</span><select v-model="baselineForm.stage" @change="baselineForm.taskId = ''"><option v-for="stage in managementStages" :key="stage" :value="stage">{{ stageLabels[stage] }}</option></select></label>
        <label class="wide"><span>关联任务</span><el-select v-model="baselineForm.taskId" clearable filterable placeholder="按专项版本汇总" aria-label="历史投入关联任务" @change="chooseBaselineTask"><el-option v-for="task in baselineTasks" :key="task.id" :value="task.id" :label="taskLabel(task.id)" /></el-select></label>
        <label><span>投入人员</span><select v-model="baselineForm.personId"><option value="">共同投入 / 历史人员</option><option v-for="person in manager.state.people" :key="person.id" :value="person.id">{{ person.name }}</option></select></label><label><span>{{ baselineForm.personId ? '历史人员备注' : '共同人员名称' }} <b v-if="!baselineForm.personId">*</b></span><input v-model="baselineForm.peopleLabel" :required="!baselineForm.personId" placeholder="如 张三、李四" maxlength="500" /></label>
        <label><span>截至日期累计（小时）<b>*</b></span><el-input-number v-model="baselineForm.hours" :min="0" :max="1000000" :precision="2" :step="1" /></label><label><span>历史来源</span><input v-model="baselineForm.source" maxlength="1000" /></label><label class="wide"><span>备注</span><textarea v-model="baselineForm.notes" rows="3" maxlength="4000" /></label><label v-if="baselineForm.id" class="wide"><span>调整原因</span><input v-model="baselineReason" maxlength="1000" /></label>
      </div></form><template #footer><el-button :disabled="manager.busy" @click="baselineDialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" @click="saveBaseline"><Check :size="14" />保存期初</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.effort-page { display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden; }
.effort-tabs-toolbar,.effort-filter-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:12px 18px; flex-shrink:0; border-bottom:1px solid var(--line); }
.effort-tabs { display:flex; align-items:center; gap:4px; }.effort-tabs > button { display:flex; align-items:center; gap:7px; height:33px; padding:0 11px; border:0; border-radius:4px; color:var(--muted); background:transparent; font-size:12px; white-space:nowrap; }.effort-tabs > button:hover { background:var(--hover); color:var(--text); }.effort-tabs > button.active { background:var(--accent-soft); color:var(--accent); }.effort-spacer { flex:1; }
.effort-search { height:33px; display:flex; align-items:center; gap:7px; padding:0 10px; border:1px solid var(--line); border-radius:5px; color:var(--muted); }.effort-search input { width:170px; min-width:0; padding:0; border:0; outline:0; background:transparent; color:var(--text); font-size:12px; }
.effort-week { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:11px; }.effort-week input { width:132px; height:33px; border:1px solid var(--line); border-radius:5px; padding:4px 7px; color:var(--text); background:var(--surface); font-size:12px; }.effort-week button { border:0; background:none; color:var(--muted); padding:4px; }
.effort-total { display:flex; align-items:baseline; gap:9px; white-space:nowrap; font-size:11px; color:var(--muted); }.effort-total strong { font-size:19px; font-weight:600; color:var(--text); font-variant-numeric:tabular-nums; }.effort-total small { font-size:11px; font-weight:400; }
.effort-table-region { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; }.effort-table { width:100%; min-width:900px; border-collapse:collapse; text-align:left; font-size:12px; }.summary-table { min-width:1320px; }.effort-table th { position:sticky; top:0; z-index:1; background:var(--bg); color:var(--muted); font-weight:500; font-size:11px; white-space:nowrap; }.effort-table th,.effort-table td { padding:12px 14px; border-bottom:1px solid var(--line); }.effort-table tbody tr:hover { background:var(--hover); }.effort-table td > strong { display:block; max-width:290px; font-weight:500; overflow-wrap:anywhere; }.effort-table td > small { display:block; font-size:10px; color:var(--muted); margin-top:4px; }.effort-table td small { white-space:nowrap; }.summary-table td:not(:first-child) { white-space:nowrap; }.number { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }.total-cell { font-weight:600; }.total-cell small { font-weight:400; }.date-cell { white-space:nowrap; font-size:11px; }.effort-cell-note { display:block; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--muted); font-size:11px; }.effort-actions-column { width:87px; }.effort-actions { display:flex; gap:3px; }
.effort-empty { display:flex; flex-direction:column; align-items:center; gap:15px; padding:70px 20px; color:var(--muted); }.effort-empty strong { font-size:13px; font-weight:500; }
.summary-table td.effort-milestone { min-width:100px; max-width:160px; white-space:normal; overflow-wrap:anywhere; font-size:11px; line-height:1.6; font-variant-numeric:tabular-nums; }.effort-milestone.is-pending { color:var(--muted); }.effort-linked-requirement { min-width:150px; max-width:220px; }
.effort-form { max-height:min(65vh,680px); overflow:auto; padding:2px 5px; }.effort-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }.wide { grid-column:1/-1; }.effort-form label { display:flex; flex-direction:column; gap:7px; min-width:0; }.effort-form label > span { color:var(--muted); font-size:12px; }.effort-form b { color:var(--el-color-danger); font-weight:500; }.effort-form input,.effort-form select,.effort-form textarea { min-width:0; width:100%; min-height:35px; padding:7px 10px; border:1px solid var(--line); border-radius:5px; color:var(--text); background:var(--surface); outline:none; font-size:13px; }.effort-form textarea { resize:vertical; }.effort-form input:focus,.effort-form select:focus,.effort-form textarea:focus { border-color:var(--accent); }.effort-form :deep(.el-input-number) { width:100%; }
@media(max-width:900px) { .effort-tabs-toolbar,.effort-filter-toolbar { padding:12px; }.effort-total { width:100%; justify-content:flex-end; } }
@media(max-width:600px) { .effort-form-grid { grid-template-columns:minmax(0,1fr); }.effort-tabs { width:100%; }.effort-tabs > button { flex:1; justify-content:center; }.effort-search { flex:1; }.effort-search input { width:100%; } }
</style>
