const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const ExcelJS = require('exceljs')
const { reactive } = require('vue')
const { emptyManagementState, applyManagementCommand, getVersionSummary, getWeekSummary } = require('../dist-electron/shared/management.js')
const { readOpeningWorkbook, prepareOpeningImport, createManagementWorkbook } = require('../dist-electron/shared/management-spreadsheet.js')

async function fileFrom(workbook, name = 'opening.xlsx') {
  const buffer = await workbook.xlsx.writeBuffer()
  return { name, size: buffer.byteLength, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) }
}
function workbook(rows = []) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('更新用时明细')
  sheet.addRow(['项目名称', '模块功能', '开始日期', '完成日期', '周期（自然日）', '产品人员', '产品用时（人天）', '产品人员2', '产品用时（人天）2', '前端人员', '前端用时（小时）', '实际上线日期', '备注'])
  rows.forEach(row => sheet.addRow(row))
  return book
}
function row(project = '业务项目', version = '报价专项', name = '产品甲', days = 1.5) {
  return [project, version, new Date('2026-10-01T00:00:00Z'), '2026/10/5', null, name, days, null, null, '前端乙', 4, '2026-10-09', '原始累计']
}
function apply(state, command) { return applyManagementCommand(state, command, '2026-11-07T10:00:00Z', crypto.randomUUID) }

test('opening template converts person-days, preserves civil dates and ignores formula-only empty rows', async () => {
  const book = workbook([row()])
  book.worksheets[0].getCell('E100').value = { formula: 'IF(C100="","",D100-C100+1)' }
  const preview = await readOpeningWorkbook(await fileFrom(book))
  assert.equal(preview.rows.length, 2)
  assert.equal(preview.rows[0].hours, 12)
  assert.equal(preview.rows[1].hours, 4)
  assert.equal(preview.rows[0].startedAt, '2026-10-01')
  assert.equal(preview.rows[0].devCompletedAt, '2026-10-05')
  assert.equal(preview.rows[0].releasedAt, '2026-10-09')
})

test('pooled opening effort remains one role balance and reactive input can be imported safely', async () => {
  const input = row('业务项目', '报价专项', '产品甲、产品乙', 2)
  const preview = await readOpeningWorkbook(await fileFrom(workbook([input])))
  assert.equal(preview.warnings.length, 1)
  const state = apply(emptyManagementState(), prepareOpeningImport(reactive(emptyManagementState()), preview, '2026-10-31'))
  assert.equal(state.people.length, 1)
  assert.equal(state.people[0].name, '前端乙')
  const pooled = state.baselines.find(b => b.role === 'product')
  assert.equal(pooled.personId, '')
  assert.equal(pooled.peopleLabel, '产品甲、产品乙')
  assert.equal(pooled.hours, 16)
  assert.equal(getVersionSummary(state, state.versions[0].id).hours, 20)
  assert.equal(getWeekSummary(state, '2026-10-26').actualHours, 0)
})

test('same-cutoff opening reimports replace balances and keep historical development date distinct', async () => {
  const preview = await readOpeningWorkbook(await fileFrom(workbook([row()])))
  let state = apply(emptyManagementState(), prepareOpeningImport(emptyManagementState(), preview, '2026-10-31'))
  const ids = state.baselines.map(b => b.id)
  preview.rows[0].hours = 20
  state = apply(state, prepareOpeningImport(reactive(state), preview, '2026-10-31'))
  assert.deepEqual(state.baselines.map(b => b.id), ids)
  assert.equal(state.baselines.length, 2)
  assert.equal(getVersionSummary(state, state.versions[0].id).hours, 24)
  assert.equal(state.versions[0].devCompletedAt, '2026-10-05')
  assert.equal(state.versions[0].testCompletedAt, '')
  assert.equal(state.versions[0].releasedAt, '2026-10-09')
  assert.throws(() => prepareOpeningImport(state, preview, '2026-11-01'), /不同截至日期/)
  assert.throws(() => prepareOpeningImport(state, preview, '2026-02-30'), /有效/)
})

test('duplicate, overlapping pooled people and malformed dates or formulas are rejected before import', async () => {
  const duplicate = await fileFrom(workbook([row(), row()]))
  await assert.rejects(() => readOpeningWorkbook(duplicate), /重复/)
  const invalidDate = row(); invalidDate[3] = '2026-02-30'
  await assert.rejects(() => fileFrom(workbook([invalidDate])).then(readOpeningWorkbook), /日期格式/)
  const formula = row(); formula[6] = { formula: 'SUM(1,2)' }
  await assert.rejects(() => fileFrom(workbook([formula])).then(readOpeningWorkbook), /公式尚未计算/)
  const negative = row(); negative[6] = -1
  await assert.rejects(() => fileFrom(workbook([negative])).then(readOpeningWorkbook), /非负数/)
  const pooled = row('业务项目', '报价专项', '产品甲、产品乙', 2); pooled[9] = null; pooled[10] = null
  const named = row('业务项目', '报价专项', '产品甲', 1); named[9] = null; named[10] = null
  const preview = await readOpeningWorkbook(await fileFrom(workbook([pooled, named])))
  assert.throws(() => prepareOpeningImport(emptyManagementState(), preview, '2026-10-31'), /范围重叠/)
  const unique = await readOpeningWorkbook(await fileFrom(workbook([row()])))
  assert.throws(() => prepareOpeningImport(emptyManagementState(), { ...unique, rows: [unique.rows[0], unique.rows[0]] }, '2026-10-31'), /重复/)
})

test('import extends existing personnel roles without creating duplicate names', async () => {
  let state = apply(emptyManagementState(), { type: 'upsert', entity: 'people', value: { id: 'person', name: '前端乙', roles: ['backend'] } })
  const preview = await readOpeningWorkbook(await fileFrom(workbook([row()])))
  state = apply(state, prepareOpeningImport(state, preview, '2026-10-31'))
  assert.equal(state.people.filter(p => p.name === '前端乙').length, 1)
  assert.deepEqual(state.people.find(p => p.id === 'person').roles, ['backend', 'frontend'])
})

test('effort export records numeric hours and days with development, test and release dates in separate columns', async () => {
  const preview = await readOpeningWorkbook(await fileFrom(workbook([row()])))
  let state = apply(emptyManagementState(), prepareOpeningImport(emptyManagementState(), preview, '2026-10-31'))
  const v = state.versions[0], person = state.people.find(p => p.name === '前端乙')
  state = apply(state, { type: 'upsert', entity: 'versions', value: { id: v.id, submittedAt: '2026-10-06', testStartedAt: '2026-10-07', testCompletedAt: '2026-10-08' } })
  state = apply(state, { type: 'upsert', entity: 'efforts', value: { projectId: v.projectId, versionId: v.id, personId: person.id, role: 'frontend', stage: 'frontend', week: '2026-11-02', hours: 2 } })
  const book = createManagementWorkbook(state, '2026-11-02', 'effort')
  const saved = await new ExcelJS.Workbook().xlsx.load(await book.xlsx.writeBuffer())
  const sheet = saved.getWorksheet('专项版本投入统计')
  assert.equal(sheet.getCell('E2').value, '2026-10-05')
  assert.equal(sheet.getCell('F2').value, 5)
  assert.equal(sheet.getCell('G2').value, '2026-10-06')
  assert.equal(sheet.getCell('I2').value, '2026-10-08')
  assert.equal(sheet.getCell('J2').value, '2026-10-09')
  assert.equal(sheet.getCell('P2').value, 18)
  assert.equal(sheet.getCell('Q2').value, 2.25)
  assert.equal(saved.getWorksheet('实际投入明细').rowCount, 4)
  assert.equal(sheet.views[0].state, 'frozen')
})

test('weekly export keeps a shared plan budget once and leaves unlinked actuals only in actual detail', async () => {
  let state = emptyManagementState()
  const save = (entity, value) => { state = apply(state, { type: 'upsert', entity, value }) }
  save('projects', { id: 'p', name: '业务项目' })
  save('people', { id: 'person', name: '开发人员', roles: ['frontend'] })
  save('versions', { id: 'v', projectId: 'p', name: '专项版本' })
  save('requirements', { id: 'r', projectId: 'p', versionId: 'v', title: '报价功能' })
  save('tasks', { id: 'a', requirementId: 'r', name: '页面A', stage: 'frontend', role: 'frontend' })
  save('tasks', { id: 'b', requirementId: 'r', name: '页面B', stage: 'frontend', role: 'frontend' })
  save('plans', { id: 'plan', projectId: 'p', versionId: 'v', personId: 'person', week: '2026-11-02', role: 'frontend', stage: 'frontend', title: '组合开发', taskIds: ['a', 'b'], plannedHours: 8, goal: '完成两个页面', status: 'confirmed' })
  save('efforts', { projectId: 'p', versionId: 'v', personId: 'person', week: '2026-11-02', role: 'frontend', stage: 'frontend', hours: 6 })
  const book = createManagementWorkbook(state, '2026-11-07', 'week'), sheet = book.getWorksheet('周排期与复盘')
  assert.equal(sheet.rowCount, 2)
  assert.equal(sheet.getCell('A2').value, '2026-11-02')
  assert.equal(sheet.getCell('H2').value, 8)
  assert.equal(sheet.getCell('I2').value, '')
  assert.equal(sheet.getCell('L2').value, 2)
  assert.equal(book.getWorksheet('本周任务状态').rowCount, 3)
  assert.equal(book.getWorksheet('实际投入明细').getCell('G2').value, 6)
})

const templatePath = 'C:/Users/Administrator/Desktop/项目更新用时统计模板.xlsx'
test('effort export separates product dimensions while retaining product and overall totals', () => {
  let state = emptyManagementState()
  const save = (entity, value) => { state = apply(state, { type: 'upsert', entity, value }) }
  save('projects', { id: 'p', name: '业务项目' })
  save('people', { id: 'person', name: '产品人员', roles: ['product'] })
  save('versions', { id: 'v', projectId: 'p', name: '专项版本' })
  for (const [stage, hours] of [['design', 40], ['documentation', 24], ['other', 2]]) save('efforts', { id: stage, projectId: 'p', versionId: 'v', personId: 'person', week: '2026-11-02', role: 'product', stage, hours })
  save('baselines', { id: 'history', projectId: 'p', versionId: 'v', personId: 'person', role: 'product', stage: 'design', hours: 6, asOf: '2026-10-31' })
  const book = createManagementWorkbook(state, '2026-11-02', 'effort')
  const sheet = book.getWorksheet('专项版本投入统计'), headers = sheet.getRow(1).values
  for (const [label, hours] of [['产品（小时）', 72], ['原型设计（小时）', 46], ['TAPD文档（小时）', 24], ['产品未细分（小时）', 2], ['总投入（小时）', 72]]) assert.equal(sheet.getCell(2, headers.indexOf(label)).value, hours)
  const detail = book.getWorksheet('实际投入明细')
  assert.equal(detail.getCell('E2').value, '原型设计')
  assert.equal(detail.getCell('E3').value, 'TAPD文档')
  assert.equal(detail.getCell('E5').value, '原型设计')
})

test('effort export summarizes each version and person across weeks and roles in configured personnel order', async () => {
  let state = emptyManagementState()
  const save = (entity, value) => { state = apply(state, { type: 'upsert', entity, value }) }
  save('projects', { id: 'p', name: '4.0项目' })
  save('people', { id: 'cao', name: '曹鑫哲', roles: ['product', 'qa'], sortOrder: 2 })
  save('people', { id: 'liu', name: '刘宇', roles: ['backend'], sortOrder: 5 })
  save('people', { id: 'chang', name: '常天翼', roles: ['frontend'], sortOrder: 3 })
  save('people', { id: 'zhao', name: '赵浩程', roles: ['product'], sortOrder: 1, active: false })
  save('versions', { id: 'v1', projectId: 'p', code: 'V1', name: '报价模块 · 第二次迭代' })
  save('versions', { id: 'v2', projectId: 'p', code: 'V2', name: '报价模块 · 第三次迭代' })
  save('versions', { id: 'empty', projectId: 'p', code: 'V3', name: '尚无实际投入' })
  for (const id of ['a', 'b']) {
    save('requirements', { id, projectId: 'p', versionId: 'v1', title: `功能${id}` })
    save('tasks', { id: `${id}-task`, requirementId: id, name: '前端', role: 'frontend', stage: 'frontend' })
  }
  const scope = { projectId: 'p', versionId: 'v1' }
  save('plans', { ...scope, id: 'shared', personId: 'chang', role: 'frontend', stage: 'frontend', taskIds: ['a-task', 'b-task'], week: '2026-11-02', title: '组合开发', goal: '完成页面', plannedHours: 8, status: 'confirmed' })
  save('plans', { ...scope, id: 'planned-only', personId: 'liu', role: 'backend', stage: 'backend', week: '2026-11-09', title: '未来开发', goal: '开发', plannedHours: 16, status: 'confirmed' })
  save('baselines', { ...scope, id: 'design-history', personId: 'cao', role: 'product', stage: 'design', hours: 2, asOf: '2026-10-16' })
  save('baselines', { ...scope, id: 'docs-history', personId: 'zhao', role: 'product', stage: 'documentation', hours: 3, asOf: '2026-10-30' })
  save('baselines', { ...scope, id: 'pooled-history', peopleLabel: '历史甲、历史乙', role: 'backend', stage: 'backend', hours: 16, asOf: '2026-10-31' })
  save('efforts', { ...scope, id: 'design-first', personId: 'cao', role: 'product', stage: 'design', week: '2026-10-19', hours: 9.7 })
  save('efforts', { ...scope, id: 'design-second', personId: 'cao', role: 'product', stage: 'design', week: '2026-10-26', hours: 0.3 })
  save('efforts', { ...scope, id: 'testing', personId: 'cao', role: 'qa', stage: 'testing', week: '2026-11-02', hours: 8 })
  save('efforts', { ...scope, id: 'shared-actual', personId: 'chang', role: 'frontend', stage: 'frontend', planId: 'shared', week: '2026-11-02', hours: 6.5 })
  save('efforts', { projectId: 'p', versionId: 'v2', id: 'next-version', personId: 'liu', role: 'backend', stage: 'backend', week: '2026-11-02', hours: 4.25 })
  const before = structuredClone(state), book = createManagementWorkbook(state, '2026-11-02', 'effort')
  const saved = await new ExcelJS.Workbook().xlsx.load(await book.xlsx.writeBuffer())
  const sheet = saved.getWorksheet('版本人员投入汇总'), headers = sheet.getRow(1).values
  const value = (row, label) => sheet.getRow(row).getCell(headers.indexOf(label)).value
  assert.equal(saved.worksheets[1].name, '版本人员投入汇总')
  assert.equal(sheet.rowCount, 6)
  assert.deepEqual([2, 3, 4, 5, 6].map(row => value(row, '人员')), ['赵浩程', '曹鑫哲', '常天翼', '历史甲、历史乙', '刘宇'])
  assert.equal(value(2, 'TAPD文档（小时）'), 3)
  assert.equal(value(3, '产品合计（小时）'), 12)
  assert.equal(value(3, '原型设计（小时）'), 12)
  assert.equal(value(3, '测试（小时）'), 8)
  assert.equal(value(3, '实际合计（小时）'), 20)
  assert.equal(value(3, '折合人天'), 2.5)
  assert.equal(value(4, '前端（小时）'), 6.5)
  assert.equal(value(4, '实际合计（小时）'), 6.5)
  assert.equal(value(5, '后端（小时）'), 16)
  assert.equal(value(5, '说明'), '历史合并投入，未拆分到个人')
  assert.equal(value(6, '版本标识'), 'V2')
  assert.equal(value(6, '后端（小时）'), 4.25)
  for (const version of state.versions) {
    const rows = [2, 3, 4, 5, 6].filter(row => value(row, '版本标识') === version.code)
    assert.equal(rows.reduce((total, row) => total + value(row, '实际合计（小时）'), 0), getVersionSummary(state, version.id).hours)
  }
  assert.equal(sheet.views[0].xSplit, 4)
  assert.equal(sheet.views[0].ySplit, 1)
  assert.equal(sheet.getCell('M3').type, ExcelJS.ValueType.Number)
  assert.equal(sheet.getCell('M3').numFmt, '#,##0.####')
  assert(sheet.autoFilter)
  assert.deepEqual(state, before)
})

test('person summaries preserve recorded zeros and unclassified product history while other export kinds stay unchanged', () => {
  let state = emptyManagementState()
  const save = (entity, value) => { state = apply(state, { type: 'upsert', entity, value }) }
  save('projects', { id: 'p', name: '业务项目' })
  save('people', { id: 'person', name: '产品人员', roles: ['product'] })
  save('people', { id: 'zero-person', name: '零投入记录', roles: ['frontend'] })
  save('versions', { id: 'v', projectId: 'p', name: '专项版本' })
  save('baselines', { id: 'history', projectId: 'p', versionId: 'v', personId: 'person', role: 'product', hours: 8, asOf: '2026-10-31' })
  save('efforts', { id: 'zero', projectId: 'p', versionId: 'v', personId: 'zero-person', role: 'frontend', stage: 'frontend', week: '2026-11-02', hours: 0 })
  const sheet = createManagementWorkbook(state, '2026-11-02', 'effort').getWorksheet('版本人员投入汇总')
  assert.equal(sheet.rowCount, 3)
  assert.equal(sheet.getCell('E2').value, 8)
  assert.equal(sheet.getCell('F2').value, 0)
  assert.equal(sheet.getCell('H2').value, 8)
  assert.equal(sheet.getCell('M3').value, 0)
  assert.equal(createManagementWorkbook(state, '2026-11-02', 'week').getWorksheet('版本人员投入汇总'), undefined)
  const empty = createManagementWorkbook(emptyManagementState(), '2026-11-02', 'effort').getWorksheet('版本人员投入汇总')
  assert.equal(empty.rowCount, 1)
  assert.equal(empty.columnCount, 15)
})

test('provided real template is parsed read-only and yields its ten cumulative role/person records', { skip: !fs.existsSync(templatePath) }, async () => {
  const before = fs.readFileSync(templatePath)
  const preview = await readOpeningWorkbook({ name: '项目更新用时统计模板.xlsx', size: before.length, arrayBuffer: async () => before.buffer.slice(before.byteOffset, before.byteOffset + before.byteLength) })
  assert.equal(preview.rows.length, 10)
  assert.equal(Math.round(preview.rows.reduce((s, row) => s + row.hours, 0) * 10) / 10, 599.2)
  const state = apply(emptyManagementState(), prepareOpeningImport(emptyManagementState(), preview, '2026-10-31'))
  assert.equal(state.projects.length, 2)
  assert.equal(state.versions.length, 4)
  assert.equal(state.baselines.length, 10)
  assert.deepEqual(fs.readFileSync(templatePath), before)
})

test('export metadata identifies historical snapshot scope separately from live data', () => {
  const state = emptyManagementState()
  const live = createManagementWorkbook(state, '2026-11-02', 'week')
  const snapshot = createManagementWorkbook(state, '2026-11-02', 'week', { snapshotRevision: 2, confirmedAt: '2026-11-06T10:00:00Z' })
  assert.equal(live.getWorksheet('导出说明').getCell('B2').value, '实时数据')
  assert.equal(snapshot.getWorksheet('导出说明').getCell('B2').value, '历史确认版本 2')
  assert.equal(snapshot.getWorksheet('导出说明').getCell('B3').value, '2026-11-06T10:00:00Z')
})
