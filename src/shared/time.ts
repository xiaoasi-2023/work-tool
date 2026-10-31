import { Temporal } from '@js-temporal/polyfill'

export type TimeUnit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds'
export type InputUnit = TimeUnit | 'auto'
export type Disambiguation = 'reject' | 'earlier' | 'later'
export type CalendarUnit = 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds' | 'milliseconds'
const scales: Record<TimeUnit, bigint> = { seconds: 1000000000n, milliseconds: 1000000n, microseconds: 1000n, nanoseconds: 1n }
export const timeUnits: { value: TimeUnit; label: string }[] = [{ value: 'seconds', label: '秒 (s)' }, { value: 'milliseconds', label: '毫秒 (ms)' }, { value: 'microseconds', label: '微秒 (μs)' }, { value: 'nanoseconds', label: '纳秒 (ns)' }]
export const commonZones = ['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney']

export function detectUnit(text: string): TimeUnit {
  const digits = text.trim().replace(/^[+-]/, '').split('.')[0].replace(/^0+(?=\d)/, '').length
  return digits <= 10 ? 'seconds' : digits <= 13 ? 'milliseconds' : digits <= 16 ? 'microseconds' : 'nanoseconds'
}
export function parseTimestamp(text: string, unit: InputUnit = 'auto'): { instant: Temporal.Instant; unit: TimeUnit } {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text.trim())
  if (!match) throw new Error('请输入有效数字时间戳，支持负数和小数')
  const detected = unit === 'auto' ? detectUnit(text) : unit
  const places = scales[detected].toString().length - 1, fraction = (match[3] || '').replace(/0+$/, '')
  if (fraction.length > places) throw new Error('精度超过纳秒，请减少小数位数')
  const nanos = BigInt(match[2]) * scales[detected] + BigInt(fraction.padEnd(places, '0') || '0')
  try { return { instant: Temporal.Instant.fromEpochNanoseconds(match[1] === '-' ? -nanos : nanos), unit: detected } }
  catch { throw new Error('时间戳超出支持范围') }
}
export function timestampValue(instant: Temporal.Instant, unit: TimeUnit): string {
  const nanos = instant.epochNanoseconds, absolute = nanos < 0n ? -nanos : nanos, scale = scales[unit]
  const whole = absolute / scale, remainder = absolute % scale
  const places = scale.toString().length - 1
  const fraction = remainder ? `.${remainder.toString().padStart(places, '0').replace(/0+$/, '')}` : ''
  return `${nanos < 0n ? '-' : ''}${whole}${fraction}`
}
export function parseDateTime(text: string, zone: string, disambiguation: Disambiguation = 'reject'): Temporal.Instant {
  const normalized = text.trim().replace(' ', 'T')
  if (!normalized) throw new Error('请输入日期时间')
  if (/\[|\]/.test(normalized)) throw new Error('请使用日期时间或带 Z / ±HH:mm 偏移的 ISO 日期')
  try {
    if (/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return Temporal.Instant.from(normalized)
    return Temporal.PlainDateTime.from(normalized, { overflow: 'reject' }).toZonedDateTime(zone, { disambiguation }).toInstant()
  } catch {
    throw new Error('日期、时区无效，或该时刻受夏令时影响；请检查输入或选择较早 / 较晚时刻')
  }
}
export function parseTimeInput(text: string, zone: string, unit: InputUnit = 'auto', disambiguation: Disambiguation = 'reject'): Temporal.Instant {
  return /^[+-]?\d+(?:\.\d+)?$/.test(text.trim()) ? parseTimestamp(text, unit).instant : parseDateTime(text, zone, disambiguation)
}
export function dateInput(instant: Temporal.Instant, zone: string): string {
  return instant.toZonedDateTimeISO(zone).toPlainDateTime().toString({ fractionalSecondDigits: 3 })
}
export function describeTime(instant: Temporal.Instant, zone: string) {
  const date = instant.toZonedDateTimeISO(zone)
  return {
    zoned: `${date.toPlainDateTime().toString().replace('T', ' ')} ${date.offset}`,
    utc: instant.toString({ fractionalSecondDigits: instant.epochNanoseconds % 1000000n === 0n ? 3 : 'auto' }),
    seconds: timestampValue(instant, 'seconds'), milliseconds: timestampValue(instant, 'milliseconds'),
    microseconds: timestampValue(instant, 'microseconds'), nanoseconds: timestampValue(instant, 'nanoseconds'),
    weekday: ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'][date.dayOfWeek - 1],
    offset: date.offset, dayOfYear: date.dayOfYear, weekOfYear: date.weekOfYear,
    yearOfWeek: date.yearOfWeek, leapYear: date.inLeapYear
  }
}
export function shiftTime(instant: Temporal.Instant, zone: string, amount: number, unit: CalendarUnit): Temporal.Instant {
  if (!Number.isSafeInteger(amount)) throw new Error('增减量必须是安全范围内的整数')
  try { return instant.toZonedDateTimeISO(zone).add({ [unit]: amount }, { overflow: 'constrain' }).toInstant() }
  catch { throw new Error('计算结果超出支持范围') }
}
export type Boundary = 'day-start' | 'day-end' | 'week-start' | 'month-start' | 'month-end' | 'year-start'
export function timeBoundary(instant: Temporal.Instant, zone: string, boundary: Boundary): Temporal.Instant {
  const current = instant.toZonedDateTimeISO(zone)
  let day = current.toPlainDate()
  if (boundary === 'week-start') day = day.subtract({ days: current.dayOfWeek - 1 })
  if (boundary === 'month-start' || boundary === 'month-end') day = day.with({ day: 1 })
  if (boundary === 'year-start') day = day.with({ month: 1, day: 1 })
  if (boundary === 'day-end') return day.add({ days: 1 }).toZonedDateTime(zone).toInstant().subtract({ nanoseconds: 1 })
  if (boundary === 'month-end') return day.add({ months: 1 }).toZonedDateTime(zone).toInstant().subtract({ nanoseconds: 1 })
  return day.toZonedDateTime(zone).toInstant()
}
export function describeDifference(start: Temporal.Instant, end: Temporal.Instant) {
  const nanos = end.epochNanoseconds - start.epochNanoseconds, absolute = nanos < 0n ? -nanos : nanos
  const sign = nanos < 0n ? '-' : ''
  let rest = absolute / 1000000n
  const days = rest / 86400000n; rest %= 86400000n
  const hours = rest / 3600000n; rest %= 3600000n
  const minutes = rest / 60000n; rest %= 60000n
  const seconds = rest / 1000n, milliseconds = rest % 1000n, submillis = absolute % 1000000n
  const decimal = (scale: bigint) => {
    const fraction = ((absolute % scale) * 1000000000n / scale).toString().padStart(9, '0').replace(/0+$/, '')
    return `${sign}${absolute / scale}${fraction ? `.${fraction}` : ''}`
  }
  return { human: `${sign}${days} 天 ${hours} 小时 ${minutes} 分 ${seconds} 秒 ${milliseconds} 毫秒${submillis ? ` ${submillis} 纳秒` : ''}`, days: decimal(86400000000000n), hours: decimal(3600000000000n), seconds: decimal(1000000000n), milliseconds: decimal(1000000n), nanoseconds: nanos.toString() }
}
