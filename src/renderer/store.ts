import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from './api'
import type { AppState, ToolId } from '../shared/types'

export const useApp = defineStore('app', () => {
  const state = ref<AppState | null>(null)
  const page = ref<ToolId | 'home' | 'favorites' | 'recent' | 'settings' | 'history'>('home')
  const activeProjectId = ref<string | null>(null)
  async function reload() { state.value = await api.state(); document.documentElement.dataset.theme = state.value.settings.theme }
  async function open(id: ToolId) { page.value = id; await api.visit(id); await reload() }
  async function favorite(id: ToolId) { await api.favorite(id); await reload() }
  async function openProject(id: string) { activeProjectId.value = id; await open('git') }
  return { state, page, activeProjectId, reload, open, openProject, favorite }
})
