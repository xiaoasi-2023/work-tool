import { contextBridge, ipcRenderer } from 'electron'
import type { ToolboxApi } from '../shared/types'

const api: ToolboxApi = {
  state: () => ipcRenderer.invoke('state'),
  addProject: () => ipcRenderer.invoke('project:add'),
  removeProject: id => ipcRenderer.invoke('project:remove', id),
  inspect: (id, base) => ipcRenderer.invoke('git:inspect', id, base),
  fetch: id => ipcRenderer.invoke('git:fetch', id),
  checkout: (id, ref) => ipcRenderer.invoke('git:checkout', id, ref),
  deleteBranches: request => ipcRenderer.invoke('git:delete', request),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  favorite: id => ipcRenderer.invoke('favorite', id),
  visit: id => ipcRenderer.invoke('visit', id),
  chooseGit: () => ipcRenderer.invoke('git:choose'),
  gitVersion: () => ipcRenderer.invoke('git:version'),
  openData: () => ipcRenderer.invoke('data:open'),
  managementState: () => ipcRenderer.invoke('management:state'),
  managementMutate: request => ipcRenderer.invoke('management:mutate', request),
  managementBackup: () => ipcRenderer.invoke('management:backup'),
  managementRestore: () => ipcRenderer.invoke('management:restore'),
  managementBackups: page => ipcRenderer.invoke('management:backups', page),
  managementCreateBackup: () => ipcRenderer.invoke('management:backup-create'),
  managementBackupDownload: id => ipcRenderer.invoke('management:backup-download', id),
  managementBackupRestore: (id, revision) => ipcRenderer.invoke('management:backup-restore', id, revision)
}
contextBridge.exposeInMainWorld('toolbox', api)
