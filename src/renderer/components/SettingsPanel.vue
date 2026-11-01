<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderOpen, Save, RefreshCw, Sun, Moon } from 'lucide-vue-next'
import { api } from '../api'
import { useApp } from '../store'
import type { Settings } from '../../shared/types'
const app = useApp()
const settings = ref<Settings>({ gitPath: 'git', protectedBranches: ['main', 'master', 'develop', 'release/*'], theme: 'light' })
const patterns = ref('')
const version = ref('')
const busy = ref(false)
const testing = ref(false)
const loaded = ref(false)
const switchingTheme = ref(false)
function loadSettings() { settings.value = { ...app.state!.settings, protectedBranches: [...app.state!.settings.protectedBranches] }; patterns.value = settings.value.protectedBranches.join('\n') }
onMounted(async () => { await app.reload(); loadSettings(); loaded.value = true })
watch(() => app.state?.settings.theme, theme => { if (theme) settings.value.theme = theme })
async function changeTheme(value: unknown) {
  if ((value !== 'light' && value !== 'dark') || switchingTheme.value || !loaded.value) return
  const previous = settings.value.theme
  settings.value.theme = value; switchingTheme.value = true
  try { await app.setTheme(value) }
  catch (e) { settings.value.theme = previous; ElMessage.error(`外观保存失败：${String(e)}`) }
  finally { switchingTheme.value = false }
}
async function save() {
  busy.value = true
  try { await api.saveSettings({ ...settings.value, protectedBranches: patterns.value.split('\n').map(s => s.trim()).filter(Boolean) }); await app.reload(); loadSettings(); ElMessage.success('设置已保存') } catch (e) { ElMessage.error(String(e)) } finally { busy.value = false }
}
async function choose() { try { const path = await api.chooseGit(); if (path) settings.value.gitPath = path } catch (e) { ElMessage.error(String(e)) } }
async function check() { testing.value = true; try { version.value = await api.gitVersion() } catch (e) { version.value = String(e) } finally { testing.value = false } }
async function openData() { try { await api.openData() } catch (e) { ElMessage.error(String(e)) } }
</script>
<template>
  <div class="page-heading"><div><div class="eyebrow">PREFERENCES</div><h1>设置</h1><p>工作空间偏好</p></div><el-button type="primary" :loading="busy" :disabled="!loaded || switchingTheme" @click="save"><Save :size="16" />保存设置</el-button></div>
  <div class="settings-layout">
    <section class="settings-section">
      <div class="settings-label"><h2>外观</h2></div>
      <div class="settings-value"><el-radio-group class="appearance-options" :model-value="settings.theme" :disabled="!loaded || busy || switchingTheme" aria-label="外观主题" @update:model-value="changeTheme"><el-radio-button value="light"><Sun :size="22" />浅色</el-radio-button><el-radio-button value="dark"><Moon :size="22" />深色</el-radio-button></el-radio-group></div>
    </section>
    <section class="settings-section">
      <div class="settings-label"><h2>Git 可执行文件</h2><span>默认使用系统 PATH 中的 Git</span></div>
      <div class="settings-value"><div class="button-row"><el-input v-model="settings.gitPath" aria-label="Git 可执行文件路径" /><button class="icon-button bordered" title="选择 Git 可执行文件" @click="choose"><FolderOpen :size="17" /></button></div><div class="setting-secondary"><el-button size="small" :loading="testing" @click="check"><RefreshCw :size="13" />检查已保存的 Git 配置</el-button><code>{{ version }}</code></div></div>
    </section>
    <section class="settings-section">
      <div class="settings-label"><h2>保护分支</h2><span>每行一个规则，支持 * 通配符</span><small>main、master、develop 始终保护</small></div>
      <div class="settings-value"><el-input v-model="patterns" type="textarea" :rows="5" aria-label="保护分支规则" /></div>
    </section>
    <section class="settings-section">
      <div class="settings-label"><h2>本地数据</h2><span>项目列表、偏好与操作记录</span></div>
      <div class="settings-value"><code class="data-path">{{ app.state?.dataPath || '浏览器本地存储' }}</code><el-button :disabled="!app.state?.desktop" @click="openData"><FolderOpen :size="15" />打开数据目录</el-button></div>
    </section>
    <section class="settings-section">
      <div class="settings-label"><h2>关于 Workbench</h2></div>
      <div class="settings-value"><strong>Workbench {{ app.state?.version }}</strong><p class="muted">{{ app.state?.desktop ? 'Windows 桌面版 · SQLite 本地存储' : '浏览器预览' }}</p></div>
    </section>
  </div>
</template>
