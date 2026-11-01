<script setup lang="ts">
import { computed, onActivated, onDeactivated, onBeforeUnmount, ref } from 'vue'
import { KeyRound } from 'lucide-vue-next'
import { inspectJwt, jwtStatus } from '../../shared/toolkit'
import ToolTextPane from './ToolTextPane.vue'
const input = ref(''), now = ref(Date.now() / 1000)
let timer: ReturnType<typeof setInterval> | undefined
onActivated(() => { now.value = Date.now() / 1000; timer = setInterval(() => { now.value = Date.now() / 1000 }, 1000) })
onDeactivated(() => clearInterval(timer)); onBeforeUnmount(() => clearInterval(timer))
const decoded = computed(() => { if (!input.value.trim()) return null; try { return inspectJwt(input.value) } catch { return null } })
const failure = computed(() => { if (!input.value.trim()) return ''; try { inspectJwt(input.value); return '' } catch (error) { return (error as Error).message } })
const header = computed(() => decoded.value ? JSON.stringify(decoded.value.header, null, 2) : '')
const payload = computed(() => decoded.value ? JSON.stringify(decoded.value.payload, null, 2) : '')
const status = computed(() => decoded.value ? jwtStatus(decoded.value.payload, now.value) : '')
const claims = computed(() => ['iat', 'nbf', 'exp'].filter(key => decoded.value?.payload[key] !== undefined).map(key => ({ key, time: new Date(Number(decoded.value!.payload[key]) * 1000).toISOString() })))
function sample() { input.value = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ3b3JrYmVuY2gtZGVtbyIsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjoxNjAwMDAzNjAwfQ.ZGVtby1zaWduYXR1cmU' }
</script>
<template>
  <div class="utility-workbench jwt-workbench"><div class="utility-heading"><h1><KeyRound :size="22" />JWT 解析</h1><el-button @click="sample">载入示例</el-button></div><div class="utility-notice">仅解析内容，未验证签名或令牌可信性。</div><ToolTextPane v-model="input" label="JWT 令牌" placeholder="eyJ… 或 Bearer eyJ…" /><el-alert v-if="failure" :title="failure" type="error" :closable="false" /><section v-if="decoded" class="jwt-status"><strong :class="status === '已过期' || status === '尚未生效' ? 'utility-warning' : ''">{{ status }}</strong><span>{{ decoded.header.alg || '未声明算法' }}</span><span>签名：{{ decoded.signature ? '存在（未验证）' : '空' }}</span><div v-for="claim in claims" :key="claim.key"><code>{{ claim.key }}</code><time>{{ claim.time }}</time></div></section><div class="utility-columns utility-grow"><ToolTextPane :model-value="header" label="Header" readonly filename="header.json" /><ToolTextPane :model-value="payload" label="Payload" readonly filename="payload.json" /></div></div>
</template>
