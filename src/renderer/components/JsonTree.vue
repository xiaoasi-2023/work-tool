<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import { isContainer, jsonKind, jsonPointer, mutateJson, parseField, parseJson, printJson, type JsonKind, type JsonPath, type JsonValue } from '../../shared/json'

const props = defineProps<{ modelValue: string; indent: number | string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const expanded = ref(new Set(['[]']))
const limit = ref(500)
const parsed = computed(() => {
  try { return { value: parseJson(props.modelValue), error: '' } }
  catch (error) { return { value: null, error: props.modelValue.trim() ? (error as Error).message : '' } }
})
type Row = { path: JsonPath; value: JsonValue; name: string; depth: number }
function children(value: JsonValue, path: JsonPath): Row[] {
  if (!isContainer(value)) return []
  return Object.entries(value).map(([key, child]) => ({ path: [...path, Array.isArray(value) ? Number(key) : key], value: child, name: key, depth: path.length + 1 }))
}
const rows = computed(() => {
  if (!props.modelValue.trim() || parsed.value.error) return []
  const result: Row[] = [], stack: Row[] = [{ path: [], value: parsed.value.value, name: '$', depth: 0 }]
  while (stack.length && result.length <= limit.value) {
    const row = stack.pop()!; result.push(row)
    if (expanded.value.has(JSON.stringify(row.path))) for (const child of children(row.value, row.path).reverse()) stack.push(child)
  }
  return result
})
function toggle(path: JsonPath) {
  const key = JSON.stringify(path), next = new Set(expanded.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  expanded.value = next
}
function expandAll() {
  const next = new Set<string>(), stack: Row[] = [{ path: [], value: parsed.value.value, name: '$', depth: 0 }]
  while (stack.length && next.size < 5000) {
    const row = stack.pop()!
    if (isContainer(row.value)) { next.add(JSON.stringify(row.path)); for (const child of children(row.value, row.path).reverse()) stack.push(child) }
  }
  expanded.value = next
}
function summary(value: JsonValue) {
  if (Array.isArray(value)) return `[ ${value.length} 项 ]`
  if (isContainer(value)) return `{ ${Object.keys(value).length} 个字段 }`
  return printJson(value, 0)
}
async function copyPath(path: JsonPath) {
  try { await navigator.clipboard.writeText(`#${jsonPointer(path)}`); ElMessage.success('路径已复制') }
  catch { ElMessage.error('复制失败') }
}
const dialog = ref(false), action = ref<'edit' | 'add'>('edit'), selected = shallowRef<Row | null>(null)
const fieldName = ref(''), fieldValue = ref(''), fieldKind = ref<JsonKind>('string'), fieldError = ref('')
const kinds: JsonKind[] = ['string', 'number', 'boolean', 'null', 'object', 'array']
const labels: Record<JsonKind, string> = { string: '字符串', number: '数字', boolean: '布尔值', null: '空值', object: '对象', array: '数组' }
const canRename = computed(() => selected.value && (action.value === 'add' || (selected.value.path.length > 0 && typeof selected.value.path.at(-1) === 'string')))
const fieldNameLabel = computed(() => action.value === 'add' && selected.value && Array.isArray(selected.value.value) ? '插入位置' : '字段名称')
function open(row: Row, mode: 'edit' | 'add') {
  action.value = mode; selected.value = row; fieldError.value = ''
  fieldName.value = mode === 'add' ? (Array.isArray(row.value) ? String(row.value.length) : '') : row.name
  fieldKind.value = mode === 'add' ? 'string' : jsonKind(row.value)
  fieldValue.value = mode === 'add' ? '' : typeof row.value === 'string' ? row.value : printJson(row.value)
  dialog.value = true
}
function changeKind() { fieldValue.value = ({ string: '', number: '0', boolean: 'true', null: 'null', object: '{}', array: '[]' })[fieldKind.value] }
function save() {
  if (!selected.value) return
  try {
    const value = parseField(fieldValue.value, fieldKind.value)
    emit('update:modelValue', mutateJson(props.modelValue, { action: action.value, path: selected.value.path, key: fieldName.value, value }, props.indent))
    if (action.value === 'add') expanded.value = new Set([...expanded.value, JSON.stringify(selected.value.path)])
    dialog.value = false
  } catch (error) { fieldError.value = (error as Error).message }
}
function remove(row: Row) {
  try { emit('update:modelValue', mutateJson(props.modelValue, { action: 'delete', path: row.path }, props.indent)) }
  catch (error) { ElMessage.error((error as Error).message) }
}
defineExpose({ fold: () => { expanded.value = new Set() }, unfold: expandAll })
</script>

<template>
  <div class="json-tree">
    <div class="json-tree-toolbar"><span class="muted">{{ rows.length ? labels[jsonKind(parsed.value)] : 'JSON' }}</span><span class="toolbar-spacer" /><button class="icon-button" title="展开全部" aria-label="展开全部" @click="expandAll"><ChevronsUpDown :size="15" /></button><button class="icon-button" title="折叠全部" aria-label="折叠全部" @click="expanded = new Set()"><ChevronsDownUp :size="15" /></button></div>
    <div v-if="parsed.error" class="json-tree-error">{{ parsed.error }}</div>
    <div v-else-if="!rows.length" class="json-tree-empty"><el-button @click="emit('update:modelValue', '{}')"><Plus :size="15" />新建对象</el-button><el-button @click="emit('update:modelValue', '[]')">新建数组</el-button></div>
    <div v-else class="json-tree-scroll">
      <div v-for="row in rows.slice(0, limit)" :key="JSON.stringify(row.path)" class="json-tree-row" :data-path="jsonPointer(row.path)" :style="{ paddingLeft: `${Math.min(row.depth, 20) * 16 + 8}px` }">
        <button v-if="isContainer(row.value)" class="icon-button tree-chevron" :title="expanded.has(JSON.stringify(row.path)) ? '折叠节点' : '展开节点'" :aria-expanded="expanded.has(JSON.stringify(row.path))" @click="toggle(row.path)"><component :is="expanded.has(JSON.stringify(row.path)) ? ChevronDown : ChevronRight" :size="14" /></button><span v-else class="tree-chevron" />
        <code class="tree-key" :title="`#${jsonPointer(row.path)}`">{{ row.name }}</code><span class="tree-colon">:</span><code :class="['tree-value', `json-${jsonKind(row.value)}`]" :title="summary(row.value)">{{ summary(row.value) }}</code>
        <div class="tree-actions"><button class="icon-button" :title="`编辑 ${row.name}`" :aria-label="`编辑 ${row.name}`" @click="open(row, 'edit')"><Pencil :size="13" /></button><button v-if="isContainer(row.value)" class="icon-button" :title="`添加到 ${row.name}`" :aria-label="`添加到 ${row.name}`" @click="open(row, 'add')"><Plus :size="14" /></button><button class="icon-button" title="复制路径" aria-label="复制路径" @click="copyPath(row.path)"><Copy :size="13" /></button><button v-if="row.path.length" class="icon-button danger-hover" :title="`删除 ${row.name}`" :aria-label="`删除 ${row.name}`" @click="remove(row)"><Trash2 :size="13" /></button></div>
      </div>
      <button v-if="rows.length > limit" class="text-action tree-more" @click="limit += 500">显示更多节点</button>
    </div>
    <el-dialog v-model="dialog" :title="action === 'add' ? '添加字段或数组项' : '编辑字段和值'" width="520px" :close-on-click-modal="false">
      <form class="json-field-form" @submit.prevent="save">
        <label v-if="canRename">{{ fieldNameLabel }}<el-input v-model="fieldName" aria-label="字段名称" /></label>
        <label>值类型<el-select v-model="fieldKind" aria-label="值类型" @change="changeKind"><el-option v-for="kind in kinds" :key="kind" :value="kind" :label="labels[kind]" /></el-select></label>
        <label v-if="fieldKind !== 'null'">值<el-select v-if="fieldKind === 'boolean'" v-model="fieldValue" aria-label="字段值"><el-option value="true" label="true" /><el-option value="false" label="false" /></el-select><el-input v-else v-model="fieldValue" type="textarea" :rows="fieldKind === 'object' || fieldKind === 'array' ? 7 : 3" aria-label="字段值" /></label>
        <el-alert v-if="fieldError" :title="fieldError" type="error" :closable="false" />
      </form>
      <template #footer><el-button @click="dialog = false">取消</el-button><el-button type="primary" @click="save">应用修改</el-button></template>
    </el-dialog>
  </div>
</template>
