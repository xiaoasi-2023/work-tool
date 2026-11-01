import { GitBranch, Braces, ListFilter, Clock3, Binary, GitCompareArrows, KeyRound, Dices, Regex, Fingerprint } from 'lucide-vue-next'
import type { ToolId } from '../shared/types'
export const tools = [
  { id: 'git' as ToolId, name: 'Git 项目管理', category: '开发工具', description: '项目集中管理，分支状态一目了然。', icon: GitBranch, color: 'green', tag: '本地项目' },
  { id: 'json' as ToolId, name: 'JSON 工作台', category: '开发工具', description: '格式化、结构编辑与 JSON 差异对比。', icon: Braces, color: 'blue', tag: '数据处理' },
  { id: 'text' as ToolId, name: '文本工作台', category: '文本工具', description: '去重、排序、行处理、大小写与文本统计。', icon: ListFilter, color: 'amber', tag: '文本处理' },
  { id: 'time' as ToolId, name: '时间戳转换', category: '开发工具', description: '高精度时间戳、时区、批量转换与日期计算。', icon: Clock3, color: 'rose', tag: '日期时间' },
  { id: 'codec' as ToolId, name: '编码解码', category: '开发工具', description: 'Base64、URL、Unicode 与 HTML 实体双向转换。', icon: Binary, color: 'blue', tag: '编码转换' },
  { id: 'compare' as ToolId, name: '文本对比', category: '文本工具', description: '按行或单词比较、忽略空白、导出差异补丁。', icon: GitCompareArrows, color: 'green', tag: '差异对比' },
  { id: 'jwt' as ToolId, name: 'JWT 解析', category: '开发工具', description: '解析 Header、Payload 与有效期状态。', icon: KeyRound, color: 'rose', tag: '令牌解析' },
  { id: 'random' as ToolId, name: 'UUID 与随机数据', category: '开发工具', description: '批量 UUID v4/v7、随机字符串与密码生成。', icon: Dices, color: 'amber', tag: '数据生成' },
  { id: 'regex' as ToolId, name: '正则表达式', category: '文本工具', description: '实时匹配、高亮、捕获组与替换预览。', icon: Regex, color: 'blue', tag: '模式匹配' },
  { id: 'hash' as ToolId, name: '哈希校验', category: '开发工具', description: 'MD5、SHA-256、SHA-512，文本与文件校验。', icon: Fingerprint, color: 'green', tag: '摘要校验' }
]
