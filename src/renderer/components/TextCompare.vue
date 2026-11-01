<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { diffLines, diffWordsWithSpace, createTwoFilesPatch } from 'diff'
import { ElMessage } from 'element-plus'
import { ArrowDown, ArrowUp, ArrowRightLeft, Download, GitCompareArrows } from 'lucide-vue-next'
import ToolTextPane from './ToolTextPane.vue'
import { downloadText } from '../tool-io'
const left = ref(''), right = ref(''), mode = ref<'lines' | 'words'>('lines'), whitespace = ref(false), ignoreCase = ref(false), current = ref(-1)
const host = ref<HTMLElement>()
const changes = computed(() => {
  if (left.value.length + right.value.length > 400000) return undefined
  const normalize = (value: string) => { let text = value.replace(/\r\n/g, '\n'); if (whitespace.value) text = text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).join('\n'); return ignoreCase.value ? text.toLowerCase() : text }
  const a = normalize(left.value), b = normalize(right.value)
  return mode.value === 'lines' ? diffLines(a, b, { timeout: 300 }) : diffWordsWithSpace(a, b, { timeout: 300 })
})
const changed = computed(() => changes.value?.filter(part => part.added || part.removed).length || 0)
const original = computed(() => changes.value?.filter(part => !part.added) || [])
const modified = computed(() => changes.value?.filter(part => !part.removed) || [])
function swap() { [left.value, right.value] = [right.value, left.value]; current.value = -1 }
async function jump(offset: number) { await nextTick(); const targets = host.value?.querySelectorAll<HTMLElement>('.diff-removed, .diff-added'); if (!targets?.length) return; current.value = (current.value + offset + targets.length) % targets.length; targets[current.value]?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }
function patch() {
  if (left.value.length + right.value.length > 400000) { ElMessage.error('内容过大，请缩小对比范围'); return }
  const value = createTwoFilesPatch('original.txt', 'modified.txt', left.value, right.value, undefined, undefined, { timeout: 300 })
  if (value === undefined) { ElMessage.error('生成补丁超时，请缩小对比范围'); return }
  downloadText(value, 'changes.patch')
}
</script>
<template>
  <div class="utility-workbench compare-workbench"><div class="utility-heading"><h1><GitCompareArrows :size="22" />文本对比</h1><button class="icon-button bordered" title="交换两侧" aria-label="交换两侧" @click="swap"><ArrowRightLeft :size="17" /></button></div><div class="utility-columns compare-inputs"><ToolTextPane v-model="left" label="原始文本" /><ToolTextPane v-model="right" label="对比文本" /></div><div class="utility-toolbar"><div class="utility-segments" role="group" aria-label="对比粒度"><button :class="{selected: mode === 'lines'}" @click="mode = 'lines'">按行</button><button :class="{selected: mode === 'words'}" @click="mode = 'words'">按单词/字符</button></div><el-checkbox v-model="whitespace">忽略空白</el-checkbox><el-checkbox v-model="ignoreCase">忽略大小写</el-checkbox><span class="toolbar-spacer" /><button class="icon-button" title="导出补丁" aria-label="导出补丁" :disabled="left === right" @click="patch"><Download :size="17" /></button></div><div class="compare-status" role="status"><span>{{ !changes ? '内容过大，请缩小对比范围' : changed ? `${changed} 处增删` : '内容一致' }}</span><span class="toolbar-spacer" /><button class="icon-button" title="上一处差异" aria-label="上一处差异" :disabled="!changed" @click="jump(-1)"><ArrowUp :size="16" /></button><button class="icon-button" title="下一处差异" aria-label="下一处差异" :disabled="!changed" @click="jump(1)"><ArrowDown :size="16" /></button></div><div ref="host" class="utility-columns diff-output utility-grow"><section><h2>原始文本</h2><pre aria-label="原始差异"><span v-for="(part,index) in original" :key="index" :class="{ 'diff-removed': part.removed }">{{ part.value }}</span></pre></section><section><h2>对比文本</h2><pre aria-label="修改差异"><span v-for="(part,index) in modified" :key="index" :class="{ 'diff-added': part.added }">{{ part.value }}</span></pre></section></div></div>
</template>
