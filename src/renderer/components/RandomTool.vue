<script setup lang="ts">
import { computed, ref } from 'vue'
import { Dices, RefreshCw } from 'lucide-vue-next'
import { generateValues } from '../../shared/toolkit'
import ToolTextPane from './ToolTextPane.vue'
const kind = ref<'v4' | 'v7' | 'string' | 'password'>('v4'), count = ref(1), length = ref(20), uppercase = ref(false), hyphens = ref(true), output = ref(''), failure = ref('')
const lower = ref(true), upper = ref(true), digits = ref(true), symbols = ref(false), excludeSimilar = ref(false)
const groups = computed(() => [lower.value ? 'abcdefghijklmnopqrstuvwxyz' : '', upper.value ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '', digits.value ? '0123456789' : '', symbols.value ? '!@#$%^&*()-_=+[]{}:,.?' : ''].filter(Boolean).map(set => excludeSimilar.value ? set.replace(/[Il1O0o]/g, '') : set))
const isUuid = computed(() => kind.value === 'v4' || kind.value === 'v7')
function generate() { try { output.value = generateValues(kind.value, count.value, length.value, groups.value, uppercase.value, hyphens.value); failure.value = '' } catch (error) { failure.value = (error as Error).message } }
function setKind(value: typeof kind.value) { kind.value = value; if (value === 'password') { symbols.value = true; length.value = 24 } }
generate()
</script>
<template>
  <div class="utility-workbench"><div class="utility-heading"><h1><Dices :size="22" />UUID 与随机数据</h1><span class="utility-local"><span class="local-dot" />安全随机源</span></div><div class="utility-toolbar"><div class="utility-segments" role="group" aria-label="生成类型"><button v-for="item in [{id:'v4',name:'UUID v4'},{id:'v7',name:'UUID v7'},{id:'string',name:'随机字符串'},{id:'password',name:'密码'}] as const" :key="item.id" :class="{ selected: kind === item.id }" :aria-pressed="kind === item.id" @click="setKind(item.id)">{{ item.name }}</button></div></div><div class="utility-options"><label>数量<input v-model.number="count" type="number" min="1" max="1000" aria-label="生成数量" /></label><label v-if="!isUuid">长度<input v-model.number="length" type="number" min="1" max="1024" aria-label="随机长度" /></label><template v-if="isUuid"><el-checkbox v-model="uppercase">大写</el-checkbox><el-checkbox v-model="hyphens">保留连字符</el-checkbox></template><template v-else><el-checkbox v-model="lower">小写字母</el-checkbox><el-checkbox v-model="upper">大写字母</el-checkbox><el-checkbox v-model="digits">数字</el-checkbox><el-checkbox v-model="symbols">符号</el-checkbox><el-checkbox v-model="excludeSimilar">排除易混淆字符</el-checkbox></template><span class="toolbar-spacer" /><el-button type="primary" @click="generate"><RefreshCw :size="16" />生成</el-button></div><el-alert v-if="failure" :title="failure" type="error" :closable="false" /><ToolTextPane v-model="output" class="utility-grow" label="生成结果" readonly filename="generated.txt" /></div>
</template>
