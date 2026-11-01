<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUpRight, Search, Settings2, SunMoon } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import { tools } from '../tools'
import { useApp } from '../store'

const visible = defineModel<boolean>({ default: false })
const app = useApp()
const query = ref(''), selected = ref(0)
const input = ref<HTMLInputElement>()
const actions = computed(() => [
  ...tools.map(tool => ({ id: tool.id, name: tool.name, detail: tool.tag, icon: tool.icon, run: () => app.open(tool.id) })),
  { id: 'settings', name: '设置', detail: '工作空间', icon: Settings2, run: () => { app.page = 'settings' } },
  { id: 'theme', name: '切换外观', detail: app.state?.settings.theme === 'dark' ? '浅色' : '深色', icon: SunMoon, run: () => app.setTheme(app.state?.settings.theme === 'dark' ? 'light' : 'dark') }
].filter(item => `${item.name}${item.detail}${item.id}`.toLowerCase().includes(query.value.trim().toLowerCase())))
watch(query, () => { selected.value = 0 })
watch(visible, value => { if (value) { query.value = ''; selected.value = 0 } })
function move(offset: number) {
  if (!actions.value.length) return
  selected.value = (selected.value + offset + actions.value.length) % actions.value.length
  void nextTick(() => document.getElementById(`command-${actions.value[selected.value]?.id}`)?.scrollIntoView({ block: 'nearest' }))
}
async function run(index: number) {
  const action = actions.value[index]
  if (!action) return
  visible.value = false
  try { await action.run() } catch (error) { ElMessage.error(String(error)) }
}
</script>

<template>
  <el-dialog v-model="visible" class="command-palette" title="快速打开" width="560px" :show-close="false" align-center @opened="input?.focus()">
    <div class="command-search"><Search :size="21" /><input ref="input" v-model="query" aria-label="搜索工具和操作" placeholder="搜索工具和操作…" role="combobox" aria-autocomplete="list" :aria-expanded="visible" aria-controls="command-results" :aria-activedescendant="actions[selected] ? `command-${actions[selected].id}` : undefined" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="run(selected)" /></div>
    <div id="command-results" class="command-results" role="listbox" aria-label="工具和操作">
      <button v-for="(action, index) in actions" :id="`command-${action.id}`" :key="action.id" role="option" :aria-selected="selected === index" :class="{ selected: selected === index }" @pointermove="selected = index" @click="run(index)"><span class="command-icon"><component :is="action.icon" :size="20" /></span><span><strong>{{ action.name }}</strong><small>{{ action.detail }}</small></span><ArrowUpRight :size="17" /></button>
      <div v-if="!actions.length" class="command-empty">没有匹配结果</div>
    </div>
  </el-dialog>
</template>
