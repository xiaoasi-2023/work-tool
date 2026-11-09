<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInputNumber, ElMessage } from 'element-plus'
import { Check } from 'lucide-vue-next'
import { useManagement } from '../../management-store'
import { applyManagementCommand, getTaskEffortSummary, getTaskWeekEffort, prepareTaskWeekEffort, roleLabels, stageLabels, sumHours, weekStart, weekEnd, type ManagementEffort } from '../../../shared/management'
import { prepareScheduleCompletion } from '../../../shared/management-schedule'

const props = defineProps<{ modelValue: boolean; taskIds: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const manager = useManagement()
const formElement = ref<HTMLFormElement>()
const draft = ref({ taskId: '', personId: '', week: '', hours: null as number | null, notes: '', reason: '', complete: false })
const previous = ref<ManagementEffort | null>(null), conflict = ref('')
const tasks = computed(() => manager.state.tasks.filter(t => props.taskIds.includes(t.id) && t.status !== 'done' && t.status !== 'cancelled'))
const task = computed(() => tasks.value.find(t => t.id === draft.value.taskId))
const requirement = computed(() => manager.state.requirements.find(r => r.id === task.value?.requirementId))
const summary = computed(() => getTaskEffortSummary(manager.state, draft.value.taskId ? [draft.value.taskId] : []))
const afterHours = computed(() => sumHours([summary.value.hours || 0, -(previous.value?.hours || 0), draft.value.hours || 0]))
function displayHours(value: number) { return value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) }
function loadWeek() {
  previous.value = null; conflict.value = ''; draft.value.hours = null; draft.value.notes = ''; draft.value.reason = ''
  if (!props.modelValue || !draft.value.taskId || !draft.value.personId || !draft.value.week) return
  try {
    previous.value = getTaskWeekEffort(manager.state, draft.value.taskId, draft.value.personId, draft.value.week)
    draft.value.hours = previous.value?.hours ?? null
    draft.value.notes = previous.value?.notes || ''
  } catch (error) { conflict.value = (error as Error).message }
}
function normalizeWeek() { if (draft.value.week) draft.value.week = weekStart(draft.value.week) }
async function save() {
  if (!task.value || !formElement.value?.reportValidity() || conflict.value) return
  if (draft.value.hours === null || !Number.isFinite(draft.value.hours)) { ElMessage.warning('请填写本周实际投入'); return }
  try {
    const effort = prepareTaskWeekEffort(manager.state, { ...draft.value, hours: draft.value.hours })
    const command = draft.value.complete ? { type: 'batch' as const, commands: [effort, prepareScheduleCompletion(applyManagementCommand(JSON.parse(JSON.stringify(manager.state)), effort), [task.value.id], draft.value.week)], reason: draft.value.reason || '登记周投入并确认角色完成' } : effort
    if (await manager.execute(command)) { emit('update:modelValue', false); ElMessage.success('周工时已保存') }
  } catch (error) { ElMessage.error((error as Error).message) }
}
watch(() => props.modelValue, open => {
  if (!open) return
  draft.value.taskId = tasks.value[0]?.id || ''
  draft.value.personId = task.value?.ownerId || ''
  draft.value.week = manager.week
  draft.value.complete = false
  loadWeek()
})
watch(() => draft.value.taskId, () => { if (props.modelValue) { draft.value.personId = task.value?.ownerId || ''; loadWeek() } })
watch([() => draft.value.personId, () => draft.value.week], loadWeek)
</script>

<template>
  <el-dialog :model-value="modelValue" :title="previous ? '修改周工时' : '登记周工时'" width="560px" :close-on-click-modal="false" destroy-on-close @update:model-value="emit('update:modelValue', $event)">
    <p class="weekly-requirement">{{ requirement?.title }}</p>
    <form ref="formElement" class="weekly-form" @submit.prevent="save">
      <label class="wide"><span>角色任务</span><select v-model="draft.taskId" required><option v-for="item in tasks" :key="item.id" :value="item.id">{{ item.name }} · {{ roleLabels[item.role] }} / {{ stageLabels[item.stage] }}</option></select></label>
      <label><span>投入人员</span><select v-model="draft.personId" required><option value="" disabled>选择人员</option><option v-for="person in manager.state.people" :key="person.id" :value="person.id" :disabled="!person.active && person.id !== task?.ownerId">{{ person.name }}</option></select></label>
      <label><span>归属周</span><input v-model="draft.week" type="date" required @change="normalizeWeek" /><small v-if="draft.week">{{ weekStart(draft.week) }} 至 {{ weekEnd(weekStart(draft.week)) }}</small></label>
      <div class="weekly-totals wide"><span>累计已登记 <strong>{{ summary.hours === null ? '—' : `${displayHours(summary.hours)} h` }}</strong></span><span v-if="previous">本周已登记 <strong>{{ displayHours(previous.hours) }} h</strong></span><span v-if="draft.hours !== null && !conflict">保存后累计 <strong>{{ displayHours(afterHours) }} h</strong></span></div>
      <label><span>该周合计（小时）</span><el-input-number v-model="draft.hours" aria-label="该周合计小时" :min="0" :max="1000000" :precision="4" :step="1" :disabled="!!conflict" /></label>
      <label v-if="previous"><span>调整原因</span><input v-model="draft.reason" maxlength="1000" /></label>
      <label class="wide"><span>进展备注</span><textarea v-model="draft.notes" rows="3" maxlength="10000" /></label>
      <el-checkbox v-model="draft.complete" class="wide">该角色任务已全部完成</el-checkbox>
      <p v-if="conflict" class="weekly-error wide" role="alert">{{ conflict }}</p>
    </form>
    <template #footer><el-button :disabled="manager.busy" @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="manager.busy" :disabled="!!conflict || !task" @click="save"><Check :size="14" />{{ previous ? '保存修改' : '保存工时' }}</el-button></template>
  </el-dialog>
</template>

<style scoped>
.weekly-requirement { margin:0 0 18px; font-size:13px; line-height:1.7; overflow-wrap:anywhere; }
.weekly-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; max-height:65vh; overflow:auto; padding:2px; }
.wide { grid-column:1/-1; }.weekly-form label { display:flex; flex-direction:column; gap:7px; min-width:0; }.weekly-form label > span { font-size:12px; color:var(--muted); }
.weekly-form input,.weekly-form select,.weekly-form textarea { width:100%; min-width:0; min-height:35px; padding:7px 10px; border:1px solid var(--line); border-radius:5px; background:var(--surface); color:var(--text); font:inherit; font-size:12px; outline:none; }.weekly-form textarea { resize:vertical; }.weekly-form input:focus,.weekly-form select:focus,.weekly-form textarea:focus { border-color:var(--accent); }.weekly-form :deep(.el-input-number) { width:100%; }.weekly-form small { color:var(--muted); font-size:10px; overflow-wrap:anywhere; }
.weekly-totals { display:flex; flex-wrap:wrap; gap:10px 20px; padding:12px 0; border-block:1px solid var(--line); color:var(--muted); font-size:11px; }.weekly-totals strong { margin-left:6px; color:var(--text); font-weight:600; font-variant-numeric:tabular-nums; }.weekly-error { margin:0; font-size:12px; line-height:1.6; color:var(--el-color-danger); }
@media(max-width:600px) { .weekly-form { grid-template-columns:minmax(0,1fr); } }
</style>
