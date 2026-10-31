<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge'
import { ArrowDown, ArrowUp, Copy, Download, FileUp } from 'lucide-vue-next'
import { undo, redo, undoDepth, redoDepth, isolateHistory } from '@codemirror/commands'
import { foldAll, unfoldAll } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { editorExtensions, indentExtensions, numberExtensions, wrapExtensions } from '../json-editor'

const props = defineProps<{ left: string; right: string; lineNumbers: boolean; wrap: boolean; indent: number | string }>()
const emit = defineEmits<{ 'update:left': [value: string]; 'update:right': [value: string]; focus: [side: 'a' | 'b']; status: [side: 'a' | 'b', value: { line: number; column: number; lines: number; undo: boolean; redo: boolean }]; import: [side: 'a' | 'b']; copy: [side: 'a' | 'b']; download: [side: 'a' | 'b'] }>()
const host = ref<HTMLElement>(), count = ref(0)
const compartments = { a: { numbers: new Compartment(), wrap: new Compartment(), indent: new Compartment() }, b: { numbers: new Compartment(), wrap: new Compartment(), indent: new Compartment() } }
let merge: MergeView | undefined, disposed = false
let active: 'a' | 'b' = 'a'
function status(side: 'a' | 'b', state: EditorState) {
  const at = state.selection.main.head, line = state.doc.lineAt(at)
  emit('status', side, { line: line.number, column: at - line.from + 1, lines: state.doc.lines, undo: undoDepth(state) > 0, redo: redoDepth(state) > 0 })
}
function extensions(side: 'a' | 'b'): Extension[] {
  const config = compartments[side]
  return [...editorExtensions(side === 'a' ? '原始 JSON' : '对比 JSON'), config.numbers.of(numberExtensions(props.lineNumbers)), config.wrap.of(wrapExtensions(props.wrap)), config.indent.of(indentExtensions(props.indent)), EditorView.domEventHandlers({ focus: () => { active = side; emit('focus', side); return false } }), EditorView.updateListener.of(update => {
    if (update.docChanged || update.selectionSet) status(side, update.state)
    if (update.docChanged) {
      if (side === 'a') emit('update:left', update.state.doc.toString()); else emit('update:right', update.state.doc.toString())
      void nextTick(() => { if (!disposed && merge) count.value = merge.chunks.length })
    }
  })]
}
onMounted(() => {
  merge = new MergeView({ parent: host.value, a: { doc: props.left, extensions: extensions('a') }, b: { doc: props.right, extensions: extensions('b') }, highlightChanges: true, gutter: true, diffConfig: { scanLimit: 1500, timeout: 150 } })
  count.value = merge.chunks.length
})
function update(side: 'a' | 'b', value: string) {
  const view = merge?.[side]
  if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: isolateHistory.of('full') })
}
watch(() => props.left, value => update('a', value))
watch(() => props.right, value => update('b', value))
watch(() => [props.lineNumbers, props.wrap, props.indent], () => {
  if (!merge) return
  for (const side of ['a', 'b'] as const) {
    const config = compartments[side]
    merge[side].dispatch({ effects: [config.numbers.reconfigure(numberExtensions(props.lineNumbers)), config.wrap.reconfigure(wrapExtensions(props.wrap)), config.indent.reconfigure(indentExtensions(props.indent))] })
  }
})
function jump(next: boolean) { if (merge) { (next ? goToNextChunk : goToPreviousChunk)(merge.b); merge.b.focus() } }
onBeforeUnmount(() => { disposed = true; merge?.destroy() })
defineExpose({ undo: () => merge && undo(merge[active]), redo: () => merge && redo(merge[active]), search: () => merge && openSearchPanel(merge[active]), fold: () => merge && foldAll(merge[active]), unfold: () => merge && unfoldAll(merge[active]) })
</script>

<template>
  <div class="json-comparison">
    <div class="json-compare-status"><span :class="count ? 'text-warning' : 'text-green'" role="status">{{ count ? `${count} 处差异` : '内容一致' }}</span><span class="toolbar-spacer" /><span class="diff-key removed">原始内容</span><span class="diff-key added">对比内容</span><button class="icon-button" title="上一处差异" aria-label="上一处差异" :disabled="!count" @click="jump(false)"><ArrowUp :size="15" /></button><button class="icon-button" title="下一处差异" aria-label="下一处差异" :disabled="!count" @click="jump(true)"><ArrowDown :size="15" /></button></div>
    <div class="json-compare-labels"><div v-for="side in ['a', 'b'] as const" :key="side"><span>{{ side === 'a' ? '原始 JSON' : '对比 JSON' }}</span><span class="toolbar-spacer" /><button class="icon-button" :title="side === 'a' ? '导入原始 JSON' : '导入对比 JSON'" :aria-label="side === 'a' ? '导入原始 JSON' : '导入对比 JSON'" @click="emit('import', side)"><FileUp :size="14" /></button><button class="icon-button" title="复制内容" :disabled="!(side === 'a' ? left : right)" @click="emit('copy', side)"><Copy :size="14" /></button><button class="icon-button" title="下载内容" :disabled="!(side === 'a' ? left : right)" @click="emit('download', side)"><Download :size="14" /></button></div></div>
    <div ref="host" class="json-merge-host" />
  </div>
</template>
