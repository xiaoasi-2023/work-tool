<script setup lang="ts">
import { ArrowUpRight, ArrowDownRight, Check, CircleAlert, Clock3 } from 'lucide-vue-next'
import { formatActualWeeks, formatScheduleSpan, formatScheduleWeek, type ManagementScheduleSummary } from '../../../shared/management-schedule'
withDefaults(defineProps<{ summary: ManagementScheduleSummary; mode?: 'weeks' | 'hours' | 'all'; compact?: boolean }>(), { mode: 'all', compact: false })
const hours = (value: number | null) => value === null ? '—' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })} h`
</script>

<template>
  <div class="mg-schedule" :class="{ compact }">
    <template v-if="mode !== 'hours'">
      <dl class="mg-schedule-facts">
        <div><dt>计划</dt><dd :title="`${formatScheduleWeek(summary.plannedStartWeek, true)} 至 ${formatScheduleWeek(summary.plannedEndWeek, true)}`">{{ formatScheduleSpan(summary.plannedStartWeek, summary.plannedEndWeek) }}</dd></div>
        <div><dt>实际</dt><dd :title="summary.actualWeeks.map(week => formatScheduleWeek(week, true)).join('；') || '尚无实际工作记录'">{{ compact ? formatActualWeeks(summary.actualWeeks) : summary.actualWeeks.map(week => formatScheduleWeek(week)).join('、') || '未开展' }}</dd></div>
        <div v-if="summary.complete"><dt>完成</dt><dd :title="formatScheduleWeek(summary.completedWeek, true)">{{ summary.completedWeek ? formatScheduleWeek(summary.completedWeek) : '待补录' }}</dd></div>
      </dl>
      <span class="mg-schedule-badge" :class="`schedule-${summary.status}`">
        <ArrowUpRight v-if="summary.status === 'early'" :size="12" /><ArrowDownRight v-else-if="summary.status === 'late'" :size="12" /><CircleAlert v-else-if="summary.status === 'overdue'" :size="12" /><Check v-else-if="summary.status === 'on-time'" :size="12" /><Clock3 v-else :size="12" />{{ summary.label }}
      </span>
    </template>
    <template v-if="mode !== 'weeks'">
      <dl class="mg-schedule-facts">
        <div><dt>预计</dt><dd>{{ hours(summary.estimatedHours) }}<span v-if="summary.sharedEstimateCount" class="mg-schedule-shared">{{ summary.estimatedHours !== null ? ' + ' : '' }}共用 {{ hours(summary.sharedEstimatedHours) }}</span></dd></div>
        <div><dt>{{ summary.complete ? '实际' : '已投' }}</dt><dd>{{ hours(summary.actualHours) }}<span v-if="summary.sharedActualCount" class="mg-schedule-shared">{{ summary.actualHours !== null ? ' + ' : '' }}共用 {{ hours(summary.sharedActualHours) }}</span></dd></div>
      </dl>
      <span class="mg-schedule-cost" :class="`cost-${summary.costStatus}`">{{ summary.costLabel }}</span>
      <small v-if="summary.allocatedHours" class="mg-schedule-shared" title="包含按人员整周总投入、按原预计比例分摊的工时">含分摊工时</small>
    </template>
  </div>
</template>
