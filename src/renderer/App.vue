<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { PanelsTopLeft, LayoutGrid, Star, History, Settings2, Search, ArrowUpRight, ChevronRight, Wrench, Monitor, FolderGit2, Activity, X, ArrowRight, Plus, FolderOpen, CheckCircle2, SlidersHorizontal, TextCursorInput } from 'lucide-vue-next'
import { useApp } from './store'
import { api } from './api'
import { tools } from './tools'
import GitTool from './components/GitTool.vue'
import DataTools from './components/DataTools.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import type { ToolId } from '../shared/types'

const app = useApp()
const search = ref('')
const category = ref('全部')
const error = ref('')
const adding = ref(false)
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
function catalog(page: 'home' | 'favorites' | 'recent', filter = '全部') { app.page = page; category.value = filter; search.value = '' }
async function load() { try { await app.reload(); error.value = '' } catch (e) { error.value = String(e) } }
async function favorite(id: ToolId) { try { await app.favorite(id) } catch (e) { ElMessage.error(String(e)) } }
async function addProject() {
  adding.value = true
  try { const project = await api.addProject(); await app.reload(); if (project) await app.openProject(project.id) }
  catch (e) { ElMessage.error((e as Error).message) } finally { adding.value = false }
}
function date(value: string) { return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) }
onMounted(load)
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" title="Workbench · 工具库" @click.prevent="catalog('home')"><span class="brand-mark"><PanelsTopLeft :size="22" /></span><span>Workbench<small>个人工具库</small></span></a>
      <div class="workspace-label"><span class="local-dot" />个人工作空间</div>
      <nav aria-label="主导航">
        <button :class="['nav-item', { active: app.page === 'home' && category === '全部' }]" title="全部工具" @click="catalog('home')"><LayoutGrid :size="18" /><span class="nav-text">全部工具</span><span class="nav-count">{{ tools.length }}</span></button>
        <button :class="['nav-item', { active: app.page === 'favorites' }]" title="我的收藏" @click="catalog('favorites')"><Star :size="18" /><span class="nav-text">我的收藏</span><span v-if="app.state?.favorites.length" class="nav-count">{{ app.state.favorites.length }}</span></button>
        <button :class="['nav-item', { active: app.page === 'recent' }]" title="最近使用" @click="catalog('recent')"><History :size="18" /><span class="nav-text">最近使用</span></button>
        <div class="nav-label">分类</div>
        <button :class="['nav-item', { active: app.page === 'home' && category === '开发工具' }]" title="开发工具" @click="catalog('home', '开发工具')"><Wrench :size="18" /><span class="nav-text">开发工具</span><span class="nav-count">3</span></button>
        <button :class="['nav-item', { active: app.page === 'home' && category === '文本工具' }]" title="文本工具" @click="catalog('home', '文本工具')"><TextCursorInput :size="18" /><span class="nav-text">文本工具</span><span class="nav-count">1</span></button>
        <div class="nav-label">工作台</div>
        <button :class="['nav-item', { active: activeTool?.id === 'git' }]" title="Git 项目管理" @click="app.open('git')"><FolderGit2 :size="18" /><span class="nav-text">Git 项目管理</span></button>
        <button v-for="tool in tools.filter(tool => app.state?.favorites.includes(tool.id) && tool.id !== 'git')" :key="tool.id" :class="['nav-item', { active: app.page === tool.id }]" :title="tool.name" @click="app.open(tool.id)"><component :is="tool.icon" :size="18" /><span class="nav-text">{{ tool.name }}</span></button>
      </nav>
      <div class="sidebar-bottom">
        <button :class="['nav-item', { active: app.page === 'history' }]" title="操作记录" @click="app.page = 'history'; app.reload()"><Activity :size="18" /><span class="nav-text">操作记录</span></button>
        <button :class="['nav-item', { active: app.page === 'settings' }]" title="设置" @click="app.page = 'settings'"><Settings2 :size="18" /><span class="nav-text">设置</span></button>
        <div class="local-status"><span class="local-dot" /><span>{{ app.state?.desktop ? '本地运行' : '网页预览' }}</span><span>v{{ app.state?.version || '0.1.0' }}</span></div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb"><PanelsTopLeft :size="15" /><span>工作空间</span><ChevronRight :size="13" /><strong>{{ pageName }}</strong></div><div class="topbar-right"><span class="runtime-indicator"><span class="local-dot" />{{ app.state?.desktop ? '桌面版' : '浏览器预览' }}</span><button class="icon-button" title="工作台设置" @click="app.page = 'settings'"><SlidersHorizontal :size="17" /></button></div></header>
      <main :class="{ 'git-page': app.page === 'git', 'editor-page': ['json', 'text'].includes(app.page) }">
        <div v-if="error" class="error-box">{{ error }}<el-button @click="load">重试</el-button></div>
        <template v-else-if="isCatalog">
          <div class="page-heading catalog-heading"><div><div class="eyebrow">WORKBENCH / LIBRARY</div><h1>{{ pageName }}<span class="title-tag">{{ filtered.length }}</span></h1><p>{{ app.page === 'favorites' ? '已收藏的工具' : app.page === 'recent' ? '按最近打开时间排列' : '你的日常工作，从这里开始。' }}</p></div><div class="catalog-summary"><span><strong>{{ tools.length.toString().padStart(2, '0') }}</strong>工具</span><i /><button @click="app.open('git')"><strong>{{ (app.state?.projects.length || 0).toString().padStart(2, '0') }}</strong>项目<ArrowUpRight :size="14" /></button></div></div>
          <section v-if="app.page === 'home' && recentTools.length && !search" class="recent-strip" aria-label="最近使用的工具"><span class="section-kicker"><History :size="15" />最近使用</span><div class="recent-tools"><button v-for="tool in recentTools" :key="tool.id" @click="app.open(tool.id)"><component :is="tool.icon" :size="16" />{{ tool.name }}<ArrowUpRight :size="13" /></button></div></section>
          <div class="library-layout">
            <section class="library-main" aria-label="工具目录">
              <div class="catalog-toolbar"><div class="tabs" aria-label="工具分类"><button v-for="item in ['全部', '开发工具', '文本工具']" :key="item" :class="{ selected: category === item }" @click="category = item">{{ item }}<span v-if="item === '全部'">{{ tools.length }}</span></button></div><label class="search-box"><Search :size="17" /><input v-model="search" aria-label="搜索工具" placeholder="搜索工具…" /><button v-if="search" class="icon-button" title="清除搜索" @click="search = ''"><X :size="15" /></button></label></div>
              <div class="tool-grid"><article v-for="tool in filtered" :key="tool.id" class="tool-card"><div class="card-top"><span :class="['tool-icon', tool.color]"><component :is="tool.icon" :size="25" :stroke-width="1.7" /></span><button class="icon-button favorite-button" :class="{ starred: app.state?.favorites.includes(tool.id) }" :title="app.state?.favorites.includes(tool.id) ? '取消收藏' : '收藏工具'" @click="favorite(tool.id)"><Star :size="17" :fill="app.state?.favorites.includes(tool.id) ? 'currentColor' : 'none'" /></button></div><button class="tool-title" @click="app.open(tool.id)">{{ tool.name }}<ArrowUpRight :size="18" /></button><p>{{ tool.description }}</p><div class="card-bottom"><span>{{ tool.category }}<span class="metadata-dot">·</span>{{ tool.tag }}</span><button class="open-tool" :title="`打开${tool.name}`" @click="app.open(tool.id)"><ArrowRight :size="17" /></button></div></article></div>
              <div v-if="!filtered.length" class="empty-inline"><Search v-if="search" :size="28" /><Star v-else-if="app.page === 'favorites'" :size="28" /><History v-else :size="28" /><strong>{{ search ? '没有找到匹配的工具' : app.page === 'favorites' ? '暂无收藏' : '暂无使用记录' }}</strong><button class="text-action" @click="catalog('home')">查看全部工具<ArrowRight :size="14" /></button></div>
              <footer class="catalog-footer"><span><CheckCircle2 :size="14" />本地工作空间</span><span>共 {{ filtered.length }} 个工具</span></footer>
            </section>
            <aside class="workspace-aside" aria-label="工作空间概览">
              <section class="aside-section"><div class="section-heading"><h2><FolderGit2 :size="17" />本地项目<span>{{ app.state?.projects.length || 0 }}</span></h2><button class="icon-button" title="管理项目" @click="app.open('git')"><ArrowUpRight :size="17" /></button></div><div v-if="!app.state?.projects.length" class="aside-empty"><FolderOpen :size="30" :stroke-width="1.4" /><strong>暂无项目</strong><span>{{ app.state?.desktop ? '尚未添加本地仓库' : '在桌面版中添加本地仓库' }}</span></div><div v-else class="home-projects"><button v-for="project in app.state.projects.slice(0, 4)" :key="project.id" @click="app.openProject(project.id)"><span class="mini-project-icon"><FolderGit2 :size="18" /></span><span><strong>{{ project.name }}</strong><small :title="project.path">{{ project.path }}</small></span><ChevronRight :size="14" /></button></div><el-button v-if="app.state?.desktop" class="add-project-inline" :loading="adding" @click="addProject"><Plus :size="15" />添加项目</el-button><button v-else class="text-action aside-action" @click="app.open('git')">打开 Git 工作台<ArrowRight :size="14" /></button></section>
              <section class="aside-section"><div class="section-heading"><h2><Activity :size="17" />最近操作</h2><button class="icon-button" title="全部操作记录" @click="app.page = 'history'; app.reload()"><ArrowUpRight :size="17" /></button></div><div v-if="!app.state?.history.length" class="aside-empty small"><span>暂无 Git 操作记录</span></div><div v-else class="activity-list"><div v-for="entry in app.state.history.slice(0, 4)" :key="entry.id"><span :class="['activity-dot', { failed: !entry.success }]" /><div><strong>{{ entry.action }}</strong><small>{{ entry.project }}</small></div><time>{{ date(entry.time) }}</time></div></div></section>
              <div class="workspace-footnote"><Monitor :size="15" /><span>Workbench<span>个人工作空间 · {{ app.state?.version }}</span></span></div>
            </aside>
          </div>
        </template>
        <GitTool v-else-if="app.page === 'git'" />
        <DataTools v-else-if="['json', 'text', 'time'].includes(app.page)" :key="app.page" :tool="app.page as 'json' | 'text' | 'time'" />
        <SettingsPanel v-else-if="app.page === 'settings'" />
        <template v-else-if="app.page === 'history'"><div class="page-heading"><div><div class="eyebrow">WORKSPACE / ACTIVITY</div><h1>操作记录<span class="title-tag">{{ app.state?.history.length || 0 }}</span></h1><p>最近 100 条 Git 操作记录</p></div><el-button @click="app.reload()">刷新</el-button></div><el-table :data="app.state?.history || []" empty-text="暂无操作记录"><el-table-column label="时间" width="180"><template #default="{row}">{{ new Date(row.time).toLocaleString('zh-CN') }}</template></el-table-column><el-table-column prop="project" label="项目" width="150" /><el-table-column prop="action" label="操作" width="130" /><el-table-column prop="detail" label="详情" min-width="240" /><el-table-column label="结果" width="90"><template #default="{row}"><el-tag :type="row.success ? 'success' : 'danger'">{{ row.success ? '成功' : '失败' }}</el-tag></template></el-table-column></el-table></template>
      </main>
    </div>
  </div>
</template>
