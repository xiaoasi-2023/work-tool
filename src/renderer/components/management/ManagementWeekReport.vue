<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, ArrowUpRight, ChevronRight, Pencil } from 'lucide-vue-next'
import { roleLabels, stageLabels, sumHours } from '../../../shared/management'
import { getWeekReportEditCells, getWeekReportLayout, getWeekReportWorkDetails, reportColumns, type ReportColumn, type WeekReportCell, type WeekReportRow, type WeekReportSection } from '../../../shared/management-week-report'

const props = withDefaults(defineProps<{ section: WeekReportSection; kind: 'actual' | 'plan' | 'unfinished' | 'advanced'; readonly?: boolean; compact?: boolean }>(), { readonly: false, compact: false })
const layout = computed(() => getWeekReportLayout(props.section.rows, { groupEarly: true }))
const emit = defineEmits<{ edit: [cell: WeekReportCell]; carry: [id: string]; complexity: [taskIds: string[]]; 'open-requirement': [id: string] }>()
const labels = { frontend: '前端', backend: '后端', product: '产品经理' }
const hours = (value: number | null) => value === null ? '未登记' : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
function details(cell: WeekReportCell) { return [cell.shared ? `组合合计 ${hours(cell.hours)} 小时，仅累计一次；筛选后仍为完整组合用时` : '', cell.allocated ? '分摊工时：按周总实际投入和原预计比例核算' : '', cell.notes].filter(Boolean).join('\n') }
function editLabel(cell: WeekReportCell) { return `编辑${cell.person}的${stageLabels[cell.stage]}${cell.planId ? '排期与进展' : cell.effortId ? '实际投入' : '角色任务'}` }
function displayCells(row: WeekReportRow, role: ReportColumn): WeekReportCell[] {
  const cells = row.cells[role]
  if (!row.groupedRows || !cells.length) return cells
  return [{ ...cells[0], taskIds: [], complexity: [...new Set(cells.flatMap(cell => cell.complexity.split(' / ')))].join(' / '),
    hours: sumHours(cells.map(cell => cell.hours ?? 0)), person: [...new Set(cells.map(cell => cell.person))].join('、'), shared: true, notes: '', allocated: cells.some(cell => cell.allocated) }]
}
</script>

<template>
  <div class="mg-week-report" :class="{ compact }">
    <div class="mg-week-report-scroll">
      <table class="mg-report-table" :aria-label="kind === 'actual' ? '本周实际工作明细' : kind === 'plan' ? '下周工作计划' : kind === 'unfinished' ? '本周未完成与结转' : '原计划下周已提前完成'">
        <colgroup><col class="report-index" /><col class="report-project" /><col class="report-platform" /><col class="report-stage" /><col class="report-work" /><template v-for="role in reportColumns" :key="role"><col class="report-complexity" /><col class="report-hours" /><col class="report-person" /><col class="report-status" /></template></colgroup>
        <thead>
          <tr><th rowspan="2" scope="col">序号</th><th rowspan="2" scope="col">项目</th><th rowspan="2" scope="col">需求端</th><th rowspan="2" scope="col">阶段</th><th rowspan="2" scope="col">工作内容</th><th v-for="role in reportColumns" :key="role" colspan="4" scope="colgroup">{{ labels[role] }}</th></tr>
          <tr><template v-for="role in reportColumns" :key="role"><th scope="col">复杂度</th><th scope="col">{{ kind === 'actual' ? '实际 (H)' : '预计 (H)' }}</th><th scope="col">人员</th><th scope="col">状态</th></template></tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in layout.rows" :key="row.id" :class="{ 'report-group-row': row.groupedRows }">
            <td>{{ index + 1 }}</td><td><span>{{ row.project }}</span><small v-if="row.module">{{ row.module }}</small></td><td>{{ row.platforms }}</td><td>{{ row.stage }}</td>
            <td class="report-work-cell">
              <ol v-if="row.groupedRows" class="report-group-list"><li v-for="item in row.groupedRows" :key="item.id"><span>{{ item.title }}{{ item.code ? `（${item.code}）` : '' }}</span><div v-for="(detail, detailIndex) in getWeekReportWorkDetails(item)" :key="detailIndex" class="report-work-detail">{{ detail }}</div></li></ol>
              <template v-else><strong>{{ row.title }}</strong><small v-if="row.code">{{ row.code }}</small><div v-for="(detail, detailIndex) in getWeekReportWorkDetails(row)" :key="detailIndex" class="report-work-detail">{{ detail }}</div></template>
              <div v-if="!readonly && !row.groupedRows" class="report-work-actions"><template v-for="cell in getWeekReportEditCells(row)" :key="cell.id"><button class="report-edit-button" :title="editLabel(cell)" :aria-label="`${row.title}：${editLabel(cell)}`" @click="emit('edit', cell)"><Pencil :size="13" /><span>{{ roleLabels[cell.role] }} · {{ cell.person }}</span></button><button v-if="kind === 'unfinished' && cell.planId" class="icon-button" :title="`安排${cell.person}下周继续`" :aria-label="`结转${row.title}`" @click="emit('carry', cell.planId)"><ArrowRight :size="14" /></button></template><button v-if="row.requirementId" class="icon-button" title="打开需求详情" :aria-label="`打开${row.title}的需求详情`" @click="emit('open-requirement', row.requirementId)"><ArrowUpRight :size="14" /></button></div>
              <details v-if="!readonly && row.groupedRows" class="report-group-editors"><summary><ChevronRight :size="13" />编辑明细（{{ row.groupedRows.length }}）</summary><div v-for="item in row.groupedRows" :key="item.id" class="report-group-editor"><strong>{{ item.code }} · {{ item.title }}</strong><div class="report-work-actions"><button v-for="cell in getWeekReportEditCells(item)" :key="cell.id" class="report-edit-button" :title="editLabel(cell)" :aria-label="`${item.title}：${editLabel(cell)}`" @click="emit('edit', cell)"><Pencil :size="13" /><span>{{ roleLabels[cell.role] }} · {{ cell.person }}</span></button><button v-if="item.requirementId" class="icon-button" title="打开需求详情" :aria-label="`打开${item.title}的需求详情`" @click="emit('open-requirement', item.requirementId)"><ArrowUpRight :size="14" /></button></div></div></details>
            </td>
            <template v-for="role in reportColumns" :key="role">
              <td><span v-for="cell in displayCells(row, role)" :key="cell.id" class="report-cell-line"><button v-if="!readonly && cell.taskIds.length" class="report-complexity-button" :title="`编辑${stageLabels[cell.stage]}复杂度`" :aria-label="`${row.title}：编辑${stageLabels[cell.stage]}复杂度`" @click="emit('complexity', cell.taskIds)"><span>{{ cell.complexity }}</span><Pencil :size="11" /></button><template v-else>{{ cell.complexity }}</template></span></td>
              <td v-if="layout.hourSpans[index][role]" class="report-numeric" :rowspan="layout.hourSpans[index][role]"><span v-for="cell in displayCells(row, role)" :key="cell.id" class="report-cell-line" :title="details(cell)">{{ hours(cell.hours) }}<small v-if="cell.allocated">分摊</small></span></td>
              <td><span v-for="cell in displayCells(row, role)" :key="cell.id" class="report-cell-line">{{ cell.person }}</span></td>
              <td><span v-for="cell in displayCells(row, role)" :key="cell.id" class="report-cell-line report-result" :class="[`result-${cell.tone}`, { 'result-completed': cell.status.startsWith('已完成') }]">{{ cell.status }}</span></td>
            </template>
          </tr>
        </tbody>
      </table>
      <div v-if="!section.rows.length" class="mg-empty">{{ kind === 'actual' ? '本周暂无实际工作记录' : kind === 'plan' ? '下周暂无待执行排期' : '暂无匹配事项' }}</div>
    </div>
  </div>
</template>

<style scoped>
.mg-week-report { display:flex; flex:1; flex-direction:column; min-height:0; min-width:0; overflow:hidden; }.mg-week-report-scroll { min-height:0; min-width:0; overflow:auto; overscroll-behavior:contain; flex:1; }
.mg-report-table { table-layout:fixed; border-collapse:separate; border-spacing:0; width:100%; min-width:2090px; color:var(--text); font-size:11px; }.mg-report-table th,.mg-report-table td { padding:9px 10px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); text-align:center; vertical-align:top; overflow-wrap:anywhere; line-height:1.7; }.mg-report-table th { position:sticky; top:0; height:30px; padding-block:5px; vertical-align:middle; color:var(--muted); background:var(--bg); font-weight:500; z-index:2; }.mg-report-table thead tr:nth-child(2) th { top:30px; }.mg-report-table th[rowspan] { vertical-align:middle; }.mg-report-table tbody tr:hover { background:var(--hover); }
.report-index { width:48px; }.report-project { width:132px; }.report-platform { width:80px; }.report-stage { width:90px; }.report-work { width:300px; }.report-complexity { width:62px; }.report-hours { width:84px; }.report-person { width:78px; }.report-status { width:194px; }
.mg-report-table td:first-child,.mg-report-table th:first-child[rowspan] { position:sticky; left:0; background:var(--surface); z-index:1; }.mg-report-table th:first-child[rowspan] { background:var(--bg); z-index:3; }.mg-report-table td:nth-child(2),.mg-report-table th:nth-child(2)[rowspan] { position:sticky; left:48px; background:var(--surface); z-index:1; }.mg-report-table th:nth-child(2)[rowspan] { background:var(--bg); z-index:3; }
.mg-report-table small { display:block; font-size:10px; color:var(--muted); margin-top:3px; }.mg-report-table .report-work-cell { text-align:left; }.report-work-cell strong { font-size:11px; font-weight:500; }.report-work-actions { display:flex; gap:3px; margin-top:3px; }.report-work-actions .icon-button { height:22px; width:24px; }.report-cell-line { display:block; min-height:20px; }.report-cell-line + .report-cell-line { margin-top:6px; border-top:1px solid var(--line); padding-top:5px; }.mg-report-table .report-numeric { font-variant-numeric:tabular-nums; vertical-align:middle; }.report-result { text-align:left; }.result-early,.result-on-time { color:var(--green); }.result-early { border-left:2px solid var(--green); padding-left:7px; }.result-late,.result-overdue { color:var(--el-color-danger); border-left:2px solid var(--el-color-danger); padding-left:7px; }.result-active { color:var(--accent); }.result-planned { color:var(--muted); }.compact .mg-report-table { min-width:2090px; }
.report-work-detail { margin-top:5px; white-space:pre-wrap; }
.result-completed:not(.result-late):not(.result-overdue) { color:var(--green); }
.report-group-list { margin:0; padding-left:22px; }.report-group-list li + li { margin-top:4px; }.report-group-editors { margin-top:8px; border-top:1px solid var(--line); padding-top:6px; }.report-group-editors summary { display:flex; align-items:center; gap:4px; color:var(--accent); cursor:pointer; list-style:none; }.report-group-editors summary::-webkit-details-marker { display:none; }.report-group-editors[open] summary svg { transform:rotate(90deg); }.report-group-editor { margin-top:8px; padding-top:6px; border-top:1px solid var(--line); }
.mg-report-table .report-group-row td { vertical-align:middle; }.mg-report-table .report-group-row .report-work-cell { vertical-align:top; }
.report-edit-button { display:inline-flex; align-items:center; gap:5px; min-height:24px; min-width:0; max-width:100%; padding:2px 5px; border:0; border-radius:3px; background:transparent; color:var(--accent); font:inherit; line-height:1.6; text-align:left; cursor:pointer; }.report-edit-button svg { flex-shrink:0; }.report-edit-button span { min-width:0; overflow-wrap:anywhere; }.report-edit-button:hover { background:var(--accent-soft); }.report-edit-button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.report-work-actions { flex-wrap:wrap; }.report-complexity-button { display:inline-flex; align-items:center; justify-content:center; gap:4px; max-width:100%; min-height:22px; padding:0; border:0; background:none; color:var(--text); font:inherit; cursor:pointer; overflow-wrap:anywhere; }.report-complexity-button svg { flex-shrink:0; color:var(--muted); }.report-complexity-button:hover,.report-complexity-button:hover svg { color:var(--accent); }.report-complexity-button:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
</style>
