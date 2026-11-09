import ExcelJS from 'exceljs'
import { getWeekSummary, roleLabels, stageLabels, sumHours, type ManagementState } from './management'
import { formatScheduleWeek } from './management-schedule'
import { getManagementWeekReport, getWeekReportLayout, getWeekReportWorkText, reportColumns, type ReportColumn, type WeekReportRow, type WeekReportSection } from './management-week-report'

const titles = { frontend: '前端', backend: '后端', product: '产品经理' }
const cyan = 'FF0CB4DF', line = 'FFDADFE5', ink = 'FF303841'
const border: Partial<ExcelJS.Borders> = Object.fromEntries(['top', 'left', 'bottom', 'right'].map(side => [side, { style: 'thin', color: { argb: line } }]))
const displayLength = (value: string) => [...value].reduce((length, char) => length + (char.charCodeAt(0) > 255 ? 2 : 1), 0)
function reportFormat(actual: boolean) {
  const groupWidth = actual ? 4 : 3, count = 5 + reportColumns.length * groupWidth
  return { withStatus: actual, groupWidth, count, endColumn: String.fromCharCode(64 + count),
    roleStart: Object.fromEntries(reportColumns.map((role, index) => [role, 6 + index * groupWidth])) as Record<ReportColumn, number> }
}
function baseStyle(sheet: ExcelJS.Worksheet) {
  sheet.properties.defaultRowHeight = 24
  sheet.views = [{ state: 'frozen', xSplit: 5, ySplit: 3, showGridLines: false }]
  sheet.pageSetup = { orientation: 'landscape', paperSize: 8 as ExcelJS.PaperSize, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:3', margins: { left: .2, right: .2, top: .35, bottom: .35, header: .1, footer: .1 } }
  sheet.headerFooter.oddFooter = '&L&BWorkbench&C第 &P 页 / 共 &N 页&R&D'
}
function template(sheet: ExcelJS.Worksheet, week: string, actual: boolean) {
  baseStyle(sheet)
  const format = reportFormat(actual), roleWidths = actual ? [13, 12, 13, 28] : [13, 12, 13]
  sheet.columns = [6, 25, 12, 14, 76, ...reportColumns.flatMap(() => roleWidths)].map(width => ({ width }))
  sheet.mergeCells(1, 1, 1, format.count)
  const date = new Date(`${week}T00:00:00Z`)
  sheet.getCell('A1').value = `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月第${Math.ceil(date.getUTCDate() / 7)}周工作计划${actual ? '及实际完成情况' : ''}`
  sheet.getRow(1).height = 38
  sheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 22, bold: true, color: { argb: ink } }
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
  for (const [index, title] of ['序号', '项目', '需求端', '阶段', '工作内容'].entries()) {
    sheet.mergeCells(2, index + 1, 3, index + 1)
    sheet.getCell(2, index + 1).value = title
  }
  for (const role of reportColumns) {
    const start = format.roleStart[role]
    sheet.mergeCells(2, start, 2, start + format.groupWidth - 1)
    sheet.getCell(2, start).value = titles[role]
    for (const [index, title] of ['任务复杂度', '排期（H）', '人员', ...(actual ? ['状态'] : [])].entries()) sheet.getCell(3, start + index).value = title
  }
  for (let row = 2; row <= 3; row++) for (let column = 1; column <= format.count; column++) {
    const cell = sheet.getCell(row, column)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cyan } }
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = border
  }
  sheet.getRow(2).height = 25
  sheet.getRow(3).height = 25
  for (const role of reportColumns) sheet.getCell(3, format.roleStart[role] + 1).note = actual ? '本周实际表：此列填写选定周实际发生的小时数，不是需求累计工时。' : '下周计划表：此列填写预计小时数；已提前完成的事项不计入下周负荷。'
  return format
}
function body(sheet: ExcelJS.Worksheet, values: ExcelJS.CellValue[]) {
  const row = sheet.addRow(values.map(value => value === '' ? null : value))
  row.eachCell({ includeEmpty: true }, cell => {
    cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: ink } }
    cell.border = border
    cell.alignment = { horizontal: /^E\d/.test(cell.address) ? 'left' : 'center', vertical: 'middle', wrapText: true }
    cell.numFmt = 'General'
  })
  let lines = 1
  for (const [index, value] of values.entries()) if (typeof value === 'string') {
    const width = sheet.getColumn(index + 1).width || 20
    lines = Math.max(lines, value.split('\n').reduce((count, text) => count + Math.max(1, Math.ceil(displayLength(text) / Math.max(5, width - 2))), 0))
  }
  row.height = Math.max(24, lines * 16 + 6)
  return row
}
const workName = getWeekReportWorkText
const projectName = (row: WeekReportRow) => `${row.project}${row.module ? `【${row.module}】` : ''}`
function splitWorkText(text: string, width: number): string[] {
  const lineWidth = Math.max(5, width - 2), maxLines = 22, limit = lineWidth * maxLines
  const lines = text.split('\n').flatMap(line => {
    const parts: string[] = []; let part = '', length = 0
    for (const char of line) {
      const size = displayLength(char)
      if (length + size > limit) { parts.push(part); part = ''; length = 0 }
      part += char; length += size
    }
    return [...parts, part]
  })
  const parts: string[] = []; let current: string[] = [], used = 0
  for (const line of lines) {
    const needed = Math.max(1, Math.ceil(displayLength(line) / lineWidth))
    if (current.length && used + needed > maxLines) { parts.push(current.join('\n')); current = []; used = 0 }
    current.push(line); used += needed
  }
  if (current.length) parts.push(current.join('\n'))
  return parts
}
export function createWeeklyReportWorkbook(state: ManagementState, week: string, context: { snapshotRevision?: number; confirmedAt?: string } = {}): ExcelJS.Workbook {
  const report = getManagementWeekReport(state, week, context.confirmedAt?.slice(0, 10)), workbook = new ExcelJS.Workbook()
  workbook.creator = 'Workbench'; workbook.created = new Date(); workbook.calcProperties.fullCalcOnLoad = true
  const actualSheet = workbook.addWorksheet('本周实际'), nextSheet = workbook.addWorksheet('下周计划'), summary = workbook.addWorksheet('周报汇总'), ledger = workbook.addWorksheet('工时核对')
  const actualFormat = template(actualSheet, report.week, true), nextFormat = template(nextSheet, report.nextWeek, false)
  const formatFor = (sheet: ExcelJS.Worksheet) => sheet === nextSheet ? nextFormat : actualFormat
  ledger.addRow(['口径', '项目', '模块', '专项版本', '工作内容', '人员', '列组', '实际角色 / 环节', '工时（H）', '计时方式', '状态', '说明'])
  const sourceRows = new Map<string, number>()
  const sections: [string, WeekReportSection][] = [['本周实际', report.actual], ['本周未完成', report.unfinished], ['下周计划', report.next], ['已提前完成', report.advanced]]
  for (const [kind, section] of sections) for (const entry of section.cells) {
    const rows = section.rows.filter(row => reportColumns.some(role => row.cells[role].some(cell => cell.id === entry.id)))
    const row = rows[0], scope = kind === '下周计划' && entry.draft ? '下周草稿' : kind
    const version = state.versions.find(version => version.id === row?.versionId)
    const role = reportColumns.find(role => rows.some(row => row.cells[role].some(cell => cell.id === entry.id)))!
    const source = ledger.addRow([scope, row?.project, row?.module || null, version?.name || null, rows.map(workName).join('\n'), entry.person, titles[role], `${roleLabels[entry.role]} / ${stageLabels[entry.stage]}`, entry.hours, entry.shared ? '组合合计' : '单项', entry.status, [entry.allocated ? '分摊工时：本周总实际投入扣除已知用时后，按原预计比例分配。' : '', entry.notes].filter(Boolean).join('\n') || null])
    sourceRows.set(`${kind}:${entry.id}`, source.number)
  }
  function appendRows(sheet: ExcelJS.Worksheet, section: WeekReportSection, kind: string, showHours = true) {
    const layout = getWeekReportLayout(section.rows, { groupEarly: true }), format = formatFor(sheet), physicalRows: { start: number; end: number }[] = []
    for (const [index, item] of layout.rows.entries()) {
      const values: ExcelJS.CellValue[] = [index + 1, projectName(item), item.platforms, item.stage, workName(item)]
      for (const role of reportColumns) {
        const cells = item.cells[role], references = cells.filter(cell => cell.hours !== null).map(cell => `'工时核对'!I${sourceRows.get(`${kind}:${cell.id}`)}`)
        let hours: ExcelJS.CellValue = ''
        if (cells.length && showHours && layout.hourSpans[index][role]) hours = references.length ? { formula: `SUM(${references.join(',')})`, result: sumHours(cells.map(cell => cell.hours ?? 0)) } : '未登记'
        values.push([...new Set(cells.flatMap(cell => cell.complexity.split(' / ')))].join('\n'), hours, [...new Set(cells.map(cell => cell.person))].join('\n'))
        if (format.withStatus) values.push([...new Set(cells.map(cell => cell.status))].join('\n'))
      }
      const parts = item.groupedRows ? splitWorkText(workName(item), sheet.getColumn(5).width || 76) : [workName(item)]
      const row = body(sheet, values.map((value, column) => column === 4 ? parts[0] : value))
      for (const text of parts.slice(1)) body(sheet, Array.from({ length: format.count }, (_, column) => column === 4 ? text : ''))
      const end = sheet.rowCount
      physicalRows.push({ start: row.number, end })
      if (end > row.number) for (let column = 1; column <= format.count; column++) if (column !== 5) sheet.mergeCells(row.number, column, end, column)
      for (const role of reportColumns) {
        const cells = item.cells[role], start = format.roleStart[role]
        if (!cells.length) continue
        row.getCell(start + 1).note = cells.map(cell => [cell.shared ? `所列组合需求合计${cell.hours ?? '未登记'}H，仅累计一次。` : '', cell.allocated ? '分摊工时：按本周总实际投入和原预计比例核算，并非逐项实测。' : '', `本周/本次预计：${cell.plannedHours ?? '未登记'}H`, cell.notes].filter(Boolean).join('\n')).join('\n\n')
        const tone = cells.find(cell => ['early', 'late', 'overdue'].includes(cell.tone))?.tone
        if (format.withStatus) row.getCell(start + 3).font = { name: 'Microsoft YaHei', size: 10, color: { argb: tone === 'late' || tone === 'overdue' ? 'FFAB5D17' : cells.every(cell => cell.status.startsWith('已完成')) ? 'FF16855C' : ink } }
        if (tone) for (const offset of format.withStatus ? [2, 3] : [2]) row.getCell(start + offset).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone === 'early' ? 'FFFFF16A' : 'FFFFE9D8' } }
      }
    }
    for (const role of reportColumns) layout.hourSpans.forEach((spans, index) => {
      if (spans[role] > 1) sheet.mergeCells(physicalRows[index].start, format.roleStart[role] + 1, physicalRows[index + spans[role] - 1].end, format.roleStart[role] + 1)
    })
  }
  const formulaTotal = (kind: string, role?: ReportColumn, person?: string): ExcelJS.CellFormulaValue => {
    const last = Math.max(2, ledger.rowCount), criteria = [`'工时核对'!A2:A${last},"${kind}"`]
    if (role) criteria.push(`'工时核对'!G2:G${last},"${titles[role]}"`)
    if (person) criteria.push(`'工时核对'!F2:F${last},"${person.replaceAll('"', '""').replaceAll('~', '~~').replaceAll('*', '~*').replaceAll('?', '~?')}"`)
    const source = sections.find(([name]) => name === (kind === '下周草稿' ? '下周计划' : kind))?.[1]
    const value = sumHours((source?.cells || []).filter(cell => (kind !== '下周计划' || !cell.draft) && (kind !== '下周草稿' || cell.draft)
      && (!role || (cell.role === 'frontend' || cell.role === 'backend' ? cell.role : 'product') === role) && (!person || cell.person === person)).map(cell => cell.hours ?? 0))
    return { formula: `SUMIFS('工时核对'!I2:I${last},${criteria.join(',')})`, result: value }
  }
  function total(sheet: ExcelJS.Worksheet, kind: string, label: string) {
    const format = formatFor(sheet), row = body(sheet, [label, ...Array(format.count - 1).fill('')]); sheet.mergeCells(row.number, 1, row.number, 6)
    for (const role of reportColumns) row.getCell(format.roleStart[role] + 1).value = formulaTotal(kind, role)
    row.eachCell(cell => { cell.font = { name: 'Microsoft YaHei', bold: true, size: 10, color: { argb: ink } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9F6FC' } } })
  }
  function band(sheet: ExcelJS.Worksheet, title: string) {
    const format = formatFor(sheet), row = body(sheet, [title, ...Array(format.count - 1).fill('')]); sheet.mergeCells(row.number, 1, row.number, format.count)
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    row.getCell(1).font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: ink } }
  }
  appendRows(actualSheet, report.actual, '本周实际'); total(actualSheet, '本周实际', '本周实际合计（H）')
  if (report.unfinished.rows.length) { band(actualSheet, '本周未完成与待结转（工时见批注，不计入本周实际合计）'); appendRows(actualSheet, report.unfinished, '本周未完成', false) }
  band(actualSheet, `统计周期：${formatScheduleWeek(report.week, true)}。本表“排期（H）”为本周实际投入；共用工时只累计一次。`)
  appendRows(nextSheet, report.next, '下周计划'); total(nextSheet, '下周计划', '下周已确认预计合计（H）')
  if (report.next.draftHours) total(nextSheet, '下周草稿', '下周待确认预计合计（H）')
  if (report.advanced.rows.length) { band(nextSheet, '原计划下周，已提前完成（保留原排期，不占用下周工时）'); appendRows(nextSheet, report.advanced, '已提前完成') }
  band(nextSheet, `计划周期：${formatScheduleWeek(report.nextWeek, true)}。本表“排期（H）”为预计投入；草稿和已提前完成事项不计入已确认合计。`)
  for (const sheet of [actualSheet, nextSheet]) sheet.pageSetup.printArea = `A1:${formatFor(sheet).endColumn}${sheet.rowCount}`

  summary.addRow(['周报汇总', formatScheduleWeek(report.week, true), '下周', formatScheduleWeek(report.nextWeek, true)])
  summary.addRow(['人员', '本周实际（H）', '下周已确认（H）', '下周草稿（H）', '下周可用（H）', '下周负荷'])
  const people = [...new Map([...getWeekSummary(state, report.week).people, ...report.nextPeople].map(person => [person.personId, person])).values()]
  for (const person of people) {
    const name = state.people.find(item => item.id === person.personId)?.name || '未分配'
    const row = summary.addRow([name, formulaTotal('本周实际', undefined, name), formulaTotal('下周计划', undefined, name), formulaTotal('下周草稿', undefined, name), person.capacity])
    row.getCell(6).value = { formula: `IF(E${row.number}=0,"",C${row.number}/E${row.number})`, result: person.capacity ? person.plannedHours / person.capacity : '' }
    row.getCell(6).numFmt = '0%'
  }
  const totalRow = summary.addRow(['合计', formulaTotal('本周实际'), formulaTotal('下周计划'), formulaTotal('下周草稿')])
  totalRow.font = { name: 'Microsoft YaHei', bold: true }
  summary.addRow([])
  summary.addRow(['未完成安排', report.unfinished.cells.length])
  summary.addRow(['下周已提前完成安排', report.advanced.cells.length])
  summary.addRow(['数据口径', context.snapshotRevision ? `历史确认版本 ${context.snapshotRevision}` : '实时数据'])
  summary.addRow(['确认时间', context.confirmedAt || null])
  if (!context.snapshotRevision) summary.addRow(['数据修订', state.revision])
  summary.addRow(['工时口径', '1人天=8小时；本周按实际归属周统计；下周排除已提前完成的安排；产品经理列组包含测试等非前后端工作，以阶段区分。'])
  const weekActuals = state.weekActuals.filter(entry => entry.week === report.week)
  if (weekActuals.length) summary.addRow(['周总投入核定', weekActuals.map(entry => `${state.people.find(person => person.id === entry.personId)?.name || '未分配'}：${entry.hours}H（${entry.basis === 'standard' ? '按标准周回填' : '经理确认'}）`).join('；')])
  summary.addRow(['组合工时', '常规事项逐项列出并合并共用工时；提前完成事项按项目、模块、人员与环节合并，保留完整需求清单，工时只累计一次。'])
  if (report.actual.cells.some(cell => cell.allocated)) summary.addRow(['分摊工时', '已知任务保留实报小时；其余任务按原预计比例分配周总投入的余额，明细见工时核对及单元格批注。'])
  for (const sheet of [summary, ledger]) {
    sheet.views = [{ state: 'frozen', ySplit: sheet === summary ? 2 : 1, showGridLines: false }]
    sheet.columns.forEach((column, index) => { column.width = sheet === ledger && index === 4 ? 76 : index === 0 ? 22 : 25 })
    sheet.eachRow(row => { row.eachCell(cell => { cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: ink } }; cell.alignment = { vertical: 'middle', wrapText: true }; cell.border = border }); row.height = 30 })
    const header = sheet.getRow(sheet === summary ? 2 : 1)
    header.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cyan } }; cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } } })
    if (sheet === ledger) {
      sheet.autoFilter = { from: 'A1', to: `L${Math.max(1, sheet.rowCount)}` }
      sheet.eachRow((row, index) => { if (index > 1) row.height = Math.max(30, ...[5, 12].map(column => String(row.getCell(column).value || '').split('\n').reduce((lines, text) => lines + Math.max(1, Math.ceil(displayLength(text) / ((sheet.getColumn(column).width || 25) - 2))), 0) * 15 + 6)) })
    } else {
      summary.getColumn(2).width = 55
      for (let row = totalRow.number + 2; row <= summary.rowCount; row++) { summary.mergeCells(row, 2, row, 6); summary.getRow(row).height = row >= summary.rowCount - 1 ? 48 : 30 }
      for (let row = 3; row < totalRow.number; row++) summary.getCell(row, 6).numFmt = '0%'
      totalRow.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: ink } }
    }
  }
  return workbook
}
