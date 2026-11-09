<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { ElButton, ElCheckbox, ElDialog, ElMessage, ElOption, ElSelect } from 'element-plus'
import { Calculator, Check } from 'lucide-vue-next'
import { useManagement } from '../../management-store'
import { roleLabels, sortManagementPeople, stageLabels, type ManagementState } from '../../../shared/management'
import { formatScheduleWeek } from '../../../shared/management-schedule'
import { getWeekEffortDefaultHours, getWeekEffortRows, prepareWeekEffortSettlement, previewWeekEffortSettlement, type WeekEffortSettlementInput } from '../../../shared/management-week-effort'

const open = defineModel<boolean>({ default: false })
const props = defineProps<{ week: string; personId?: string }>()
const manager = useManagement(), source = shallowRef<ManagementState>(manager.state)
const personId = ref(''), totalHours = ref<number | null>(null), notes = ref('')
const fields = ref<{ key: string; included: boolean; known: boolean; hours: number | null }[]>([])
const people = computed(() => sortManagementPeople(source.value.people).filter(person => person.active || source.value.efforts.some(entry => entry.personId === person.id && entry.week === props.week)))
const rows = computed(() => getWeekEffortRows(source.value, personId.value, props.week))
const stale = computed(() => source.value.revision !== manager.state.revision)
const input = computed<WeekEffortSettlementInput>(() => {
  if (totalHours.value === null || totalHours.value === ('' as unknown) || !Number.isFinite(totalHours.value)) throw new Error('请填写本周总实际投入')
  const included = fields.value.filter(field => field.included)
  if (included.some(field => field.known && (field.hours === null || field.hours === ('' as unknown) || !Number.isFinite(field.hours)))) throw new Error('请填写已知任务的实际工时')
  return { personId: personId.value, week: props.week, totalHours: totalHours.value, notes: notes.value,
    known: included.filter(field => field.known).map(field => ({ key: field.key, hours: field.hours! })),
    planIds: rows.value.filter(row => !row.effort && included.some(field => field.key === row.key)).map(row => row.plan!.id) }
})
const result = computed(() => {
  try { return { preview: previewWeekEffortSettlement(source.value, input.value), error: '' } }
  catch (error) { return { preview: null, error: (error as Error).message } }
})
const previewRows = computed(() => new Map(result.value.preview?.rows.map(row => [row.key, row]) || []))
const existing = computed(() => source.value.weekActuals.find(entry => entry.personId === personId.value && entry.week === props.week))
const hours = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
function selectPerson() {
  totalHours.value = getWeekEffortDefaultHours(source.value, personId.value, props.week)
  notes.value = existing.value?.notes || ''
  fields.value = rows.value.map(row => ({ key: row.key, included: row.included, known: row.known, hours: row.effort?.hours ?? null }))
}
function field(key: string) { return fields.value.find(field => field.key === key)! }
function reset() {
  source.value = manager.state
  personId.value = props.personId || people.value.find(person => source.value.efforts.some(entry => entry.personId === person.id && entry.week === props.week))?.id || people.value[0]?.id || ''
  selectPerson()
}
async function save() {
  if (stale.value || !result.value.preview || manager.busy) return
  if (await manager.execute(prepareWeekEffortSettlement(source.value, input.value))) { open.value = false; ElMessage.success('本周实际投入已核对，分摊结果已同步至需求和投入统计') }
}
watch(open, value => { if (value) reset() })
</script>

<template>
  <el-dialog v-model="open" title="核对本周工时" width="min(1100px, calc(100vw - 24px))" top="5vh" :close-on-click-modal="false" :close-on-press-escape="!manager.busy" :show-close="!manager.busy" destroy-on-close>
    <div class="week-effort-controls">
      <label><span>人员</span><el-select v-model="personId" aria-label="核算人员" :disabled="manager.busy" @change="selectPerson"><el-option v-for="person in people" :key="person.id" :label="person.name" :value="person.id" /></el-select></label>
      <div class="week-effort-period"><span>实际工作周</span><strong>{{ formatScheduleWeek(week, true) }}</strong></div>
      <label><span>本周总实际投入（H）</span><input v-model.number="totalHours" type="number" min="0" max="10000000" step="0.0001" aria-label="本周总实际投入小时" :disabled="manager.busy" /></label>
    </div>
    <div v-if="existing?.basis === 'standard'" class="week-effort-status">历史总投入按标准工作周回填</div>
    <div v-if="stale" class="week-effort-error" role="alert">管理数据已更新，请关闭后重新打开核对。</div>
    <div v-else-if="result.error" class="week-effort-error" role="alert">{{ result.error }}</div>
    <div class="week-effort-table-scroll">
      <table class="mg-table week-effort-table"><thead><tr><th>本周投入</th><th>工作内容</th><th class="number">原预计（H）</th><th>工时处理</th><th class="number">本次实际（H）</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.key" :class="{ excluded: !field(row.key).included }">
          <td><el-checkbox v-model="field(row.key).included" :disabled="!!row.effort || manager.busy" :aria-label="`本周投入：${row.title}`" /></td>
          <td><strong>{{ row.title }}</strong><small>{{ manager.projectName(row.projectId) }} / {{ manager.versionName(row.versionId) }}</small><small>{{ roleLabels[(row.effort || row.plan)!.role] }} · {{ stageLabels[(row.effort || row.plan)!.stage] }}<span v-if="row.early" class="week-effort-early">提前完成</span></small></td>
          <td class="number">{{ hours(row.estimatedHours) }}<small v-if="row.effort">原登记 {{ hours(row.effort.hours) }}</small></td>
          <td><select v-model="field(row.key).known" :disabled="!field(row.key).included || manager.busy" :aria-label="`${row.title}的工时处理方式`"><option :value="false">按预计分摊</option><option :value="true">保留登记工时</option></select></td>
          <td class="number"><input v-if="field(row.key).known && field(row.key).included" v-model.number="field(row.key).hours" type="number" min="0" max="10000000" step="0.0001" :disabled="manager.busy" :aria-label="`${row.title}已知实际小时`" /><template v-else>{{ field(row.key).included ? hours(previewRows.get(row.key)?.hours) : '—' }}<small v-if="field(row.key).included">分摊</small></template></td>
        </tr></tbody>
      </table>
      <div v-if="!rows.length" class="mg-empty"><Calculator :size="24" /><span>暂无可核算工作</span></div>
    </div>
    <div class="week-effort-totals"><span>原登记合计 <strong>{{ hours(result.preview?.previousHours) }}H</strong></span><span>保留登记工时 <strong>{{ hours(result.preview?.knownHours) }}H</strong></span><span>本次分摊工时 <strong>{{ hours(result.preview?.allocatedHours) }}H</strong></span><span>本周合计 <strong>{{ hours(result.preview?.totalHours) }}H</strong></span></div>
    <label class="week-effort-note"><span>核算备注</span><input v-model="notes" :disabled="manager.busy" maxlength="10000" aria-label="核算备注" /></label>
    <template #footer><el-button :disabled="manager.busy" @click="open = false">取消</el-button><el-button type="primary" :disabled="stale || !result.preview || !rows.length" :loading="manager.busy" @click="save"><Check :size="14" />保存核算</el-button></template>
  </el-dialog>
</template>

<style scoped>
.week-effort-controls { display:grid; grid-template-columns:200px minmax(160px,1fr) 210px; gap:18px; align-items:end; padding-bottom:18px; }.week-effort-controls label,.week-effort-period { display:flex; flex-direction:column; gap:8px; min-width:0; font-size:12px; }.week-effort-controls label > span,.week-effort-period > span,.week-effort-note > span { color:var(--muted); }.week-effort-period strong { display:flex; align-items:center; height:34px; font-weight:500; font-size:12px; }
input,select { width:100%; height:34px; min-width:0; padding:5px 8px; border:1px solid var(--line); border-radius:4px; background:var(--surface); color:var(--text); font:inherit; font-size:12px; }input[type=number] { font-variant-numeric:tabular-nums; text-align:right; }.week-effort-error,.week-effort-status { padding:8px 0; font-size:12px; }.week-effort-error { color:var(--el-color-danger); }.week-effort-status { color:var(--muted); }.week-effort-table-scroll { height:min(46vh,430px); min-height:180px; overflow:auto; overscroll-behavior:contain; border-top:1px solid var(--line); }.week-effort-table { min-width:760px; table-layout:fixed; }.week-effort-table th,.week-effort-table td { padding:10px; vertical-align:middle; }.week-effort-table th:first-child { width:74px; }.week-effort-table th:nth-child(3) { width:115px; }.week-effort-table th:nth-child(4) { width:130px; }.week-effort-table th:nth-child(5) { width:132px; }.week-effort-table strong { font-weight:500; line-height:1.7; }.week-effort-table small { line-height:1.6; }.week-effort-table .excluded { opacity:.5; }.week-effort-early { margin-left:8px; color:var(--green); }.week-effort-totals { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:12px 24px; padding:16px 0; font-size:12px; border-top:1px solid var(--line); color:var(--muted); }.week-effort-totals strong { font-weight:600; color:var(--text); margin-left:6px; font-variant-numeric:tabular-nums; }.week-effort-note { display:flex; align-items:center; gap:12px; font-size:12px; }.week-effort-note > span { flex-shrink:0; }
@media(max-width:650px) { .week-effort-controls { grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }.week-effort-period { grid-column:1 / -1; grid-row:2; }.week-effort-totals { justify-content:flex-start; } }
</style>
