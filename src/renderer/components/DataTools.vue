<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Copy, Trash2, Download, ListFilter } from 'lucide-vue-next'
import { tools } from '../tools'

const props = defineProps<{ tool: 'text' }>()
const toolInfo = computed(() => tools.find(t => t.id === props.tool)!)
const drafts = (() => { try { return JSON.parse(sessionStorage.getItem(`draft-${props.tool}`) || '{}') } catch { return {} } })()
const input = ref(drafts.input || '')
const output = ref('')
const failure = ref('')
const trim = ref(true)
const ignoreEmpty = ref(true)
const ignoreCase = ref(false)
const sort = ref('none')
const removed = ref(0)
onBeforeUnmount(() => { sessionStorage.setItem(`draft-${props.tool}`, JSON.stringify({ input: input.value })) })
async function copy(text: string) { try { await navigator.clipboard.writeText(text); ElMessage.success('已复制') } catch { ElMessage.error('复制失败，请选择文本手动复制') } }
function clear() { input.value = ''; output.value = ''; failure.value = '' }
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
  const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = 'deduplicated.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="data-tool text-tool">
  <div class="page-heading"><div><div class="eyebrow">{{ tool === 'text' ? 'TEXT' : 'DEVELOPMENT' }} / {{ tool.toUpperCase() }}</div><h1>{{ toolInfo.name }}</h1><p>{{ toolInfo.description }}</p></div><span class="heading-label"><span class="local-dot" />本地处理</span></div>
    <div class="editor-toolbar"><el-button type="primary" @click="dedupe"><ListFilter :size="16" />去重</el-button><el-checkbox v-model="trim">去除首尾空白</el-checkbox><el-checkbox v-model="ignoreEmpty">忽略空行</el-checkbox><el-checkbox v-model="ignoreCase">忽略大小写</el-checkbox><el-select v-model="sort" aria-label="文本排序" style="width:110px"><el-option value="none" label="原始顺序" /><el-option value="asc" label="升序" /><el-option value="desc" label="降序" /></el-select><span class="toolbar-spacer" /><button class="icon-button" title="清空" @click="clear"><Trash2 :size="16" /></button></div>
    <el-alert v-if="failure" :title="failure" type="error" :closable="false" class="tool-alert" />
    <div class="editors"><section class="editor-pane"><header><span>输入</span><span class="muted">{{ input.length.toLocaleString() }} 字符</span></header><textarea v-model="input" aria-label="文本输入" placeholder="粘贴需要处理的文本，每行一项…" spellcheck="false" /></section><section class="editor-pane"><header><span>输出<small v-if="output">已移除 {{ removed }} 行</small></span><div class="button-row"><button class="icon-button" title="下载结果" :disabled="!output" @click="download"><Download :size="16" /></button><button class="icon-button" title="复制结果" :disabled="!output" @click="copy(output)"><Copy :size="16" /></button></div></header><textarea v-model="output" aria-label="处理结果" placeholder="处理结果" spellcheck="false" readonly /></section></div>
  </div>
</template>
