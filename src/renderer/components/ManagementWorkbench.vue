<script setup lang="ts">
import { computed, onActivated, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Activity, ArrowRight, CalendarDays, ClipboardList, DatabaseBackup, Download, FolderKanban, History, Layers3, LayoutDashboard, RefreshCw, RotateCcw, Upload, Users, Wallet } from 'lucide-vue-next'
import { api } from '../api'
import { useManagement } from '../management-store'
import { addWeeks, getManagementAlerts, getVersionPhase, getVersionSummary, getWeekSummary, isRequirementClosed, validateManagementState, weekStart } from '../../shared/management'
import type { ManagementAlert } from '../../shared/management'
import type { OpeningPreview } from '../management-io'
import ManagementCatalog from './management/ManagementCatalog.vue'
import ManagementRequirements from './management/ManagementRequirements.vue'
import ManagementWeek from './management/ManagementWeek.vue'
import ManagementEffort from './management/ManagementEffort.vue'
import ManagementBackups from './management/ManagementBackups.vue'
import '../management.css'

const manager = useManagement()
const tabs = [
  { id: 'overview', name: '总览', icon: LayoutDashboard },
  { id: 'requirements', name: '需求跟踪', icon: ClipboardList },
  { id: 'week', name: '周排期', icon: CalendarDays },
  { id: 'effort', name: '投入统计', icon: Wallet },
  { id: 'versions', name: '专项版本', icon: Layers3 },
  { id: 'projects', name: '项目', icon: FolderKanban },
  { id: 'people', name: '人员', icon: Users }
] as const
type Tab = typeof tabs[number]['id']
const tab = ref<Tab>('overview'), focusId = ref(''), alertFilter = ref('all')
const focusEffortId = ref('')
const historyDialog = ref(false), historyQuery = ref(''), historyId = ref('')
const backupDialog = ref(false)
const openingInput = ref<HTMLInputElement>(), restoreInput = ref<HTMLInputElement>()
const openingPreview = ref<OpeningPreview | null>(null), importDialog = ref(false), asOf = ref(''), reading = ref(false)
const thisWeek = computed(() => getWeekSummary(manager.state, weekStart()))
const nextWeek = computed(() => getWeekSummary(manager.state, addWeeks(weekStart())))
const alerts = computed(() => getManagementAlerts(manager.state))
const filteredAlerts = computed(() => alerts.value.filter(a => alertFilter.value === 'all' || a.severity === alertFilter.value))
const activeRequirements = computed(() => manager.state.requirements.filter(r => r.status === 'active' && !isRequirementClosed(manager.state, r.id)))
const activeVersions = computed(() => manager.state.versions.filter(v => v.status === 'active' && !v.releasedAt).map(v => ({ ...v, phase: getVersionPhase(manager.state, v.id), summary: getVersionSummary(manager.state, v.id) })))
const audit = computed(() => manager.state.audit.slice().reverse().filter(a => `${a.action} ${a.reason} ${a.entityId}`.toLowerCase().includes(historyQuery.value.toLowerCase())))
const selectedAudit = computed(() => manager.state.audit.find(a => a.id === historyId.value))
const entityLabels: Record<string, string> = { projects: '项目', people: '人员', versions: '专项版本', requirements: '需求', tasks: '任务', plans: '周排期', efforts: '实际投入', baselines: '历史期初', capacities: '可用工时', weekActuals: '周工时核算' }
function auditAction(action: string) { const [entity, verb] = action.split('.'); return entityLabels[entity] ? `${entityLabels[entity]} · ${({ delete: '删除', create: '新增', update: '修改', carryover: '结转' } as Record<string, string>)[verb] || '保存'}` : ({ 'week.confirm': '确认周记录', 'backup.restore': '恢复备份' } as Record<string, string>)[action] || action }
function recordName(value: unknown) { if (!value || typeof value !== 'object') return ''; const v = value as Record<string, unknown>; return String(v.title || v.name || v.code || v.week || '') }
function pretty(value: unknown) { return JSON.stringify(value, null, 2) || '—' }
function localTime(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
async function load() { if (manager.loading || manager.busy) return; try { await manager.load() } catch {} }
onActivated(load)
function openWeek(next = false) { manager.week = next ? addWeeks(weekStart()) : weekStart(); tab.value = 'week' }
function openRequirement(id: string) { focusId.value = id; tab.value = 'requirements' }
function openEffort(id: string) { focusEffortId.value = id; tab.value = 'effort' }
function openAlert(alert: ManagementAlert) {
  if (alert.entity === 'requirement' || alert.entity === 'task') {
    focusId.value = alert.entity === 'requirement' ? alert.entityId : manager.state.tasks.find(t => t.id === alert.entityId)?.requirementId || ''
    tab.value = 'requirements'
  } else if (alert.entity === 'version') tab.value = 'versions'
  else if (alert.entity === 'plan') { manager.week = manager.state.plans.find(p => p.id === alert.entityId)?.week || weekStart(); tab.value = 'week' }
  else openWeek()
}
async function backup() {
  try { const path = await api.managementBackup(); if (path) ElMessage.success('管理数据已备份') }
  catch (e) { ElMessage.error((e as Error).message) }
}
async function restore() {
  try {
    await ElMessageBox.confirm('恢复后将使用所选备份中的管理数据，当前数据会先备份。', '恢复管理数据', { type: 'warning', confirmButtonText: '选择备份', cancelButtonText: '取消' })
    if (!window.toolbox) { restoreInput.value?.click(); return }
    manager.busy = true
    const state = await api.managementRestore()
    if (state) { manager.state = state; manager.error = ''; manager.ready = true; ElMessage.success('管理数据已恢复') }
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error((e as Error).message) }
  finally { manager.busy = false }
}
async function restoreFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file) return
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('备份文件不能超过30 MB')
    const data = validateManagementState(JSON.parse((await file.text()).replace(/^\uFEFF/, '')))
    if (await manager.execute({ type: 'restore', data, reason: `恢复备份：${file.name}` })) ElMessage.success('管理数据已恢复')
  } catch (e) { ElMessage.error((e as Error).message) }
}
async function readOpening(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file) return
  reading.value = true
  try { const io = await import('../management-io'); openingPreview.value = await io.readOpeningWorkbook(file); asOf.value = ''; importDialog.value = true }
  catch (e) { ElMessage.error((e as Error).message) }
  finally { reading.value = false }
}
async function importOpening() {
  if (!openingPreview.value) return
  try {
    const { prepareOpeningImport } = await import('../management-io')
    if (await manager.execute(prepareOpeningImport(manager.state, openingPreview.value, asOf.value))) { importDialog.value = false; tab.value = 'effort'; ElMessage.success('历史期初投入已导入') }
  } catch (e) { ElMessage.error((e as Error).message) }
}
async function exportAll() {
  try { const { exportManagementWorkbook } = await import('../management-io'); await exportManagementWorkbook(manager.state, manager.week, 'effort') }
  catch (e) { ElMessage.error((e as Error).message) }
}
</script>

<template>
  <div class="management-workbench" :aria-busy="manager.loading || manager.busy">
    <header class="mg-header">
      <div class="mg-title"><span class="mg-title-icon"><FolderKanban :size="20" /></span><h1>研发管理</h1><span class="mg-save-state"><span class="local-dot" />{{ manager.busy ? '保存中' : manager.ready ? `已保存 · r${manager.state.revision}` : '本地工作台' }}</span><el-button class="mg-backup-records-button" :disabled="manager.busy" @click="backupDialog = true"><DatabaseBackup :size="14" />备份记录</el-button></div>
      <div class="mg-header-actions">
        <el-button :loading="reading" :disabled="manager.busy || !manager.ready" @click="openingInput?.click()"><Upload :size="14" />导入历史投入</el-button>
        <button class="icon-button" title="导出专项版本投入表" aria-label="导出专项版本投入表" :disabled="!manager.ready" @click="exportAll"><Download :size="17" /></button>
        <button class="icon-button" title="备份管理数据" aria-label="备份管理数据" :disabled="manager.busy || !manager.ready" @click="backup"><DatabaseBackup :size="17" /></button>
        <button class="icon-button" title="恢复管理备份" aria-label="恢复管理备份" :disabled="manager.busy || manager.loading" @click="restore"><RotateCcw :size="17" /></button>
        <button class="icon-button" title="变更记录" aria-label="变更记录" @click="historyDialog = true"><History :size="17" /></button>
        <button class="icon-button" title="刷新数据" aria-label="刷新数据" :disabled="manager.busy || manager.loading" @click="load"><RefreshCw :size="16" :class="{ 'mg-spinning': manager.loading }" /></button>
      </div>
    </header>
    <nav class="mg-tabs" aria-label="研发管理视图"><button v-for="item in tabs" :key="item.id" :class="{ selected: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id"><component :is="item.icon" :size="15" /><span>{{ item.name }}</span><span v-if="item.id === 'overview' && alerts.length" class="mg-tab-count">{{ alerts.length }}</span></button></nav>
    <div v-if="manager.error" class="mg-load-error"><Activity :size="22" /><strong>管理数据加载失败</strong><p>{{ manager.error }}</p><el-button @click="load">重试</el-button></div>
    <div v-else-if="!manager.ready" class="mg-empty">正在加载管理数据…</div>
    <div v-else class="mg-body">
      <div v-if="tab === 'overview'" class="mg-overview">
        <div class="mg-overview-stats">
          <button @click="tab = 'requirements'"><span>进行中需求</span><strong>{{ activeRequirements.length }}<small>项</small></strong><ClipboardList :size="18" /></button>
          <button @click="openWeek()"><span>本周排期</span><strong>{{ thisWeek.plans }}<small>项 · {{ thisWeek.plannedHours }} h</small></strong><CalendarDays :size="18" /></button>
          <button @click="tab = 'effort'"><span>本周实际投入</span><strong>{{ thisWeek.actualHours }}<small>h</small></strong><Wallet :size="18" /></button>
          <button @click="openWeek(true)"><span>下周已排</span><strong>{{ nextWeek.plans }}<small>项 · {{ nextWeek.plannedHours }} h</small></strong><ArrowRight :size="18" /></button>
        </div>
        <div class="mg-overview-columns">
          <section class="mg-alerts"><div class="mg-panel-heading"><h2>待跟进<span>{{ alerts.length }}</span></h2><select v-model="alertFilter" aria-label="筛选提醒级别" class="mg-native-select"><option value="all">全部事项</option><option value="danger">逾期与阻塞</option><option value="warning">待安排与补录</option><option value="info">阶段衔接</option></select></div>
            <div class="mg-scroll mg-alert-list"><button v-for="alert in filteredAlerts" :key="alert.id" class="mg-alert-row" @click="openAlert(alert)"><span :class="['mg-alert-marker', alert.severity]" /><span class="mg-alert-copy"><strong>{{ alert.title }}</strong><span>{{ alert.detail }}</span><small v-if="alert.projectId">{{ manager.projectName(alert.projectId) }}</small></span><ArrowRight :size="15" /></button><div v-if="!filteredAlerts.length" class="mg-empty"><ClipboardList :size="28" /><span>暂无待跟进事项</span></div></div>
          </section>
          <section class="mg-version-overview"><div class="mg-panel-heading"><h2>专项版本<span>{{ activeVersions.length }}</span></h2><button class="mg-text-button" @click="tab = 'versions'">管理版本<ArrowRight :size="14" /></button></div>
            <div class="mg-scroll"><table class="mg-table"><thead><tr><th>专项版本 / 项目</th><th>当前阶段</th><th class="number">累计投入</th></tr></thead><tbody><tr v-for="version in activeVersions" :key="version.id"><td><button class="mg-table-link" @click="tab = 'versions'">{{ version.name }}</button><small>{{ manager.projectName(version.projectId) }} · {{ version.code }}</small></td><td><span class="mg-status" :class="{ done: version.phase === '开发完成' || version.phase === '测试中' || version.phase === '待上线' }">{{ version.phase }}</span><small v-if="version.devCompletedAt">开发完成 {{ version.devCompletedAt }}</small><small v-else-if="version.plannedDevEnd">计划开发完成 {{ version.plannedDevEnd }}</small><small v-if="version.testCompletedAt">测试完成 {{ version.testCompletedAt }}</small></td><td class="number">{{ version.summary.hours }} h<small>{{ version.summary.days }} 人天</small></td></tr></tbody></table><div v-if="!activeVersions.length" class="mg-empty"><Layers3 :size="28" /><span>暂无进行中的专项版本</span><div class="mg-actions"><el-button @click="tab = 'projects'">新增项目</el-button><el-button @click="tab = 'versions'">新增版本</el-button></div></div></div>
          </section>
        </div>
      </div>
      <ManagementRequirements v-else-if="tab === 'requirements'" :focus-id="focusId" />
      <ManagementWeek v-else-if="tab === 'week'" @open-requirement="openRequirement" @open-effort="openEffort" />
      <ManagementEffort v-else-if="tab === 'effort'" :focus-id="focusEffortId" @focused="focusEffortId = ''" @import="openingInput?.click()" />
      <ManagementCatalog v-else :key="tab" :kind="tab as 'projects' | 'people' | 'versions'" @open-requirement="openRequirement" />
    </div>
    <input ref="openingInput" type="file" accept=".xlsx" hidden aria-label="导入历史投入 Excel" @change="readOpening" />
    <input ref="restoreInput" type="file" accept=".json" hidden aria-label="恢复 JSON 备份" @change="restoreFile" />
    <ManagementBackups v-model="backupDialog" @import="restore" />
    <el-dialog v-model="importDialog" title="导入历史期初投入" width="920px" :close-on-click-modal="false" destroy-on-close>
      <template v-if="openingPreview"><div class="mg-import-info"><strong>{{ openingPreview.source }}</strong><span>{{ openingPreview.rows.length }} 条角色投入</span><label>累计截至日期 <input v-model="asOf" type="date" required aria-label="历史投入截至日期" /></label></div><div v-if="openingPreview.warnings.length" class="mg-import-warnings"><p v-for="warning in openingPreview.warnings" :key="warning">{{ warning }}</p></div><div class="mg-import-preview"><el-table :data="openingPreview.rows" height="100%" empty-text="无可导入记录"><el-table-column prop="row" label="原行号" width="75" /><el-table-column prop="project" label="项目" min-width="120" /><el-table-column prop="version" label="专项版本" min-width="160" /><el-table-column prop="person" label="人员" min-width="140" /><el-table-column label="角色" width="80"><template #default="{row}">{{ { product: '产品', frontend: '前端', backend: '后端', qa: '测试', other: '其他' }[row.role as 'product' | 'frontend' | 'backend' | 'qa' | 'other'] }}</template></el-table-column><el-table-column prop="hours" label="累计小时" width="100" /></el-table></div></template>
      <template #footer><el-button @click="importDialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" :disabled="!asOf" @click="importOpening"><Upload :size="14" />确认导入</el-button></template>
    </el-dialog>
    <el-dialog v-model="historyDialog" title="管理数据变更记录" width="1020px" destroy-on-close><input v-model="historyQuery" class="mg-search-input mg-history-search" placeholder="查找变更类型或原因" aria-label="查找变更" /><div class="mg-history-layout"><div class="mg-scroll"><table class="mg-table"><thead><tr><th>时间</th><th>变更</th><th>内容 / 原因</th></tr></thead><tbody><tr v-for="entry in audit" :key="entry.id" :class="{ selected: entry.id === historyId }" tabindex="0" @click="historyId = entry.id" @keydown.enter="historyId = entry.id"><td class="mg-nowrap">{{ localTime(entry.time) }}</td><td>{{ auditAction(entry.action) }}</td><td>{{ recordName(entry.after) || recordName(entry.before) }}<small>{{ entry.reason }}</small></td></tr></tbody></table><div v-if="!audit.length" class="mg-empty">暂无变更记录</div></div><aside v-if="selectedAudit" class="mg-history-detail"><h3>变更前</h3><pre>{{ pretty(selectedAudit.before) }}</pre><h3>变更后</h3><pre>{{ pretty(selectedAudit.after) }}</pre></aside></div></el-dialog>
  </div>
</template>
