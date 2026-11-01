<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, RefreshCw, FolderGit2, GitBranch, Trash2, Search, ShieldCheck, CircleDot, GitMerge, ArrowRightLeft, Folder, CloudDownload } from 'lucide-vue-next'
import { useApp } from '../store'
import { api } from '../api'
import type { Branch, DeleteResult, Project, RepoDetail } from '../../shared/types'

const app = useApp()
let initialized = false
const project = ref<Project | null>(null)
const detail = ref<RepoDetail | null>(null)
const busy = ref(false)
const failure = ref('')
const keyword = ref('')
const scope = ref('all')
const mergedOnly = ref(false)
const selected = ref<Branch[]>([])
const confirmation = ref(false)
const force = ref(false)
const confirmText = ref('')
const deleting = ref(false)
const results = ref<DeleteResult[]>([])
const resultVisible = ref(false)
const table = ref()
const projectQuery = ref('')
const projectList = computed(() => (app.state?.projects || []).filter(p => `${p.name} ${p.path}`.toLowerCase().includes(projectQuery.value.toLowerCase())))
const candidates = computed(() => detail.value?.branches.filter(b => b.merged && !b.protected && !b.current && !b.occupied).length || 0)
const visible = computed(() => (detail.value?.branches || []).filter(b => (scope.value === 'all' || b.kind === scope.value) && (!mergedOnly.value || (b.merged && !b.protected && !b.current && !b.occupied)) && `${b.name} ${b.subject} ${b.author}`.toLowerCase().includes(keyword.value.toLowerCase())))
const needsForce = computed(() => selected.value.some(b => !b.merged))
const hasRemote = computed(() => selected.value.some(b => b.kind === 'remote'))
const canDelete = computed(() => selected.value.length > 0 && (!needsForce.value || force.value) && (!(hasRemote.value || force.value) || confirmText.value === project.value?.name))
function error(e: unknown) { return (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '') }
async function refresh(base?: string) {
  if (!project.value) return
  busy.value = true; failure.value = ''; selected.value = []
  try { detail.value = await api.inspect(project.value.id, base || detail.value?.baseRef) } catch (e) { failure.value = error(e); detail.value = null } finally { busy.value = false }
}
async function open(p: Project) { app.activeProjectId = p.id; project.value = p; detail.value = null; keyword.value = ''; scope.value = 'all'; mergedOnly.value = false; await refresh() }
function overview() { project.value = null; detail.value = null; failure.value = ''; app.activeProjectId = null }
function pickProject(id: string) { const p = app.state?.projects.find(p => p.id === id); if (p) open(p); else overview() }
async function add() {
  busy.value = true
  try { const p = await api.addProject(); await app.reload(); if (p) { busy.value = false; await open(p) } } catch (e) { ElMessage.error(error(e)) } finally { busy.value = false }
}
async function remove(p: Project) {
  try { await ElMessageBox.confirm(`从工具箱移除「${p.name}」？项目文件与 Git 仓库将保留。`, '移除项目', { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }); await api.removeProject(p.id); await app.reload(); if (project.value?.id === p.id) overview() } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(error(e)) }
}
async function fetchRemote() {
  if (!project.value) return
  busy.value = true
  try { await api.fetch(project.value.id); ElMessage.success('远程信息已更新，失效引用已清理') } catch (e) { ElMessage.error(error(e)) } finally { busy.value = false; await refresh(); await app.reload() }
}
async function checkout(b: Branch) {
  if (!project.value) return
  try {
    await ElMessageBox.confirm(`切换到本地分支「${b.name}」？`, '切换分支', { confirmButtonText: '切换', cancelButtonText: '取消' })
    busy.value = true; await api.checkout(project.value.id, b.ref); ElMessage.success('已切换分支')
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(error(e)) } finally { busy.value = false; await refresh(); await app.reload() }
}
function selectable(b: Branch) { return !busy.value && !b.protected && !b.current && !b.occupied }
function prepareDelete() { force.value = false; confirmText.value = ''; confirmation.value = true }
async function executeDelete() {
  if (!canDelete.value || !project.value || !detail.value) return
  deleting.value = true
  try {
    results.value = await api.deleteBranches({ projectId: project.value.id, refs: selected.value.map(b => b.ref), baseRef: detail.value.baseRef, force: force.value, expected: Object.fromEntries(selected.value.map(b => [b.ref, b.hash])) })
    confirmation.value = false; resultVisible.value = true; await refresh(); await app.reload()
  } catch (e) { ElMessage.error(error(e)) } finally { deleting.value = false }
}
function clearSelection() { table.value?.clearSelection(); selected.value = [] }
onMounted(async () => { await app.reload(); const initial = app.state?.projects.find(p => p.id === app.activeProjectId) || app.state?.projects[0]; if (initial) await open(initial); initialized = true })
onActivated(() => { if (initialized && app.activeProjectId && app.activeProjectId !== project.value?.id) pickProject(app.activeProjectId) })
</script>

<template>
  <div class="git-tool">
    <header class="git-heading">
      <div class="git-title"><GitBranch :size="20" /><h1>Git 工作台</h1><span class="heading-divider" /><span class="muted">{{ app.state?.projects.length || 0 }} 个项目</span></div>
      <div class="button-row"><el-button v-if="project" :disabled="busy" title="刷新仓库" aria-label="刷新仓库" class="refresh-button" @click="refresh()"><RefreshCw :size="15" /></el-button><el-button v-if="project" :loading="busy" @click="fetchRemote"><CloudDownload :size="15" />同步远程</el-button><el-button type="primary" :loading="!project && busy" :disabled="busy" @click="add"><Plus :size="16" />添加项目</el-button></div>
    </header>
    <div :class="['git-workspace', { 'has-projects': app.state?.projects.length }]">
      <aside v-if="app.state?.projects.length" class="project-rail" aria-label="项目列表">
        <div class="project-rail-head"><div class="section-heading"><h2>项目资源库<span>{{ app.state.projects.length }}</span></h2><button class="icon-button" title="添加项目" :disabled="busy" @click="add"><Plus :size="16" /></button></div><label class="search-box project-search"><Search :size="14" /><input v-model="projectQuery" aria-label="查找项目" placeholder="查找项目" /></label></div>
        <button :class="['project-overview-button', { active: !project }]" :disabled="busy" @click="overview"><Folder :size="15" />全部项目<span>{{ app.state.projects.length }}</span></button>
        <div class="project-rail-list" tabindex="0" aria-label="项目列表滚动区域">
          <div v-for="p in projectList" :key="p.id" :class="['project-rail-row', { active: project?.id === p.id }]"><button :disabled="busy" class="rail-project-name" :title="`${p.name}\n${p.path}`" @click="open(p)"><FolderGit2 :size="17" /><span><strong>{{ p.name }}</strong><small>{{ p.path }}</small></span></button><button class="icon-button danger-hover" :disabled="busy" :title="`移除项目 ${p.name}`" @click="remove(p)"><Trash2 :size="14" /></button></div>
          <p v-if="!projectList.length" class="rail-empty">没有匹配的项目</p>
        </div>
        <div class="project-rail-footer"><span class="local-dot" />本地工作空间<span>{{ app.state.projects.length }} 个仓库</span></div>
      </aside>
      <div class="repository-content">
      <div v-if="app.state?.projects.length" class="project-switcher"><el-select :model-value="project?.id || ''" aria-label="选择项目" :disabled="busy" @change="pickProject"><el-option value="" label="全部项目" /><el-option v-for="p in app.state.projects" :key="p.id" :value="p.id" :label="p.name" /></el-select></div>
    <template v-if="!project">
      <div v-if="!app.state?.projects.length" class="empty-project"><div class="empty-icon"><FolderGit2 :size="36" :stroke-width="1.3" /></div><h2>添加你的第一个项目</h2><p>选择本机 Git 仓库文件夹</p><el-button type="primary" :loading="busy" @click="add"><Plus :size="16" />添加项目</el-button><span v-if="!app.state?.desktop" class="preview-note">本地项目功能需使用桌面程序</span></div>
      <div v-else class="project-list"><div class="list-head"><span>项目</span><span>添加时间</span><span>操作</span></div><div v-for="p in app.state?.projects" :key="p.id" class="project-row"><button class="project-name" @click="open(p)"><span class="project-folder"><FolderGit2 :size="22" /></span><span><strong>{{ p.name }}</strong><small>{{ p.path }}</small></span></button><span class="muted">{{ new Date(p.addedAt).toLocaleDateString('zh-CN') }}</span><div class="button-row"><el-button @click="open(p)">查看分支</el-button><button class="icon-button danger-hover" :title="`移除项目 ${p.name}`" @click="remove(p)"><Trash2 :size="16" /></button></div></div></div>
    </template>
    <template v-else>
      <div class="repository-heading"><span class="repository-icon"><FolderGit2 :size="22" /></span><div><h2 :title="project.name">{{ project.name }}</h2><p class="project-path" :title="project.path">{{ project.path }}</p></div><span v-if="detail" class="repo-connection"><span class="local-dot" />{{ detail.remotes.length ? `${detail.remotes.length} 个远程连接` : '本地仓库' }}</span></div>
      <div v-if="failure" class="error-box"><strong>无法读取仓库</strong><p>{{ failure }}</p><el-button @click="refresh()">重试</el-button></div>
      <div v-else-if="!detail" class="empty-inline">正在读取仓库…</div>
      <template v-else>
        <div class="repo-overview"><div class="current-branch"><GitBranch :size="15" /><span>当前分支</span><strong :title="detail.current">{{ detail.current }}</strong></div><div><CircleDot :size="14" /><strong :class="detail.dirty ? 'text-warning' : 'text-green'">{{ detail.dirty ? `${detail.dirty} 项未提交` : '工作区干净' }}</strong></div><div class="cleanup-stat"><GitMerge :size="15" /><strong>{{ candidates }}</strong><span>个可清理分支</span></div></div>
        <div class="branch-topline"><div class="tabs"><button v-for="tab in [{id:'all',name:'全部分支'}, {id:'local',name:'本地'}, {id:'remote',name:'远程'}]" :key="tab.id" :class="{selected:scope === tab.id}" :disabled="busy" @click="scope = tab.id; clearSelection()">{{ tab.name }}<span>{{ detail.branches.filter(b => tab.id === 'all' || b.kind === tab.id).length }}</span></button></div><div class="base-picker"><span>比较基准</span><el-select :model-value="detail.baseRef" :disabled="busy" aria-label="比较基准" filterable @change="refresh"><el-option v-for="b in detail.branches" :key="b.ref" :value="b.ref" :label="b.name" /></el-select></div></div>
        <div class="branch-toolbar"><label class="search-box"><Search :size="16" /><input v-model="keyword" aria-label="搜索分支" placeholder="搜索分支、提交或作者…" :disabled="busy" @input="clearSelection" /></label><el-checkbox v-model="mergedOnly" :disabled="busy" @change="clearSelection">仅可清理</el-checkbox><span class="toolbar-spacer" /><span class="muted selected-count">已选 {{ selected.length }} 项</span><el-button type="danger" plain :disabled="!selected.length || busy" @click="prepareDelete"><Trash2 :size="15" />删除分支</el-button></div>
        <div class="branch-table-viewport">
          <el-table ref="table" v-loading="busy" :data="visible" height="100%" row-key="ref" class="branch-table" empty-text="没有匹配的分支" @selection-change="selected = $event">
            <el-table-column type="selection" :selectable="selectable" width="44" />
            <el-table-column label="分支名称" min-width="300"><template #default="{row}"><div class="branch-name"><GitBranch :size="14" /><strong :title="row.name">{{ row.name }}</strong></div><div class="branch-meta"><span>{{ row.kind === 'local' ? '本地' : '远程' }}</span><span v-if="row.current" class="status-badge green">当前分支</span><span v-if="row.protected" class="status-badge"><ShieldCheck :size="11" />保护</span><span v-if="row.occupied && !row.current" class="status-badge amber">工作区占用</span></div></template></el-table-column>
            <el-table-column label="合并状态" width="136"><template #default="{row}"><span :class="['merge-status', row.merged ? 'text-green' : 'text-warning']"><component :is="row.merged ? GitMerge : CircleDot" :size="14" />{{ row.merged ? '已合并' : `${row.ahead} 个独有提交` }}</span></template></el-table-column>
            <el-table-column label="最后提交" min-width="240"><template #default="{row}"><div class="commit-subject" :title="row.subject">{{ row.subject }}</div><div class="branch-meta"><code>{{ row.hash.slice(0,7) }}</code><span>{{ row.author }}</span></div></template></el-table-column>
            <el-table-column label="更新时间" width="110"><template #default="{row}"><span class="date-text" :title="row.date">{{ new Date(row.date).toLocaleDateString('zh-CN') }}</span></template></el-table-column>
            <el-table-column label="操作" width="60" align="center" fixed="right"><template #default="{row}"><button v-if="row.kind === 'local' && !row.current" class="icon-button" :disabled="busy || detail.dirty > 0 || row.occupied" :title="detail.dirty ? '存在未提交修改' : row.occupied ? '被工作区占用' : `切换到 ${row.name}`" @click="checkout(row)"><ArrowRightLeft :size="15" /></button><span v-else class="muted">·</span></template></el-table-column>
          </el-table>
        </div>
        <div class="table-footer"><span>共 {{ visible.length }} 个分支</span><span><ShieldCheck :size="13" />当前、保护及工作区占用分支已锁定</span></div>
      </template>
    </template>
      </div>
    </div>
    <el-dialog v-model="confirmation" title="确认删除分支" width="640px" :close-on-click-modal="false" :close-on-press-escape="!deleting" :show-close="!deleting" :before-close="(done: () => void) => { if (!deleting) done() }">
      <p class="dialog-intro">项目 <strong>{{ project?.name }}</strong> · 共 {{ selected.length }} 个分支 · 基准 {{ detail?.baseRef.replace(/^refs\/(heads|remotes)\//, '') }}</p>
      <div class="delete-preview"><div v-for="b in selected" :key="b.ref"><span class="status-badge">{{ b.kind === 'local' ? '本地' : '远程' }}</span><strong>{{ b.name }}</strong><span :class="b.merged ? 'text-green' : 'text-warning'">{{ b.merged ? '已合并' : `${b.ahead} 个独有提交` }}</span></div></div>
      <el-alert v-if="hasRemote" title="远程分支将从服务器删除，可能影响其他协作者。" type="warning" :closable="false" show-icon />
      <el-checkbox v-if="needsForce" v-model="force" :disabled="deleting" class="force-checkbox">强制删除未合并分支，接受独有提交丢失的风险</el-checkbox>
      <div v-if="hasRemote || force" class="confirm-field"><label for="confirm-project">输入项目名「{{ project?.name }}」确认</label><el-input id="confirm-project" v-model="confirmText" :disabled="deleting" autocomplete="off" /></div>
      <template #footer><el-button :disabled="deleting" @click="confirmation = false">取消</el-button><el-button type="danger" :disabled="!canDelete" :loading="deleting" @click="executeDelete">删除 {{ selected.length }} 个分支</el-button></template>
    </el-dialog>
    <el-dialog v-model="resultVisible" title="删除结果" width="680px"><div class="result-summary">成功 {{ results.filter(r => r.success).length }} 项，失败 {{ results.filter(r => !r.success).length }} 项</div><div v-for="result in results" :key="result.ref" class="result-row"><el-tag :type="result.success ? 'success' : 'danger'">{{ result.success ? '成功' : '失败' }}</el-tag><div><strong>{{ result.ref.replace(/^refs\/(heads|remotes)\//, '') }}</strong><p>{{ result.message }}</p></div></div><template #footer><el-button type="primary" @click="resultVisible = false">完成</el-button></template></el-dialog>
  </div>
</template>
