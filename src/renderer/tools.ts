import { GitBranch, Braces, ListFilter, Clock3 } from 'lucide-vue-next'
import type { ToolId } from '../shared/types'
export const tools = [
  { id: 'git' as ToolId, name: 'Git 项目管理', category: '开发工具', description: '项目集中管理，分支状态一目了然。', icon: GitBranch, color: 'green', tag: '本地项目' },
  { id: 'json' as ToolId, name: 'JSON 工作台', category: '开发工具', description: '格式化、校验与压缩 JSON 数据。', icon: Braces, color: 'blue', tag: '数据处理' },
  { id: 'text' as ToolId, name: '文本去重', category: '文本工具', description: '逐行去重、清理空白与文本排序。', icon: ListFilter, color: 'amber', tag: '文本处理' },
  { id: 'time' as ToolId, name: '时间戳转换', category: '开发工具', description: '在 Unix 时间戳和日期之间转换。', icon: Clock3, color: 'rose', tag: '日期时间' }
]
