<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRightLeft, Binary } from 'lucide-vue-next'
import { convertText, type Codec } from '../../shared/toolkit'
import ToolTextPane from './ToolTextPane.vue'
const input = ref(''), output = ref(''), codec = ref<Codec>('base64'), decoding = ref(false), failure = ref(''), automatic = ref(true)
const modes = [{ id: 'base64', label: 'Base64' }, { id: 'base64url', label: 'Base64URL' }, { id: 'url', label: 'URL' }, { id: 'unicode', label: 'Unicode' }, { id: 'html', label: 'HTML 实体' }] as const
const direction = computed(() => decoding.value ? '解码' : '编码')
function convert() {
  try { output.value = convertText(input.value, codec.value, decoding.value); failure.value = '' }
  catch (error) { output.value = ''; failure.value = (error as Error).message }
}
watch([input, codec, decoding, automatic], () => { if (automatic.value) convert() })
function swap() { input.value = output.value; decoding.value = !decoding.value; convert() }
</script>
<template>
  <div class="utility-workbench"><div class="utility-heading"><h1><Binary :size="22" />编码解码</h1><span class="utility-local"><span class="local-dot" />UTF-8</span></div><div class="utility-toolbar"><div class="utility-segments" role="group" aria-label="编码类型"><button v-for="mode in modes" :key="mode.id" :class="{ selected: codec === mode.id }" :aria-pressed="codec === mode.id" @click="codec = mode.id">{{ mode.label }}</button></div><span class="toolbar-spacer" /><el-checkbox v-model="automatic">实时转换</el-checkbox></div><div class="utility-toolbar"><div class="utility-segments" role="group" aria-label="转换方向"><button :class="{ selected: !decoding }" @click="decoding = false">编码</button><button :class="{ selected: decoding }" @click="decoding = true">解码</button></div><el-button type="primary" @click="convert">{{ direction }}</el-button><button class="icon-button bordered" title="交换并反向转换" aria-label="交换并反向转换" :disabled="!output" @click="swap"><ArrowRightLeft :size="17" /></button></div><el-alert v-if="failure" :title="failure" type="error" :closable="false" /><div class="utility-columns utility-grow"><ToolTextPane v-model="input" label="编码输入" placeholder="输入需要转换的内容…" /><ToolTextPane v-model="output" label="转换结果" readonly /></div></div>
</template>
