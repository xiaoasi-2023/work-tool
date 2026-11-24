<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { HardDrive, ScanLine, FolderOpen, Download, FileUp, Square, ArrowUpRight, ShieldCheck, Archive, Trash2, History, TrendingUp, Search, RefreshCw, ChevronRight, Files } from 'lucide-vue-next'
import { api } from '../api'
import { DISK_SELECTION_LIMIT, diskBytes, diskChanges, diskKindLabels, diskPath, diskSnapshotAfterOperations, importDiskSnapshot, type DiskAction, type DiskCandidate, type DiskOperation, type DiskPreview, type DiskSnapshot, type DiskState, type DiskVolume } from '../../shared/disk'
import '../disk.css'

const native = !!window.toolbox?.disk
const state = ref<DiskState>({ job: null, snapshots: [], operations: [], working: false })
const home = ref(''), volumes = ref<DiskVolume[]>([]), root = ref(''), scope = ref('profile')
const current = ref<DiskSnapshot | null>(null), imports = ref<DiskSnapshot[]>([]), baseline = ref<DiskSnapshot | null>(null), baselineId = ref('')
const query = ref(''), kind = ref(''), owner = ref(''), selected = ref<string[]>([]), busy = ref(false), failure = ref('')
const destination = ref(''), preview = ref<DiskPreview | null>(null), previewOpen = ref(false), picker = ref<HTMLInputElement>(), selectedSnapshot = ref('')
const tabs = [{ id: 'candidates', title: '整理候选' }, { id: 'apps', title: '按软件查看' }, { id: 'folders', title: '目录与大文件' }, { id: 'growth', title: '增长对比' }, { id: 'history', title: '操作记录' }] as const
const tab = ref<(typeof tabs)[number]['id']>('candidates'), folderView = ref<'folders' | 'files'>('folders')
const scanning = computed(() => state.value.job?.status === 'scanning')
const locked = computed(() => busy.value || state.value.working)
const canOperate = computed(() => native && current.value?.source === 'native' && current.value.complete && !locked.value && !scanning.value)
const activeSnapshot = computed(() => current.value ? diskSnapshotAfterOperations(current.value, state.value.operations) : null)
const stale = computed(() => !!activeSnapshot.value?.changedAt)
const allSnapshots = computed(() => [...imports.value.map(snapshot => ({ id: snapshot.id, root: snapshot.root, createdAt: snapshot.createdAt, complete: snapshot.complete, bytes: snapshot.bytes })), ...state.value.snapshots])
const matchingSnapshots = computed(() => allSnapshots.value.filter(snapshot => snapshot.id !== current.value?.id && snapshot.complete && current.value && diskPath(snapshot.root) === diskPath(current.value.root)))
const candidates = computed(() => (activeSnapshot.value?.candidates || []).filter(row => (!query.value || `${row.path} ${row.owner} ${row.reason}`.toLowerCase().includes(query.value.toLowerCase())) && (!kind.value || row.kind === kind.value) && (!owner.value || row.owner === owner.value)))
const selectableRows = computed(() => candidates.value.filter(row => row.action && !row.blocked))
const selectedVisibleCount = computed(() => selectableRows.value.filter(row => selected.value.includes(row.id)).length)
const allSelected = computed(() => selectableRows.value.length > 0 && selectedVisibleCount.value === selectableRows.value.length)
const partiallySelected = computed(() => selectedVisibleCount.value > 0 && !allSelected.value)
const selectedRows = computed(() => (activeSnapshot.value?.candidates || []).filter(row => selected.value.includes(row.id) && row.action && !row.blocked))
const selectedClean = computed(() => selectedRows.value.filter(row => row.action === 'clean'))
const selectedArchive = computed(() => selectedRows.value.filter(row => row.action === 'archive'))
const clearBytes = computed(() => (activeSnapshot.value?.candidates || []).filter(row => row.action === 'clean' && (!row.blocked || current.value?.source === 'imported')).reduce((sum, row) => sum + row.bytes, 0))
const archiveBytes = computed(() => (activeSnapshot.value?.candidates || []).filter(row => row.action === 'archive' && (!row.blocked || current.value?.source === 'imported')).reduce((sum, row) => sum + row.bytes, 0))
const volume = computed(() => current.value?.volume || volumes.value.find(volume => diskPath(root.value).startsWith(diskPath(volume.path))) || null)
const usedPercent = computed(() => volume.value?.total ? Math.max(0, Math.min(100, (1 - volume.value.free / volume.value.total) * 100)) : 0)
const folderRows = computed(() => (folderView.value === 'folders' ? current.value?.folders || [] : current.value?.largeFiles || []).filter(row => !query.value || row.path.toLowerCase().includes(query.value.toLowerCase())))
const growth = computed(() => { try { return current.value && baseline.value ? diskChanges(current.value, baseline.value).filter(row => !query.value || row.path.toLowerCase().includes(query.value.toLowerCase())) : [] } catch { return [] } })
const compareError = computed(() => { try { if (current.value && baseline.value) diskChanges(current.value, baseline.value); return '' } catch (e) { return (e as Error).message } })
const sameArchiveVolume = computed(() => preview.value?.action === 'archive' && /^[a-z]:/i.test(preview.value.destination) && preview.value.items.some(item => diskPath(item.path).slice(0, 2) === diskPath(preview.value!.destination).slice(0, 2)))
let timer: ReturnType<typeof setInterval> | undefined, polling = false, initialized = false, seenJob = ''
const date = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录'
const shortPath = (value: string) => value.split(/[\\/]/).filter(Boolean).at(-1) || value
const errorText = (error: unknown) => (error as Error).message || String(error)
const signed = (bytes: number) => `${bytes > 0 ? '+' : bytes < 0 ? '−' : ''}${diskBytes(Math.abs(bytes))}`
const candidateStatus = (row: DiskCandidate) => row.handled ? { clean: '已清理', archive: '已归档', restore: '已恢复' }[row.handled] : row.blocked ? '暂时保留' : row.action === 'clean' ? '可重建' : row.action === 'archive' ? '归档保留' : '按工具管理'
watch([query, kind, owner], () => { selected.value = [] }, { flush: 'sync' })
watch(selectableRows, rows => { const allowed = new Set(rows.map(row => row.id)); selected.value = selected.value.filter(id => allowed.has(id)) }, { flush: 'sync' })
function switchTab(value: typeof tab.value) { tab.value = value; query.value = ''; owner.value = ''; kind.value = '' }
async function showSnapshot(id: string) {
  try {
    current.value = imports.value.find(snapshot => snapshot.id === id) || await api.disk.snapshot(id)
    selectedSnapshot.value = id; selected.value = []; baseline.value = null; baselineId.value = ''; query.value = ''; owner.value = ''
  } catch (error) { failure.value = errorText(error) }
}
async function poll() {
  if (!native || polling) return
  polling = true
  try {
    state.value = await api.disk.state()
    const job = state.value.job
    if (job?.status === 'failed') failure.value = job.error
    if (job?.snapshotId && job.snapshotId !== seenJob) { seenJob = job.snapshotId; await showSnapshot(job.snapshotId) }
  } catch (error) { failure.value = errorText(error) }
  finally { polling = false }
}
async function initialize() {
  if (initialized) return
  initialized = true
  try {
    if (native) {
      const environment = await api.disk.environment()
      home.value = environment.home; root.value = environment.home; volumes.value = environment.volumes
      await poll()
      if (!current.value && state.value.snapshots[0]) await showSnapshot(state.value.snapshots[0].id)
    }
  } catch (error) { failure.value = errorText(error) }
}
function activate() { void initialize(); if (!timer && native) timer = setInterval(() => void poll(), 1200) }
function deactivate() { if (timer) clearInterval(timer); timer = undefined }
onMounted(activate); onActivated(activate); onDeactivated(deactivate); onBeforeUnmount(deactivate)
function setScope(value: string) { scope.value = value; if (value === 'profile') root.value = home.value; else if (value === 'drive') root.value = volumes.value[0]?.path || home.value }
async function choose(purpose: 'scan' | 'archive') {
  try { const value = await api.disk.chooseFolder(purpose); if (value) { if (purpose === 'scan') { root.value = value; scope.value = 'folder' } else destination.value = value } }
  catch (error) { ElMessage.error(errorText(error)) }
}
async function scan() {
  busy.value = true; failure.value = ''; selected.value = []
  try { state.value.job = await api.disk.start(root.value) }
  catch (error) { failure.value = errorText(error) }
  finally { busy.value = false }
}
async function cancel() { try { await api.disk.cancel() } catch (error) { ElMessage.error(errorText(error)) } }
function toggle(row: DiskCandidate) {
  if (!canOperate.value || !row.action || row.blocked) return
  if (selected.value.includes(row.id)) selected.value = selected.value.filter(id => id !== row.id)
  else if (selected.value.length >= DISK_SELECTION_LIMIT) ElMessage.info(`每次最多选择 ${DISK_SELECTION_LIMIT} 项`)
  else selected.value.push(row.id)
}
function toggleAll() {
  if (!canOperate.value) return
  selected.value = allSelected.value ? [] : selectableRows.value.map(row => row.id)
}
async function prepare(action: DiskAction) {
  if (!current.value) return
  const rows = action === 'clean' ? selectedClean.value : selectedArchive.value
  if (!rows.length) return
  if (action === 'archive' && !destination.value) { await choose('archive'); if (!destination.value) return }
  busy.value = true; failure.value = ''
  try { preview.value = await api.disk.prepare(current.value.id, rows.map(row => row.id), action, destination.value); previewOpen.value = true }
  catch (error) { ElMessage.error(errorText(error)) }
  finally { busy.value = false }
}
async function changeArchive() { await choose('archive'); if (destination.value) await prepare('archive') }
function acceptResult(operation: DiskOperation) {
  state.value.operations = [operation, ...state.value.operations.filter(record => record.id !== operation.id)]
  if (current.value) current.value = diskSnapshotAfterOperations(current.value, [operation])
}
async function perform() {
  if (!preview.value) return
  busy.value = true
  try {
    const result = await api.disk.execute(preview.value.id)
    if (result) { acceptResult(result); previewOpen.value = false; const success = result.items.filter(item => item.success).length; ElMessage({ type: success === result.items.length ? 'success' : 'warning', message: `处理结束：成功 ${success} 项，跳过或失败 ${result.items.length - success} 项。未处理条目可继续操作，详情见操作记录。` }) }
    await poll()
  } catch (error) { ElMessage.error(errorText(error)) }
  finally { busy.value = false }
}
async function restore(id: string) {
  busy.value = true
  try { const result = await api.disk.restore(id); if (result) { acceptResult(result); await poll(); ElMessage.info(`恢复完成：成功 ${result.items.filter(item => item.success).length} 项，请查看逐项结果`) } }
  catch (error) { ElMessage.error(errorText(error)) }
  finally { busy.value = false }
}
async function reveal(value: string) { if (!native) return; try { await api.disk.reveal(value) } catch (error) { ElMessage.error(errorText(error)) } }
async function uninstall() { try { await api.disk.uninstall() } catch (error) { ElMessage.error(errorText(error)) } }
async function loadBaseline(id: string) { baselineId.value = id; try { baseline.value = imports.value.find(snapshot => snapshot.id === id) || await api.disk.snapshot(id) } catch (error) { baseline.value = null; ElMessage.error(errorText(error)) } }
async function importFile(event: Event) {
  const element = event.target as HTMLInputElement, file = element.files?.[0]
  element.value = ''; if (!file) return
  busy.value = true
  try {
    if (file.size > 40 * 1024 ** 2) throw new Error('报告文件不能超过 40 MiB')
    const snapshot = importDiskSnapshot(JSON.parse((await file.text()).replace(/^\uFEFF/, '')))
    imports.value.unshift(snapshot); imports.value = imports.value.slice(0, 12)
    await showSnapshot(snapshot.id); failure.value = ''; ElMessage.success('已导入扫描报告，仅供分析')
  } catch (error) { ElMessage.error(errorText(error)) }
  finally { busy.value = false }
}
function exportReport() {
  if (!current.value) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(current.value, null, 2)], { type: 'application/json' })), a = document.createElement('a')
  a.href = url; a.download = `Workbench-磁盘扫描-${current.value.createdAt.slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="disk-workbench">
    <header class="disk-heading"><div class="disk-heading-title"><span class="disk-logo"><HardDrive :size="24" :stroke-width="1.7" /></span><div><h1>磁盘空间助手</h1><p>看清占用，再有依据地整理</p></div></div><div class="disk-heading-actions"><el-button :disabled="locked" @click="picker?.click()"><FileUp :size="15" />导入报告</el-button><el-button :disabled="!current" @click="exportReport"><Download :size="15" />导出报告</el-button></div><input ref="picker" type="file" accept=".json,application/json" class="disk-file-input" aria-label="导入扫描报告" @change="importFile" /></header>
    <div v-if="!native" class="disk-notice"><ShieldCheck :size="16" /><span>浏览器可导入 JSON 报告查看分析。扫描本机磁盘、清理和归档请使用桌面版。</span></div>
    <div v-if="failure" class="disk-notice is-error" role="alert">{{ failure }}</div>
    <section v-if="native" class="disk-scan-toolbar" aria-label="扫描范围">
      <div class="disk-scope-switch"><button v-for="option in [{id:'profile',name:'用户目录'},{id:'drive',name:'整个磁盘'},{id:'folder',name:'指定目录'}]" :key="option.id" :class="{selected:scope===option.id}" :disabled="locked || scanning" @click="setScope(option.id)">{{ option.name }}</button></div>
      <el-select v-if="scope==='drive'" v-model="root" :disabled="locked || scanning" aria-label="扫描磁盘" class="disk-volume-select"><el-option v-for="item in volumes" :key="item.path" :value="item.path" :label="`${item.path} ${item.name}`" /></el-select>
      <button v-else-if="scope==='folder'" class="disk-folder-picker" :disabled="locked || scanning" @click="choose('scan')"><FolderOpen :size="16" />选择文件夹</button>
      <code class="disk-scan-path" :title="root">{{ root || '请选择范围' }}</code>
      <el-button v-if="scanning" @click="cancel"><Square :size="14" />停止扫描</el-button><el-button v-else type="primary" :disabled="!root || locked" @click="scan"><ScanLine :size="16" />{{ current ? '重新扫描' : '开始扫描' }}</el-button>
    </section>
    <section v-if="scanning" class="disk-progress" role="status" aria-live="polite"><div><span class="disk-pulse" /><strong>正在分析</strong><span>{{ state.job!.files.toLocaleString() }} 个文件 · {{ diskBytes(state.job!.bytes) }}</span></div><code :title="state.job!.directory">{{ state.job!.directory }}</code><div class="disk-progress-track"><span /></div></section>
    <section v-if="current || volumes.length" class="disk-overview" aria-label="空间概览">
      <div class="disk-drive-summary"><div><span>{{ volume?.path || '扫描范围' }}</span><small>可用空间</small></div><strong>{{ volume ? diskBytes(volume.free) : '—' }}</strong><div class="disk-capacity-track" role="img" :aria-label="`磁盘已用 ${Math.round(usedPercent)}%`"><span :class="{full:usedPercent>85}" :style="{width:`${usedPercent}%`}" /></div><small>{{ volume ? `${diskBytes(volume.total)} 总容量 · 已用 ${usedPercent.toFixed(0)}%` : '目录逻辑体积与磁盘实际占用分别统计' }}</small></div>
      <div class="disk-metric"><span>已扫描文件体积</span><strong>{{ current ? diskBytes(current.bytes) : '—' }}</strong><small>{{ current ? `${current.files.toLocaleString()} 个文件` : '扫描后显示' }}</small></div>
      <div class="disk-metric is-green"><span>缓存清理候选</span><strong>{{ current ? diskBytes(clearBytes) : '—' }}</strong><small>{{ current?.source==='imported' ? '报告中的候选体积，需本机重扫核对' : '执行前核对进程与文件状态' }}</small></div>
      <div class="disk-metric"><span>归档候选文件</span><strong>{{ current ? diskBytes(archiveBytes) : '—' }}</strong><small>{{ current?.source==='imported' ? '报告仅供分析，保留原有文件' : '移到其他磁盘可释放原盘空间' }}</small></div>
    </section>
    <div v-if="!current && !scanning" class="disk-welcome"><div class="disk-welcome-art"><HardDrive :size="50" :stroke-width="1.1" /><span><Search :size="22" /></span></div><h2>空间花在哪里，一次看清</h2><p>从用户目录开始，查看 AI 工具、开发环境和历史文件的实际占用。</p><div><span><ShieldCheck :size="16" />扫描只读取文件元数据</span><span><Archive :size="16" />历史资料支持校验归档</span></div><el-button v-if="!native" type="primary" @click="picker?.click()"><FileUp :size="16" />导入本机分析报告</el-button></div>
    <template v-if="current">
      <div class="disk-snapshot-bar"><span :title="current.root"><span class="disk-snapshot-dot" />{{ current.source === 'native' ? '本机扫描' : '导入报告' }}<ChevronRight :size="13" /><code>{{ current.root }}</code></span><el-select v-model="selectedSnapshot" aria-label="扫描快照" @change="showSnapshot"><el-option v-for="item in allSnapshots" :key="item.id" :value="item.id" :label="`${date(item.createdAt)}${item.complete ? '' : '（已停止）'}`" /></el-select></div>
      <div v-if="stale || !current.complete" class="disk-notice is-warning">{{ !current.complete ? '扫描已停止，当前结果不完整，仅供查看。' : '已处理条目已禁用，其他条目可继续勾选。空间和目录占用仍为扫描时数据，重新扫描可更新完整统计。' }}</div>
      <nav class="disk-tabs" aria-label="磁盘分析视图"><button v-for="item in tabs" :key="item.id" :class="{selected:tab===item.id}" @click="switchTab(item.id)">{{ item.title }}<span v-if="item.id==='candidates'">{{ current.candidates.length }}</span></button></nav>
      <section class="disk-content">
        <div v-if="tab!=='history'" class="disk-view-toolbar"><div v-if="tab==='folders'" class="disk-sub-switch"><button :class="{selected:folderView==='folders'}" @click="folderView='folders'">目录占用</button><button :class="{selected:folderView==='files'}" @click="folderView='files'">大文件</button></div><template v-if="tab==='candidates'"><el-select v-model="kind" clearable placeholder="全部类型" aria-label="候选类型"><el-option v-for="(name,id) in diskKindLabels" :key="id" :label="name" :value="id" /></el-select><el-select v-model="owner" clearable placeholder="全部软件" aria-label="所属软件"><el-option v-for="name in [...new Set(current.candidates.map(row=>row.owner))]" :key="name" :label="name" :value="name" /></el-select></template><template v-if="tab==='growth'"><span class="disk-caption">对比基线</span><el-select :model-value="baselineId" placeholder="选择同范围的完整扫描" aria-label="增长对比基线" @change="loadBaseline"><el-option v-for="item in matchingSnapshots" :key="item.id" :value="item.id" :label="date(item.createdAt)" /></el-select></template><span class="disk-spacer" /><label class="disk-search"><Search :size="15" /><input v-model="query" aria-label="搜索路径或软件" placeholder="搜索路径或软件" /></label></div>
        <div v-if="tab==='growth' && baseline && !compareError" class="disk-notice">仅比较两次报告共同记录的目录；未列出的目录不按 0 计算，父子目录的变化不能相加。</div>
        <div class="disk-table-scroll">
          <template v-if="tab==='candidates'"><table class="disk-table disk-candidates"><colgroup><col style="width:44px" /><col style="width:18%" /><col style="width:40%" /><col style="width:110px" /><col /><col style="width:46px" /></colgroup><thead><tr><th><input type="checkbox" aria-label="全选当前筛选结果中可处理的条目" title="全选当前筛选结果中可处理的条目" :checked="allSelected" :indeterminate="partiallySelected" :disabled="!canOperate || !selectableRows.length" @change="toggleAll" /></th><th>所属软件 / 类型</th><th>位置与整理依据</th><th class="disk-number">候选体积</th><th>处理方式</th><th /></tr></thead><tbody><tr v-for="row in candidates" :key="row.id" :class="{picked:selected.includes(row.id)}"><td><input type="checkbox" :aria-label="`选择${row.path}`" :checked="selected.includes(row.id)" :disabled="!canOperate || !row.action || !!row.blocked" @change="toggle(row)" /></td><td><strong>{{ row.owner }}</strong><span class="disk-type">{{ diskKindLabels[row.kind] }}</span></td><td><strong class="disk-ellipsis" :title="row.path">{{ shortPath(row.path) }}</strong><code class="disk-ellipsis disk-path" :title="row.path">{{ row.path }}</code><small>{{ row.reason }}</small></td><td class="disk-number">{{ diskBytes(row.bytes) }}</td><td><span :class="['disk-chip',row.blocked || !row.action ? 'muted' : row.action==='clean' ? 'green' : 'amber']">{{ candidateStatus(row) }}</span><small class="disk-row-impact" :title="row.blocked || row.impact">{{ row.blocked || row.impact }}</small></td><td><button v-if="native" class="icon-button" :title="`定位${row.path}`" :aria-label="`定位${row.path}`" @click="reveal(row.path)"><ArrowUpRight :size="16" /></button></td></tr></tbody></table><div v-if="!candidates.length" class="disk-empty"><ShieldCheck :size="28" /><strong>当前范围未发现匹配的整理候选</strong><span>未识别的文件只展示占用，保留原有数据。</span></div></template>
          <template v-else-if="tab==='apps'"><table class="disk-table"><colgroup><col style="width:25%" /><col style="width:140px" /><col style="width:22%" /><col /></colgroup><thead><tr><th>软件或来源</th><th class="disk-number">文件体积</th><th>占用分布</th><th>来源位置</th></tr></thead><tbody><tr v-for="item in current.apps.filter(row=>!query || `${row.name} ${row.paths.map(x=>x.path).join(' ')}`.toLowerCase().includes(query.toLowerCase()))" :key="item.id"><td><strong>{{ item.name }}</strong><small>{{ item.files.toLocaleString() }} 个文件</small></td><td class="disk-number">{{ diskBytes(item.bytes) }}</td><td><div class="disk-mini-bar"><span :style="{width:`${Math.max(1,item.bytes/Math.max(1,current.bytes)*100)}%`}" /></div><small>{{ (item.bytes/Math.max(1,current.bytes)*100).toFixed(1) }}% 的已扫描文件</small></td><td><details><summary>{{ item.paths.length }} 处来源目录</summary><div v-for="source in item.paths" :key="source.path" class="disk-app-source"><code :title="source.path">{{ source.path }}</code><span>{{ diskBytes(source.bytes) }}</span><button v-if="native" class="icon-button" title="打开所在位置" @click="reveal(source.path)"><FolderOpen :size="14" /></button></div></details></td></tr></tbody></table></template>
          <template v-else-if="tab==='folders'"><table class="disk-table"><colgroup><col style="width:65%" /><col style="width:140px" /><col /><col style="width:50px" /></colgroup><thead><tr><th>{{ folderView==='folders' ? '目录（按占用从大到小）' : '大文件' }}</th><th class="disk-number">逻辑体积</th><th>{{ folderView==='folders' ? '统计状态' : '最后修改' }}</th><th /></tr></thead><tbody><tr v-for="row in folderRows" :key="row.path"><td><strong class="disk-ellipsis" :title="row.path">{{ shortPath(row.path) }}</strong><code class="disk-path disk-ellipsis" :title="row.path">{{ row.path }}</code></td><td class="disk-number">{{ diskBytes(row.bytes) }}</td><td><span v-if="'partial' in row" :class="['disk-chip',row.partial?'amber':'muted']">{{ row.partial ? '含未读取条目' : '已统计' }}</span><small v-else>{{ date(row.modifiedAt) }}</small></td><td><button v-if="native" class="icon-button" title="定位文件夹或文件" @click="reveal(row.path)"><ArrowUpRight :size="16" /></button></td></tr></tbody></table><div v-if="!folderRows.length" class="disk-empty"><Files :size="28" /><span>没有匹配的记录</span></div></template>
          <template v-else-if="tab==='growth'"><div v-if="!baseline || compareError" class="disk-empty"><TrendingUp :size="30" /><strong>{{ compareError || (matchingSnapshots.length ? '选择一次扫描作为对比基线' : '尚无可比较的扫描记录') }}</strong><span>相同范围完成两次扫描后，可查看目录实际增加量。文件修改时间不代表净增长。</span></div><table v-else class="disk-table"><colgroup><col style="width:52%" /><col /><col /><col /></colgroup><thead><tr><th>同范围目录</th><th class="disk-number">基线体积</th><th class="disk-number">本次体积</th><th class="disk-number">变化</th></tr></thead><tbody><tr v-for="row in growth" :key="row.path"><td><code class="disk-ellipsis" :title="row.path">{{ row.path }}</code><small v-if="row.partial">包含未读取条目，变化仅供参考</small></td><td class="disk-number">{{ diskBytes(row.before) }}</td><td class="disk-number">{{ diskBytes(row.after) }}</td><td :class="['disk-number',row.delta>0?'disk-increase':row.delta<0?'disk-decrease':'']">{{ signed(row.delta) }}</td></tr></tbody></table></template>
          <template v-else><div v-if="!state.operations.length" class="disk-empty"><History :size="30" /><strong>暂无整理记录</strong><span>执行清理或归档后，在这里查看逐项结果和归档恢复入口。</span></div><article v-for="record in state.operations" :key="record.id" class="disk-operation"><header><span :class="['disk-operation-icon',{archive:record.action==='archive'}]"><Archive v-if="record.action==='archive'" :size="18" /><RefreshCw v-else-if="record.action==='restore'" :size="18" /><Trash2 v-else :size="18" /></span><div><strong>{{ record.action==='clean'?'缓存清理':record.action==='archive'?'文件归档':'归档恢复' }}<span :class="['disk-chip',record.status==='interrupted'?'amber':'muted']">{{ record.status==='running'?'处理中':record.status==='interrupted'?'处理中断':'已结束' }}</span></strong><small>{{ date(record.createdAt) }} · 成功 {{ record.items.filter(item=>item.success).length }}/{{ record.items.length }} 项</small></div><span class="disk-spacer" /><span v-if="record.freeBefore!==null && record.freeAfter!==null" class="disk-operation-change">可用空间变化 <strong>{{ signed(record.freeAfter-record.freeBefore) }}</strong></span><el-button v-if="native && record.action==='archive' && record.items.some(item=>item.hash && !item.restoredAt)" :disabled="locked || scanning" @click="restore(record.id)">恢复归档</el-button></header><div v-for="(item,index) in record.items" :key="index" class="disk-operation-item"><span :class="['disk-result-dot',{success:item.success}]" /><div><code>{{ item.path }}</code><small>{{ item.message }}<span v-if="item.restoredAt"> · 已于 {{ date(item.restoredAt) }} 恢复</span></small><button v-if="item.recoveryPath" class="disk-text-button" @click="reveal(item.recoveryPath)">查看处理中断的恢复位置</button><button v-if="item.archivedPath" class="disk-text-button" @click="reveal(item.archivedPath)">定位归档文件</button></div><span>{{ diskBytes(item.bytes) }}</span></div></article></template>
        </div>
        <footer v-if="tab==='candidates'" class="disk-selection-bar disk-bulk-bar">
          <div class="disk-bulk-selection">
            <el-checkbox :model-value="allSelected" :indeterminate="partiallySelected" :disabled="!canOperate || !selectableRows.length" @change="toggleAll">全选当前结果</el-checkbox>
            <span role="status">{{ selected.length ? `已选 ${selected.length} 项 · ${diskBytes(selectedRows.reduce((sum,row)=>sum+row.bytes,0))}` : `当前 ${candidates.length} 项，可选 ${selectableRows.length} 项` }}</span>
            <el-button v-if="selected.length" link :disabled="locked" @click="selected=[]">清空选择</el-button>
            <small>筛选变更后清空选择</small>
          </div>
          <el-button :disabled="!canOperate || !selectedArchive.length" @click="prepare('archive')"><Archive :size="15" />归档 {{ selectedArchive.length || '' }}</el-button>
          <el-button type="primary" :disabled="!canOperate || !selectedClean.length" :loading="busy" @click="prepare('clean')"><Trash2 :size="15" />检查并清理 {{ selectedClean.length || '' }}</el-button>
        </footer>
        <footer v-else-if="tab==='apps' && native" class="disk-selection-bar"><span class="disk-caption">软件本体通过系统卸载入口管理</span><span class="disk-spacer" /><el-button @click="uninstall"><ArrowUpRight :size="15" />打开已安装的应用</el-button></footer>
      </section>
      <footer class="disk-footnote"><span>{{ date(current.createdAt) }} · {{ current.source==='imported'?'报告仅供分析':'本地文件元数据' }}<span v-if="current.inaccessible"> · {{ current.inaccessible }} 项未读取</span><span v-if="current.skippedLinks"> · 跳过 {{ current.skippedLinks }} 个链接</span></span><span>逻辑体积可能包含硬链接重复计数 · 目录 Top 1000 / 大文件 Top 200</span></footer>
    </template>
    <el-dialog v-model="previewOpen" :title="preview?.action==='clean'?'整理预览 · 缓存清理':'整理预览 · 校验归档'" width="720px" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
      <template v-if="preview"><div class="disk-preview-summary"><strong>{{ preview.items.length }} 项 · {{ diskBytes(preview.bytes) }}</strong><span>执行前将再次核对文件与进程状态</span></div><div v-if="preview.action==='archive'" class="disk-notice"><Archive :size="17" /><span>归档到 <code>{{ preview.destination }}</code>，SHA-256 校验成功后移出原位置。操作记录支持恢复。</span><el-button link :disabled="busy" @click="changeArchive">更换位置</el-button></div><div v-if="sameArchiveVolume" class="disk-notice is-warning">目标位置与原文件在同一磁盘，本次归档不会增加该磁盘可用空间。</div><div class="disk-preview-items"><div v-for="item in preview.items" :key="item.id"><strong>{{ item.owner }} · {{ diskBytes(item.bytes) }}</strong><code>{{ item.path }}</code><p>{{ item.impact }}</p></div></div></template>
      <template #footer><el-button :disabled="busy" @click="previewOpen=false">返回</el-button><el-button type="primary" :loading="busy" @click="perform">{{ preview?.action==='clean'?'继续清理':'继续归档' }}</el-button></template>
    </el-dialog>
  </div>
</template>
