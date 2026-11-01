<script setup lang="ts">
import { computed, nextTick, onDeactivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowRightLeft, Braces, CheckCheck, Check, Code2, Copy, Download, FileJson, FileUp, GitCompareArrows, ListOrdered, ListTree, Maximize2, Minimize2, Redo2, Search, Trash2, Undo2, ChevronsDownUp, ChevronsUpDown } from 'lucide-vue-next'
import { parseJson, printJson, sortJson } from '../../shared/json'
import JsonCodeEditor from './JsonCodeEditor.vue'
import JsonTree from './JsonTree.vue'
import JsonCompare from './JsonCompare.vue'

function read(key: string, storage: Storage) { try { return JSON.parse(storage.getItem(key) || '{}') || {} } catch { return {} } }
const draft = read('draft-json', sessionStorage), prefs = read('json-preferences', localStorage)
const input = ref(typeof draft.input === 'string' ? draft.input : '')
const output = ref(typeof draft.output === 'string' ? draft.output : '')
const inputFormat = ref<'json' | 'yaml'>(draft.inputFormat === 'yaml' ? 'yaml' : 'json')
const outputFormat = ref<'json' | 'yaml'>(draft.outputFormat === 'yaml' ? 'yaml' : 'json')
const mode = ref<'code' | 'tree' | 'compare'>('code')
const focusedPane = ref<'input' | 'output' | null>(null)
const feedback = ref(''), resultRevision = ref(0)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
function notify(message: string) { feedback.value = message; clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => { feedback.value = '' }, 2200) }
const indent = ref<number | string>([2, 4, '\t'].includes(prefs.indent) ? prefs.indent : 2)
const numbers = ref(prefs.numbers !== false), wrap = ref(prefs.wrap !== false), ignoreOrder = ref(true)
const failure = ref(''), active = ref<'input' | 'output'>('input')
const inputEditor = ref<InstanceType<typeof JsonCodeEditor>>(), outputEditor = ref<InstanceType<typeof JsonCodeEditor>>(), compareEditor = ref<InstanceType<typeof JsonCompare>>()
const treeEditor = ref<InstanceType<typeof JsonTree>>()
type Status = { line: number; column: number; lines: number; undo: boolean; redo: boolean }
const emptyStatus: Status = { line: 1, column: 1, lines: 1, undo: false, redo: false }
const statuses = ref({ input: { ...emptyStatus }, output: { ...emptyStatus } })
const status = computed(() => statuses.value[active.value])
const currentText = computed(() => active.value === 'input' ? input.value : output.value)
const filePicker = ref<HTMLInputElement>(), fileTarget = ref<'input' | 'output'>('input')
let draftTimer: ReturnType<typeof setTimeout> | undefined
function saveDraft() { try { sessionStorage.setItem('draft-json', JSON.stringify({ input: input.value, output: output.value, inputFormat: inputFormat.value, outputFormat: outputFormat.value })) } catch {} }
watch([input, output], () => { failure.value = ''; clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 300) })
watch([indent, numbers, wrap], () => { try { localStorage.setItem('json-preferences', JSON.stringify({ indent: indent.value, numbers: numbers.value, wrap: wrap.value })) } catch {} })
onMounted(() => window.addEventListener('pagehide', saveDraft))
onDeactivated(saveDraft)
onBeforeUnmount(() => { clearTimeout(feedbackTimer); clearTimeout(draftTimer); saveDraft(); window.removeEventListener('pagehide', saveDraft) })
function result(value: string, format: 'json' | 'yaml' = 'json') { outputFormat.value = format; output.value = value; active.value = 'output'; resultRevision.value++; focusedPane.value = focusedPane.value === 'input' ? null : focusedPane.value; notify('结果已更新') }
async function transform(action: 'format' | 'compact' | 'sort' | 'escape' | 'unescape' | 'yaml' | 'json') {
  try {
    failure.value = ''
    if (!currentText.value.trim()) throw new Error('请输入 JSON 数据')
    if (action === 'yaml' || action === 'json') {
      const source = currentText.value
      const format = action === 'json' ? 'yaml' : 'json'
      if (active.value === 'input') inputFormat.value = format; else outputFormat.value = format
      const { jsonToYaml, yamlToJson } = await import('../../shared/yaml')
      result(action === 'yaml' ? jsonToYaml(source) : yamlToJson(source, indent.value), action === 'yaml' ? 'yaml' : 'json')
      return
    }
    if (action === 'escape') { result(printJson(currentText.value, 0)); return }
    const value = parseJson(currentText.value)
    if (action === 'unescape') {
      if (typeof value !== 'string') throw new Error('反转义需要 JSON 字符串')
      result(value)
    } else result(printJson(action === 'sort' ? sortJson(value) : value, action === 'compact' ? 0 : indent.value))
  } catch (error) { failure.value = (error as Error).message }
}
function validate() {
  try { parseJson(currentText.value); failure.value = ''; ElMessage.success('JSON 校验通过') }
  catch (error) { failure.value = (error as Error).message }
}
function command(name: 'undo' | 'redo' | 'search' | 'fold' | 'unfold') {
  if (mode.value === 'tree' && active.value === 'output') {
    if (name === 'fold' || name === 'unfold') { treeEditor.value?.[name](); return }
    if (name === 'search') { mode.value = 'code'; void nextTick(() => outputEditor.value?.search()); return }
  }
  const editor = mode.value === 'compare' ? compareEditor.value : active.value === 'input' ? inputEditor.value : outputEditor.value
  editor?.[name]()
}
function normalizeComparison() {
  try {
    let left, right
    try { left = parseJson(input.value) } catch (error) { throw new Error(`原始 JSON：${(error as Error).message}`) }
    try { right = parseJson(output.value) } catch (error) { throw new Error(`对比 JSON：${(error as Error).message}`) }
    input.value = printJson(ignoreOrder.value ? sortJson(left) : left, indent.value)
    output.value = printJson(ignoreOrder.value ? sortJson(right) : right, indent.value)
    failure.value = ''
  } catch (error) { failure.value = (error as Error).message }
}
function switchMode(next: 'code' | 'tree' | 'compare') {
  mode.value = next
  if (next === 'tree') {
    active.value = 'output'
    if (!output.value && input.value.trim()) {
      try { output.value = printJson(parseJson(input.value), indent.value) }
      catch { /* The tree displays the input parse error. */ }
    }
  }
  if (next === 'compare' && input.value.trim() && output.value.trim()) normalizeComparison()
}
function navigateViews(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const modes = ['code', 'tree', 'compare'] as const
  const index = modes.indexOf(mode.value)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3
  const tabs = event.currentTarget as HTMLElement
  switchMode(modes[next]!)
  void nextTick(() => tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus())
}
function swap() { [input.value, output.value] = [output.value, input.value]; [inputFormat.value, outputFormat.value] = [outputFormat.value, inputFormat.value] }
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); ElMessage.success('已复制') }
  catch { ElMessage.error('复制失败，请选择文本手动复制') }
}
function download(value: string, name: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function chooseFile(target: 'input' | 'output') { fileTarget.value = target; filePicker.value?.click() }
async function importFile(event: Event) {
  const picker = event.target as HTMLInputElement, file = picker.files?.[0]
  if (!file) return
  const target = fileTarget.value
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请拆分后导入')
    const text = (await file.text()).replace(/^\uFEFF/, '')
    if (target === 'input') { input.value = text; inputFormat.value = 'json' } else { output.value = text; outputFormat.value = 'json' }
    active.value = target
  } catch (error) { failure.value = (error as Error).message }
  finally { picker.value = '' }
}
function sample() {
  inputFormat.value = 'json'
  input.value = '{"name":"Workbench","version":"0.1.2","enabled":true,"id":90071992547409931234,"tools":[{"name":"JSON","tags":["format","compare"]},{"name":"Git","tags":[]}],"metadata":null}'
  active.value = 'input'; result(printJson(parseJson(input.value), indent.value))
}
</script>

<template>
  <div class="json-workbench" @keydown.ctrl.enter.prevent="mode === 'compare' ? normalizeComparison() : transform('format')">
    <div class="json-heading"><h1><Braces :size="21" />JSON 工作台</h1><div class="json-view-tabs" role="tablist" aria-label="JSON 视图" @keydown="navigateViews"><span class="json-view-indicator" :style="{ transform: `translateX(${mode === 'code' ? 0 : mode === 'tree' ? 100 : 200}%)` }" /><button v-for="tab in [{ id: 'code' as const, name: '代码', icon: Code2 }, { id: 'tree' as const, name: '结构', icon: ListTree }, { id: 'compare' as const, name: '对比', icon: GitCompareArrows }]" :key="tab.id" role="tab" :tabindex="mode === tab.id ? 0 : -1" :aria-selected="mode === tab.id" :class="{ selected: mode === tab.id }" @click="switchMode(tab.id)"><component :is="tab.icon" :size="15" />{{ tab.name }}</button></div></div>
    <div class="json-toolbar">
      <el-button type="primary" @click="mode === 'compare' ? normalizeComparison() : transform('format')"><Braces :size="15" />{{ mode === 'compare' ? '标准化对比' : '格式化' }}</el-button>
      <button class="icon-button bordered" title="压缩 JSON" aria-label="压缩 JSON" @click="transform('compact')"><Minimize2 :size="16" /></button><button class="icon-button bordered" title="校验 JSON" aria-label="校验 JSON" @click="validate"><CheckCheck :size="16" /></button><button class="icon-button bordered" title="递归排序键" aria-label="递归排序键" @click="transform('sort')"><ListOrdered :size="16" /></button>
      <span class="json-toolbar-divider" />
      <button class="icon-button" title="撤销" aria-label="撤销" :disabled="mode !== 'compare' && !status.undo" @click="command('undo')"><Undo2 :size="16" /></button><button class="icon-button" title="重做" aria-label="重做" :disabled="mode !== 'compare' && !status.redo" @click="command('redo')"><Redo2 :size="16" /></button><button class="icon-button" title="查找与替换" aria-label="查找与替换" @click="command('search')"><Search :size="16" /></button><button class="icon-button" title="折叠代码" aria-label="折叠代码" @click="command('fold')"><ChevronsDownUp :size="16" /></button><button class="icon-button" title="展开代码" aria-label="展开代码" @click="command('unfold')"><ChevronsUpDown :size="16" /></button>
      <span class="toolbar-spacer" />
      <el-select :model-value="''" placeholder="转换" aria-label="JSON 转换" class="json-convert" @change="transform"><el-option value="escape" label="JSON 转义" /><el-option value="unescape" label="JSON 反转义" /><el-option value="yaml" label="JSON → YAML" /><el-option value="json" label="YAML → JSON" /></el-select>
      <button class="icon-button" title="载入示例" aria-label="载入示例" @click="sample"><FileJson :size="17" /></button><button class="icon-button" title="交换两侧内容" aria-label="交换两侧内容" @click="swap"><ArrowRightLeft :size="17" /></button>
    </div>
    <div class="json-options"><label class="json-indent-label">缩进<el-select v-model="indent" aria-label="JSON 缩进"><el-option :value="2" label="2 空格" /><el-option :value="4" label="4 空格" /><el-option :value="'\t'" label="Tab" /></el-select></label><el-checkbox v-model="numbers">行号</el-checkbox><el-checkbox v-model="wrap">自动换行</el-checkbox><el-checkbox v-if="mode === 'compare'" v-model="ignoreOrder" @change="normalizeComparison">忽略键顺序</el-checkbox><span class="toolbar-spacer" /><span class="json-local-label"><span class="local-dot" />本地处理</span></div>
    <el-alert v-if="failure" :title="failure" type="error" :closable="false" class="json-failure" />
    <div v-show="mode !== 'compare'" :class="['json-panels', { 'pane-focused': focusedPane }]">
      <section v-show="!focusedPane || focusedPane === 'input'" class="json-pane"><header><strong>输入</strong><span class="muted">{{ input.length.toLocaleString() }} 字符</span><span class="toolbar-spacer" /><button class="icon-button" :title="focusedPane === 'input' ? '恢复双栏' : '放大输入'" :aria-label="focusedPane === 'input' ? '恢复双栏' : '放大输入'" @click="focusedPane = focusedPane === 'input' ? null : 'input'"><component :is="focusedPane === 'input' ? Minimize2 : Maximize2" :size="15" /></button><button class="icon-button" title="导入输入 JSON" aria-label="导入输入 JSON" @click="chooseFile('input')"><FileUp :size="15" /></button><button class="icon-button" title="复制输入" aria-label="复制输入" :disabled="!input" @click="copy(input)"><Copy :size="15" /></button><button class="icon-button danger-hover" title="清空输入" aria-label="清空输入" :disabled="!input" @click="input = ''"><Trash2 :size="15" /></button></header><JsonCodeEditor ref="inputEditor" v-model="input" :format="inputFormat" label="JSON 输入" :line-numbers="numbers" :wrap="wrap" :indent="indent" @focus="active = 'input'" @status="statuses.input = $event" /></section>
      <section v-show="!focusedPane || focusedPane === 'output'" :class="['json-pane', { 'result-flash': feedback }]" :data-revision="resultRevision"><header><strong>{{ mode === 'tree' ? '结构编辑' : outputFormat === 'yaml' ? 'YAML 结果' : '结果' }}</strong><span class="muted">{{ output.length.toLocaleString() }} 字符</span><span class="toolbar-spacer" /><button class="icon-button" :title="focusedPane === 'output' ? '恢复双栏' : '放大结果'" :aria-label="focusedPane === 'output' ? '恢复双栏' : '放大结果'" @click="focusedPane = focusedPane === 'output' ? null : 'output'"><component :is="focusedPane === 'output' ? Minimize2 : Maximize2" :size="15" /></button><button class="icon-button" title="导入结果 JSON" aria-label="导入结果 JSON" @click="chooseFile('output')"><FileUp :size="15" /></button><button class="icon-button" title="下载结果" aria-label="下载结果" :disabled="!output" @click="download(output, outputFormat === 'yaml' ? 'converted.yaml' : 'formatted.json')"><Download :size="15" /></button><button class="icon-button" title="复制结果" aria-label="复制结果" :disabled="!output" @click="copy(output)"><Copy :size="15" /></button><button class="icon-button danger-hover" title="清空结果" aria-label="清空结果" :disabled="!output" @click="output = ''"><Trash2 :size="15" /></button></header><JsonCodeEditor v-show="mode !== 'tree'" ref="outputEditor" v-model="output" :format="outputFormat" label="处理结果" :line-numbers="numbers" :wrap="wrap" :indent="indent" @focus="active = 'output'" @status="statuses.output = $event" /><JsonTree v-if="mode === 'tree'" ref="treeEditor" :model-value="output || input" :indent="indent" @update:model-value="result" /></section>
    </div>
    <JsonCompare v-if="mode === 'compare'" ref="compareEditor" v-model:left="input" v-model:right="output" :line-numbers="numbers" :wrap="wrap" :indent="indent" @focus="active = $event === 'a' ? 'input' : 'output'" @status="(side, value) => statuses[side === 'a' ? 'input' : 'output'] = value" @import="chooseFile($event === 'a' ? 'input' : 'output')" @copy="copy($event === 'a' ? input : output)" @download="download($event === 'a' ? input : output, $event === 'a' ? 'original.json' : 'comparison.json')" />
    <footer class="json-status"><span>{{ active === 'input' ? '输入' : '结果' }}<span class="metadata-dot">·</span>行 {{ status.line }}，列 {{ status.column }}</span><Transition name="feedback"><span v-if="feedback" class="json-action-feedback" role="status"><Check :size="13" />{{ feedback }}</span></Transition><span>{{ status.lines }} 行<span class="metadata-dot">·</span>UTF-8</span></footer>
    <input ref="filePicker" type="file" accept=".json,.txt,application/json,text/plain" class="json-file-input" aria-label="导入 JSON 文件" @change="importFile" />
  </div>
</template>

<style src="../json.css"></style>
