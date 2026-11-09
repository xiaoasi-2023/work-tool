<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { PanelsTopLeft, PanelLeftClose, PanelLeftOpen, LayoutGrid, Star, History, Settings2, Search, ArrowUpRight, ChevronRight, Monitor, FolderGit2, Activity, X, ArrowRight, Plus, FolderOpen, CheckCircle2, Sun, Moon, Menu } from 'lucide-vue-next'
import { useApp } from './store'
import { api } from './api'
import { tools } from './tools'
import type { ToolId } from '../shared/types'
import CommandPalette from './components/CommandPalette.vue'

const GitTool = defineAsyncComponent(() => import('./components/GitTool.vue'))
const DataTools = defineAsyncComponent(() => import('./components/DataTools.vue'))
const JsonWorkbench = defineAsyncComponent(() => import('./components/JsonWorkbench.vue'))
const TimeWorkbench = defineAsyncComponent(() => import('./components/TimeWorkbench.vue'))
const SettingsPanel = defineAsyncComponent(() => import('./components/SettingsPanel.vue'))
const CodecTool = defineAsyncComponent(() => import('./components/CodecTool.vue'))
const TextCompare = defineAsyncComponent(() => import('./components/TextCompare.vue'))
const JwtTool = defineAsyncComponent(() => import('./components/JwtTool.vue'))
const RandomTool = defineAsyncComponent(() => import('./components/RandomTool.vue'))
const RegexTool = defineAsyncComponent(() => import('./components/RegexTool.vue'))
const HashTool = defineAsyncComponent(() => import('./components/HashTool.vue'))
const ManagementWorkbench = defineAsyncComponent(() => import('./components/ManagementWorkbench.vue'))

const app = useApp()
const search = ref('')
const category = ref('全部')
const error = ref('')
const adding = ref(false)
const collapsed = ref(false)
const mobileNavigation = ref(false)
const switchingTheme = ref(false)
const navigationViewport = window.matchMedia('(max-width: 900px)')
function viewportChanged() { mobileNavigation.value = false }
const commandOpen = ref(false)
const openTabs = ref<ToolId[]>([])
const toolComponents = { git: GitTool, json: JsonWorkbench, time: TimeWorkbench, text: DataTools, codec: CodecTool, compare: TextCompare, jwt: JwtTool, random: RandomTool, regex: RegexTool, hash: HashTool, management: ManagementWorkbench }
const activeComponent = computed(() => activeTool.value ? toolComponents[activeTool.value.id] : null)
const openedTools = computed(() => openTabs.value.map(id => tools.find(tool => tool.id === id)!))
function closeTab(id: ToolId) {
  const index = openTabs.value.indexOf(id)
  openTabs.value = openTabs.value.filter(tab => tab !== id)
  if (app.page === id) {
    const next = openTabs.value[Math.min(index, openTabs.value.length - 1)]
    if (next) void app.open(next); else catalog('home')
  }
}
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandOpen.value = !commandOpen.value }
  if (event.key === 'Escape') mobileNavigation.value = false
}
const activeTool = computed(() => tools.find(tool => tool.id === app.page))
const pageName = computed(() => activeTool.value?.name || ({ home: '全部工具', favorites: '我的收藏', recent: '最近使用', settings: '设置', history: '操作记录' } as Record<string, string>)[app.page])
const isCatalog = computed(() => ['home', 'favorites', 'recent'].includes(app.page))
const recentTools = computed(() => (app.state?.recent || []).map(id => tools.find(tool => tool.id === id)!).filter(Boolean))
const filtered = computed(() => {
  let items = tools.filter(tool => (!search.value || `${tool.name}${tool.description}${tool.category}`.toLowerCase().includes(search.value.toLowerCase())) && (category.value === '全部' || tool.category === category.value))
  if (app.page === 'favorites') items = items.filter(tool => app.state?.favorites.includes(tool.id))
  if (app.page === 'recent') items = items.filter(tool => app.state?.recent.includes(tool.id)).sort((a,b) => app.state!.recent.indexOf(a.id) - app.state!.recent.indexOf(b.id))
  return items
})
function catalog(page: 'home' | 'favorites' | 'recent', filter = '全部') { app.page = page; category.value = filter; search.value = ''; mobileNavigation.value = false }
async function load() { try { await app.reload(); error.value = '' } catch (e) { error.value = String(e) } }
async function favorite(id: ToolId) { try { await app.favorite(id) } catch (e) { ElMessage.error(String(e)) } }
async function addProject() {
  adding.value = true
  try { const project = await api.addProject(); await app.reload(); if (project) await app.openProject(project.id) }
  catch (e) { ElMessage.error((e as Error).message) } finally { adding.value = false }
}
function date(value: string) { return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) }
function toggleNavigation() {
  if (navigationViewport.matches) mobileNavigation.value = !mobileNavigation.value
  else if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(async () => { collapsed.value = !collapsed.value; await nextTick() })
  else {
    const shell = document.querySelector<HTMLElement>('.main-shell')
    const previous = shell?.getBoundingClientRect().left
    collapsed.value = !collapsed.value
    if (shell && previous !== undefined && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) void nextTick(() => shell.animate([{ transform: `translateX(${previous - shell.getBoundingClientRect().left}px)` }, { transform: 'translateX(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' }))
  }
}
async function toggleTheme() {
  if (switchingTheme.value) return
  switchingTheme.value = true
  try {
    const theme = app.state?.settings.theme === 'dark' ? 'light' : 'dark'
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) await document.startViewTransition(() => app.setTheme(theme)).updateCallbackDone
    else await app.setTheme(theme)
  }
  catch (e) { ElMessage.error(String(e)) }
  finally { switchingTheme.value = false }
}
watch(() => app.page, page => {
  mobileNavigation.value = false
  if (tools.some(tool => tool.id === page) && !openTabs.value.includes(page as ToolId)) openTabs.value.push(page as ToolId)
})
watch(commandOpen, open => { if (open) mobileNavigation.value = false })
onMounted(() => { void load(); window.addEventListener('keydown', keydown); navigationViewport.addEventListener('change', viewportChanged) })
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown); navigationViewport.removeEventListener('change', viewportChanged) })
</script>

<template>
  <div :class="['app-shell', { 'sidebar-collapsed': collapsed, 'mobile-nav-open': mobileNavigation }]">
    <Transition name="navigation-shade"><button v-if="mobileNavigation" class="navigation-backdrop" aria-label="关闭导航" @click="mobileNavigation = false" /></Transition>
    <aside id="workspace-navigation" class="sidebar">
      <a class="brand" href="#" title="Workbench · 工具库" @click.prevent="catalog('home')"><span class="brand-mark"><PanelsTopLeft :size="22" /></span><span>Workbench<small>个人工具库</small></span></a>
      <div class="workspace-label"><span class="local-dot" />个人工作空间</div>
      <button class="workspace-search" title="快速打开 (Ctrl+K)" aria-label="快速打开" @click="commandOpen = true"><Search :size="17" /><span class="nav-text">快速打开</span></button>
      <nav aria-label="主导航" @click="mobileNavigation = false">
        <button :class="['nav-item', { active: app.page === 'home' && category === '全部' }]" title="全部工具" @click="catalog('home')"><LayoutGrid :size="18" /><span class="nav-text">全部工具</span><span class="nav-count">{{ tools.length }}</span></button>
        <button :class="['nav-item', { active: app.page === 'favorites' }]" title="我的收藏" @click="catalog('favorites')"><Star :size="18" /><span class="nav-text">我的收藏</span><span v-if="app.state?.favorites.length" class="nav-count">{{ app.state.favorites.length }}</span></button>
        <button :class="['nav-item', { active: app.page === 'recent' }]" title="最近使用" @click="catalog('recent')"><History :size="18" /><span class="nav-text">最近使用</span></button>
        <div class="nav-label">工具</div>
        <button v-for="tool in tools" :key="tool.id" :class="['nav-item', { active: app.page === tool.id }]" :title="tool.name" :aria-current="app.page === tool.id ? 'page' : undefined" @click="app.open(tool.id)"><component :is="tool.icon" :size="18" /><span class="nav-text">{{ tool.name }}</span><Star v-if="app.state?.favorites.includes(tool.id)" class="nav-favorite" :size="12" /></button>
      </nav>
      <div class="sidebar-bottom" @click="mobileNavigation = false">
        <button :class="['nav-item', { active: app.page === 'history' }]" title="操作记录" @click="app.page = 'history'; app.reload()"><Activity :size="18" /><span class="nav-text">操作记录</span></button>
        <button :class="['nav-item', { active: app.page === 'settings' }]" title="设置" @click="app.page = 'settings'"><Settings2 :size="18" /><span class="nav-text">设置</span></button>
        <div class="local-status"><span class="local-dot" /><span>{{ app.state?.desktop ? '本地运行' : '网页预览' }}</span><span>v{{ app.state?.version || '0.1.0' }}</span></div>
      </div>
    </aside>
    <div class="main-shell" :inert="mobileNavigation || undefined">
      <nav v-if="openTabs.length" class="workspace-tabs" aria-label="打开的工具"><button class="workspace-home" title="工具库" aria-label="工具库" :class="{ selected: isCatalog }" @click="catalog('home')"><LayoutGrid :size="17" /></button><TransitionGroup name="workspace-tab" tag="div" class="workspace-tab-list"><div v-for="tool in openedTools" :key="tool.id" :class="['workspace-tab', { selected: app.page === tool.id }]"><button class="workspace-tab-title" :aria-current="app.page === tool.id ? 'page' : undefined" @click="app.open(tool.id)"><component :is="tool.icon" :size="15" />{{ tool.name }}</button><button class="workspace-tab-close" :title="`关闭${tool.name}`" :aria-label="`关闭${tool.name}`" @click="closeTab(tool.id)"><X :size="13" /></button></div></TransitionGroup><button class="workspace-tab-add" title="打开工具" aria-label="打开工具" @click="commandOpen = true"><Plus :size="17" /></button></nav>
      <header class="topbar"><div class="breadcrumb"><button class="icon-button navigation-toggle" :title="collapsed ? '展开导航' : '收起导航'" aria-label="切换导航" aria-controls="workspace-navigation" @click="toggleNavigation"><Menu class="mobile-menu-icon" :size="19" /><component :is="collapsed ? PanelLeftOpen : PanelLeftClose" class="desktop-menu-icon" :size="18" /></button><span>工作空间</span><ChevronRight :size="14" /><strong>{{ pageName }}</strong></div><div class="topbar-right"><span class="runtime-indicator"><span class="local-dot" />{{ app.state?.desktop ? '桌面版' : '浏览器预览' }}</span><button class="icon-button" :title="app.state?.settings.theme === 'dark' ? '切换为浅色' : '切换为深色'" :aria-label="app.state?.settings.theme === 'dark' ? '切换为浅色' : '切换为深色'" :disabled="!app.state || switchingTheme" @click="toggleTheme"><component :is="app.state?.settings.theme === 'dark' ? Sun : Moon" :size="18" /></button><span class="topbar-divider" /><button class="icon-button" title="工作台设置" aria-label="工作台设置" @click="app.page = 'settings'"><Settings2 :size="18" /></button></div></header>
      <main :class="{ 'git-page': app.page === 'git', 'management-page': app.page === 'management', 'editor-page': ['json', 'text'].includes(app.page), 'catalog-page': isCatalog, 'settings-page': app.page === 'settings' }">
        <div v-if="error" class="error-box">{{ error }}<el-button @click="load">重试</el-button></div>
        <template v-else-if="isCatalog">
          <div class="page-heading catalog-heading"><div><div class="eyebrow">WORKBENCH / LIBRARY</div><h1>{{ pageName }}<span class="title-tag">{{ filtered.length }}</span></h1><p>开发与数据处理<span class="metadata-dot">/</span>Workbench</p></div><el-button v-if="app.state?.desktop" :loading="adding" @click="addProject"><Plus :size="16" />添加项目</el-button><button v-else class="catalog-launcher" @click="commandOpen = true"><Search :size="17" />快速打开<ArrowUpRight :size="16" /></button></div>
          <div class="library-layout">
            <section class="library-main" aria-label="工具目录">
              <div class="catalog-toolbar"><div class="tabs" aria-label="工具分类"><button v-for="item in ['全部', '管理工具', '开发工具', '文本工具']" :key="item" :class="{ selected: category === item }" @click="category = item">{{ item }}<span v-if="item === '全部'">{{ tools.length }}</span></button></div><label class="search-box"><Search :size="17" /><input v-model="search" aria-label="搜索工具" placeholder="搜索工具…" /><button v-if="search" class="icon-button" title="清除搜索" @click="search = ''"><X :size="15" /></button></label></div>
              <TransitionGroup name="tool-list" tag="div" class="tool-grid"><article v-for="(tool, index) in filtered" :key="tool.id" :class="['tool-card', tool.color]" :style="{ '--item-index': index }"><span class="tool-index">{{ String(index + 1).padStart(2, '0') }}</span><span :class="['tool-icon', tool.color]"><component :is="tool.icon" :size="26" :stroke-width="1.7" /></span><div class="tool-summary"><button class="tool-title" @click="app.open(tool.id)">{{ tool.name }}</button><p>{{ tool.description }}</p></div><span class="tool-category">{{ tool.tag }}</span><button class="icon-button favorite-button" :class="{ starred: app.state?.favorites.includes(tool.id) }" :title="app.state?.favorites.includes(tool.id) ? '取消收藏' : '收藏工具'" @click="favorite(tool.id)"><Star :size="17" :fill="app.state?.favorites.includes(tool.id) ? 'currentColor' : 'none'" /></button><button class="open-tool" :title="`打开${tool.name}`" :aria-label="`打开${tool.name}`" @click="app.open(tool.id)"><ArrowUpRight :size="20" /></button></article></TransitionGroup>
              <div v-if="!filtered.length" class="empty-inline"><Search v-if="search" :size="28" /><Star v-else-if="app.page === 'favorites'" :size="28" /><History v-else :size="28" /><strong>{{ search ? '没有找到匹配的工具' : app.page === 'favorites' ? '暂无收藏' : '暂无使用记录' }}</strong><button class="text-action" @click="catalog('home')">查看全部工具<ArrowRight :size="14" /></button></div>
              <footer class="catalog-footer"><span><CheckCircle2 :size="14" />本地工作空间</span><span>共 {{ filtered.length }} 个工具</span></footer>
              <section v-if="app.page === 'home' && recentTools.length && !search" class="recent-strip" aria-label="最近使用的工具"><span class="section-kicker"><History :size="16" />最近使用</span><div class="recent-tools"><button v-for="tool in recentTools" :key="tool.id" @click="app.open(tool.id)"><component :is="tool.icon" :size="16" />{{ tool.name }}<ArrowUpRight :size="13" /></button></div></section>
            </section>
            <aside v-if="app.state?.projects.length || app.state?.history.length" class="workspace-aside" aria-label="工作空间概览">
              <section class="aside-section"><div class="section-heading"><h2><FolderGit2 :size="17" />本地项目<span>{{ app.state?.projects.length || 0 }}</span></h2><button class="icon-button" title="管理项目" @click="app.open('git')"><ArrowUpRight :size="17" /></button></div><div v-if="!app.state?.projects.length" class="aside-empty"><FolderOpen :size="30" :stroke-width="1.4" /><strong>暂无项目</strong><span>{{ app.state?.desktop ? '尚未添加本地仓库' : '在桌面版中添加本地仓库' }}</span></div><div v-else class="home-projects"><button v-for="project in app.state.projects.slice(0, 4)" :key="project.id" @click="app.openProject(project.id)"><span class="mini-project-icon"><FolderGit2 :size="18" /></span><span><strong>{{ project.name }}</strong><small :title="project.path">{{ project.path }}</small></span><ChevronRight :size="14" /></button></div><el-button v-if="app.state?.desktop" class="add-project-inline" :loading="adding" @click="addProject"><Plus :size="15" />添加项目</el-button><button v-else class="text-action aside-action" @click="app.open('git')">打开 Git 工作台<ArrowRight :size="14" /></button></section>
              <section class="aside-section"><div class="section-heading"><h2><Activity :size="17" />最近操作</h2><button class="icon-button" title="全部操作记录" @click="app.page = 'history'; app.reload()"><ArrowUpRight :size="17" /></button></div><div v-if="!app.state?.history.length" class="aside-empty small"><span>暂无 Git 操作记录</span></div><div v-else class="activity-list"><div v-for="entry in app.state.history.slice(0, 4)" :key="entry.id"><span :class="['activity-dot', { failed: !entry.success }]" /><div><strong>{{ entry.action }}</strong><small>{{ entry.project }}</small></div><time>{{ date(entry.time) }}</time></div></div></section>
              <div class="workspace-footnote"><Monitor :size="15" /><span>Workbench<span>个人工作空间 · {{ app.state?.version }}</span></span></div>
            </aside>
          </div>
        </template>
        <Transition name="workspace" mode="out-in"><KeepAlive><component :is="activeComponent" v-if="activeComponent && !error" :key="app.page" :tool="app.page" /></KeepAlive></Transition>
        <SettingsPanel v-if="app.page === 'settings' && !error" />
        <template v-if="app.page === 'history' && !error"><div class="page-heading"><div><div class="eyebrow">WORKSPACE / ACTIVITY</div><h1>操作记录<span class="title-tag">{{ app.state?.history.length || 0 }}</span></h1><p>最近 100 条 Git 操作记录</p></div><el-button @click="app.reload()">刷新</el-button></div><el-table :data="app.state?.history || []" empty-text="暂无操作记录"><el-table-column label="时间" width="180"><template #default="{row}">{{ new Date(row.time).toLocaleString('zh-CN') }}</template></el-table-column><el-table-column prop="project" label="项目" width="150" /><el-table-column prop="action" label="操作" width="130" /><el-table-column prop="detail" label="详情" min-width="240" /><el-table-column label="结果" width="90"><template #default="{row}"><el-tag :type="row.success ? 'success' : 'danger'">{{ row.success ? '成功' : '失败' }}</el-tag></template></el-table-column></el-table></template>
      </main>
    </div>
    <CommandPalette v-model="commandOpen" />
  </div>
</template>
