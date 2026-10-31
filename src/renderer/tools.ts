import { GitBranch, Braces, ListFilter, Clock3 } from 'lucide-vue-next'
import type { ToolId } from '../shared/types'
export const tools = [
  { id: 'git' as ToolId, name: 'Git 项目管理', category: '开发工具', description: '项目集中管理，分支状态一目了然。', icon: GitBranch, color: 'green', tag: '本地项目' },
  { id: 'json' as ToolId, name: 'JSON 工作台', category: '开发工具', description: '格式化、结构编辑与 JSON 差异对比。', icon: Braces, color: 'blue', tag: '数据处理' },
  { id: 'text' as ToolId, name: '文本去重', category: '文本工具', description: '逐行去重、清理空白与文本排序。', icon: ListFilter, color: 'amber', tag: '文本处理' },
  { id: 'time' as ToolId, name: '时间戳转换', category: '开发工具', description: '高精度时间戳、时区、批量转换与日期计算。', icon: Clock3, color: 'rose', tag: '日期时间' }
]
