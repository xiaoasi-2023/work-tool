import ExcelJS from 'exceljs'
import { createWeeklyReportWorkbook } from './management-week-report-spreadsheet'
import { formatScheduleWeek, getPlansForWeek, getPlanSchedule, getRequirementSchedule, getScopeSchedule } from './management-schedule'
import { formatVersionDevelopmentSpan, formatVersionMilestone, getVersionTimeline } from './management-timeline'
import { roleLabels, stageLabels, taskStatusLabels, getVersionSummary, sortManagementPeople, sumHours, isManagementDate, weekStart } from './management'
import type { ManagementState, ManagementRole, ManagementCommand } from './management'

export interface OpeningRow {
  row: number; project: string; version: string; person: string; role: ManagementRole; hours: number;
  startedAt: string; devCompletedAt: string; releasedAt: string; notes: string;
}
export interface OpeningPreview { rows: OpeningRow[]; warnings: string[]; source: string }
export interface OpeningWorkbookFile { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
export interface ManagementExportContext { snapshotRevision?: number; confirmedAt?: string }
function peopleNames(value: string) { return value.split(/[、,，;；/\n&＆]+/).map(name => name.trim()).filter(Boolean) }
function hasUncalculatedFormula(cell: ExcelJS.Cell) {
  const value = cell.value
  return !!value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value) && value.result === undefined
}
function text(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null) return ''
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return String(value.result ?? '').trim()
    if ('richText' in value) return value.richText.map(v => v.text).join('').trim()
    if ('text' in value) return String(value.text).trim()
  }
  return String(value).trim()
}
function date(cell: ExcelJS.Cell) {
  if (!cell.value) return ''
  if (hasUncalculatedFormula(cell)) throw new Error(`日期公式尚未计算：${cell.address}，请在 Excel 中重新计算并保存`)
  if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10)
  const value = text(cell).replaceAll('/', '-')
  if (!value || value === '-') return ''
  const normalized = value.split('-').map((v, i) => i ? v.padStart(2, '0') : v).join('-')
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value) && isManagementDate(normalized)) return normalized
  throw new Error(`日期格式无效：${cell.address}`)
}
export async function readOpeningWorkbook(file: OpeningWorkbookFile): Promise<OpeningPreview> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Excel 文件不能超过10 MB')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await file.arrayBuffer() as unknown as Parameters<typeof book.xlsx.load>[0])
  const sheet = book.getWorksheet('更新用时明细') || book.worksheets[0]
  if (!sheet) throw new Error('工作簿中没有工作表')
  if (sheet.rowCount > 10000) throw new Error('投入模板不能超过10000行，请拆分后导入')
  let header = 0
  for (let n = 1; n <= Math.min(sheet.rowCount, 20); n++) if (text(sheet.getCell(n, 1)) === '项目名称') { header = n; break }
  if (!header) throw new Error('未识别投入模板，请使用包含“项目名称”表头的更新用时明细')
  if (!['模块功能', '专项版本', '更新批次'].includes(text(sheet.getCell(header, 2))) || !['开始日期', '开发开始日期'].includes(text(sheet.getCell(header, 3))) || !['完成日期', '开发完成日期'].includes(text(sheet.getCell(header, 4)))) throw new Error('模板前四列应为项目名称、模块功能/专项版本、开始日期、开发完成日期')
  const columns: { column: number; personColumn: number; role: ManagementRole; factor: number }[] = []
  const roleMap: Record<string, ManagementRole> = { 产品: 'product', 前端: 'frontend', 后端: 'backend', 测试: 'qa' }
  let releaseColumn = 0, notesColumn = 0
  sheet.getRow(header).eachCell((cell, column) => {
    const label = text(cell).replace(/\s/g, '')
    const match = /^(产品|前端|后端|测试)(用时|工时|投入)/.exec(label)
    if (match) {
      const factor = /人天/.test(label) ? 8 : /小时|\(H\)|（H）/i.test(label) ? 1 : 0
      if (!factor) throw new Error(`无法识别“${label}”的工时单位`)
      if (!text(sheet.getCell(header, column - 1)).startsWith(`${match[1]}人员`)) throw new Error(`“${label}”前应为对应的人员列`)
      columns.push({ column, personColumn: column - 1, role: roleMap[match[1]], factor })
    }
    if (label === '实际上线日期') releaseColumn = column
    if (label === '备注') notesColumn = column
  })
  if (!columns.length) throw new Error('未找到产品、前端、后端或测试用时列')
  const rows: OpeningRow[] = [], warnings: string[] = [], keys = new Set<string>()
  const versionDates = new Map<string, string>()
  for (let n = header + 1; n <= Math.min(sheet.rowCount, 10000); n++) {
    const project = text(sheet.getCell(n, 1)), version = text(sheet.getCell(n, 2))
    if (!project && !version) continue
    if (!project || !version) throw new Error(`第${n}行缺少项目名称或模块功能/专项版本名称`)
    for (const col of columns) {
      if (hasUncalculatedFormula(sheet.getCell(n, col.column))) throw new Error(`第${n}行投入公式尚未计算，请在 Excel 中重新计算并保存`)
      const raw = text(sheet.getCell(n, col.column)), person = text(sheet.getCell(n, col.personColumn))
      if (!raw || raw === '-') continue
      const amount = Number(raw)
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`第${n}行的${roleLabels[col.role]}投入必须为非负数`)
      if (!person || person === '-') throw new Error(`第${n}行的${roleLabels[col.role]}投入缺少人员`)
      const key = JSON.stringify([project, version, person, col.role])
      if (keys.has(key)) throw new Error(`第${n}行重复出现相同项目、版本、人员和角色，请先核对累计范围`)
      keys.add(key)
      if (peopleNames(person).length > 1) warnings.push(`第${n}行“${person}”为共同投入，将保留角色总额，不均分到个人`)
      const startedAt = date(sheet.getCell(n, 3)), devCompletedAt = date(sheet.getCell(n, 4)), releasedAt = releaseColumn ? date(sheet.getCell(n, releaseColumn)) : ''
      if (startedAt && devCompletedAt && devCompletedAt < startedAt) throw new Error(`第${n}行的开发完成日期早于开始日期`)
      if (devCompletedAt && releasedAt && releasedAt < devCompletedAt) throw new Error(`第${n}行的上线日期早于开发完成日期`)
      const versionKey = JSON.stringify([project, version]), dates = JSON.stringify([startedAt, devCompletedAt, releasedAt])
      if (versionDates.has(versionKey) && versionDates.get(versionKey) !== dates) throw new Error(`第${n}行同一专项版本的日期不一致，请先合并核对`)
      versionDates.set(versionKey, dates)
      rows.push({ row: n, project, version, person, role: col.role, hours: Math.round(amount * col.factor * 10000) / 10000,
        startedAt, devCompletedAt, releasedAt, notes: notesColumn ? text(sheet.getCell(n, notesColumn)) : '' })
    }
  }
  if (!rows.length) throw new Error('没有找到可导入的实际投入记录')
  return { rows, warnings: [...new Set(warnings)], source: file.name }
}
export function prepareOpeningImport(state: ManagementState, preview: OpeningPreview, asOf: string): ManagementCommand {
  if (!isManagementDate(asOf)) throw new Error('请选择有效的期初投入截至日期')
  if (!preview.rows.length) throw new Error('没有可导入的期初投入')
  const projects = state.projects.map(p => ({ ...p, modules: [...p.modules] }))
  const versions = state.versions.map(v => ({ ...v }))
  const people = state.people.map(p => ({ ...p, roles: [...p.roles] }))
  const baselines = state.baselines.map(b => ({ ...b })), keys = new Set<string>()
  const commands: ManagementCommand[] = []
  const upsert = (entity: 'projects' | 'versions' | 'people' | 'baselines', value: object) => commands.push({ type: 'upsert', entity, value: { ...value } })
  for (const row of preview.rows) {
    if (!row.project.trim() || !row.version.trim() || !row.person.trim() || !Number.isFinite(row.hours) || row.hours < 0) throw new Error(`第${row.row}行的期初投入格式无效`)
    const key = JSON.stringify([row.project, row.version, row.person, row.role])
    if (keys.has(key)) throw new Error(`第${row.row}行的期初投入重复，请核对后导入`)
    keys.add(key)
    let project = projects.find(p => p.name.toLocaleLowerCase() === row.project.toLocaleLowerCase())
    if (!project) { project = { id: crypto.randomUUID(), code: '', name: row.project, ownerId: '', modules: [], status: 'active', notes: '' }; projects.push(project); upsert('projects', project) }
    const matches = versions.filter(v => v.projectId === project!.id && v.name === row.version)
    if (matches.length > 1) throw new Error(`“${row.project} / ${row.version}”匹配多个专项版本，请先调整版本名称`)
    let version = matches[0]
    if (!version) {
      version = { id: crypto.randomUUID(), projectId: project.id, code: `IMP-${crypto.randomUUID().slice(0, 6)}`, name: row.version, ownerId: '', scope: '', notes: row.notes,
        status: 'active', plannedStart: '', plannedDevEnd: '', plannedTestEnd: '', plannedRelease: '', startedAt: row.startedAt, devCompletedAt: row.devCompletedAt,
        submittedAt: '', testStartedAt: '', testCompletedAt: '', releasedAt: row.releasedAt, estimatedHours: null }
      versions.push(version); upsert('versions', version)
    }
    const grouped = peopleNames(row.person).length > 1
    const personMatches = grouped ? [] : people.filter(p => p.name === row.person)
    if (personMatches.length > 1) throw new Error(`“${row.person}”匹配多个同名人员，请先核对人员记录`)
    let person = personMatches[0]
    if (!person && !grouped) { person = { id: crypto.randomUUID(), name: row.person, roles: [row.role], weeklyCapacity: 40, active: true, notes: '' }; people.push(person); upsert('people', person) }
    else if (person && !person.roles.includes(row.role)) { person.roles.push(row.role); upsert('people', person) }
    const existing = baselines.find(b => b.versionId === version!.id && b.role === row.role && (person ? b.personId === person.id : !b.personId && b.peopleLabel === row.person))
    if (existing && existing.asOf !== asOf) throw new Error(`“${row.project} / ${row.version} / ${row.person}”已有不同截至日期的期初，请先核对范围`)
    const overlapping = baselines.some(b => b.id !== existing?.id && b.versionId === version!.id && b.role === row.role && peopleNames(b.personId ? people.find(p => p.id === b.personId)?.name || b.peopleLabel : b.peopleLabel).some(name => peopleNames(row.person).includes(name)))
    if (overlapping) throw new Error(`“${row.project} / ${row.version} / ${row.person}”与现有期初人员范围重叠，请先核对共同投入与个人投入`)
    const baseline = { id: existing?.id || crypto.randomUUID(), projectId: project.id, versionId: version.id, personId: person?.id || '', peopleLabel: row.person,
      role: row.role, hours: row.hours, asOf, source: preview.source, notes: row.notes }
    upsert('baselines', baseline)
    if (!existing) baselines.push(baseline)
  }
  return { type: 'batch', commands, reason: `导入历史累计：${preview.source}，截至${asOf}` }
}
function formatSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: { row: sheet.rowCount, column: sheet.columnCount } }
  sheet.getRow(1).height = 29
  sheet.getRow(1).eachCell(cell => { cell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3565D8' } } })
  sheet.columns.forEach(column => { column.width = 20 })
  sheet.eachRow((row, number) => { if (number > 1) { row.height = 25; row.eachCell(cell => { cell.alignment = { vertical: 'middle', wrapText: true }; cell.numFmt = 'General' }) } })
}
export function createManagementWorkbook(state: ManagementState, week: string, kind: 'week' | 'effort' | 'report', context: ManagementExportContext = {}): ExcelJS.Workbook {
  if (kind === 'report') return createWeeklyReportWorkbook(state, week, context)
  week = weekStart(week)
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'Workbench'; workbook.created = new Date()
  const project = (id: string) => state.projects.find(p => p.id === id)?.name || ''
  const projectCode = (id: string) => state.projects.find(p => p.id === id)?.code || ''
  const requirementCodes = (ids: string[]) => [...new Set(state.tasks.filter(task => ids.includes(task.id)).map(task => state.requirements.find(requirement => requirement.id === task.requirementId)?.code).filter(Boolean))].join('；')
  const version = (id: string) => { const v = state.versions.find(v => v.id === id); return v ? `${v.code} ${v.name}` : '' }
  const person = (id: string) => state.people.find(p => p.id === id)?.name || ''
  if (kind === 'week') {
    const sheet = workbook.addWorksheet('周排期与复盘')
    sheet.addRow(['周起始日期', '项目', '专项版本', '工作内容', '工作环节', '角色', '人员', '预计工时（小时）', '关联投入（小时）', '本周结果', '本周目标', '组合任务数', '来源', '备注', '计划状态', '原计划周', '实际工作周', '实际完成周', '排期偏差', '原预计小时', '工时偏差', '项目编号', '需求编号'])
    const results = { pending: '未开始', partial: '部分完成', done: '本周目标完成', blocked: '阻塞', cancelled: '撤销' }
    const sources = { planned: '原计划', carryover: '跨周结转', urgent: '临时插入' }
    const statuses = { draft: '草稿', confirmed: '已确认', cancelled: '已撤销' }
    for (const plan of getPlansForWeek(state, week)) { const schedule = getPlanSchedule(state, plan); sheet.addRow([week, project(plan.projectId), version(plan.versionId), plan.title,
      stageLabels[plan.stage], roleLabels[plan.role], person(plan.personId), plan.plannedHours ?? '', schedule.actualHours ?? '', results[plan.outcome], plan.goal, plan.taskIds.length, sources[plan.source], plan.notes, statuses[plan.status], formatScheduleWeek(plan.baselineWeek || plan.week, true), schedule.actualWeeks.map(value => formatScheduleWeek(value, true)).join('；'), formatScheduleWeek(schedule.completedWeek, true), schedule.label, schedule.estimatedHours ?? '', schedule.costLabel, projectCode(plan.projectId), requirementCodes(plan.taskIds)]) }
    const tasks = workbook.addWorksheet('本周任务状态')
    tasks.addRow(['任务', '需求', '工作环节', '执行状态', '进度（%）', '剩余预计小时', '阻塞原因', '需求编号'])
    const ids = new Set(getPlansForWeek(state, week).flatMap(p => p.taskIds))
    for (const task of state.tasks.filter(t => ids.has(t.id))) tasks.addRow([task.name, state.requirements.find(r => r.id === task.requirementId)?.title || '', stageLabels[task.stage], taskStatusLabels[task.status], task.progress, task.remainingHours ?? '', task.blockedReason, state.requirements.find(r => r.id === task.requirementId)?.code || ''])
  } else {
    const sheet = workbook.addWorksheet('专项版本投入统计')
    sheet.addRow(['项目', '版本标识', '专项版本', '开发开始日期', '开发完成日期', '开发周期（自然日）', '提测日期', '测试开始日期', '测试完成日期', '实际上线日期', '产品（小时）', '前端（小时）', '后端（小时）', '测试（小时）', '其他（小时）', '总投入（小时）', '总投入（人天）', '原型设计（小时）', 'TAPD文档（小时）', '产品未细分（小时）', '备注', '开发开始（汇总）', '开发完成（汇总）', '开发周期（汇总）', '测试完成（汇总）', '实际上线（汇总）'])
    for (const v of state.versions) { const s = getVersionSummary(state, v.id), timeline = getVersionTimeline(state, v.id); sheet.addRow([project(v.projectId), v.code, v.name, v.startedAt, v.devCompletedAt, s.developmentDays ?? '', v.submittedAt, v.testStartedAt, v.testCompletedAt, v.releasedAt, s.byRole.product, s.byRole.frontend, s.byRole.backend, s.byRole.qa, s.byRole.other, s.hours, s.days, s.byProductStage.design, s.byProductStage.documentation, s.byProductStage.unclassified, v.notes, formatVersionMilestone(timeline.developmentStart, true), formatVersionMilestone(timeline.developmentEnd, true), formatVersionDevelopmentSpan(timeline), formatVersionMilestone(timeline.testEnd, true), formatVersionMilestone(timeline.release, true)]) }
    const peopleSheet = workbook.addWorksheet('版本人员投入汇总')
    peopleSheet.addRow(['项目', '版本标识', '专项版本', '人员', '产品合计（小时）', '原型设计（小时）', 'TAPD文档（小时）', '产品未细分（小时）', '前端（小时）', '后端（小时）', '测试（小时）', '其他（小时）', '实际合计（小时）', '折合人天', '说明'])
    const peopleOrder = new Map(sortManagementPeople(state.people).map((entry, index) => [entry.id, index]))
    const contributorKey = (entry: { personId: string; peopleLabel?: string }) => JSON.stringify([entry.personId, entry.personId ? '' : entry.peopleLabel || ''])
    for (const v of state.versions) {
      const efforts = state.efforts.filter(entry => entry.versionId === v.id), baselines = state.baselines.filter(entry => entry.versionId === v.id)
      const contributors = new Map([...efforts, ...baselines].map(entry => [contributorKey(entry), { personId: entry.personId, peopleLabel: 'peopleLabel' in entry ? entry.peopleLabel : '' }]))
      const ordered = [...contributors].sort(([, a], [, b]) => (peopleOrder.get(a.personId) ?? peopleOrder.size) - (peopleOrder.get(b.personId) ?? peopleOrder.size) || a.peopleLabel.localeCompare(b.peopleLabel, 'zh-CN'))
      for (const [key, contributor] of ordered) {
        const summary = getVersionSummary({ ...state, efforts: efforts.filter(entry => contributorKey(entry) === key), baselines: baselines.filter(entry => contributorKey(entry) === key) }, v.id)
        peopleSheet.addRow([project(v.projectId), v.code, v.name, person(contributor.personId) || contributor.peopleLabel, summary.byRole.product,
          summary.byProductStage.design, summary.byProductStage.documentation, summary.byProductStage.unclassified, summary.byRole.frontend, summary.byRole.backend, summary.byRole.qa, summary.byRole.other,
          summary.hours, summary.days, contributor.personId ? '' : '历史合并投入，未拆分到个人'])
      }
    }
  }
  const scopeIds = kind === 'week' ? new Set(getPlansForWeek(state, week).flatMap(plan => plan.taskIds)) : null
  const scheduleHeader = ['项目', '专项版本', '需求', '原计划开始周', '原计划完成周', '实际工作周', '实际完成周', '排期偏差', '预计小时', '实际小时', '共用预计小时', '共用实际小时', '工时偏差']
  const comparison = workbook.addWorksheet('功能排期对比'); comparison.addRow([...scheduleHeader, '项目编号', '需求编号'])
  const comparisonRow = (requirement: ManagementState['requirements'][number], schedule: ReturnType<typeof getScopeSchedule>) => [project(requirement.projectId), version(requirement.versionId), requirement.title,
    formatScheduleWeek(schedule.plannedStartWeek, true), formatScheduleWeek(schedule.plannedEndWeek, true), schedule.actualWeeks.map(value => formatScheduleWeek(value, true)).join('；'), formatScheduleWeek(schedule.completedWeek, true), schedule.label,
    schedule.estimatedHours ?? '', schedule.actualHours ?? '', schedule.sharedEstimateCount ? schedule.sharedEstimatedHours : '', schedule.sharedActualCount ? schedule.sharedActualHours : '', schedule.costLabel]
  const roleComparison = workbook.addWorksheet('角色排期对比'); roleComparison.addRow([...scheduleHeader, '角色任务', '角色', '负责人', '项目编号', '需求编号'])
  for (const requirement of state.requirements.filter(item => !scopeIds || state.tasks.some(task => task.requirementId === item.id && scopeIds.has(task.id)))) {
    comparison.addRow([...comparisonRow(requirement, getRequirementSchedule(state, requirement.id)), projectCode(requirement.projectId), requirement.code])
    for (const task of state.tasks.filter(item => item.requirementId === requirement.id && (!scopeIds || scopeIds.has(item.id)))) roleComparison.addRow([...comparisonRow(requirement, getScopeSchedule(state, [task.id])), task.name, roleLabels[task.role], person(task.ownerId), projectCode(requirement.projectId), requirement.code])
  }
  const detail = workbook.addWorksheet('实际投入明细')
  detail.addRow(['项目', '专项版本', '人员', '角色', '工作环节', '归属周/期初截至日', '实际小时', '换算人天', '来源', '说明', '投入覆盖开始日期', '投入覆盖结束日期'])
  for (const e of state.efforts.filter(e => kind !== 'week' || e.week === week)) detail.addRow([project(e.projectId), version(e.versionId), person(e.personId), roleLabels[e.role], stageLabels[e.stage], e.week, e.hours, e.hours / 8, e.hoursSource === 'allocated' ? '分摊工时' : '实际投入', e.notes, e.coveredStart || e.week, e.coveredEnd || ''])
  if (kind !== 'week') for (const e of state.baselines) detail.addRow([project(e.projectId), version(e.versionId), person(e.personId) || e.peopleLabel, roleLabels[e.role], e.stage ? stageLabels[e.stage] : '', e.asOf, e.hours, e.hours / 8, `历史期初：${e.source}`, e.notes])
  const metadata = workbook.addWorksheet('导出说明')
  metadata.addRow(['项目', '取值'])
  metadata.addRow(['数据口径', context.snapshotRevision ? `历史确认版本 ${context.snapshotRevision}` : '实时数据'])
  metadata.addRow(['确认时间', context.confirmedAt || ''])
  metadata.addRow(['导出时间', new Date().toISOString()])
  metadata.addRow(['工时换算', '1人天 = 8小时'])
  metadata.addRow(['产品分项', '原型设计、TAPD文档和产品未细分均已包含在产品合计及总投入中，不重复累加；未明确阶段的历史期初计入产品未细分'])
  if (kind === 'effort') metadata.addRow(['人员汇总', '按专项版本和人员汇总实际投入及历史期初；同一人的不同角色分列，组合工时仅累计一次；历史合并投入保留原始人员名称，不均分到个人'])
  metadata.addRow(['数据修订', state.revision])
  metadata.addRow(['排期对比', '计划使用原确认基准；实际工作周与完成周分别记录；开发完成取前后端较晚完成周，测试及上线另计；共用工时是整组投入，不可按需求行累加'])
  if (kind === 'week') metadata.addRow(['周起始日期', week])
  workbook.eachSheet(formatSheet)
  const peopleSheet = workbook.getWorksheet('版本人员投入汇总')
  if (peopleSheet) {
    peopleSheet.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }]
    peopleSheet.getRow(1).height = 40
    peopleSheet.getRow(1).eachCell(cell => { cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true } })
    for (const [column, width] of [[1, 18], [2, 20], [3, 34], [4, 18], [15, 36]]) peopleSheet.getColumn(column).width = width
    peopleSheet.eachRow((row, index) => {
      if (index === 1) return
      for (let column = 5; column <= 14; column++) { row.getCell(column).numFmt = '#,##0.####'; row.getCell(column).alignment = { vertical: 'middle', horizontal: 'right' } }
      row.getCell(13).font = { name: 'Microsoft YaHei', bold: true }
    })
  }
  return workbook
}
