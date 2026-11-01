<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undo, redo, undoDepth, redoDepth, isolateHistory } from '@codemirror/commands'
import { foldAll, unfoldAll } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { editorExtensions, indentExtensions, numberExtensions, wrapExtensions } from '../json-editor'

const props = defineProps<{ modelValue: string; label: string; lineNumbers: boolean; wrap: boolean; indent: number | string; format?: 'json' | 'yaml' }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; focus: []; status: [value: { line: number; column: number; lines: number; undo: boolean; redo: boolean }] }>()
const host = ref<HTMLElement>()
const numbers = new Compartment(), wrapping = new Compartment(), indentation = new Compartment(), editing = new Compartment()
let view: EditorView | undefined
function status() {
  if (!view) return
  const at = view.state.selection.main.head, line = view.state.doc.lineAt(at)
  emit('status', { line: line.number, column: at - line.from + 1, lines: view.state.doc.lines, undo: undoDepth(view.state) > 0, redo: redoDepth(view.state) > 0 })
}
onMounted(() => {
  view = new EditorView({ parent: host.value, state: EditorState.create({ doc: props.modelValue, extensions: [
    editing.of(editorExtensions(props.label, props.format)), numbers.of(numberExtensions(props.lineNumbers)), wrapping.of(wrapExtensions(props.wrap)), indentation.of(indentExtensions(props.indent)),
    EditorView.domEventHandlers({ focus: () => { emit('focus'); return false } }),
    EditorView.updateListener.of(update => { if (update.docChanged) emit('update:modelValue', update.state.doc.toString()); if (update.docChanged || update.selectionSet) status() })
  ] }) })
  status()
})
watch(() => props.modelValue, value => {
  if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] })
})
watch(() => props.lineNumbers, value => view?.dispatch({ effects: numbers.reconfigure(numberExtensions(value)) }))
watch(() => props.wrap, value => view?.dispatch({ effects: wrapping.reconfigure(wrapExtensions(value)) }))
watch(() => props.indent, value => view?.dispatch({ effects: indentation.reconfigure(indentExtensions(value)) }))
watch(() => props.format, value => view?.dispatch({ effects: editing.reconfigure(editorExtensions(props.label, value)) }))
onBeforeUnmount(() => view?.destroy())
defineExpose({ undo: () => view && undo(view), redo: () => view && redo(view), search: () => view && openSearchPanel(view), fold: () => view && foldAll(view), unfold: () => view && unfoldAll(view) })
</script>

<template><div ref="host" class="json-code-editor" /></template>
