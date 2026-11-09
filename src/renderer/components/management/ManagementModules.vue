<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElButton, ElDialog, ElMessage, ElMessageBox } from 'element-plus'
import { AlertTriangle, ArrowUpRight, Check, ClipboardList, Layers3, Pencil, Plus, Search, Trash2 } from 'lucide-vue-next'
import { useManagement } from '../../management-store'
import { getProjectModules, getRequirementPhase, requirementPhaseLabels, type ManagementCommand, type ManagementRequirement } from '../../../shared/management'

const props = defineProps<{ modelValue: boolean; projectId: string; initialModule?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; 'open-requirement': [id: string] }>()
const manager = useManagement()
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const project = computed(() => manager.state.projects.find(item => item.id === props.projectId))
const projectRequirements = computed(() => manager.state.requirements.filter(item => item.projectId === props.projectId))
const modules = computed(() => getProjectModules(manager.state, props.projectId))
const query = ref(''), selectedName = ref('')
const visibleModules = computed(() => modules.value.filter(item => item.name.toLowerCase().includes(query.value.trim().toLowerCase())))
const linkedCount = computed(() => modules.value.reduce((count, module) => count + module.requirementIds.length, 0))
const unassignedCount = computed(() => projectRequirements.value.length - linkedCount.value)
const selectedRequirements = computed(() => projectRequirements.value.filter(item => selectedName.value ? item.module === selectedName.value : !project.value?.modules.includes(item.module)))
const editDialog = ref(false), editFormElement = ref<HTMLFormElement>(), moduleNameInput = ref<HTMLInputElement>()
const editForm = ref({ originalName: '', name: '' })
const nameError = computed(() => {
  const name = editForm.value.name.trim()
  return name && name !== editForm.value.originalName && modules.value.some(item => item.name === name) ? '模块名称已存在' : ''
})
const deleteDialog = ref(false), confirming = ref(false)
const deleteForm = ref({ name: '', requirements: [] as { id: string; code: string; title: string; versionId: string }[], target: null as string | null })
const transferOptions = computed(() => project.value?.modules.filter(name => name !== deleteForm.value.name) || [])
const busy = computed(() => manager.busy || confirming.value)

function versionName(id: string) { return manager.state.versions.find(item => item.id === id)?.name || '待定版本' }
function phaseLabel(requirement: ManagementRequirement) {
  return requirement.status === 'paused' ? '已暂停' : requirement.status === 'cancelled' ? '已取消' : requirementPhaseLabels[getRequirementPhase(manager.state, requirement.id)]
}
function openRequirement(id: string) { visible.value = false; emit('open-requirement', id) }
function openEdit(name = '') { editForm.value = { originalName: name, name }; editDialog.value = true }
async function focusName() { await nextTick(); moduleNameInput.value?.focus(); moduleNameInput.value?.select() }
async function saveModule() {
  if (busy.value || !project.value || !editFormElement.value?.reportValidity() || nameError.value) return
  const name = editForm.value.name.trim(), originalName = editForm.value.originalName
  if (!name) { ElMessage.warning('请填写模块名称'); return }
  if (name === originalName) { editDialog.value = false; return }
  const command: ManagementCommand = originalName
    ? { type: 'project-module', projectId: project.value.id, action: 'rename', name: originalName, newName: name, reason: `将模块「${originalName}」重命名为「${name}」，同步需求归属` }
    : { type: 'project-module', projectId: project.value.id, action: 'create', name, reason: `新增项目模块「${name}」` }
  if (await manager.execute(command)) { selectedName.value = name; query.value = ''; editDialog.value = false; ElMessage.success(originalName ? '模块及需求归属已更新' : '模块已添加') }
}
function openDelete(name: string) {
  deleteForm.value = { name, requirements: projectRequirements.value.filter(item => item.module === name).map(item => ({ id: item.id, code: item.code, title: item.title, versionId: item.versionId })), target: null }
  deleteDialog.value = true
}
async function deleteModule() {
  if (!project.value || busy.value) return
  const draft = { ...deleteForm.value, requirements: [...deleteForm.value.requirements] }
  if (draft.requirements.length && draft.target === null) return
  const projectId = project.value.id, target = draft.target || ''
  const destination = target ? `转移至「${target}」` : '改为未关联模块'
  confirming.value = true
  try {
    if (draft.requirements.length) await ElMessageBox.confirm(
      `模块「${draft.name}」关联 ${draft.requirements.length} 条需求。确认将这些需求${destination}，并删除该模块？需求、任务和工时记录均保留。`,
      '再次确认删除模块',
      { type: 'warning', confirmButtonText: '确认转移并删除', cancelButtonText: '返回检查', closeOnClickModal: false, closeOnPressEscape: false, autofocus: false }
    )
    const success = await manager.execute({ type: 'project-module', projectId, action: 'delete', name: draft.name, targetModule: target,
      confirmedRequirementIds: draft.requirements.map(item => item.id), reason: `删除模块「${draft.name}」；${draft.requirements.length ? `${draft.requirements.length}条需求${destination}` : '模块下无关联需求'}` })
    if (success) { selectedName.value = draft.requirements.length ? target : modules.value[0]?.name || ''; deleteDialog.value = false; ElMessage.success('模块已删除，需求记录已保留') }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error((error as Error).message)
  } finally { confirming.value = false }
}
watch([() => props.modelValue, () => props.projectId, () => props.initialModule], ([open]) => {
  if (open) { query.value = ''; selectedName.value = props.initialModule ?? modules.value[0]?.name ?? '' }
  else { editDialog.value = false; deleteDialog.value = false }
}, { immediate: true })
watch(modules, items => { if (selectedName.value && !items.some(item => item.name === selectedName.value)) selectedName.value = items[0]?.name || '' })
</script>

<template>
  <el-dialog v-model="visible" title="项目模块" width="min(1080px, calc(100vw - 24px))" top="5vh" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" destroy-on-close append-to-body>
    <template #header="{ titleId }"><div class="module-heading"><Layers3 :size="20" /><div><h2 :id="titleId">项目模块</h2><p>{{ project?.name }}</p></div></div></template>
    <div class="module-workspace">
      <div class="module-totals"><span>项目模块<strong>{{ project?.modules.length || 0 }}</strong></span><span>已关联需求<strong>{{ linkedCount }}</strong></span><span>未关联需求<strong>{{ unassignedCount }}</strong></span></div>
      <div class="module-layout">
        <section class="module-directory" aria-label="项目模块管理">
          <div class="module-toolbar"><label class="module-search"><Search :size="14" /><input v-model="query" aria-label="搜索模块" placeholder="搜索模块" /></label><el-button type="primary" :disabled="busy || !project || project.modules.length >= 1000" @click="openEdit()"><Plus :size="14" />新增模块</el-button></div>
          <div class="module-list-scroll" tabindex="0" aria-label="模块列表">
            <table class="module-table"><colgroup><col /><col class="module-count-column" /><col class="module-count-column" /><col class="module-action-column" /></colgroup>
              <thead><tr><th scope="col">模块名称</th><th scope="col" class="number">需求</th><th scope="col" class="number">进行中</th><th scope="col" class="module-actions-heading">操作</th></tr></thead>
              <tbody><tr v-for="module in visibleModules" :key="module.name" :class="{ selected: module.name === selectedName }" tabindex="0" :aria-selected="module.name === selectedName" @click="selectedName = module.name" @keydown.enter.self="selectedName = module.name">
                <td><strong>{{ module.name }}</strong></td><td class="number">{{ module.requirementIds.length }}</td><td class="number"><span :class="{ 'module-active-count': module.activeCount }">{{ module.activeCount }}</span></td>
                <td><div class="module-row-actions"><button type="button" class="icon-button" :title="`重命名${module.name}`" :aria-label="`重命名${module.name}`" :disabled="busy" @click.stop="openEdit(module.name)"><Pencil :size="14" /></button><button type="button" class="icon-button module-delete-button" :title="`删除${module.name}`" :aria-label="`删除${module.name}`" :disabled="busy" @click.stop="openDelete(module.name)"><Trash2 :size="14" /></button></div></td>
              </tr></tbody>
            </table>
            <div v-if="!visibleModules.length" class="module-empty"><Layers3 :size="24" /><span>{{ query ? '没有匹配的模块' : '暂无项目模块' }}</span><el-button v-if="!query" :disabled="busy || !project" @click="openEdit()"><Plus :size="14" />新增模块</el-button></div>
          </div>
          <button type="button" class="module-unassigned" :class="{ selected: selectedName === '' }" @click="selectedName = ''"><span>未关联模块的需求</span><strong>{{ unassignedCount }}</strong></button>
        </section>
        <section class="module-requirements" aria-label="模块关联需求">
          <header><div><h3>{{ selectedName || '未关联模块' }}</h3></div><span>{{ selectedRequirements.length }} 条需求</span></header>
          <div class="module-requirements-scroll" tabindex="0" aria-label="关联需求列表">
            <button v-for="requirement in selectedRequirements" :key="requirement.id" type="button" class="module-requirement" @click="openRequirement(requirement.id)"><span><strong>{{ requirement.title }}</strong><small>{{ requirement.code }} · {{ versionName(requirement.versionId) }}</small></span><span class="module-requirement-phase">{{ phaseLabel(requirement) }}</span><ArrowUpRight :size="14" /></button>
            <div v-if="!selectedRequirements.length" class="module-empty"><ClipboardList :size="25" /><span>暂无关联需求</span></div>
          </div>
        </section>
      </div>
    </div>
  </el-dialog>
  <el-dialog v-model="editDialog" :title="editForm.originalName ? '重命名模块' : '新增模块'" width="min(480px, calc(100vw - 24px))" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" append-to-body destroy-on-close @opened="focusName">
    <form ref="editFormElement" class="module-edit-form" @submit.prevent="saveModule"><label><span>模块名称 <b>*</b></span><input ref="moduleNameInput" v-model="editForm.name" required maxlength="500" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'module-name-error' : undefined" /></label><p v-if="nameError" id="module-name-error" class="module-field-error" role="alert">{{ nameError }}</p><p v-if="editForm.originalName" class="module-edit-impact">关联需求 <strong>{{ modules.find(item => item.name === editForm.originalName)?.requirementIds.length || 0 }}</strong> 条</p></form>
    <template #footer><el-button :disabled="busy" @click="editDialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" :disabled="busy || !!nameError || !editForm.name.trim()" @click="saveModule"><Check :size="14" />保存</el-button></template>
  </el-dialog>
  <el-dialog v-model="deleteDialog" title="删除项目模块" width="min(580px, calc(100vw - 24px))" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" append-to-body destroy-on-close>
    <div class="module-delete-summary"><AlertTriangle :size="20" /><div><strong>{{ deleteForm.name }}</strong><p>{{ project?.name }} · {{ deleteForm.requirements.length }} 条关联需求</p></div></div>
    <template v-if="deleteForm.requirements.length">
      <div class="module-delete-requirements" tabindex="0" aria-label="将要转移的需求"><div v-for="requirement in deleteForm.requirements" :key="requirement.id"><strong>{{ requirement.title }}</strong><small>{{ requirement.code }} · {{ versionName(requirement.versionId) }}</small></div></div>
      <label class="module-transfer"><span>关联需求转移至 <b>*</b></span><select v-model="deleteForm.target" :disabled="busy"><option :value="null" disabled>选择需求去向</option><option value="">未关联模块</option><option v-for="module in transferOptions" :key="module" :value="module">{{ module }}</option></select></label>
      <p class="module-delete-impact">仅删除模块，关联需求、任务、周排期和工时记录保留。</p>
    </template>
    <p v-else class="module-delete-impact">该模块下暂无关联需求，确认删除此模块？</p>
    <template #footer><el-button :disabled="busy" @click="deleteDialog = false">保留模块</el-button><el-button type="danger" :loading="busy" :disabled="busy || (deleteForm.requirements.length > 0 && deleteForm.target === null)" @click="deleteModule"><Trash2 :size="14" />{{ deleteForm.requirements.length ? '继续确认' : '删除模块' }}</el-button></template>
  </el-dialog>
</template>

<style scoped>
.module-heading { display:flex; align-items:center; gap:11px; min-width:0; padding-right:20px; color:var(--accent); }
.module-heading > div { min-width:0; }.module-heading h2 { margin:0; color:var(--text); font-size:16px; font-weight:600; line-height:1.5; }.module-heading p { margin:3px 0 0; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
.module-workspace { display:flex; flex-direction:column; height:min(68vh,640px); min-height:300px; overflow:hidden; border-top:1px solid var(--line); }
.module-totals { display:flex; flex-wrap:wrap; gap:12px 28px; align-items:center; padding:12px 16px; background:var(--bg); border-bottom:1px solid var(--line); }
.module-totals > span { display:flex; align-items:baseline; gap:9px; font-size:11px; color:var(--muted); }.module-totals strong { color:var(--text); font-size:16px; font-weight:600; font-variant-numeric:tabular-nums; }
.module-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); min-height:0; flex:1; }
.module-directory { display:flex; flex-direction:column; min-height:0; min-width:0; border-right:1px solid var(--line); }
.module-toolbar { display:flex; align-items:center; gap:10px; padding:12px; border-bottom:1px solid var(--line); flex-shrink:0; }
.module-search { display:flex; align-items:center; gap:7px; min-width:0; flex:1; height:32px; padding:0 9px; border:1px solid var(--line); border-radius:4px; color:var(--muted); }
.module-search > svg { flex-shrink:0; }.module-search input { width:100%; min-width:0; border:0; outline:0; color:var(--text); background:none; font-size:12px; }.module-search:focus-within { border-color:var(--accent); }
.module-toolbar .el-button { height:32px; font-size:12px; flex-shrink:0; }
.module-list-scroll { min-height:0; flex:1; overflow:auto; overscroll-behavior:contain; }
.module-table { width:100%; min-width:350px; border-collapse:collapse; table-layout:fixed; font-size:12px; text-align:left; }
.module-count-column { width:50px; }.module-action-column { width:80px; }.module-table th { position:sticky; top:0; z-index:1; background:var(--bg); color:var(--muted); font-size:10px; font-weight:500; white-space:nowrap; }
.module-table th,.module-table td { padding:11px 10px; border-bottom:1px solid var(--line); }.module-table td:first-child { padding-left:13px; }.module-table td > strong { display:block; color:var(--text); font-weight:500; line-height:1.6; overflow-wrap:anywhere; }
.module-table tbody tr { cursor:pointer; }.module-table tbody tr:hover { background:var(--hover); }.module-table tbody tr.selected { background:var(--accent-soft); }.module-table tbody tr:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.number { text-align:right; font-variant-numeric:tabular-nums; }.module-active-count { color:var(--accent); font-weight:500; }
.module-actions-heading { text-align:right; }.module-row-actions { display:flex; justify-content:flex-end; gap:1px; }.module-row-actions .icon-button { width:27px; height:27px; flex-shrink:0; }.module-delete-button:hover:not(:disabled) { color:var(--el-color-danger); background:var(--el-color-danger-light-9); }
.module-unassigned { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-shrink:0; width:100%; min-height:44px; padding:10px 14px; border:0; border-top:1px solid var(--line); background:var(--bg); color:var(--muted); font-size:11px; text-align:left; }.module-unassigned strong { font-weight:500; font-variant-numeric:tabular-nums; }.module-unassigned.selected { color:var(--accent); background:var(--accent-soft); }
.module-requirements { display:flex; flex-direction:column; min-width:0; min-height:0; }.module-requirements > header { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:57px; padding:12px 15px; border-bottom:1px solid var(--line); }
.module-requirements header > div { min-width:0; }.module-requirements h3 { margin:0; color:var(--text); font-size:13px; font-weight:600; overflow-wrap:anywhere; }.module-requirements header > span { font-size:11px; color:var(--muted); white-space:nowrap; }
.module-requirements-scroll { min-height:0; flex:1; overflow:auto; overscroll-behavior:contain; }
.module-requirement { display:flex; align-items:flex-start; gap:12px; width:100%; padding:14px 15px; text-align:left; border:0; border-bottom:1px solid var(--line); background:none; color:var(--text); }
.module-requirement:hover { background:var(--hover); }.module-requirement > span:first-child { flex:1; min-width:0; }.module-requirement strong { display:block; font-size:12px; line-height:1.7; font-weight:500; overflow-wrap:anywhere; }.module-requirement small { display:block; margin-top:5px; color:var(--muted); font-size:10px; line-height:1.6; overflow-wrap:anywhere; }
.module-requirement-phase { margin-top:2px; color:var(--muted); font-size:10px; white-space:nowrap; }.module-requirement > svg { margin-top:3px; flex-shrink:0; color:var(--subtle); }
.module-empty { display:flex; flex-direction:column; justify-content:center; align-items:center; gap:13px; min-height:160px; padding:24px 15px; color:var(--muted); font-size:12px; }
.module-edit-form label,.module-transfer { display:flex; flex-direction:column; gap:8px; font-size:12px; color:var(--muted); }.module-edit-form b,.module-transfer b { color:var(--el-color-danger); font-weight:400; }
.module-edit-form input,.module-transfer select { width:100%; min-width:0; height:36px; border:1px solid var(--line); border-radius:4px; padding:6px 10px; background:var(--surface); color:var(--text); outline:0; font-size:13px; }.module-edit-form input:focus,.module-transfer select:focus { border-color:var(--accent); }.module-edit-form input[aria-invalid="true"] { border-color:var(--el-color-danger); }
.module-field-error { margin:7px 0 0; color:var(--el-color-danger); font-size:11px; }.module-edit-impact { margin:16px 0 0; color:var(--muted); font-size:12px; }.module-edit-impact strong { margin-inline:5px; color:var(--text); font-weight:500; }
.module-delete-summary { display:flex; align-items:flex-start; gap:11px; padding-bottom:15px; }.module-delete-summary > svg { flex-shrink:0; color:var(--el-color-warning); }.module-delete-summary > div { min-width:0; }.module-delete-summary strong { font-size:14px; font-weight:600; color:var(--text); overflow-wrap:anywhere; }.module-delete-summary p { margin:5px 0 0; font-size:11px; color:var(--muted); overflow-wrap:anywhere; }
.module-delete-requirements { max-height:min(30vh,240px); overflow:auto; overscroll-behavior:contain; border-block:1px solid var(--line); margin-bottom:18px; }.module-delete-requirements > div { padding:10px 0; border-bottom:1px solid var(--line); }.module-delete-requirements > div:last-child { border-bottom:0; }.module-delete-requirements strong { display:block; font-weight:500; font-size:12px; color:var(--text); line-height:1.6; overflow-wrap:anywhere; }.module-delete-requirements small { display:block; margin-top:4px; color:var(--muted); font-size:10px; overflow-wrap:anywhere; }
.module-delete-impact { margin:14px 0 0; font-size:12px; color:var(--muted); line-height:1.8; }
@media(max-width:760px) { .module-layout { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(150px,1fr) minmax(140px,1fr); }.module-directory { border-right:0; border-bottom:1px solid var(--line); }.module-totals { gap:10px 20px; padding:10px 12px; }.module-totals strong { font-size:14px; }.module-workspace { height:70vh; }.module-toolbar { padding:8px 10px; }.module-requirements > header { min-height:42px; padding:9px 12px; }.module-requirement { padding:11px 12px; }.module-empty { min-height:100px; } }
@media(max-width:420px) { .module-totals { gap:7px 16px; }.module-totals > span { gap:5px; font-size:10px; }.module-table { min-width:320px; }.module-count-column { width:43px; }.module-action-column { width:76px; }.module-table th,.module-table td { padding-inline:7px; } }
</style>
