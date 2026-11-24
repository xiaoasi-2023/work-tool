<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, type InputInstance } from 'element-plus'
import { Activity, ArrowUpRight, Bookmark, Bot, Building2, Check, Cloud, Code2, Download, Folder, FolderPlus, Globe2, History, Layers3, ListChecks, MoreHorizontal, Pencil, Pin, Plus, RefreshCw, Search, Star, Trash2, Upload, X } from 'lucide-vue-next'
import { api } from '../api'
import { UNCATEGORIZED, parseBookmarkHtml, parseWebsiteImport, parseWebsiteLines, websiteIcon, websiteUrl, type Website, type WebsiteCategory, type WebsiteIconMode, type WebsiteImport, type WebsitesCommand, type WebsitesState } from '../../shared/websites'
import '../websites.css'

const state = ref<WebsitesState | null>(null), loading = ref(false), saving = ref(false), error = ref('')
const query = ref(''), filter = ref('all'), categoryId = ref('all'), managing = ref(false), selected = ref<string[]>([])
const siteDialog = ref(false), categoriesDialog = ref(false), batchDialog = ref(false), importDialog = ref(false)
const failedIcons = reactive(new Set<string>()), picker = ref<HTMLInputElement>()
const siteNameInput = ref<InputInstance>()
const editRevision = ref(0), batchText = ref(''), batchCategory = ref(UNCATEGORIZED), moveCategory = ref('')
const imported = ref<WebsiteImport | null>(null), importMode = ref<'merge' | 'replace'>('merge')
const siteForm = reactive({ id: '', name: '', url: '', categoryId: UNCATEGORIZED, description: '', tags: '', icon: '', iconMode: 'auto' as WebsiteIconMode, favorite: false, pinned: false, order: 100 })
const categoryForm = reactive({ id: '', name: '', order: 100 })
const native = !!window.toolbox?.websites
const categories = computed(() => [...(state.value?.categories || [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN')))
const allItems = computed(() => state.value?.items || [])
const items = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return allItems.value.filter(site => (categoryId.value === 'all' || site.categoryId === categoryId.value) && (filter.value !== 'favorites' || site.favorite) && (filter.value !== 'recent' || site.openCount > 0) && (!search || [site.name, site.url, site.description, ...site.tags].join(' ').toLocaleLowerCase().includes(search))).sort((a, b) => filter.value === 'recent' ? b.lastOpenedAt.localeCompare(a.lastOpenedAt) || a.name.localeCompare(b.name) : Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
})
const groups = computed(() => filter.value === 'recent' ? items.value.length ? [{ id: 'recent', name: '最近使用', items: items.value }] : [] : categories.value.map(category => ({ ...category, items: items.value.filter(site => site.categoryId === category.id) })).filter(group => group.items.length))
const selectedItems = computed(() => items.value.filter(site => selected.value.includes(site.id)))
const allSelected = computed(() => items.value.length > 0 && selectedItems.value.length === items.value.length)
const partialSelected = computed(() => selectedItems.value.length > 0 && !allSelected.value)
const importStats = computed(() => {
  if (!imported.value) return { add: 0, duplicate: 0 }
  const urls = new Set(allItems.value.map(site => site.url)), existing = importMode.value === 'merge' ? imported.value.state.items.filter(site => urls.has(site.url)).length : 0
  return { add: imported.value.state.items.length - existing, duplicate: imported.value.duplicates + existing }
})
const iconForCategory = (id: string) => ({ development: Code2, cloud: Cloud, ops: Activity, ai: Bot, company: Building2, recent: History }[id] || Folder)
const countCategory = (id: string) => allItems.value.filter(site => site.categoryId === id).length
const categoryName = (id: string) => categories.value.find(category => category.id === id)?.name || '未分类'
const host = (url: string) => new URL(url).host
const iconKey = (site: Website) => site.id + websiteIcon(site)
const previewIcon = computed(() => {
  try {
    if (siteForm.iconMode === 'letter') return ''
    if (siteForm.iconMode === 'custom') return siteForm.icon.trim() ? websiteUrl(siteForm.icon) : ''
    return websiteIcon({ url: websiteUrl(siteForm.url), icon: '', iconMode: 'auto' })
  } catch { return '' }
})
const previewIconKey = computed(() => 'preview:' + siteForm.iconMode + ':' + previewIcon.value)
const previewLetter = computed(() => Array.from(siteForm.name.trim() || '网站')[0].toUpperCase())
const iconModeHelp = computed(() => siteForm.iconMode === 'auto' ? '自动获取网站图标，获取不到时显示名称首字。' : siteForm.iconMode === 'letter' ? '始终显示名称第一个字，英文字母自动大写，无需准备图片。' : '粘贴可直接打开的图片地址，例如 PNG、SVG 或 ICO；加载失败时显示名称首字。')
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value)
watch([query, filter, categoryId], () => { selected.value = [] }, { flush: 'sync' })
watch(items, rows => { const ids = new Set(rows.map(site => site.id)); selected.value = selected.value.filter(id => ids.has(id)) })
async function load() {
  if (loading.value || saving.value) return
  loading.value = true
  try { state.value = await api.websites.read(); error.value = ''; if (categoryId.value !== 'all' && !state.value.categories.some(category => category.id === categoryId.value)) categoryId.value = 'all' }
  catch (value) { error.value = errorText(value) }
  finally { loading.value = false }
}
let active = true
function focus() { if (active && !siteDialog.value && !categoriesDialog.value && !batchDialog.value && !importDialog.value) void load() }
onMounted(() => { void load(); window.addEventListener('focus', focus) })
onActivated(() => { active = true; focus() }); onDeactivated(() => { active = false }); onBeforeUnmount(() => window.removeEventListener('focus', focus))
async function change(command: WebsitesCommand, revision = state.value?.revision): Promise<boolean> {
  if (revision === undefined || saving.value) return false
  saving.value = true
  try { state.value = await api.websites.mutate({ revision, command }); error.value = ''; return true }
  catch (value) { ElMessage.error(errorText(value)); return false }
  finally { saving.value = false }
}
function editSite(site?: Website) {
  Object.assign(siteForm, { id: '', name: '', url: '', categoryId: categoryId.value === 'all' ? UNCATEGORIZED : categoryId.value, description: '', tags: '', icon: '', iconMode: 'auto', favorite: false, pinned: false, order: 100 }, site || {}, { tags: site?.tags.join('，') || '', iconMode: site?.iconMode || (site?.icon ? 'custom' : 'auto') })
  editRevision.value = state.value?.revision || 0; siteDialog.value = true
}
function inferName() { if (!siteForm.name.trim()) { try { siteForm.name = host(websiteUrl(siteForm.url)) } catch { /* Keep the unfinished input. */ } } }
async function saveSite() {
  const value = { ...siteForm, id: siteForm.id || undefined, icon: siteForm.iconMode === 'custom' ? siteForm.icon : '', tags: siteForm.tags.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean) }
  if (await change({ type: 'save-site', value }, editRevision.value)) { siteDialog.value = false; ElMessage.success('网站已保存') }
}
async function openSite(event: MouseEvent, site: Website) {
  if (managing.value) { event.preventDefault(); toggle(site.id); return }
  if (native) event.preventDefault()
  try { const next = await api.websites.open(site.id); if (!state.value || next.revision >= state.value.revision) state.value = next }
  catch (value) { ElMessage.error((native ? '打开失败：' : '网站已请求打开，使用记录保存失败：') + errorText(value)) }
}
async function menu(command: string, site: Website) {
  if (command === 'edit') editSite(site)
  else if (command === 'favorite' || command === 'pinned') await change({ type: 'flag', id: site.id, field: command, value: !site[command] })
  else if (command === 'delete') await removeSites([site.id])
}
function toggle(id: string) { selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id] }
function toggleAll() { selected.value = allSelected.value ? [] : items.value.map(site => site.id) }
function setManaging() { managing.value = !managing.value; selected.value = []; moveCategory.value = '' }
async function removeSites(ids: string[]) {
  try { await ElMessageBox.confirm('删除选中的 ' + ids.length + ' 个网站？', '删除网站', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', distinguishCancelAndClose: true }); if (await change({ type: 'delete-sites', ids })) { selected.value = []; ElMessage.success('网站已删除') } } catch (value) { if (value !== 'cancel' && value !== 'close') ElMessage.error(errorText(value)) }
}
async function moveSites() { if (moveCategory.value && selectedItems.value.length && await change({ type: 'move-sites', ids: selectedItems.value.map(site => site.id), categoryId: moveCategory.value })) { selected.value = []; moveCategory.value = ''; ElMessage.success('已移动分类') } }
function resetCategory(category?: WebsiteCategory) { Object.assign(categoryForm, { id: '', name: '', order: 100 }, category || {}) }
async function saveCategory() { if (await change({ type: 'save-category', value: { ...categoryForm, id: categoryForm.id || undefined } })) { resetCategory(); ElMessage.success('分类已保存') } }
async function removeCategory(category: WebsiteCategory) {
  try { await ElMessageBox.confirm('删除“' + category.name + '”分类？其中 ' + countCategory(category.id) + ' 个网站将移到“未分类”。', '删除分类', { type: 'warning', confirmButtonText: '移动网站并删除分类', cancelButtonText: '取消' }); if (await change({ type: 'delete-category', id: category.id })) { if (categoryId.value === category.id) categoryId.value = UNCATEGORIZED; resetCategory() } } catch (value) { if (value !== 'cancel' && value !== 'close') ElMessage.error(errorText(value)) }
}
function previewBatch() {
  try { imported.value = parseWebsiteLines(batchText.value, categoryName(batchCategory.value)); importMode.value = 'merge'; batchDialog.value = false; importDialog.value = true }
  catch (value) { ElMessage.error(errorText(value)) }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return
  try {
    if (file.size > 20 * 1024 ** 2) throw new Error('导入文件不能超过 20 MiB')
    const content = (await file.text()).replace(/^\uFEFF/, '')
    imported.value = /^\s*</.test(content) ? parseBookmarkHtml(content) : parseWebsiteImport(JSON.parse(content))
    importMode.value = 'merge'; importDialog.value = true
  } catch (value) { ElMessage.error(errorText(value)) }
}
async function applyImport() {
  if (!imported.value) return
  if (importMode.value === 'replace') {
    try { await ElMessageBox.confirm('当前 ' + allItems.value.length + ' 个网站将由备份内容替换。恢复前会自动备份当前数据。', '恢复网站备份', { type: 'warning', confirmButtonText: '备份并恢复', cancelButtonText: '取消' }) } catch { return }
  }
  if (await change({ type: 'import', mode: importMode.value, data: imported.value.state })) { importDialog.value = false; selected.value = []; if (categoryId.value !== 'all' && !state.value?.categories.some(category => category.id === categoryId.value)) categoryId.value = 'all'; ElMessage.success('网站已导入') }
}
function exportFile() {
  if (!state.value) return
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.value, null, 2)], { type: 'application/json' })), a = document.createElement('a')
  a.href = url; a.download = 'Workbench-常用网站-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="websites-workbench" v-loading="loading && !state">
    <header class="websites-heading">
      <div class="websites-title"><span class="websites-mark"><Bookmark :size="24" :stroke-width="1.7" /></span><div><h1>常用网站 <span>{{ allItems.length }}</span></h1><p>文档、平台与日常入口，按用途整理</p></div></div>
      <div class="websites-heading-actions"><el-button :disabled="!state || saving" @click="resetCategory(); categoriesDialog=true"><FolderPlus :size="15" />管理分类</el-button><el-dropdown :disabled="!state || saving" @command="(command: string) => command==='import' ? picker?.click() : exportFile()"><el-button :disabled="!state || saving"><Layers3 :size="15" />导入 / 导出</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="import"><Upload :size="14" />导入 JSON / 浏览器书签</el-dropdown-item><el-dropdown-item command="export"><Download :size="14" />导出 JSON 备份</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-dropdown split-button type="primary" :disabled="!state || saving" @click="editSite()" @command="(command: string) => command==='single' ? editSite() : (batchText='', batchCategory=categoryId==='all'?UNCATEGORIZED:categoryId, batchDialog=true)"><Plus :size="16" />添加网站<template #dropdown><el-dropdown-menu><el-dropdown-item command="single">添加一个网站</el-dropdown-item><el-dropdown-item command="batch">批量粘贴网址</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div>
      <input ref="picker" class="websites-file-input" type="file" accept=".json,.html,.htm,application/json,text/html" aria-label="导入网站备份或书签" @change="importFile" />
    </header>
    <div v-if="error" class="websites-error" role="alert"><span>{{ error }}</span><el-button link @click="load">重新加载</el-button></div>
    <section class="websites-toolbar" aria-label="网站筛选">
      <div class="websites-view-tabs"><button v-for="item in [{id:'all',name:'全部网站',icon:Globe2},{id:'favorites',name:'已收藏',icon:Star},{id:'recent',name:'最近使用',icon:History}]" :key="item.id" :class="{selected:filter===item.id}" :aria-pressed="filter===item.id" @click="filter=item.id"><component :is="item.icon" :size="15" />{{ item.name }}</button></div>
      <div class="websites-toolbar-right"><label class="websites-search"><Search :size="16" /><input v-model="query" aria-label="搜索网站" placeholder="搜索名称、网址或标签" /><button v-if="query" class="icon-button" aria-label="清除网站搜索" @click="query=''"><X :size="14" /></button><kbd v-else>搜索</kbd></label><el-button :disabled="!state || saving" :type="managing?'primary':'default'" plain @click="setManaging"><ListChecks :size="15" />{{ managing?'完成整理':'批量整理' }}</el-button><button class="icon-button" title="刷新网站列表" aria-label="刷新网站列表" :disabled="loading || saving" @click="load"><RefreshCw :size="16" /></button></div>
    </section>
    <nav class="websites-category-nav" aria-label="网站分类"><button :class="{selected:categoryId==='all'}" @click="categoryId='all'">全部分类<span>{{ allItems.length }}</span></button><button v-for="category in categories" :key="category.id" :class="{selected:categoryId===category.id}" @click="categoryId=category.id">{{ category.name }}<span>{{ countCategory(category.id) }}</span></button></nav>
    <div v-if="managing" class="websites-bulk-bar"><el-checkbox :model-value="allSelected" :indeterminate="partialSelected" :disabled="!items.length || saving" @change="toggleAll">全选当前结果</el-checkbox><span>已选 {{ selectedItems.length }} / {{ items.length }} 项</span><el-button v-if="selected.length" link @click="selected=[]">清空选择</el-button><span class="websites-spacer" /><el-select v-model="moveCategory" placeholder="移到分类…" aria-label="批量移动目标分类" :disabled="saving"><el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" /></el-select><el-button :disabled="!selectedItems.length || !moveCategory || saving" @click="moveSites">移动</el-button><el-button type="danger" plain :disabled="!selectedItems.length || saving" @click="removeSites(selectedItems.map(site=>site.id))"><Trash2 :size="14" />删除</el-button></div>
    <section class="websites-scroll" aria-label="网站列表">
      <section v-for="group in groups" :key="group.id" class="websites-group">
        <header><component :is="iconForCategory(group.id)" :size="17" /><h2>{{ group.name }}</h2><span>{{ group.items.length }}</span><div /><button v-if="!managing && group.id!=='recent'" title="在此分类添加网站" :aria-label="'在'+group.name+'添加网站'" @click="editSite(); siteForm.categoryId=group.id"><Plus :size="16" /></button></header>
        <div class="websites-grid"><article v-for="site in group.items" :key="site.id" :class="['website-card',{picked:selected.includes(site.id)}]">
          <input v-if="managing" class="website-card-check" type="checkbox" :aria-label="'选择'+site.name" :checked="selected.includes(site.id)" :disabled="saving" @change="toggle(site.id)" />
          <a class="website-card-main" :href="site.url" target="_blank" rel="noopener noreferrer" :title="site.name+'\n'+site.url" @click="openSite($event,site)">
            <span class="website-icon" :style="{'--site-hue':(site.name.charCodeAt(0)*37)%360}"><img v-if="websiteIcon(site) && !failedIcons.has(iconKey(site))" :src="websiteIcon(site)" loading="lazy" referrerpolicy="no-referrer" alt="" @error="failedIcons.add(iconKey(site))" /><span v-else>{{ Array.from(site.name)[0]?.toUpperCase() }}</span></span>
            <div class="website-card-copy"><h3><Pin v-if="site.pinned" :size="12" />{{ site.name }}</h3><p>{{ site.description || site.url }}</p><div class="website-card-meta"><span>{{ host(site.url) }}</span><small v-for="tag in site.tags.slice(0,2)" :key="tag">{{ tag }}</small></div></div><ArrowUpRight v-if="!managing" class="website-open-icon" :size="15" />
          </a>
          <div v-if="!managing" class="website-card-actions"><button class="website-card-edit" :aria-label="'编辑'+site.name" :disabled="saving" @click.stop="editSite(site)"><Pencil :size="13" /><span>编辑</span></button><button :class="{starred:site.favorite}" :title="site.favorite?'取消收藏':'收藏网站'" :aria-label="(site.favorite?'取消收藏':'收藏')+site.name" :disabled="saving" @click="menu('favorite',site)"><Star :size="14" :fill="site.favorite?'currentColor':'none'" /></button><el-dropdown trigger="click" :disabled="saving" @command="(command: string)=>menu(command,site)"><button :aria-label="'管理'+site.name" title="更多操作"><MoreHorizontal :size="17" /></button><template #dropdown><el-dropdown-menu><el-dropdown-item command="pinned"><Pin :size="14" />{{ site.pinned?'取消置顶':'分类内置顶' }}</el-dropdown-item><el-dropdown-item command="delete" divided><Trash2 :size="14" />删除网站</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div>
        </article></div>
      </section>
      <div v-if="!groups.length && !loading" class="websites-empty"><component :is="filter==='favorites'?Star:filter==='recent'?History:Search" :size="36" :stroke-width="1.3" /><h2>{{ query?'没有找到匹配的网站':filter==='favorites'?'还没有收藏的网站':filter==='recent'?'还没有打开记录':'这里还没有网站' }}</h2><p>{{ query?'试试其他关键词，或查看全部分类':filter==='favorites'?'点击网站卡片上的星标，常用入口就会出现在这里':filter==='recent'?'打开网站后，会在这里按最近使用时间排列':'添加网址，把常用入口放在一起' }}</p><el-button v-if="state && !query && filter==='all'" type="primary" @click="editSite"><Plus :size="15" />添加网站</el-button><el-button v-else-if="query" @click="query='';categoryId='all'">清除搜索与分类</el-button></div>
    </section>
    <footer class="websites-footnote"><span><span class="websites-local-dot" />本地保存 · {{ allItems.length }} 个网站 / {{ categories.length }} 个分类</span><span>{{ managing?'筛选变更后会清空选择':'点击卡片打开网站 · 点击编辑修改网址与图标' }}</span></footer>

    <el-dialog class="websites-dialog websites-site-dialog" v-model="siteDialog" :title="siteForm.id?'编辑网站':'添加网站'" width="700px" align-center :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" @opened="siteNameInput?.focus()">
      <template #header><div class="websites-editor-heading"><h2>{{ siteForm.id?'编辑网站':'添加网站' }}</h2><p>设置网站信息、图标与展示顺序</p></div></template>
      <el-form :model="siteForm" label-position="top" class="websites-site-form" :disabled="saving" @submit.prevent="saveSite">
        <section class="websites-editor-section" aria-labelledby="website-basic-heading">
          <div class="websites-editor-section-title"><h3 id="website-basic-heading">基本信息</h3><span>名称与网址为必填项</span></div>
          <div class="websites-form-pair">
            <el-form-item label="网站名称" required><el-input ref="siteNameInput" v-model="siteForm.name" maxlength="120" placeholder="例如：GSAP v3 文档" aria-label="网站名称" /></el-form-item>
            <el-form-item label="所属分类"><el-select v-model="siteForm.categoryId" aria-label="所属分类"><el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" /></el-select></el-form-item>
          </div>
          <el-form-item label="网站地址" required><el-input v-model="siteForm.url" placeholder="https://example.com 或 localhost:3000" aria-label="网站地址" @blur="inferName" /></el-form-item>
          <el-form-item label="简介"><el-input v-model="siteForm.description" type="textarea" :rows="2" maxlength="600" placeholder="简要说明这个网站的用途（选填）" aria-label="网站简介" /></el-form-item>
          <el-form-item label="标签"><el-input v-model="siteForm.tags" placeholder="例如：接口，文档，开发（使用逗号分隔）" aria-label="网站标签" /></el-form-item>
        </section>
        <section class="websites-editor-section" aria-labelledby="website-icon-heading">
          <div class="websites-editor-section-title"><h3 id="website-icon-heading">图标</h3><span>选择显示方式，下方实时预览</span></div>
          <div class="websites-icon-config">
            <el-radio-group v-model="siteForm.iconMode" aria-label="选择网站图标显示方式"><el-radio-button value="auto">自动获取</el-radio-button><el-radio-button value="letter">名称首字</el-radio-button><el-radio-button value="custom">自定义图片</el-radio-button></el-radio-group>
            <el-form-item v-if="siteForm.iconMode==='custom'" label="图片地址" required><el-input v-model="siteForm.icon" placeholder="https://example.com/logo.png" aria-label="自定义图标图片地址" /></el-form-item>
            <div class="websites-icon-preview">
              <span class="website-icon"><img v-if="previewIcon && !failedIcons.has(previewIconKey)" :src="previewIcon" alt="图标预览" referrerpolicy="no-referrer" @error="failedIcons.add(previewIconKey)" /><span v-else>{{ previewLetter }}</span></span>
              <div><strong>{{ siteForm.name.trim() || '网站名称' }}</strong><p>{{ iconModeHelp }}</p><small v-if="previewIcon && failedIcons.has(previewIconKey)">图片暂时无法加载，当前使用名称首字。</small></div>
              <button v-if="previewIcon && failedIcons.has(previewIconKey)" class="icon-button" type="button" title="重新加载图标" aria-label="重新加载图标" @click="failedIcons.delete(previewIconKey)"><RefreshCw :size="15" /></button>
            </div>
          </div>
        </section>
        <section class="websites-editor-section" aria-labelledby="website-display-heading">
          <div class="websites-editor-section-title"><h3 id="website-display-heading">展示设置</h3></div>
          <div class="websites-form-pair">
            <el-form-item label="分类内排序"><el-input-number v-model="siteForm.order" :min="0" :max="1000000" :step="10" controls-position="right" aria-label="分类内排序" /><p class="websites-form-help">数字越小越靠前，置顶网站优先展示。</p></el-form-item>
            <el-form-item label="快捷设置"><div class="websites-editor-checks"><el-checkbox v-model="siteForm.favorite">收藏网站</el-checkbox><el-checkbox v-model="siteForm.pinned">分类内置顶</el-checkbox></div></el-form-item>
          </div>
        </section>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="siteDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveSite">保存网站</el-button></template>
    </el-dialog>
    <el-dialog class="websites-dialog" v-model="categoriesDialog" title="管理分类" width="660px" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving">
      <div class="websites-category-editor"><el-input v-model="categoryForm.name" :disabled="categoryForm.id===UNCATEGORIZED" maxlength="40" :placeholder="categoryForm.id?'修改分类名称':'添加分类，例如：公司系统'" aria-label="分类名称" /><el-input-number v-model="categoryForm.order" :min="0" :max="1000000" :step="10" controls-position="right" aria-label="分类排序" /><el-button type="primary" :loading="saving" @click="saveCategory">{{ categoryForm.id?'保存':'添加' }}</el-button><el-button v-if="categoryForm.id" :disabled="saving" @click="resetCategory()">取消编辑</el-button></div><p class="websites-form-help">按排序数字从小到大展示。删除分类时，网站自动移到“未分类”。</p><div class="websites-category-list"><div v-for="category in categories" :key="category.id"><span class="websites-category-number">{{ category.order }}</span><Folder :size="16" /><strong>{{ category.name }}</strong><small>{{ countCategory(category.id) }} 个网站</small><span class="websites-spacer" /><button class="icon-button" :aria-label="'编辑'+category.name" :disabled="saving" @click="resetCategory(category)"><Pencil :size="15" /></button><button class="icon-button" :aria-label="'删除'+category.name" :disabled="category.id===UNCATEGORIZED || saving" @click="removeCategory(category)"><Trash2 :size="15" /></button></div></div><template #footer><el-button :disabled="saving" @click="categoriesDialog=false">完成</el-button></template>
    </el-dialog>
    <el-dialog class="websites-dialog" v-model="batchDialog" title="批量添加网站" width="660px" :close-on-click-modal="false"><el-form label-position="top"><el-form-item label="所属分类"><el-select v-model="batchCategory"><el-option v-for="category in categories" :key="category.id" :label="category.name" :value="category.id" /></el-select></el-form-item><el-form-item label="每行一个网址，也支持“名称 | 网址”"><el-input v-model="batchText" type="textarea" :rows="10" placeholder="https://github.com/&#10;接口文档 | https://wiki.apipost.cn/" /></el-form-item></el-form><template #footer><el-button @click="batchDialog=false">取消</el-button><el-button type="primary" @click="previewBatch">预览导入</el-button></template></el-dialog>
    <el-dialog class="websites-dialog" v-model="importDialog" title="导入网站预览" width="780px" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving"><template v-if="imported"><div class="websites-import-options"><el-radio-group v-model="importMode" :disabled="saving"><el-radio-button value="merge">合并添加</el-radio-button><el-radio-button value="replace">恢复备份 / 替换全部</el-radio-button></el-radio-group><span>{{ importMode==='merge'?'保留已有网站，重复网址跳过':'使用导入内容替换当前网站和分类' }}</span></div><div class="websites-import-stats"><div><strong>{{ importStats.add }}</strong><span>{{ importMode==='merge'?'将新增':'将恢复' }}</span></div><div><strong>{{ importStats.duplicate }}</strong><span>重复跳过</span></div><div><strong>{{ imported.skipped }}</strong><span>无效跳过</span></div></div><el-table :data="imported.state.items.slice(0,100)" max-height="360" size="small"><el-table-column prop="name" label="名称" min-width="150" show-overflow-tooltip /><el-table-column label="分类" width="120"><template #default="{row}">{{ imported.state.categories.find(category=>category.id===row.categoryId)?.name }}</template></el-table-column><el-table-column prop="url" label="网址" min-width="220" show-overflow-tooltip /></el-table><p class="websites-form-help">{{ imported.state.items.length>100?'仅预览前 100 条，确认后处理全部有效记录。':'确认后保存到本地网站库。' }}</p></template><template #footer><el-button :disabled="saving" @click="importDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="applyImport"><Check :size="15" />{{ importMode==='merge'?'确认导入':'确认恢复' }}</el-button></template></el-dialog>
  </div>
</template>
