<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { Regex } from 'lucide-vue-next'
import type { RegexMatch } from '../../shared/regex'
import ToolTextPane from './ToolTextPane.vue'
const pattern = ref(''), flags = ref(['g']), text = ref(''), replacement = ref(''), output = ref(''), matches = ref<RegexMatch[]>([]), failure = ref(''), truncated = ref(false), busy = ref(false)
let worker: Worker | undefined, debounce: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, request = 0, active = false
const templates = [{ name: '邮箱', pattern: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+' }, { name: 'IPv4', pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\b' }, { name: '日期', pattern: '(\\d{4})-(\\d{2})-(\\d{2})' }, { name: '数字', pattern: '-?\\d+(?:\\.\\d+)?' }]
function selectTemplate(value: string) { pattern.value = value }
function toggleFlag(flag: string, value: unknown) { flags.value = value ? [...flags.value, flag] : flags.value.filter(item => item !== flag) }
function stop() { worker?.terminate(); worker = undefined; clearTimeout(deadline); clearTimeout(debounce); busy.value = false }
function run() {
  stop(); failure.value = ''; matches.value = []; output.value = ''; truncated.value = false
  if (!pattern.value) return
  const id = ++request
  busy.value = true
  worker = new Worker(new URL('../workers/regex.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = event => {
    if (event.data.id !== request) return
    failure.value = event.data.error || ''; matches.value = event.data.matches || []; output.value = event.data.output || ''; truncated.value = !!event.data.truncated; stop()
  }
  worker.onerror = () => { failure.value = '匹配执行失败'; stop() }
  deadline = setTimeout(() => { failure.value = '匹配超时（1 秒），请简化表达式或减少文本'; stop() }, 1000)
  worker.postMessage({ id, pattern: pattern.value, flags: flags.value.join(''), text: text.value, replacement: replacement.value })
}
watch([pattern, flags, text, replacement], () => { stop(); if (active) debounce = setTimeout(run, 180) }, { deep: true })
onActivated(() => { active = true; run() }); onDeactivated(() => { active = false; stop() }); onBeforeUnmount(stop)
const fragments = computed(() => {
  let cursor = 0
  const result: { text: string; match: boolean }[] = []
  for (const item of matches.value) { if (item.index > cursor) result.push({ text: text.value.slice(cursor, item.index), match: false }); result.push({ text: item.value || '∅', match: true }); cursor = item.index + item.value.length }
  result.push({ text: text.value.slice(cursor), match: false }); return result
})
</script>
<template>
  <div class="utility-workbench regex-workbench"><div class="utility-heading"><h1><Regex :size="22" />正则表达式</h1><el-select model-value="" aria-label="常用正则模板" placeholder="常用模板" style="width:150px" @change="selectTemplate"><el-option v-for="item in templates" :key="item.name" :label="item.name" :value="item.pattern" /></el-select></div><label class="utility-field">表达式<el-input v-model="pattern" aria-label="正则表达式" placeholder="输入表达式，不含两侧 /" /></label><div class="utility-toolbar"><el-checkbox v-for="flag in ['g','i','m','s','u']" :key="flag" :model-value="flags.includes(flag)" @change="toggleFlag(flag, $event)">{{ flag }}</el-checkbox><span class="toolbar-spacer" /><span role="status" class="utility-muted">{{ busy ? '匹配中…' : `${matches.length}${truncated ? '+' : ''} 个匹配` }}</span></div><el-alert v-if="failure" :title="failure" type="error" :closable="false" /><div class="utility-columns regex-inputs"><ToolTextPane v-model="text" label="测试文本" /><section class="regex-preview"><h2>匹配高亮</h2><pre><template v-for="(part,index) in fragments" :key="index"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></pre></section></div><details v-if="matches.length" class="regex-captures"><summary>捕获组 · {{ matches.length }} 项{{ truncated ? '（已截断）' : '' }}</summary><div class="utility-table-scroll"><table><thead><tr><th>位置</th><th>匹配</th><th>捕获组</th></tr></thead><tbody><tr v-for="(match,index) in matches" :key="index"><td>{{ match.index }}</td><td><code>{{ match.value || '∅' }}</code></td><td><code>{{ JSON.stringify(match.named || match.groups) }}</code></td></tr></tbody></table></div></details><label class="utility-field">替换为<el-input v-model="replacement" aria-label="正则替换内容" placeholder="$1、$2 或普通文本" /></label><ToolTextPane v-model="output" label="替换结果" readonly /></div>
</template>
