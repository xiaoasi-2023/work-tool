<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import { DatabaseBackup, Download, RefreshCw, RotateCcw, Upload } from 'lucide-vue-next'
import { api } from '../../api'
import { useManagement } from '../../management-store'
import type { ManagementBackupPage, ManagementBackupRecord } from '../../../shared/types'

const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ import: [] }>()
const manager = useManagement()
const history = ref<ManagementBackupPage | null>(null)
const page = ref(1), loading = ref(false), working = ref(''), error = ref('')
let requestId = 0
const sourceLabels = { manual: '手动', automatic: '自动', history: '历史' }
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function size(value: number) { return value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB` }
function message(value: unknown) { return (value instanceof Error ? value.message : '备份操作失败').replace(/^Error invoking remote method '[^']+': Error: /, '') }
async function load() {
  const id = ++requestId
  loading.value = true; error.value = ''
  try {
    const result = await api.managementBackups(page.value)
    if (id === requestId) { history.value = result; page.value = result.page }
  } catch (value) { if (id === requestId) error.value = message(value) }
  finally { if (id === requestId) loading.value = false }
}
async function changePage(value: number) { page.value = value; await load() }
async function create() {
  if (working.value || manager.busy || !manager.ready) return
  working.value = 'create'
  try { await api.managementCreateBackup(); page.value = 1; await load(); ElMessage.success('当前研发管理数据已备份') }
  catch (value) { ElMessage.error(message(value)) }
  finally { working.value = '' }
}
async function download(record: ManagementBackupRecord) {
  if (working.value || !record.valid) return
  working.value = `download:${record.id}`
  try { if (await api.managementBackupDownload(record.id)) ElMessage.success('备份文件已导出') }
  catch (value) { ElMessage.error(message(value)) }
  finally { working.value = '' }
}
async function restore(record: ManagementBackupRecord) {
  if (working.value || manager.busy || !manager.ready || !record.valid) return
  const revision = manager.state.revision
  try {
    await ElMessageBox.confirm(`将恢复到 ${time(record.createdAt)} 的数据版本 r${record.revision}。当前研发管理数据会先自动备份，再替换为所选备份；此后的修改不会保留在恢复后的数据中。`,
      '确认恢复这份备份？', { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消', closeOnClickModal: false })
  } catch { return }
  if (manager.busy || working.value) return
  working.value = `restore:${record.id}`; manager.busy = true
  try {
    manager.state = await api.managementBackupRestore(record.id, revision)
    manager.ready = true; manager.error = ''; page.value = 1
    await load()
    ElMessage.success('研发管理数据已恢复，恢复前的数据已另存备份')
  } catch (value) {
    ElMessage.error(message(value))
    try { await manager.reload() } catch {}
  } finally { working.value = ''; manager.busy = false }
}
watch(open, value => { if (value) { page.value = 1; void load() } else requestId++ })
watch(() => manager.state.revision, () => { if (open.value && !working.value) void load() })
</script>

<template>
  <el-dialog v-model="open" title="研发管理备份记录" width="1100px" :close-on-click-modal="false" :close-on-press-escape="!working" :show-close="!working" destroy-on-close>
    <div class="mg-backup-layout" :aria-busy="loading || !!working">
      <div v-if="history" class="mg-backup-storage">
        <dl><div><dt>当前存储</dt><dd>{{ history.storage === 'browser' ? '本机文件（浏览器模式）' : '本机 SQLite（安装版）' }}</dd></div><div><dt>数据文件</dt><dd>{{ history.dataFile }}</dd></div><div><dt>备份目录</dt><dd>{{ history.directory }}</dd></div></dl>
      </div>
      <div class="mg-backup-toolbar">
        <span class="muted">{{ history ? `共 ${history.total} 份备份` : '本地研发管理数据' }}</span>
        <div class="mg-actions">
          <el-button :disabled="!!working || loading || manager.busy || !manager.ready" @click="emit('import')"><Upload :size="14" />导入备份文件</el-button>
          <button class="icon-button" title="刷新备份记录" aria-label="刷新备份记录" :disabled="loading || !!working" @click="load"><RefreshCw :size="15" :class="{ 'mg-spinning': loading }" /></button>
          <el-button type="primary" :loading="working === 'create'" :disabled="!!working || loading || manager.busy || !manager.ready" @click="create"><DatabaseBackup :size="14" />立即备份</el-button>
        </div>
      </div>
      <div v-if="error" class="mg-backup-error" role="alert">{{ error }}</div>
      <div class="mg-backup-list">
        <table class="mg-table mg-backup-table">
          <thead><tr><th>备份时间 / 文件</th><th>来源 / 原因</th><th>数据版本</th><th>数据范围</th><th class="number">文件大小</th><th>操作</th></tr></thead>
          <tbody><tr v-for="record in history?.records || []" :key="record.id">
            <td><strong>{{ time(record.createdAt) }}</strong><small class="mg-backup-filename">{{ record.id }}</small></td>
            <td><span class="mg-backup-source" :class="record.source">{{ sourceLabels[record.source] }}</span><small>{{ record.reason }}</small></td>
            <td><template v-if="record.valid">r{{ record.revision }}</template><span v-else class="text-warning" :title="record.error">文件异常</span></td>
            <td><template v-if="record.counts">{{ record.counts.projects }} 项目 · {{ record.counts.requirements }} 需求<small>{{ record.counts.plans }} 条排期 · {{ record.counts.efforts }} 条投入</small></template><small v-else class="text-warning">{{ record.error }}</small></td>
            <td class="number">{{ size(record.size) }}</td>
            <td><div class="mg-actions"><button class="icon-button" title="下载这份备份" aria-label="下载这份备份" :disabled="!!working || !record.valid" @click="download(record)"><Download :size="15" /></button><button class="icon-button" title="恢复到这份备份" aria-label="恢复到这份备份" :disabled="!!working || manager.busy || !manager.ready || !record.valid" @click="restore(record)"><RotateCcw :size="15" /></button></div></td>
          </tr></tbody>
        </table>
        <div v-if="!history?.records.length" class="mg-empty"><DatabaseBackup :size="25" /><span>{{ loading ? '正在读取备份记录…' : error ? '未能加载备份记录' : '暂无备份记录' }}</span></div>
      </div>
    </div>
    <template #footer><div class="mg-backup-footer"><el-pagination v-if="history" small :current-page="page" :page-size="history.pageSize" :total="history.total" layout="total, prev, pager, next" :disabled="loading || !!working" @current-change="changePage" /><span v-else /><el-button :disabled="!!working" @click="open = false">关闭</el-button></div></template>
  </el-dialog>
</template>

<style scoped>
.mg-backup-layout { display:flex; flex-direction:column; min-width:0; gap:14px; }
.mg-backup-storage { padding-bottom:14px; border-bottom:1px solid var(--line); }
.mg-backup-storage dl { display:grid; gap:8px; margin:0; font-size:12px; }
.mg-backup-storage dl > div { display:grid; grid-template-columns:72px minmax(0,1fr); gap:12px; }
.mg-backup-storage dt { color:var(--muted); }.mg-backup-storage dd { margin:0; overflow-wrap:anywhere; color:var(--text); }
.mg-backup-toolbar,.mg-backup-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.mg-backup-toolbar .el-button { height:31px; font-size:12px; }.mg-backup-error { color:var(--el-color-danger); font-size:12px; overflow-wrap:anywhere; }
.mg-backup-list { height:min(46vh,440px); min-height:200px; overflow:auto; overscroll-behavior:contain; border-top:1px solid var(--line); }
.mg-backup-table { min-width:860px; }.mg-backup-table td,.mg-backup-table th { padding:11px 12px; vertical-align:middle; }.mg-backup-table td:first-child { width:31%; }.mg-backup-table strong { font-size:12px; font-weight:500; }.mg-backup-filename { max-width:290px; font-size:10px; line-height:1.6; }
.mg-backup-source { display:inline-block; color:var(--muted); font-size:11px; }.mg-backup-source.manual { color:var(--accent); }.mg-backup-source.automatic { color:var(--green); }.mg-backup-table .icon-button { width:28px; height:28px; }
@media(max-width:600px) { .mg-backup-toolbar > .mg-actions { flex-wrap:wrap; }.mg-backup-storage dl > div { grid-template-columns:60px minmax(0,1fr); gap:8px; }.mg-backup-footer { align-items:flex-end; } }
</style>
