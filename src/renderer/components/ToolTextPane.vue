<script setup lang="ts">
import { ref } from 'vue'
import { Copy, Download, FileUp, Trash2 } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import { copyText, downloadText, readTextFile } from '../tool-io'
const value = defineModel<string>({ default: '' })
const props = defineProps<{ label: string; readonly?: boolean; placeholder?: string; filename?: string }>()
const picker = ref<HTMLInputElement>()
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  try { if (input.files?.[0]) value.value = await readTextFile(input.files[0]) }
  catch (error) { ElMessage.error(String(error)) } finally { input.value = '' }
}
</script>
<template>
  <section class="utility-pane"><header><strong>{{ label }}</strong><small>{{ value.length.toLocaleString() }} 字符</small><span class="toolbar-spacer" /><button v-if="!readonly" class="icon-button" :aria-label="`导入${label}`" :title="`导入${label}`" @click="picker?.click()"><FileUp :size="15" /></button><button class="icon-button" :disabled="!value" :aria-label="`下载${label}`" :title="`下载${label}`" @click="downloadText(value, props.filename || 'result.txt')"><Download :size="15" /></button><button class="icon-button" :disabled="!value" :aria-label="`复制${label}`" :title="`复制${label}`" @click="copyText(value)"><Copy :size="15" /></button><button v-if="!readonly" class="icon-button" :disabled="!value" :aria-label="`清空${label}`" :title="`清空${label}`" @click="value = ''"><Trash2 :size="15" /></button></header><textarea v-model="value" :aria-label="label" :readonly="readonly" :placeholder="placeholder" spellcheck="false" /><input ref="picker" type="file" class="utility-file-input" accept="text/*,.json,.jwt,.csv,.yaml,.yml" @change="importFile" /></section>
</template>
