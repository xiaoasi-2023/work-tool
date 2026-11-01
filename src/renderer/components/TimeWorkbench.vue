<script setup lang="ts">
import { computed, onActivated, onDeactivated, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Temporal } from '@js-temporal/polyfill'
import { ElMessage } from 'element-plus'
import { ArrowRight, ArrowRightLeft, Calculator, CalendarClock, Clock3, Copy, Download, Globe2, List, Pause, Play, RefreshCw, Trash2 } from 'lucide-vue-next'
import { commonZones, dateInput, describeDifference, describeTime, parseDateTime, parseTimeInput, parseTimestamp, shiftTime, timeBoundary, timestampValue, timeUnits, type Boundary, type CalendarUnit, type Disambiguation, type InputUnit, type TimeUnit } from '../../shared/time'

function read(key: string, storage: Storage) { try { return JSON.parse(storage.getItem(key) || '{}') || {} } catch { return {} } }
const draft = read('draft-time-workbench', sessionStorage), preferences = read('time-preferences', localStorage)
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
function initialZone() {
  try { if (typeof preferences.zone === 'string') { Temporal.Now.instant().toZonedDateTimeISO(preferences.zone); return preferences.zone } } catch {}
  return browserZone
}
const zone = ref<string>(initialZone())
const zoneOptions = computed(() => {
  let supported: string[] = []
  try { supported = Intl.supportedValuesOf('timeZone') } catch {}
  return [...new Set([browserZone, ...commonZones, ...supported])]
})
const disambiguation = ref<Disambiguation>('reject')
const tab = ref<'convert' | 'batch' | 'calculate'>('convert')
const now = shallowRef(Temporal.Now.instant()), paused = ref(false)
let timer: ReturnType<typeof setInterval> | undefined, draftTimer: ReturnType<typeof setTimeout> | undefined
onMounted(() => window.addEventListener('pagehide', saveDraft))
onActivated(() => { if (!paused.value) now.value = Temporal.Now.instant(); clearInterval(timer); timer = setInterval(() => { if (!paused.value) now.value = Temporal.Now.instant() }, 1000) })
onDeactivated(() => { clearInterval(timer); saveDraft() })
onBeforeUnmount(() => { clearInterval(timer); clearTimeout(draftTimer); saveDraft(); window.removeEventListener('pagehide', saveDraft) })
const timestamp = ref<string>(typeof draft.timestamp === 'string' ? draft.timestamp : '')
const inputUnit = ref<InputUnit>('auto'), datetime = ref<string>(typeof draft.datetime === 'string' ? draft.datetime : '')
const instant = shallowRef<Temporal.Instant | null>(null), detectedUnit = ref(''), failure = ref('')
const detail = computed(() => instant.value ? describeTime(instant.value, zone.value) : null)
const live = computed(() => describeTime(now.value, zone.value))
const history = ref<{ timestamp: string; label: string }[]>(Array.isArray(draft.history) ? draft.history.filter((item: any) => typeof item?.timestamp === 'string' && typeof item?.label === 'string').slice(0, 8) : [])
const resultRows = computed(() => detail.value ? [
  { label: `日期 · ${zone.value}`, value: detail.value.zoned }, { label: 'UTC / ISO 8601', value: detail.value.utc },
  ...timeUnits.map(unit => ({ label: `Unix · ${unit.label}`, value: detail.value![unit.value] }))
] : [])
const worldZones = ['Asia/Shanghai', 'UTC', 'America/New_York', 'Europe/London']
const world = computed(() => worldZones.map(value => ({ zone: value, label: ({ 'Asia/Shanghai': '上海', UTC: 'UTC', 'America/New_York': '纽约', 'Europe/London': '伦敦' } as Record<string, string>)[value], text: dateInput(now.value, value).replace('T', ' ').slice(0, 19) })))
function show(value: Temporal.Instant, source = '') {
  instant.value = value; failure.value = ''; detectedUnit.value = source
  const item = { timestamp: value.epochNanoseconds.toString(), label: value.toString() }
  history.value = [item, ...history.value.filter(entry => entry.timestamp !== item.timestamp)].slice(0, 8)
}
function convertTimestamp() {
  try { const parsed = parseTimestamp(timestamp.value, inputUnit.value); show(parsed.instant, inputUnit.value === 'auto' ? `自动识别：${timeUnits.find(unit => unit.value === parsed.unit)!.label}` : '') }
  catch (error) { instant.value = null; detectedUnit.value = ''; failure.value = (error as Error).message }
}
function convertDate() {
  try { show(parseDateTime(datetime.value, zone.value, disambiguation.value)) }
  catch (error) { instant.value = null; failure.value = (error as Error).message }
}
function fillNow(target: 'timestamp' | 'date') {
  const current = Temporal.Now.instant()
  if (target === 'timestamp') { timestamp.value = timestampValue(current, inputUnit.value === 'auto' ? 'milliseconds' : inputUnit.value); convertTimestamp() }
  else { datetime.value = dateInput(current, zone.value); show(current) }
}
const shortcuts: { label: string; value: Boundary }[] = [{ label: '今日零点', value: 'day-start' }, { label: '今日结束', value: 'day-end' }, { label: '本周一', value: 'week-start' }, { label: '本月初', value: 'month-start' }, { label: '本月末', value: 'month-end' }, { label: '今年初', value: 'year-start' }]
function boundary(value: Boundary) { try { show(timeBoundary(Temporal.Now.instant(), zone.value, value)); datetime.value = instant.value!.toZonedDateTimeISO(zone.value).toPlainDateTime().toString() } catch (error) { failure.value = (error as Error).message } }
async function copy(value: string) { try { await navigator.clipboard.writeText(value); ElMessage.success('已复制') } catch { ElMessage.error('复制失败，请手动选择文本') } }
function download(value: string, filename: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' })), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000)
}
function copyResults() { if (detail.value) void copy(resultRows.value.map(row => `${row.label}\t${row.value}`).join('\n')) }

const batchInput = ref<string>(typeof draft.batchInput === 'string' ? draft.batchInput : '')
const batchUnit = ref<InputUnit>('auto'), batchOutput = ref<'date' | 'iso' | TimeUnit>('date')
type BatchRow = { line: number; input: string; output: string; success: boolean }
const batchRows = ref<BatchRow[]>([]), batchError = ref('')
const batchConfig = ref<{ zone: string; format: string } | null>(null)
const batchSuccess = computed(() => batchRows.value.filter(row => row.success).length)
const batchText = computed(() => batchRows.value.map(row => `${row.line}\t${row.input}\t${row.success ? row.output : `错误：${row.output}`}`).join('\n'))
function runBatch() {
  const lines = batchInput.value.split(/\r?\n/).map((text, index) => ({ text: text.trim(), line: index + 1 })).filter(row => row.text)
  if (!lines.length || lines.length > 1000) { batchError.value = '请输入 1 至 1000 行非空时间戳或日期'; batchRows.value = []; return }
  batchError.value = ''; batchConfig.value = { zone: zone.value, format: batchOutput.value }
  batchRows.value = lines.map(row => {
    try {
      const value = parseTimeInput(row.text, zone.value, batchUnit.value, disambiguation.value)
      const output = batchOutput.value === 'date' ? describeTime(value, zone.value).zoned : batchOutput.value === 'iso' ? value.toString() : timestampValue(value, batchOutput.value)
      return { line: row.line, input: row.text, output, success: true }
    } catch (error) { return { line: row.line, input: row.text, output: (error as Error).message, success: false } }
  })
}

const startDate = ref<string>(typeof draft.startDate === 'string' ? draft.startDate : ''), endDate = ref<string>(typeof draft.endDate === 'string' ? draft.endDate : '')
const difference = ref<ReturnType<typeof describeDifference> | null>(null), diffError = ref('')
const calculateDate = ref<string>(typeof draft.calculateDate === 'string' ? draft.calculateDate : ''), amount = ref(1), calendarUnit = ref<CalendarUnit>('days')
const calendarUnits: { value: CalendarUnit; label: string }[] = [{ value: 'years', label: '年' }, { value: 'months', label: '月' }, { value: 'weeks', label: '周' }, { value: 'days', label: '天' }, { value: 'hours', label: '小时' }, { value: 'minutes', label: '分钟' }, { value: 'seconds', label: '秒' }, { value: 'milliseconds', label: '毫秒' }]
const shifted = shallowRef<Temporal.Instant | null>(null), shiftError = ref('')
const shiftDetail = computed(() => shifted.value ? describeTime(shifted.value, zone.value) : null)
function calcDifference() {
  try { difference.value = describeDifference(parseTimeInput(startDate.value, zone.value, 'auto', disambiguation.value), parseTimeInput(endDate.value, zone.value, 'auto', disambiguation.value)); diffError.value = '' }
  catch (error) { difference.value = null; diffError.value = (error as Error).message }
}
function calcShift() {
  try { shifted.value = shiftTime(parseTimeInput(calculateDate.value, zone.value, 'auto', disambiguation.value), zone.value, Number(amount.value), calendarUnit.value); shiftError.value = '' }
  catch (error) { shifted.value = null; shiftError.value = (error as Error).message }
}
watch(zone, value => { try { Temporal.Now.instant().toZonedDateTimeISO(value); localStorage.setItem('time-preferences', JSON.stringify({ zone: value })) } catch { zone.value = browserZone } })
watch([batchInput, batchUnit, batchOutput, zone, disambiguation], () => { batchRows.value = []; batchError.value = ''; batchConfig.value = null })
watch([startDate, endDate, zone, disambiguation], () => { difference.value = null; diffError.value = '' })
watch([calculateDate, amount, calendarUnit, zone, disambiguation], () => { shifted.value = null; shiftError.value = '' })
function saveDraft() { try { sessionStorage.setItem('draft-time-workbench', JSON.stringify({ timestamp: timestamp.value, datetime: datetime.value, batchInput: batchInput.value, startDate: startDate.value, endDate: endDate.value, calculateDate: calculateDate.value, history: history.value })) } catch {} }
watch([timestamp, datetime, batchInput, startDate, endDate, calculateDate, history], () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 250) })
</script>

<template>
  <div class="time-workbench">
    <div class="time-heading"><h1><Clock3 :size="21" />时间戳工作台</h1><div class="time-zone-picker"><Globe2 :size="15" /><el-select v-model="zone" filterable aria-label="时区" placeholder="选择时区"><el-option v-for="value in zoneOptions" :key="value" :value="value" :label="value" /></el-select></div></div>
    <section class="time-live" aria-label="当前时间"><div class="time-live-main"><span class="time-caption">当前 Unix 时间戳</span><div><strong>{{ timestampValue(now, 'seconds').split('.')[0] }}</strong><button class="icon-button" title="复制当前秒时间戳" aria-label="复制当前秒时间戳" @click="copy(timestampValue(now, 'seconds').split('.')[0])"><Copy :size="15" /></button><button class="icon-button" :title="paused ? '继续时钟' : '暂停时钟'" :aria-label="paused ? '继续时钟' : '暂停时钟'" @click="paused = !paused; if (!paused) now = Temporal.Now.instant()"><component :is="paused ? Play : Pause" :size="15" /></button></div><span>{{ live.zoned }}<span class="metadata-dot">·</span>{{ live.weekday }}</span></div><div class="time-live-ms"><span class="time-caption">毫秒</span><div><code>{{ timestampValue(now, 'milliseconds').split('.')[0] }}</code><button class="icon-button" title="复制当前毫秒时间戳" aria-label="复制当前毫秒时间戳" @click="copy(timestampValue(now, 'milliseconds').split('.')[0])"><Copy :size="14" /></button></div></div></section>
    <nav class="time-tabs" aria-label="时间工具"><span class="time-tab-indicator" :style="{ transform: `translateX(${tab === 'convert' ? 0 : tab === 'batch' ? 100 : 200}%)` }" /><button v-for="item in [{ id: 'convert' as const, name: '时间转换', icon: ArrowRightLeft }, { id: 'batch' as const, name: '批量转换', icon: List }, { id: 'calculate' as const, name: '日期计算', icon: Calculator }]" :key="item.id" :class="{ selected: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id"><component :is="item.icon" :size="15" />{{ item.name }}</button></nav>
    <div class="time-dst-options"><span>夏令时冲突</span><el-select v-model="disambiguation" aria-label="夏令时冲突处理"><el-option value="reject" label="报错提示" /><el-option value="earlier" label="选择较早时刻" /><el-option value="later" label="选择较晚时刻" /></el-select><span class="toolbar-spacer" /><span><span class="local-dot" />本地处理</span></div>
    <template v-if="tab === 'convert'">
      <div class="time-convert-grid">
        <section class="time-input-section"><h2>时间戳 → 日期</h2><label class="time-field">Unix 时间戳<el-input v-model="timestamp" aria-label="Unix 时间戳" placeholder="整数或小数时间戳" @input="failure = ''; detectedUnit = ''" @keyup.enter="convertTimestamp" /></label><div class="time-input-actions"><el-select v-model="inputUnit" aria-label="时间戳单位"><el-option value="auto" label="自动识别" /><el-option v-for="unit in timeUnits" :key="unit.value" :value="unit.value" :label="unit.label" /></el-select><button class="icon-button bordered" title="填入当前时间戳" aria-label="填入当前时间戳" @click="fillNow('timestamp')"><RefreshCw :size="15" /></button><el-button type="primary" @click="convertTimestamp">转换<ArrowRight :size="15" /></el-button></div><span v-if="detectedUnit" class="time-hint">{{ detectedUnit }}</span><span v-else class="time-hint">自动识别按数字位数推断，可手动指定单位</span></section>
        <section class="time-input-section"><h2>日期 → 时间戳</h2><label class="time-field">日期时间 / ISO 8601<el-input v-model="datetime" aria-label="日期时间" placeholder="2026-10-31 12:30:00.123 或带 Z / 偏移的 ISO 日期" @input="failure = ''" @keyup.enter="convertDate" /></label><div class="time-input-actions"><span class="time-hint">{{ zone }}</span><span class="toolbar-spacer" /><button class="icon-button bordered" title="填入当前日期" aria-label="填入当前日期" @click="fillNow('date')"><RefreshCw :size="15" /></button><el-button type="primary" @click="convertDate">转换<ArrowRight :size="15" /></el-button></div></section>
      </div>
      <div class="time-shortcuts"><CalendarClock :size="15" /><button v-for="item in shortcuts" :key="item.value" @click="boundary(item.value)">{{ item.label }}</button></div>
      <el-alert v-if="failure" :title="failure" type="error" :closable="false" />
      <section v-if="detail" class="conversion-results time-result-block"><div class="time-section-title"><h2>转换结果</h2><span class="toolbar-spacer" /><button class="icon-button" title="复制全部结果" aria-label="复制全部结果" @click="copyResults"><Copy :size="16" /></button></div><div v-for="row in resultRows" :key="row.label" class="time-result-row"><span>{{ row.label }}</span><code>{{ row.value }}</code><button class="icon-button" :title="`复制${row.label}`" :aria-label="`复制${row.label}`" @click="copy(row.value)"><Copy :size="14" /></button></div><footer>{{ detail.weekday }}<span>全年第 {{ detail.dayOfYear }} 天</span><span>ISO {{ detail.yearOfWeek }} 年第 {{ detail.weekOfYear }} 周</span><span>{{ detail.leapYear ? '闰年' : '平年' }}</span></footer></section>
      <section v-if="history.length" class="time-history"><div class="time-section-title"><h2>最近转换</h2><button class="icon-button danger-hover" title="清空转换记录" aria-label="清空转换记录" @click="history = []"><Trash2 :size="14" /></button></div><div class="time-history-list"><button v-for="item in history" :key="item.timestamp" @click="show(Temporal.Instant.fromEpochNanoseconds(BigInt(item.timestamp)))"><code>{{ item.label }}</code></button></div></section>
      <section class="time-world"><div v-for="item in world" :key="item.zone"><span>{{ item.label }}</span><code>{{ item.text }}</code></div></section>
    </template>
    <template v-else-if="tab === 'batch'">
      <section class="time-batch"><div class="time-batch-controls"><el-select v-model="batchUnit" aria-label="批量输入单位"><el-option value="auto" label="自动识别单位" /><el-option v-for="unit in timeUnits" :key="unit.value" :value="unit.value" :label="unit.label" /></el-select><ArrowRight :size="15" /><el-select v-model="batchOutput" aria-label="批量输出格式"><el-option value="date" label="所选时区日期" /><el-option value="iso" label="UTC / ISO 8601" /><el-option v-for="unit in timeUnits" :key="unit.value" :value="unit.value" :label="unit.label" /></el-select><el-button type="primary" @click="runBatch">批量转换</el-button></div><label class="time-field">每行一个时间戳或日期 · 最多 1000 行<el-input v-model="batchInput" type="textarea" :rows="7" aria-label="批量时间输入" placeholder="0&#10;1793419200000&#10;2026-10-31 12:00:00&#10;2026-10-31T04:00:00Z" /></label><el-alert v-if="batchError" :title="batchError" type="error" :closable="false" /><template v-if="batchRows.length"><div class="time-section-title"><h2>成功 {{ batchSuccess }} 项，失败 {{ batchRows.length - batchSuccess }} 项</h2><span class="toolbar-spacer" /><button class="icon-button" title="复制批量结果" aria-label="复制批量结果" @click="copy(batchText)"><Copy :size="15" /></button><button class="icon-button" title="下载批量结果" aria-label="下载批量结果" @click="download(batchText, 'time-results.txt')"><Download :size="15" /></button></div><p class="time-hint">{{ batchConfig?.zone }} · {{ batchConfig?.format }}</p><div class="time-batch-table"><table><thead><tr><th>行</th><th>输入</th><th>结果</th></tr></thead><tbody><tr v-for="row in batchRows" :key="row.line" :class="{ failed: !row.success }"><td>{{ row.line }}</td><td><code>{{ row.input }}</code></td><td><code>{{ row.output }}</code></td></tr></tbody></table></div></template></section>
    </template>
    <template v-else>
      <div class="time-calculations">
        <section><h2>日期加减</h2><label class="time-field">基准时间<el-input v-model="calculateDate" aria-label="计算基准时间" placeholder="日期或自动识别时间戳" /></label><div class="time-math-controls"><label>增减量<input v-model.number="amount" aria-label="日期增减量" type="number" step="1" /></label><el-select v-model="calendarUnit" aria-label="日期增减单位"><el-option v-for="unit in calendarUnits" :key="unit.value" :value="unit.value" :label="unit.label" /></el-select><el-button type="primary" @click="calcShift">计算日期</el-button></div><p class="time-hint">年 / 月 / 天按日历计算，月末取目标月最后有效日期；小时按实际时长计算。</p><el-alert v-if="shiftError" :title="shiftError" type="error" :closable="false" /><div v-if="shiftDetail" class="time-math-result" role="status"><code>{{ shiftDetail.zoned }}</code><code>{{ shiftDetail.utc }}</code><div><span>秒时间戳</span><code>{{ shiftDetail.seconds }}</code><button class="icon-button" title="复制日期计算结果" aria-label="复制日期计算结果" @click="copy(shiftDetail.utc)"><Copy :size="14" /></button></div></div></section>
        <section><h2>时间差 · 结束 − 开始</h2><label class="time-field">开始时间<el-input v-model="startDate" aria-label="时间差开始时间" placeholder="日期或自动识别时间戳" /></label><label class="time-field">结束时间<el-input v-model="endDate" aria-label="时间差结束时间" placeholder="日期或自动识别时间戳" /></label><div class="time-input-actions"><button class="icon-button bordered" title="交换起止时间" aria-label="交换起止时间" @click="[startDate, endDate] = [endDate, startDate]"><ArrowRightLeft :size="15" /></button><span class="toolbar-spacer" /><el-button type="primary" @click="calcDifference">计算时间差</el-button></div><el-alert v-if="diffError" :title="diffError" type="error" :closable="false" /><div v-if="difference" class="time-math-result" role="status"><strong>{{ difference.human }}</strong><div><span>总天数（约）</span><code>{{ difference.days }}</code></div><div><span>总小时（约）</span><code>{{ difference.hours }}</code></div><div><span>总秒数</span><code>{{ difference.seconds }}</code></div><div><span>总毫秒</span><code>{{ difference.milliseconds }}</code></div><div><span>总纳秒</span><code>{{ difference.nanoseconds }}</code><button class="icon-button" title="复制时间差" aria-label="复制时间差" @click="copy(difference.human)"><Copy :size="14" /></button></div></div></section>
      </div>
    </template>
  </div>
</template>

<style src="../time.css"></style>
