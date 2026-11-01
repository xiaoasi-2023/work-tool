export const toolIds = ['git', 'json', 'text', 'time', 'codec', 'compare', 'jwt', 'random', 'regex', 'hash'] as const
export type ToolId = typeof toolIds[number]
export interface Settings { gitPath: string; protectedBranches: string[]; theme: 'light' | 'dark' }
export interface Project { id: string; name: string; path: string; addedAt: string }
export interface Branch {
  ref: string; name: string; kind: 'local' | 'remote'; remote: string; remoteBranch: string;
  hash: string; subject: string; author: string; date: string; upstream: string;
  current: boolean; protected: boolean; occupied: boolean; merged: boolean;
  ahead: number; behind: number;
}
export interface RepoDetail {
  current: string; dirty: number; branches: Branch[]; baseRef: string;
  remotes: string[]; detached: boolean;
}
export interface HistoryEntry { id: number; time: string; project: string; action: string; detail: string; success: boolean }
export interface AppState {
  projects: Project[]; favorites: ToolId[]; recent: ToolId[]; settings: Settings;
  history: HistoryEntry[]; dataPath: string; version: string; desktop: boolean;
}
export interface DeleteRequest { projectId: string; refs: string[]; baseRef: string; force: boolean; expected: Record<string, string> }
export interface DeleteResult { ref: string; success: boolean; message: string }
export interface ToolboxApi {
  state(): Promise<AppState>;
  addProject(): Promise<Project | null>;
  removeProject(id: string): Promise<void>;
  inspect(id: string, baseRef?: string): Promise<RepoDetail>;
  fetch(id: string): Promise<void>;
  checkout(id: string, ref: string): Promise<void>;
  deleteBranches(request: DeleteRequest): Promise<DeleteResult[]>;
  saveSettings(settings: Settings): Promise<void>;
  favorite(id: ToolId): Promise<void>;
  visit(id: ToolId): Promise<void>;
  chooseGit(): Promise<string | null>;
  gitVersion(): Promise<string>;
  openData(): Promise<void>;
}
