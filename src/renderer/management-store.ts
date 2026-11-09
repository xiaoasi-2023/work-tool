import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from './api'
import { emptyManagementState, weekStart } from '../shared/management'
import type { ManagementCommand, ManagementEntity, ManagementState } from '../shared/management'

export const useManagement = defineStore('management', () => {
  const state = ref<ManagementState>(emptyManagementState())
  const loading = ref(false), busy = ref(false), ready = ref(false), error = ref('')
  const week = ref(weekStart())
  const projectId = ref('')
  async function load() {
    loading.value = true
    try { state.value = await api.managementState(); ready.value = true; error.value = '' }
    catch (e) { error.value = (e as Error).message; throw e }
    finally { loading.value = false }
  }
  async function mutate(command: ManagementCommand) {
    if (busy.value) throw new Error('上一项操作尚未完成，请稍后重试')
    busy.value = true
    try {
      const next = await api.managementMutate({ revision: state.value.revision, command: JSON.parse(JSON.stringify(command)) as ManagementCommand })
      state.value = next; error.value = ''; return next
    } catch (e) {
      try { state.value = await api.managementState() } catch {}
      throw e
    } finally { busy.value = false }
  }
  async function execute(command: ManagementCommand) {
    try { await mutate(command); return true }
    catch (e) { ElMessage.error((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')); return false }
  }
  const save = (entity: ManagementEntity, value: object, reason?: string) => execute({ type: 'upsert', entity, value: { ...value }, reason })
  const remove = (entity: ManagementEntity, id: string, reason?: string) => execute({ type: 'delete', entity, id, reason })
  const projectName = (id: string) => state.value.projects.find(p => p.id === id)?.name || '未指定'
  const personName = (id: string) => state.value.people.find(p => p.id === id)?.name || '未分配'
  const versionName = (id: string) => { const v = state.value.versions.find(v => v.id === id); return v ? `${v.code} · ${v.name}` : '未指定' }
  return { state, loading, busy, ready, error, week, projectId, load, reload: load, mutate, execute, command: mutate, save, upsert: save, remove, projectName, personName, versionName }
})
