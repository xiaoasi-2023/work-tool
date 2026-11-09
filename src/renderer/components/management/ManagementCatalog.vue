<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElCheckbox, ElDialog, ElMessage, ElMessageBox, ElOption, ElSelect, ElInputNumber } from 'element-plus'
import { Archive, Check, Pencil, Plus, Search, UserRound, FolderKanban, Layers3 } from 'lucide-vue-next'
import { useManagement } from '../../management-store'
import { getProjectModules, getVersionPhase, managementRoles, nextPersonSortOrder, roleLabels, sortManagementPeople, type ManagementPerson, type ManagementProject, type ManagementRole, type ManagementVersion } from '../../../shared/management'
import ManagementModules from './ManagementModules.vue'

const props = defineProps<{ kind: 'projects' | 'people' | 'versions' }>()
const emit = defineEmits<{ 'open-requirement': [id: string] }>()
const manager = useManagement()
const query = ref('')
const projectFilter = ref('')
const showInactive = ref(false)
const dialog = ref(false)
const formElement = ref<HTMLFormElement>()
const modulesDialog = ref(false), modulesProjectId = ref(''), initialModule = ref<string>()
const moduleSummaries = computed(() => new Map(manager.state.projects.map(project => [project.id, getProjectModules(manager.state, project.id)])))
const formModules = computed(() => moduleSummaries.value.get(form.value.id) || [])
const title = computed(() => ({ projects: '业务项目', people: '人员', versions: '专项版本' })[props.kind])
const icon = computed(() => ({ projects: FolderKanban, people: UserRound, versions: Layers3 })[props.kind])
interface CatalogDraft {
  id: string; name: string; ownerId: string; status: 'active' | 'paused' | 'archived' | 'cancelled'; notes: string;
  roles: ManagementRole[]; weeklyCapacity: number; sortOrder: number; active: boolean; projectId: string; code: string; scope: string;
  plannedStart: string; plannedDevEnd: string; plannedTestEnd: string; plannedRelease: string; startedAt: string;
  devCompletedAt: string; submittedAt: string; testStartedAt: string; testCompletedAt: string; releasedAt: string; estimatedHours: number | null; reason: string;
}
function blank(): CatalogDraft {
  return { id: '', name: '', ownerId: '', status: 'active', notes: '', roles: [], weeklyCapacity: 40, sortOrder: nextPersonSortOrder(manager.state.people), active: true,
    projectId: projectFilter.value, code: '', scope: '', plannedStart: '', plannedDevEnd: '', plannedTestEnd: '', plannedRelease: '', startedAt: '',
    devCompletedAt: '', submittedAt: '', testStartedAt: '', testCompletedAt: '', releasedAt: '', estimatedHours: null, reason: '' }
}
const form = ref<CatalogDraft>(blank())
const people = computed(() => sortManagementPeople(manager.state.people))
const rows = computed(() => {
  const source = props.kind === 'projects' ? manager.state.projects : props.kind === 'people' ? people.value : manager.state.versions
  return source.filter(item => {
    const inactive = 'active' in item ? !item.active : item.status === 'archived' || item.status === 'cancelled'
    return (showInactive.value || !inactive) && (props.kind !== 'versions' || !projectFilter.value || ('projectId' in item && item.projectId === projectFilter.value)) &&
      `${item.name} ${'code' in item ? item.code : ''} ${'modules' in item ? (moduleSummaries.value.get(item.id) || []).map(module => module.name).join(' ') : ''} ${item.notes}`.toLowerCase().includes(query.value.toLowerCase())
  })
})
function personName(id: string) { return manager.state.people.find(person => person.id === id)?.name || '未指定' }
function projectName(id: string) { return manager.state.projects.find(project => project.id === id)?.name || '未指定' }
function versionHours(id: string) { return Math.round([...manager.state.efforts, ...manager.state.baselines].filter(entry => entry.versionId === id).reduce((sum, entry) => sum + entry.hours, 0) * 100) / 100 }
function versionPhase(version: ManagementVersion) {
  return getVersionPhase(manager.state, version.id)
}
function edit(item?: ManagementProject | ManagementPerson | ManagementVersion) {
  form.value = { ...blank(), ...item, roles: item && 'roles' in item ? [...item.roles] : [], sortOrder: item && 'roles' in item ? item.sortOrder ?? manager.state.people.findIndex(person => person.id === item.id) + 1 : nextPersonSortOrder(manager.state.people) }
  dialog.value = true
}
function openModules(projectId: string, module?: string) {
  modulesProjectId.value = projectId; initialModule.value = module; modulesDialog.value = true
}
async function save() {
  if (!formElement.value?.reportValidity()) return
  const f = form.value
  let value: Record<string, unknown>
  if (props.kind === 'projects') value = { id: f.id || crypto.randomUUID(), code: f.code.trim(), name: f.name.trim(), ownerId: f.ownerId, status: f.status, notes: f.notes }
  else if (props.kind === 'people') value = { id: f.id || crypto.randomUUID(), name: f.name.trim(), roles: [...f.roles], weeklyCapacity: f.weeklyCapacity, sortOrder: f.sortOrder, active: f.active, notes: f.notes }
  else value = { id: f.id || crypto.randomUUID(), projectId: f.projectId, code: f.code.trim(), name: f.name.trim(), ownerId: f.ownerId, scope: f.scope,
    status: f.status, notes: f.notes, plannedStart: f.plannedStart, plannedDevEnd: f.plannedDevEnd, plannedTestEnd: f.plannedTestEnd, plannedRelease: f.plannedRelease,
    startedAt: f.startedAt, devCompletedAt: f.devCompletedAt, submittedAt: f.submittedAt, testStartedAt: f.testStartedAt, testCompletedAt: f.testCompletedAt, releasedAt: f.releasedAt, estimatedHours: f.estimatedHours }
  if (await manager.save(props.kind, value, f.reason)) {
    dialog.value = false; ElMessage.success('已保存')
    if (props.kind === 'projects' && !f.id) openModules(value.id as string)
  }
}
async function archive(item: ManagementProject | ManagementPerson | ManagementVersion) {
  const inactive = 'active' in item ? !item.active : item.status === 'archived' || item.status === 'cancelled'
  try {
    await ElMessageBox.confirm(`${inactive ? '恢复' : props.kind === 'people' ? '停用' : '归档'}「${item.name}」？历史排期和投入将保留。`, title.value, { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' })
    const change = 'active' in item ? { active: inactive } : { status: inactive ? 'active' : 'archived' }
    if (await manager.save(props.kind, { id: item.id, ...change }, inactive ? '恢复使用' : '归档或停用')) ElMessage.success('已更新')
  } catch { /* Dialog cancellation leaves the record unchanged. */ }
}
watch(() => props.kind, () => { query.value = ''; projectFilter.value = ''; dialog.value = false; modulesDialog.value = false; showInactive.value = false })
</script>

<template>
  <section class="mg-catalog">
    <div class="mg-toolbar">
      <div class="catalog-caption"><component :is="icon" :size="17" /><strong>{{ title }}</strong><span class="mg-count">{{ rows.length }}</span></div>
      <label class="catalog-search"><Search :size="15" /><input v-model="query" :placeholder="`搜索${title}`" :aria-label="`搜索${title}`" /></label>
      <el-select v-if="kind === 'versions'" v-model="projectFilter" clearable placeholder="全部项目" aria-label="筛选项目" style="width:170px"><el-option v-for="project in manager.state.projects" :key="project.id" :label="project.name" :value="project.id" /></el-select>
      <el-checkbox v-model="showInactive">显示{{ kind === 'people' ? '停用人员' : '归档记录' }}</el-checkbox>
      <span class="catalog-spacer" /><el-button type="primary" :disabled="manager.busy" @click="edit()"><Plus :size="15" />新增{{ title }}</el-button>
    </div>
    <div class="mg-scroll catalog-table-scroll">
      <table class="mg-table catalog-table" :class="{ 'catalog-project-table': kind === 'projects' }">
        <colgroup v-if="kind === 'projects'"><col class="catalog-project-name-column" /><col class="catalog-owner-column" /><col /><col class="catalog-status-column" /><col class="catalog-project-action-column" /></colgroup>
        <thead><tr><th v-if="kind === 'people'" class="catalog-sort-column">排序</th><th>{{ title }}名称{{ kind === 'projects' ? ' / 项目编号' : '' }}</th><th v-if="kind === 'versions'">所属项目</th><th v-if="kind !== 'people'">负责人</th><th v-if="kind === 'projects'">模块</th><th v-if="kind === 'people'">角色</th><th v-if="kind === 'people'">周可用工时</th><template v-if="kind === 'versions'"><th>开发完成</th><th>测试完成</th><th>实际上线</th><th class="number">累计投入</th></template><th>状态</th><th class="catalog-action-column">操作</th></tr></thead>
        <tbody>
          <tr v-for="item in rows" :key="item.id">
            <td v-if="'roles' in item" class="catalog-sort-column">{{ item.sortOrder ?? manager.state.people.findIndex(person => person.id === item.id) + 1 }}</td>
            <td><button class="catalog-name" :title="item.name" @click="edit(item)">{{ item.name }}</button><small v-if="'code' in item" class="catalog-secondary">{{ item.code }}</small><small v-else-if="item.notes" class="catalog-secondary" :title="item.notes">{{ item.notes }}</small></td>
            <td v-if="'projectId' in item">{{ projectName(item.projectId) }}</td>
            <td v-if="'ownerId' in item">{{ personName(item.ownerId) }}</td>
            <td v-if="'modules' in item"><div v-if="moduleSummaries.get(item.id)?.length" class="catalog-project-module-list"><button v-for="module in moduleSummaries.get(item.id)" :key="module.name" type="button" class="catalog-module-link" :title="`${module.name} · ${module.requirementIds.length}条需求`" @click="openModules(item.id, module.name)"><span>{{ module.name }}</span><small>{{ module.requirementIds.length }}</small></button></div><button v-else type="button" class="catalog-add-module" :disabled="manager.busy" @click="openModules(item.id)"><Plus :size="13" />添加模块</button></td>
            <template v-if="'roles' in item"><td>{{ item.roles.map(role => roleLabels[role]).join('、') || '未指定' }}</td><td class="number">{{ item.weeklyCapacity }} h</td></template>
            <template v-if="'devCompletedAt' in item"><td>{{ item.devCompletedAt || '—' }}</td><td>{{ item.testCompletedAt || '—' }}</td><td>{{ item.releasedAt || '—' }}</td><td class="number">{{ versionHours(item.id) }} h<small class="catalog-secondary">{{ Math.round(versionHours(item.id) / 8 * 100) / 100 }} 人天</small></td></template>
            <td><span class="mg-badge" :class="{ success: 'active' in item ? item.active : 'releasedAt' in item ? !!item.releasedAt : item.status === 'active' }">{{ 'active' in item ? item.active ? '在职' : '已停用' : 'releasedAt' in item ? versionPhase(item) : { active: '进行中', paused: '暂停', archived: '已归档' }[item.status] }}</span></td>
            <td><div class="mg-actions"><button v-if="'modules' in item" type="button" class="catalog-manage-modules" title="管理项目模块" :disabled="manager.busy" @click="openModules(item.id)"><Layers3 :size="14" /><span>模块</span></button><button class="icon-button" title="编辑" :disabled="manager.busy" @click="edit(item)"><Pencil :size="15" /></button><button class="icon-button" :title="('active' in item ? !item.active : item.status === 'archived' || item.status === 'cancelled') ? '恢复使用' : kind === 'people' ? '停用人员' : '归档'" :disabled="manager.busy" @click="archive(item)"><Archive :size="15" /></button></div></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="mg-empty"><component :is="icon" :size="30" /><strong>{{ query || projectFilter ? '没有匹配的记录' : `暂无${title}` }}</strong><el-button v-if="!query && !projectFilter" @click="edit()"><Plus :size="14" />新增{{ title }}</el-button></div>
    </div>
    <el-dialog v-model="dialog" :title="`${form.id ? '编辑' : '新增'}${title}`" :width="kind === 'versions' ? '820px' : '600px'" :close-on-click-modal="false" destroy-on-close>
      <form ref="formElement" class="mg-form catalog-form" @submit.prevent="save">
        <div class="catalog-form-grid">
          <label :class="{ wide: kind === 'people' }"><span>{{ title }}名称 <b>*</b></span><input v-model="form.name" required maxlength="160" /></label>
          <label v-if="kind === 'projects'"><span>项目编号</span><input v-model="form.code" maxlength="80" placeholder="自动生成" /></label>
          <template v-if="kind === 'versions'">
            <label><span>版本标识 <b>*</b></span><input v-model="form.code" required maxlength="80" placeholder="如 v1.1 / ES-001" /></label>
            <label><span>所属项目 <b>*</b></span><select v-model="form.projectId" required><option value="" disabled>选择项目</option><option v-for="project in manager.state.projects" :key="project.id" :value="project.id" :disabled="project.status === 'archived' && project.id !== form.projectId">{{ project.name }}</option></select></label>
          </template>
          <label v-if="kind !== 'people'"><span>负责人</span><select v-model="form.ownerId"><option value="">未指定</option><option v-for="person in people" :key="person.id" :value="person.id" :disabled="!person.active && person.id !== form.ownerId">{{ person.name }}</option></select></label>
          <label v-if="kind !== 'people'"><span>状态</span><select v-model="form.status"><option value="active">进行中</option><option value="paused">暂停</option><option value="archived">归档</option><option v-if="kind === 'versions'" value="cancelled">取消</option></select></label>
          <div v-if="kind === 'projects' && form.id" class="catalog-module-summary wide"><div><span>项目模块 <small>{{ formModules.length }}</small></span><button type="button" class="catalog-manage-modules" :disabled="manager.busy" @click="openModules(form.id)"><Layers3 :size="14" />管理模块</button></div><div class="catalog-project-module-list"><button v-for="module in formModules" :key="module.name" type="button" class="catalog-module-link" @click="openModules(form.id, module.name)"><span>{{ module.name }}</span><small>{{ module.requirementIds.length }}</small></button><span v-if="!formModules.length" class="catalog-no-modules">暂无模块</span></div></div>
          <template v-if="kind === 'people'"><div class="wide"><span class="field-label">默认角色</span><div class="catalog-roles"><label v-for="role in managementRoles" :key="role"><input v-model="form.roles" type="checkbox" :value="role" />{{ roleLabels[role] }}</label></div></div><label><span>排序</span><el-input-number v-model="form.sortOrder" :min="0" :max="1000000" :step="1" :precision="0" /></label><label><span>每周可用工时（小时）</span><el-input-number v-model="form.weeklyCapacity" :min="0" :max="168" :step="1" /></label><label><span>人员状态</span><select v-model="form.active"><option :value="true">在职</option><option :value="false">已停用</option></select></label></template>
          <template v-if="kind === 'versions'"><label><span>预计总投入（小时）</span><el-input-number v-model="form.estimatedHours" :min="0" :precision="2" :step="8" /></label><label class="wide"><span>专项范围</span><textarea v-model="form.scope" rows="2" /></label><div class="catalog-section wide">计划日期</div><label><span>计划开发开始</span><input v-model="form.plannedStart" type="date" /></label><label><span>计划开发完成</span><input v-model="form.plannedDevEnd" type="date" /></label><label><span>计划测试完成</span><input v-model="form.plannedTestEnd" type="date" /></label><label><span>计划上线</span><input v-model="form.plannedRelease" type="date" /></label><div class="catalog-section wide">实际里程碑</div><label><span>开发开始</span><input v-model="form.startedAt" type="date" /></label><label><span>开发完成</span><input v-model="form.devCompletedAt" type="date" /></label><label><span>提测</span><input v-model="form.submittedAt" type="date" /></label><label><span>测试开始</span><input v-model="form.testStartedAt" type="date" /></label><label><span>测试完成</span><input v-model="form.testCompletedAt" type="date" /></label><label><span>实际上线</span><input v-model="form.releasedAt" type="date" /></label></template>
          <label class="wide"><span>备注</span><textarea v-model="form.notes" rows="2" maxlength="4000" /></label><label v-if="form.id" class="wide"><span>调整说明</span><input v-model="form.reason" maxlength="1000" /></label>
        </div>
      </form>
      <template #footer><el-button :disabled="manager.busy" @click="dialog = false">取消</el-button><el-button type="primary" :loading="manager.busy" @click="save"><Check :size="15" />保存</el-button></template>
    </el-dialog>
    <ManagementModules v-if="kind === 'projects'" v-model="modulesDialog" :project-id="modulesProjectId" :initial-module="initialModule" @open-requirement="emit('open-requirement', $event)" />
  </section>
</template>

<style scoped>
.mg-catalog { height:100%; min-height:0; display:flex; flex-direction:column; overflow:hidden; }
.mg-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 20px; border-bottom:1px solid var(--line); flex-shrink:0; }
.catalog-caption { display:flex; align-items:center; gap:8px; font-size:13px; margin-right:8px; }
.catalog-caption > svg { color:var(--accent); }.mg-count { color:var(--muted); font:11px Consolas,monospace; }
.catalog-search { display:flex; align-items:center; gap:8px; height:34px; border:1px solid var(--line); border-radius:5px; padding:0 10px; color:var(--muted); background:var(--surface); }
.catalog-search input { border:0; outline:0; width:170px; min-width:0; background:none; color:var(--text); font-size:12px; }
.catalog-spacer { flex:1; }.catalog-table-scroll { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; }
.catalog-table { width:100%; border-collapse:collapse; text-align:left; font-size:12px; }
.catalog-table th { position:sticky; top:0; background:var(--bg); z-index:1; font-weight:500; font-size:11px; color:var(--muted); white-space:nowrap; }
.catalog-table th,.catalog-table td { padding:12px 18px; border-bottom:1px solid var(--line); vertical-align:middle; }
.catalog-table tbody tr:hover { background:var(--hover); }.catalog-name { border:0; background:none; padding:0; color:var(--text); font-size:13px; font-weight:550; text-align:left; overflow-wrap:anywhere; }
.catalog-name:hover { color:var(--accent); }.catalog-secondary { display:block; max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--muted); margin-top:4px; font-size:11px; }
.catalog-action-column { width:92px; }.number { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.catalog-sort-column { width:76px; text-align:center; font-variant-numeric:tabular-nums; }
.catalog-project-table { table-layout:fixed; min-width:800px; }.catalog-project-name-column { width:22%; }.catalog-owner-column { width:100px; }.catalog-status-column { width:88px; }.catalog-project-action-column,.catalog-project-table .catalog-action-column { width:164px; }
.catalog-project-module-list { display:flex; flex-wrap:wrap; align-items:flex-start; gap:6px; min-width:0; }.catalog-module-link { display:inline-flex; align-items:baseline; gap:7px; max-width:100%; padding:4px 7px; border:1px solid var(--line); border-radius:4px; background:var(--surface); color:var(--text); font-size:11px; text-align:left; line-height:1.6; }.catalog-module-link > span { min-width:0; overflow-wrap:anywhere; }.catalog-module-link > small { display:inline; margin:0; font-size:10px; color:var(--muted); font-variant-numeric:tabular-nums; flex-shrink:0; }.catalog-module-link:hover { border-color:var(--accent); color:var(--accent); }.catalog-module-link:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.catalog-manage-modules,.catalog-add-module { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-height:28px; padding:0 3px; border:0; background:none; color:var(--accent); font-size:11px; white-space:nowrap; }.catalog-manage-modules:hover,.catalog-add-module:hover { text-decoration:underline; }.catalog-project-table .mg-actions { align-items:center; }.catalog-project-table .icon-button { width:28px; height:28px; flex-shrink:0; }
.catalog-module-summary { padding-top:4px; }.catalog-module-summary > div:first-child { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; }.catalog-module-summary > div:first-child > span { color:var(--muted); font-size:12px; }.catalog-module-summary small { margin-left:5px; font-variant-numeric:tabular-nums; }.catalog-no-modules { color:var(--muted); font-size:12px; }
.mg-actions { display:flex; gap:4px; }.mg-badge { display:inline-flex; white-space:nowrap; font-size:11px; line-height:22px; padding:0 7px; border-radius:4px; color:var(--muted); background:var(--hover); }.mg-badge.success { color:var(--green); background:var(--soft-green); }
.mg-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:15px; padding:70px 20px; color:var(--muted); }.mg-empty strong { font-size:13px; font-weight:500; }
.catalog-form { max-height:min(65vh,670px); overflow:auto; padding:2px 5px; }.catalog-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px; }.wide { grid-column:1/-1; }
.catalog-form label { display:flex; flex-direction:column; gap:7px; min-width:0; }.catalog-form label > span,.field-label { font-size:12px; color:var(--muted); }.catalog-form b { color:var(--el-color-danger); font-weight:500; }
.catalog-form input,.catalog-form select,.catalog-form textarea { width:100%; min-width:0; min-height:35px; border:1px solid var(--line); border-radius:5px; background:var(--surface); color:var(--text); padding:7px 10px; font-size:13px; outline:none; }.catalog-form textarea { resize:vertical; }.catalog-form input:focus,.catalog-form select:focus,.catalog-form textarea:focus { border-color:var(--accent); }
.catalog-form :deep(.el-input-number) { width:100%; }.catalog-roles { display:flex; flex-wrap:wrap; gap:5px 14px; margin-top:8px; }.catalog-roles label { display:flex; flex-direction:row; align-items:center; gap:6px; font-size:12px; }.catalog-roles input { width:14px; height:14px; min-height:14px; padding:0; accent-color:var(--accent); }.catalog-section { padding:10px 0 2px; border-top:1px solid var(--line); font-size:12px; font-weight:600; }
@media(max-width:700px) { .mg-toolbar { padding:12px; gap:9px; }.catalog-caption { width:100%; }.catalog-search { flex:1; }.catalog-search input { width:100%; }.catalog-form-grid { grid-template-columns:minmax(0,1fr); }.catalog-table th,.catalog-table td { padding-inline:12px; } }
</style>
