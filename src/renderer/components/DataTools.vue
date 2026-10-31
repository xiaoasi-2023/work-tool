<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Copy, Trash2, Braces, Minimize2, ArrowRight, Download, Play, Check, ListFilter, RefreshCw } from 'lucide-vue-next'
import { tools } from '../tools'
import { parse, stringify } from 'lossless-json'

const props = defineProps<{ tool: 'json' | 'text' | 'time' }>()
const toolInfo = computed(() => tools.find(t => t.id === props.tool)!)
const drafts = (() => { try { return JSON.parse(sessionStorage.getItem(`draft-${props.tool}`) || '{}') } catch { return {} } })()
const input = ref(drafts.input || '')
const output = ref('')
const failure = ref('')
const indent = ref(2)
const trim = ref(true)
const ignoreEmpty = ref(true)
const ignoreCase = ref(false)
const sort = ref('none')
const removed = ref(0)
const timestamp = ref('')
const unit = ref('seconds')
const datetime = ref('')
const converted = ref<{ local: string; utc: string; seconds: string; milliseconds: string } | null>(null)
const now = ref(Date.now())
const timer = setInterval(() => { now.value = Date.now() }, 1000)
onBeforeUnmount(() => { clearInterval(timer); sessionStorage.setItem(`draft-${props.tool}`, JSON.stringify({ input: input.value })) })
async function copy(text: string) { try { await navigator.clipboard.writeText(text); ElMessage.success('已复制') } catch { ElMessage.error('复制失败，请选择文本手动复制') } }
function clear() { input.value = ''; output.value = ''; failure.value = '' }
function format(compact = false) {
  try { output.value = stringify(parse(input.value), undefined, compact ? undefined : indent.value) || ''; failure.value = ''; ElMessage.success(compact ? '已压缩' : '已格式化') }
  catch (e) { failure.value = (e as Error).message; output.value = '' }
}
function dedupe() {
  const lines = input.value.split(/\r?\n/)
  const seen = new Set<string>()
  let result = lines.map((line: string) => trim.value ? line.trim() : line).filter((line: string) => {
    if (ignoreEmpty.value && !line.trim()) return false
    const key = ignoreCase.value ? line.toLowerCase() : line
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  if (sort.value !== 'none') result = result.sort((a: string, b: string) => a.localeCompare(b, 'zh-CN') * (sort.value === 'asc' ? 1 : -1))
  removed.value = lines.length - result.length; output.value = result.join('\n'); failure.value = ''
}
function download() {
  const url = URL.createObjectURL(new Blob([output.value], { type: props.tool === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = props.tool === 'json' ? 'formatted.json' : 'deduplicated.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function showDate(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new Error('日期无效或超出支持范围')
  converted.value = { local: date.toLocaleString('zh-CN', { hour12: false }), utc: date.toISOString(), seconds: String(Math.floor(date.getTime() / 1000)), milliseconds: String(date.getTime()) }
  failure.value = ''
}
function convertTimestamp() {
  try { if (!/^-?\d+$/.test(timestamp.value.trim())) throw new Error('请输入整数时间戳'); const value = Number(timestamp.value); if (!Number.isSafeInteger(value)) throw new Error('时间戳超出整数精度范围'); showDate(new Date(value * (unit.value === 'seconds' ? 1000 : 1))) } catch (e) { converted.value = null; failure.value = (e as Error).message }
}
function convertDate() {
  try {
    if (!datetime.value) throw new Error('请选择日期时间')
    const date = new Date(datetime.value)
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(datetime.value)
    if (!parts || date.getFullYear() !== +parts[1] || date.getMonth() + 1 !== +parts[2] || date.getDate() !== +parts[3]) throw new Error('日期无效')
    showDate(date)
  } catch (e) { converted.value = null; failure.value = (e as Error).message }
}
</script>

<template>
  <div :class="['data-tool', { 'text-tool': tool !== 'time' }]">
  <div class="page-heading"><div><div class="eyebrow">{{ tool === 'text' ? 'TEXT' : 'DEVELOPMENT' }} / {{ tool.toUpperCase() }}</div><h1>{{ toolInfo.name }}</h1><p>{{ toolInfo.description }}</p></div><span class="heading-label"><span class="local-dot" />本地处理</span></div>
  <template v-if="tool !== 'time'">
    <div class="editor-toolbar"><template v-if="tool === 'json'"><el-button type="primary" @click="format()"><Braces :size="16" />格式化</el-button><el-button @click="format(true)"><Minimize2 :size="15" />压缩</el-button><span class="muted">缩进</span><el-select v-model="indent" aria-label="JSON 缩进" style="width:85px"><el-option :value="2" label="2 空格" /><el-option :value="4" label="4 空格" /></el-select></template><template v-else><el-button type="primary" @click="dedupe"><ListFilter :size="16" />去重</el-button><el-checkbox v-model="trim">去除首尾空白</el-checkbox><el-checkbox v-model="ignoreEmpty">忽略空行</el-checkbox><el-checkbox v-model="ignoreCase">忽略大小写</el-checkbox><el-select v-model="sort" aria-label="文本排序" style="width:110px"><el-option value="none" label="原始顺序" /><el-option value="asc" label="升序" /><el-option value="desc" label="降序" /></el-select></template><span class="toolbar-spacer" /><button class="icon-button" title="清空" @click="clear"><Trash2 :size="16" /></button></div>
    <el-alert v-if="failure" :title="failure" type="error" :closable="false" class="tool-alert" />
    <div class="editors"><section class="editor-pane"><header><span>输入</span><span class="muted">{{ input.length.toLocaleString() }} 字符</span></header><textarea v-model="input" :aria-label="tool === 'json' ? 'JSON 输入' : '文本输入'" :placeholder="tool === 'json' ? '粘贴 JSON 数据…' : '粘贴需要处理的文本，每行一项…'" spellcheck="false" /></section><section class="editor-pane"><header><span>输出<small v-if="tool === 'text' && output">已移除 {{ removed }} 行</small></span><div class="button-row"><button class="icon-button" title="下载结果" :disabled="!output" @click="download"><Download :size="16" /></button><button class="icon-button" title="复制结果" :disabled="!output" @click="copy(output)"><Copy :size="16" /></button></div></header><textarea v-model="output" aria-label="处理结果" placeholder="处理结果" spellcheck="false" readonly /></section></div>
  </template>
  <template v-else>
    <div class="current-time"><span>当前 Unix 时间戳</span><strong>{{ Math.floor(now / 1000) }}</strong><button class="icon-button" title="复制当前时间戳" @click="copy(String(Math.floor(now / 1000)))"><Copy :size="17" /></button><span class="timezone">{{ Intl.DateTimeFormat().resolvedOptions().timeZone }}</span></div>
    <section class="time-section"><h2>时间戳 → 日期</h2><div class="time-form"><el-input v-model="timestamp" aria-label="Unix 时间戳" placeholder="输入时间戳" @keyup.enter="convertTimestamp" /><el-select v-model="unit" aria-label="时间戳单位"><el-option value="seconds" label="秒 (s)" /><el-option value="milliseconds" label="毫秒 (ms)" /></el-select><button class="icon-button" title="填入当前时间" @click="timestamp = String(unit === 'seconds' ? Math.floor(Date.now()/1000) : Date.now())"><RefreshCw :size="17" /></button><el-button type="primary" @click="convertTimestamp">转换<ArrowRight :size="15" /></el-button></div></section>
    <section class="time-section"><h2>日期 → 时间戳</h2><div class="time-form"><input v-model="datetime" aria-label="日期时间" class="datetime-input" type="datetime-local" step="1" /><span class="muted">本地时区</span><el-button type="primary" @click="convertDate">转换<ArrowRight :size="15" /></el-button></div></section>
    <el-alert v-if="failure" :title="failure" type="error" :closable="false" />
    <section v-if="converted" class="conversion-results"><h2><Check :size="17" />转换结果</h2><div v-for="(value, key) in converted" :key="key"><span>{{ {local: '本地时间', utc: 'UTC 时间', seconds: '时间戳 · 秒', milliseconds: '时间戳 · 毫秒'}[key] }}</span><code>{{ value }}</code><button class="icon-button" :title="`复制${key}`" @click="copy(value)"><Copy :size="15" /></button></div></section>
  </template>
  </div>
</template>
