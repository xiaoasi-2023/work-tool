<script setup lang="ts">
import { computed, onDeactivated, onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Copy, Trash2, Download, ListFilter } from 'lucide-vue-next'
import { tools } from '../tools'
import { processText, type TextAction } from '../../shared/toolkit'

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
const prefix = ref(''), suffix = ref(''), lastAction = ref('')
const statistics = computed(() => ({ chars: [...input.value].length, lines: input.value ? input.value.split(/\r?\n/).length : 0, bytes: new TextEncoder().encode(input.value).length }))
function saveDraft() { try { sessionStorage.setItem(`draft-${props.tool}`, JSON.stringify({ input: input.value })) } catch {} }
onMounted(() => window.addEventListener('pagehide', saveDraft))
onDeactivated(saveDraft)
onBeforeUnmount(() => { saveDraft(); window.removeEventListener('pagehide', saveDraft) })
async function copy(text: string) { try { await navigator.clipboard.writeText(text); ElMessage.success('已复制') } catch { ElMessage.error('复制失败，请选择文本手动复制') } }
function clear() { input.value = ''; output.value = ''; failure.value = '' }
function dedupe() {
  apply('dedupe')
}
function apply(action: TextAction) {
  output.value = processText(input.value, action, { trim: trim.value, ignoreEmpty: ignoreEmpty.value, ignoreCase: ignoreCase.value, sort: sort.value, prefix: prefix.value, suffix: suffix.value })
  removed.value = input.value.split(/\r?\n/).length - output.value.split(/\r?\n/).length
  lastAction.value = action; failure.value = ''
}
function download() {
  const url = URL.createObjectURL(new Blob([output.value], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = 'processed.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="data-tool text-tool">
  <div class="page-heading"><div><div class="eyebrow">{{ tool === 'text' ? 'TEXT' : 'DEVELOPMENT' }} / {{ tool.toUpperCase() }}</div><h1>{{ toolInfo.name }}</h1><p>{{ toolInfo.description }}</p></div><span class="heading-label"><span class="local-dot" />本地处理</span></div>
    <div class="editor-toolbar"><el-button type="primary" @click="dedupe"><ListFilter :size="16" />去重</el-button><el-checkbox v-model="trim">去除首尾空白</el-checkbox><el-checkbox v-model="ignoreEmpty">忽略空行</el-checkbox><el-checkbox v-model="ignoreCase">忽略大小写</el-checkbox><el-select v-model="sort" aria-label="文本排序" style="width:110px"><el-option value="none" label="原始顺序" /><el-option value="asc" label="升序" /><el-option value="desc" label="降序" /></el-select><span class="toolbar-spacer" /><button class="icon-button" title="清空" @click="clear"><Trash2 :size="16" /></button></div>
    <el-alert v-if="failure" :title="failure" type="error" :closable="false" class="tool-alert" />
    <div class="text-extra-toolbar"><el-select model-value="" aria-label="文本操作" placeholder="行与大小写操作" style="width:170px" @change="apply"><el-option v-for="item in [{id:'trim',name:'去除首尾空白'},{id:'empty',name:'移除空行'},{id:'asc',name:'升序排序'},{id:'desc',name:'降序排序'},{id:'reverse',name:'反转行顺序'},{id:'upper',name:'转为大写'},{id:'lower',name:'转为小写'},{id:'number',name:'添加行号'}]" :key="item.id" :value="item.id" :label="item.name" /></el-select><el-input v-model="prefix" aria-label="行前缀" placeholder="行前缀" /><el-input v-model="suffix" aria-label="行后缀" placeholder="行后缀" /><el-button @click="apply('prefix')">添加前后缀</el-button><el-button :disabled="!output" @click="input = output">结果作为输入</el-button><span class="utility-muted">{{ statistics.chars }} 字符 · {{ statistics.lines }} 行 · {{ statistics.bytes }} 字节</span></div>
    <div class="editors"><section class="editor-pane"><header><span>输入</span><span class="muted">{{ input.length.toLocaleString() }} 字符</span></header><textarea v-model="input" aria-label="文本输入" placeholder="粘贴需要处理的文本，每行一项…" spellcheck="false" /></section><section class="editor-pane"><header><span>输出<small v-if="output">{{ lastAction === 'dedupe' || lastAction === 'empty' ? `已移除 ${removed} 行` : '处理完成' }}</small></span><div class="button-row"><button class="icon-button" title="下载结果" :disabled="!output" @click="download"><Download :size="16" /></button><button class="icon-button" title="复制结果" :disabled="!output" @click="copy(output)"><Copy :size="16" /></button></div></header><textarea v-model="output" aria-label="处理结果" placeholder="处理结果" spellcheck="false" readonly /></section></div>
  </div>
</template>
