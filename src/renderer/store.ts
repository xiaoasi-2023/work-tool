import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from './api'
import type { AppState, Settings, ToolId } from '../shared/types'

export const useApp = defineStore('app', () => {
  const state = ref<AppState | null>(null)
  const page = ref<ToolId | 'home' | 'favorites' | 'recent' | 'settings' | 'history'>('home')
  const activeProjectId = ref<string | null>(null)
  const pendingTheme = ref<Settings['theme'] | null>(null)
  async function reload() { state.value = await api.state(); document.documentElement.dataset.theme = pendingTheme.value || state.value.settings.theme }
  async function setTheme(theme: Settings['theme']) {
    const previous = state.value?.settings.theme || 'light'
    pendingTheme.value = theme
    document.documentElement.dataset.theme = theme
    try {
      // Persist only the appearance change, leaving other settings drafts untouched.
      const saved = await api.state()
      await api.saveSettings({ ...saved.settings, theme })
      if (state.value) state.value.settings.theme = theme
    } catch (error) {
      document.documentElement.dataset.theme = previous
      throw error
    } finally { pendingTheme.value = null }
  }
  async function open(id: ToolId) { page.value = id; await api.visit(id); await reload() }
  async function favorite(id: ToolId) { await api.favorite(id); await reload() }
  async function openProject(id: string) { activeProjectId.value = id; await open('git') }
  return { state, page, activeProjectId, reload, setTheme, open, openProject, favorite }
})
