<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createMD5, createSHA256, createSHA512 } from 'hash-wasm'
import { Copy, Fingerprint, FileUp, X } from 'lucide-vue-next'
import ToolTextPane from './ToolTextPane.vue'
import { copyText } from '../tool-io'
const text = ref(''), mode = ref<'text' | 'file'>('text'), file = ref<File>(), picker = ref<HTMLInputElement>(), busy = ref(false), progress = ref(0), failure = ref(''), expected = ref('')
const results = ref<{ name: string; value: string }[]>([]), source = ref('')
const match = computed(() => !expected.value.trim() ? '' : results.value.some(item => item.value.toLowerCase() === expected.value.trim().toLowerCase()) ? '校验一致' : '校验不一致')
let job = 0
function cancel() { job++; busy.value = false }
watch([text, mode, file], () => { cancel(); results.value = []; failure.value = '' })
onBeforeUnmount(cancel)
function choose(event: Event) { file.value = (event.target as HTMLInputElement).files?.[0]; results.value = []; (event.target as HTMLInputElement).value = '' }
async function calculate() {
  const id = ++job, selected = file.value, input = text.value, type = mode.value
  busy.value = true; failure.value = ''; results.value = []; progress.value = 0
  try {
    if (type === 'file' && !selected) throw new Error('请选择文件')
    const hashers = await Promise.all([createMD5(), createSHA256(), createSHA512()])
    if (id !== job) return
    hashers.forEach(hasher => hasher.init())
    if (type === 'text') hashers.forEach(hasher => hasher.update(input))
    else {
      const size = selected!.size, chunk = 2 * 1024 * 1024
      for (let offset = 0; offset < size; offset += chunk) {
        const bytes = new Uint8Array(await selected!.slice(offset, offset + chunk).arrayBuffer())
        if (id !== job) return
        hashers.forEach(hasher => hasher.update(bytes)); progress.value = Math.round(Math.min(offset + chunk, size) / size * 100)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }
    if (id !== job) return
    source.value = type === 'file' ? `${selected!.name} · ${selected!.size.toLocaleString()} 字节` : `${new TextEncoder().encode(input).length.toLocaleString()} UTF-8 字节`
    results.value = hashers.map((hasher, index) => ({ name: ['MD5','SHA-256','SHA-512'][index]!, value: hasher.digest('hex') })); progress.value = 100
  } catch (error) { if (id === job) failure.value = (error as Error).message }
  finally { if (id === job) busy.value = false }
}
</script>
<template>
  <div class="utility-workbench hash-workbench"><div class="utility-heading"><h1><Fingerprint :size="22" />哈希校验</h1><span class="utility-local"><span class="local-dot" />本地计算</span></div><div class="utility-toolbar"><div class="utility-segments"><button :class="{ selected: mode === 'text' }" :disabled="busy" @click="mode = 'text'; results = []">文本</button><button :class="{ selected: mode === 'file' }" :disabled="busy" @click="mode = 'file'; results = []">文件</button></div><span class="toolbar-spacer" /><span v-if="busy" class="utility-muted" role="status">{{ progress }}%</span><button v-if="busy" class="icon-button" title="取消计算" aria-label="取消计算" @click="cancel"><X :size="17" /></button><el-button type="primary" :loading="busy" @click="calculate">计算哈希</el-button></div><ToolTextPane v-if="mode === 'text'" v-model="text" label="哈希文本" /><div v-else class="hash-file"><FileUp :size="30" /><strong>{{ file?.name || '未选择文件' }}</strong><span v-if="file">{{ file.size.toLocaleString() }} 字节</span><el-button :disabled="busy" @click="picker?.click()">选择文件</el-button><input ref="picker" type="file" class="utility-file-input" aria-label="哈希文件" @change="choose" /></div><el-alert v-if="failure" :title="failure" type="error" :closable="false" /><section v-if="results.length" class="hash-results"><div class="utility-result-caption">{{ source }}</div><div v-for="item in results" :key="item.name"><span>{{ item.name }}</span><code>{{ item.value }}</code><button class="icon-button" :aria-label="`复制${item.name}`" :title="`复制${item.name}`" @click="copyText(item.value)"><Copy :size="16" /></button></div><label class="utility-field">期望哈希<el-input v-model="expected" aria-label="期望哈希" placeholder="粘贴需要校验的哈希值" /></label><strong v-if="match" :class="match === '校验一致' ? 'text-green' : 'utility-warning'" role="status">{{ match }}</strong></section></div>
</template>
