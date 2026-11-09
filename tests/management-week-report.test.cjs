const { test } = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('exceljs')
const { emptyManagementState, applyManagementCommand, getWeekSummary } = require('../dist-electron/shared/management.js')
const { getManagementWeekReport, getWeekReportEditCells, getWeekReportLayout, getWeekReportWorkDetails, getWeekReportWorkText, reportColumns } = require('../dist-electron/shared/management-week-report.js')
const { createManagementWorkbook } = require('../dist-electron/shared/management-spreadsheet.js')
const { getPlansForWeek } = require('../dist-electron/shared/management-schedule.js')
const { prepareWeekEffortSettlement } = require('../dist-electron/shared/management-week-effort.js')

function fixture() {
  let state = emptyManagementState(), serial = 0
  const apply = command => state = applyManagementCommand(state, command, '2026-11-08T06:00:00Z', () => `generated-${++serial}`)
  const save = (entity, value) => apply({ type: 'upsert', entity, value, reason: '测试数据维护' })
  save('projects', { id: 'p', name: '4.0项目', modules: ['MES模块'] })
  save('people', { id: 'front', name: '高正峰', roles: ['frontend'], weeklyCapacity: 40 })
  save('people', { id: 'back', name: '刘宇', roles: ['backend'], weeklyCapacity: 40 })
  save('people', { id: 'product', name: '曹鑫哲', roles: ['product', 'qa'], weeklyCapacity: 40 })
  save('versions', { id: 'v', projectId: 'p', name: '首期', code: 'V1' })
  const requirement = (id = 'a', extra = {}) => save('requirements', { id, projectId: 'p', versionId: 'v', title: `功能${id}`, module: 'MES模块', platforms: ['PC端'], ...extra })
  const task = (id = 'af', requirementId = 'a', role = 'frontend', extra = {}) => save('tasks', { id, requirementId, name: `${role}开发`, role, stage: role === 'qa' ? 'testing' : role === 'product' ? 'design' : role, ownerId: role === 'frontend' ? 'front' : role === 'backend' ? 'back' : 'product', complexity: 'C', ...extra })
  const plan = (id, taskIds, week, hours = 16, extra = {}) => {
    const task = state.tasks.find(task => task.id === taskIds[0])
    save('plans', { id, taskIds, projectId: 'p', versionId: 'v', personId: task?.ownerId || 'front', role: task?.role || 'frontend', stage: task?.stage || 'frontend', week, plannedHours: hours, title: `排期${id}`, goal: '完成本周目标', status: 'confirmed', ...extra })
  }
  const effort = (id, planId, week, hours) => {
    const plan = state.plans.find(plan => plan.id === planId)
    save('efforts', { id, planId, week, hours, projectId: 'p', versionId: 'v', personId: plan.personId, role: plan.role, stage: plan.stage, taskIds: plan.taskIds })
  }
  return { get state() { return state }, apply, save, requirement, task, plan, effort }
}

test('reconciled weekly exports retain merged numeric totals and distinguish allocations without adding fields', async () => {
  const f = fixture()
  for (const id of ['a', 'b', 'early']) {
    f.requirement(id)
    f.task(`${id}f`, id, 'frontend', { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: id === 'early' ? '2026-11-09' : '2026-11-02' })
  }
  f.plan('ordinary', ['af', 'bf'], '2026-11-02', 40, { outcome: 'done', completedWeek: '2026-11-02' })
  f.effort('ordinary-hours', 'ordinary', '2026-11-02', 40)
  f.plan('early', ['earlyf'], '2026-11-09', 16, { outcome: 'done', completedWeek: '2026-11-02' })
  f.effort('early-hours', 'early', '2026-11-02', 16)
  f.apply(prepareWeekEffortSettlement(f.state, { personId: 'front', week: '2026-11-02', totalHours: 40, known: [{ key: 'effort:early-hours', hours: 16 }] }))
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.hours, 40)
  assert.equal(report.actual.cells.find(cell => cell.effortId === 'ordinary-hours').allocated, true)
  assert.equal(report.actual.cells.find(cell => cell.effortId === 'early-hours').allocated, undefined)
  assert.equal(report.actual.cells.find(cell => cell.effortId === 'early-hours').status, '已完成（提前）')
  assert(report.advanced.cells.every(cell => !cell.allocated))
  const original = createManagementWorkbook(f.state, '2026-11-02', 'report')
  const book = await new ExcelJS.Workbook().xlsx.load(await original.xlsx.writeBuffer())
  const sheet = book.getWorksheet('本周实际'), ledger = book.getWorksheet('工时核对')
  assert.equal(sheet.columnCount, 17)
  assert.equal(book.getWorksheet('下周计划').columnCount, 14)
  assert.equal(sheet.getCell('G4').result, 24)
  assert.equal(sheet.getCell('G5').master.address, 'G4')
  assert.equal(sheet.getCell('G6').result, 16)
  assert.equal(sheet.getCell('G7').result, 40)
  assert.match(JSON.stringify(sheet.getCell('G4').note), /分摊工时/)
  assert.equal(ledger.getCell('I2').value, 24)
  assert.match(ledger.getCell('L2').value, /分摊工时/)
  const detail = createManagementWorkbook(f.state, '2026-11-02', 'effort').getWorksheet('实际投入明细')
  assert.equal(detail.getCell('I2').value, '分摊工时')
  assert.equal(detail.getCell('G2').value, 24)
})

test('weekly actuals use the actual week and omit the backend completed the previous week', () => {
  const f = fixture(); f.requirement(); f.task('af', 'a', 'frontend', { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-09' }); f.task('ab', 'a', 'backend', { status: 'done', completedWeek: '2026-10-26', plannedEndWeek: '2026-11-02' })
  f.plan('pf', ['af'], '2026-11-09', 16, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('ef', 'pf', '2026-11-02', 16)
  f.plan('pb', ['ab'], '2026-11-02', 16, { outcome: 'done', completedWeek: '2026-10-26' }); f.effort('eb', 'pb', '2026-10-26', 16)
  const before = structuredClone(f.state), report = getManagementWeekReport(f.state, '2026-11-06')
  assert.equal(report.actual.rows.length, 1)
  assert.equal(report.actual.hours, 16)
  assert.equal(report.actual.rows[0].cells.frontend[0].status, '已完成（提前）')
  assert.equal(report.actual.rows[0].cells.backend.length, 0)
  assert.equal(report.next.hours, 0)
  assert.equal(report.advanced.hours, 16)
  assert.equal(report.nextPeople.find(person => person.personId === 'front').plannedHours, 0)
  assert.deepEqual(f.state, before)
})

test('manually created work without plans exposes its original effort editors and exports role complexities', async () => {
  const f = fixture()
  f.save('people', { id: 'full', name: '蒋世彤', roles: ['frontend', 'backend'] })
  f.requirement('manual', { title: '小工具管理:克隆、帮助中心。文件下载审批', code: 'REQ-000025' })
  for (const role of ['frontend', 'backend']) {
    f.task(role, 'manual', role, { ownerId: '', complexity: '', status: 'done', completedWeek: '2026-11-02' })
    f.save('efforts', { id: `${role}-hours`, projectId: 'p', versionId: 'v', personId: 'full', role, stage: role, taskIds: [role], week: '2026-11-02', coveredStart: '2026-11-02', coveredEnd: '2026-11-08', hours: 8 })
  }
  const before = structuredClone(f.state)
  let report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.rows.length, 1)
  assert.equal(report.actual.hours, 16)
  assert.deepEqual(getWeekReportEditCells(report.actual.rows[0]).map(cell => ({ planId: cell.planId, effortId: cell.effortId, taskIds: cell.taskIds, person: cell.person })), [
    { planId: '', effortId: 'frontend-hours', taskIds: ['frontend'], person: '蒋世彤' },
    { planId: '', effortId: 'backend-hours', taskIds: ['backend'], person: '蒋世彤' },
  ])
  assert.deepEqual(f.state, before)
  f.apply({ type: 'batch', commands: [
    { type: 'upsert', entity: 'tasks', value: { id: 'frontend', complexity: 'B' } },
    { type: 'upsert', entity: 'tasks', value: { id: 'backend', complexity: 'C' } },
  ] })
  report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.rows[0].cells.frontend[0].complexity, 'B')
  assert.equal(report.actual.rows[0].cells.backend[0].complexity, 'C')
  assert.equal(report.actual.hours, 16)
  assert.equal(f.state.plans.length, 0)
  assert.deepEqual(f.state.efforts, before.efforts)
  assert.deepEqual(f.state.requirements, before.requirements)
  assert.deepEqual(f.state.tasks.map(({ complexity, ...task }) => task), before.tasks.map(({ complexity, ...task }) => task))
  const saved = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'report').xlsx.writeBuffer())
  const actual = saved.getWorksheet('本周实际')
  assert.equal(actual.columnCount, 17)
  assert.equal(actual.getCell('F4').value, 'B'); assert.equal(actual.getCell('J4').value, 'C')
  assert.equal(actual.getCell('G4').result, 8); assert.equal(actual.getCell('K4').result, 8)
})

test('report editors deduplicate a plan and keep task-only completion records editable', () => {
  const f = fixture(); f.requirement(); f.task()
  f.task('af-extra', 'a', 'frontend', { status: 'done', completedWeek: '2026-11-02' })
  f.plan('plan', ['af', 'af-extra'], '2026-11-02', 8)
  f.save('efforts', { id: 'first', planId: 'plan', taskIds: ['af'], projectId: 'p', versionId: 'v', personId: 'front', role: 'frontend', stage: 'frontend', week: '2026-11-02', hours: 8 })
  f.requirement('complete'); f.task('complete', 'complete', 'backend', { status: 'done', completedWeek: '2026-11-02' })
  const report = getManagementWeekReport(f.state, '2026-11-02')
  const planned = getWeekReportEditCells(report.actual.rows.find(row => row.requirementId === 'a'))
  assert.equal(planned.length, 1); assert.equal(planned[0].planId, 'plan')
  const completed = getWeekReportEditCells(report.actual.rows.find(row => row.requirementId === 'complete'))
  assert.equal(completed.length, 1); assert.equal(completed[0].planId, ''); assert.equal(completed[0].effortId, '')
  assert.deepEqual(completed[0].taskIds, ['complete']); assert.equal(completed[0].hours, null)
})

test('a direct shared effort keeps its original edit target on every displayed requirement', () => {
  const f = fixture(); f.requirement('a'); f.requirement('b'); f.task('af', 'a'); f.task('bf', 'b')
  f.save('efforts', { id: 'shared', projectId: 'p', versionId: 'v', personId: 'front', role: 'frontend', stage: 'frontend', taskIds: ['af', 'bf'], week: '2026-11-02', hours: 8 })
  const report = getManagementWeekReport(f.state, '2026-11-02'), layout = getWeekReportLayout(report.actual.rows)
  assert.equal(report.actual.hours, 8)
  assert.equal(layout.rows.length, 2)
  assert.equal(layout.hourSpans[0].frontend, 2)
  for (const row of layout.rows) {
    const [cell] = getWeekReportEditCells(row)
    assert.equal(cell.effortId, 'shared'); assert.equal(cell.planId, '')
    assert.equal(cell.taskIds.length, 1)
    assert.deepEqual(f.state.efforts.find(entry => entry.id === cell.effortId).taskIds, ['af', 'bf'])
  }
})

test('aggregated product work exposes the completed weekly scope in preview and Excel without changing its hours', async () => {
  const f = fixture(), completed = '询比价管理16小时、竞价管理16小时，需求设计均已完成', upcoming = '招标管理、合同管理、价格库需求设计，合计计划16小时'
  f.requirement('design', { title: '需求设计' }); f.task('design', 'design', 'product')
  f.plan('now', ['design'], '2026-11-02', 32, { goal: completed, outcome: 'done', completedWeek: '2026-11-02', notes: '内部导入来源与调整过程' })
  f.effort('actual', 'now', '2026-11-02', 32)
  f.save('efforts', { id: 'actual', notes: '历史来源和日期补录说明' })
  f.plan('next', ['design'], '2026-11-09', 16, { goal: upcoming })
  const before = structuredClone(f.state), report = getManagementWeekReport(f.state, '2026-11-02')
  assert.deepEqual(getWeekReportWorkDetails(report.actual.rows[0]), [completed])
  assert.deepEqual(getWeekReportWorkDetails(report.next.rows[0]), [upcoming])
  assert.equal(report.actual.rows.length, 1); assert.equal(report.actual.hours, 32); assert.equal(report.next.hours, 16)
  const saved = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'report').xlsx.writeBuffer())
  const actual = saved.getWorksheet('本周实际'), next = saved.getWorksheet('下周计划')
  assert.equal(actual.getCell('E4').value, getWeekReportWorkText(report.actual.rows[0]))
  assert.match(actual.getCell('E4').value, /询比价管理16小时、竞价管理16小时/)
  assert.doesNotMatch(actual.getCell('E4').value, /内部导入|历史来源|招标管理/)
  assert.equal(actual.getCell('O4').result, 32)
  assert.equal(next.getCell('E4').value, getWeekReportWorkText(report.next.rows[0]))
  assert.equal(next.getCell('M4').result, 16)
  assert(actual.getRow(4).height >= 38)
  assert.equal(actual.columnCount, 17)
  assert.deepEqual(f.state, before)
})

test('an empty weekly goal keeps the requirement name and code in preview and export', async () => {
  const f = fixture()
  f.requirement('a', { title: '客户与联系人相关需求', code: '销261105-01' })
  f.task('af', 'a', 'frontend', { status: 'done', completedWeek: '2026-11-02' })
  f.plan('actual', ['af'], '2026-11-02', 4, { goal: '', outcome: 'done', completedWeek: '2026-11-02' })
  f.effort('actual', 'actual', '2026-11-02', 4)
  f.requirement('b', { title: '库存模块需求设计' }); f.task('design', 'b', 'product')
  f.plan('next', ['design'], '2026-11-09', 16, { goal: '' })
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.deepEqual(getWeekReportWorkDetails(report.actual.rows[0]), [])
  assert.deepEqual(getWeekReportWorkDetails(report.next.rows[0]), [])
  assert.equal(getWeekReportWorkText(report.actual.rows[0]), '客户与联系人相关需求（销261105-01）')
  const saved = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'report').xlsx.writeBuffer())
  assert.equal(saved.getWorksheet('本周实际').getCell('E4').value, getWeekReportWorkText(report.actual.rows[0]))
  assert.equal(saved.getWorksheet('下周计划').getCell('E4').value, getWeekReportWorkText(report.next.rows[0]))
  assert.equal(report.actual.hours, 4); assert.equal(report.next.hours, 16)
})

test('actual work content belongs to its recorded week and remains independent from later plan goals and private notes', () => {
  const f = fixture(); f.requirement('design', { title: '需求设计' }); f.task('design', 'design', 'product')
  f.plan('p', ['design'], '2026-11-09', 32, { goal: '完成全部设计', outcome: 'done', completedWeek: '2026-11-09' })
  f.effort('first', 'p', '2026-11-02', 8)
  assert.deepEqual(getWeekReportWorkDetails(getManagementWeekReport(f.state, '2026-11-02').actual.rows[0]), [])
  f.save('efforts', { id: 'first', workContent: '询比价管理：8小时，完成20%', notes: '仅供内部核对' })
  f.effort('second', 'p', '2026-11-09', 24)
  f.save('efforts', { id: 'second', workContent: '竞价管理：24小时，完成设计' })
  f.save('plans', { id: 'p', goal: '调整后的后续工作目标' })
  assert.deepEqual(getWeekReportWorkDetails(getManagementWeekReport(f.state, '2026-11-02').actual.rows[0]), ['询比价管理：8小时，完成20%'])
  assert.deepEqual(getWeekReportWorkDetails(getManagementWeekReport(f.state, '2026-11-09').actual.rows[0]), ['竞价管理：24小时，完成设计'])
  f.save('efforts', { id: 'second', workContent: '' })
  assert.deepEqual(getWeekReportWorkDetails(getManagementWeekReport(f.state, '2026-11-09').actual.rows[0]), [])
})

test('shared work keeps expanded requirement names and merged hours while duplicate role descriptions retain all participants', () => {
  const f = fixture(); f.requirement('a'); f.requirement('b'); f.task('af', 'a'); f.task('bf', 'b')
  f.plan('shared', ['af', 'bf'], '2026-11-02', 8, { outcome: 'done', completedWeek: '2026-11-02', goal: '两项功能合计8小时' })
  f.effort('shared', 'shared', '2026-11-02', 8)
  let report = getManagementWeekReport(f.state, '2026-11-02'), layout = getWeekReportLayout(report.actual.rows)
  assert.equal(layout.hourSpans[0].frontend, 2)
  assert(layout.rows.every(row => getWeekReportWorkDetails(row).length === 0))
  assert.equal(report.actual.hours, 8)
  f.requirement('single'); f.task('sf', 'single'); f.task('sb', 'single', 'backend')
  for (const [id, task] of [['front', 'sf'], ['back', 'sb']]) {
    f.plan(id, [task], '2026-11-02', 4); f.effort(id, id, '2026-11-02', 4)
    f.save('efforts', { id, workContent: '共同完成接口联调' })
  }
  report = getManagementWeekReport(f.state, '2026-11-02')
  assert.deepEqual(getWeekReportWorkDetails(report.actual.rows.find(row => row.requirementId === 'single')), ['高正峰、刘宇：共同完成接口联调'])
  assert.equal(report.actual.hours, 16)
})

test('planned work without actual effort remains visible as unfinished and never becomes invented actual work', () => {
  const f = fixture(); f.requirement(); f.task(); f.plan('p', ['af'], '2026-11-02')
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.rows.length, 0)
  assert.equal(report.actual.hours, 0)
  assert.equal(report.unfinished.rows.length, 1)
  assert.match(report.unfinished.cells[0].status, /未完成/)
  assert.equal(report.next.rows.length, 0)
})

test('unlinked work and zero-hour records are preserved independently from completion with missing hours', () => {
  const f = fixture(); f.requirement('a'); f.requirement('b'); f.task('af', 'a', 'frontend', { status: 'done', completedWeek: '2026-11-02' }); f.task('bf', 'b', 'frontend', { status: 'done', completedWeek: '2026-11-02' })
  f.plan('zero', ['af'], '2026-11-02', 0, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('zero', 'zero', '2026-11-02', 0)
  f.save('efforts', { id: 'unlinked', projectId: 'p', versionId: 'v', personId: 'back', role: 'backend', stage: 'backend', week: '2026-11-02', hours: 1.5 })
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.hours, 1.5)
  assert.equal(report.actual.rows.length, 3)
  assert.equal(report.actual.cells.find(cell => cell.id === 'effort:zero').hours, 0)
  assert.equal(report.actual.cells.find(cell => cell.id === 'completion:bf').hours, null)
  assert(report.actual.rows.some(row => !row.requirementId && row.title.includes('未关联需求')))
})

test('all shared requirements are expanded while amounts and person totals count each effort only once', () => {
  const f = fixture()
  for (const id of ['a', 'b', 'c', 'd', 'e']) { f.requirement(id); f.task(`${id}f`, id, 'frontend', { status: 'done', completedWeek: '2026-11-02' }) }
  f.plan('group', ['af', 'bf', 'cf', 'df', 'ef'], '2026-11-02', 8, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('group', 'group', '2026-11-02', 8)
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.rows.length, 5)
  assert.equal(report.actual.cells.length, 1)
  assert.equal(report.actual.hours, 8)
  assert(report.actual.rows.every(row => row.cells.frontend[0].shared))
  assert.equal(new Set(report.actual.rows.map(row => row.cells.frontend[0].group)).size, 1)
  assert.equal(getWeekSummary(f.state, '2026-11-02').actualHours, report.actual.hours)
})

test('a historical weekly goal does not acquire a completion recorded in a later week', () => {
  const f = fixture(); f.requirement(); f.task('af', 'a', 'frontend', { status: 'done', progress: 100, completedWeek: '2026-11-16' })
  f.plan('p', ['af'], '2026-11-02', 8, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('e', 'p', '2026-11-02', 8)
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.cells[0].status, '本周目标完成，整项进行中')
  assert.notEqual(report.actual.cells[0].tone, 'on-time')
})

test('draft future work is visible but does not consume confirmed capacity, and draft actuals still count', () => {
  const f = fixture(); f.requirement(); f.task(); f.plan('draft', ['af'], '2026-11-09', 12, { status: 'draft' }); f.effort('e', 'draft', '2026-11-02', 2)
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.hours, 2)
  assert.equal(report.next.hours, 0)
  assert.equal(report.next.draftHours, 12)
  assert.equal(report.nextPeople.find(person => person.personId === 'front').plannedHours, 0)
  assert.notEqual(report.actual.cells[0].status, '待确认')
})

test('partly completed shared future work keeps pending tasks, exposes a budget review, and never invents a split', () => {
  const f = fixture(); f.requirement('a'); f.requirement('b'); f.task('af', 'a', 'frontend', { status: 'done', completedWeek: '2026-11-02' }); f.task('bf', 'b')
  f.plan('group', ['af', 'bf'], '2026-11-09', 16)
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.deepEqual(report.next.rows.map(row => row.requirementId), ['b'])
  assert.equal(report.next.hours, 16)
  assert.match(report.next.cells[0].status, /核对/)
  assert.equal(report.next.cells[0].shared, true)
  assert.deepEqual(report.advanced.rows.map(row => row.requirementId), ['a'])
  assert.equal(report.advanced.cells[0].hours, null)
})

test('product design, documentation and testing remain separate rows in the fixed product-manager column group', () => {
  const f = fixture(); f.requirement()
  for (const [id, stage, role] of [['design', 'design', 'product'], ['docs', 'documentation', 'product'], ['qa', 'testing', 'qa']]) {
    f.task(id, 'a', role, { stage, status: 'done', completedWeek: '2026-11-02' }); f.plan(id, [id], '2026-11-02', 4, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort(id, id, '2026-11-02', 4)
  }
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.actual.rows.length, 3)
  assert.deepEqual(new Set(report.actual.rows.map(row => row.stage)), new Set(['需求设计', '文档编写', '项目测试']))
  assert(report.actual.rows.every(row => row.cells.product.length === 1))
  assert.equal(report.actual.hours, 12)
})

test('the report workbook retains exactly the 17 reference fields and cyan two-level header after serialization', async () => {
  const f = fixture(); f.requirement(); f.task('af', 'a', 'frontend', { status: 'done', completedWeek: '2026-11-02' }); f.plan('p', ['af'], '2026-11-02', 1.5, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('e', 'p', '2026-11-02', 1.5)
  const original = createManagementWorkbook(f.state, '2026-11-02', 'report')
  const book = await new ExcelJS.Workbook().xlsx.load(await original.xlsx.writeBuffer()), sheet = book.getWorksheet('本周实际')
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['本周实际', '下周计划', '周报汇总', '工时核对'])
  assert.equal(sheet.columnCount, 17)
  assert.equal(sheet.getCell('A1').value, '2026年11月第1周工作计划及实际完成情况')
  assert.deepEqual(['A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'J2', 'N2'].map(address => sheet.getCell(address).value), ['序号', '项目', '需求端', '阶段', '工作内容', '前端', '后端', '产品经理'])
  assert.deepEqual(['F3', 'G3', 'H3', 'I3'].map(address => sheet.getCell(address).value), ['任务复杂度', '排期（H）', '人员', '状态'])
  assert.equal(sheet.getCell('A3').master.address, 'A2')
  assert.equal(sheet.getCell('I2').master.address, 'F2')
  assert.equal(sheet.getCell('F2').fill.fgColor.argb, 'FF0CB4DF')
  assert.equal(sheet.getCell('G4').value.result, 1.5)
  assert.equal(sheet.getCell('G4').numFmt || 'General', 'General')
  for (const address of ['N4', 'O4', 'P4', 'Q4']) assert.equal(sheet.getCell(address).value, null)
  assert.match(sheet.getCell('E4').value, /REQ-/)
  assert.equal(sheet.views[0].ySplit, 3)
  assert.equal(sheet.pageSetup.orientation, 'landscape')
})

test('scattered shared work is placed together and exported as one merged numeric amount', async () => {
  const f = fixture()
  for (const id of ['a', 'b', 'c']) { f.requirement(id); f.task(`${id}f`, id, 'frontend', { status: 'done', completedWeek: '2026-11-02' }) }
  f.plan('ac', ['af', 'cf'], '2026-11-02', 8, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('ac', 'ac', '2026-11-02', 8)
  f.plan('b', ['bf'], '2026-11-02', 2, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('b', 'b', '2026-11-02', 2)
  const before = structuredClone(f.state), original = createManagementWorkbook(f.state, '2026-11-02', 'report')
  const book = await new ExcelJS.Workbook().xlsx.load(await original.xlsx.writeBuffer()), sheet = book.getWorksheet('本周实际')
  assert.match(sheet.getCell('E4').value, /功能a/)
  assert.match(sheet.getCell('E5').value, /功能c/)
  assert.match(sheet.getCell('E6').value, /功能b/)
  assert.equal(sheet.getCell('G5').master.address, 'G4')
  assert.equal(sheet.getCell('G4').result, 8)
  assert.equal(sheet.getCell('G6').result, 2)
  assert.equal(sheet.getCell('G7').result, 10)
  assert.equal(book.getWorksheet('工时核对').rowCount, 3)
  for (const tab of book.worksheets) tab.eachRow(row => row.eachCell(cell => assert.doesNotMatch(String(cell.value || ''), /共用\s*G\d+/)))
  assert.deepEqual(f.state, before)
})

function checkLayoutAmounts(section, layout) {
  const sourceCounts = new Map(), originalCells = section.rows.flatMap(row => reportColumns.flatMap(role => row.cells[role].map(cell => `${row.requirementId}:${role}:${cell.id}`))).sort()
  const displayedCells = layout.rows.flatMap(row => reportColumns.flatMap(role => row.cells[role].map(cell => `${row.requirementId}:${role}:${cell.id}`))).sort()
  assert.deepEqual(displayedCells, originalCells)
  for (const [index, row] of layout.rows.entries()) for (const role of reportColumns) {
    const span = layout.hourSpans[index][role]
    if (!span) continue
    for (const cell of row.cells[role]) sourceCounts.set(cell.id, (sourceCounts.get(cell.id) || 0) + 1)
    if (span > 1) {
      assert.equal(row.cells[role].length, 1)
      for (let offset = 1; offset < span; offset++) {
        assert.equal(layout.hourSpans[index + offset][role], 0)
        assert.deepEqual(layout.rows[index + offset].cells[role].map(cell => cell.id), row.cells[role].map(cell => cell.id))
      }
    }
  }
  assert.equal(sourceCounts.size, section.cells.length)
  for (const count of sourceCounts.values()) assert.equal(count, 1)
}

test('overlapping frontend and backend groups remain on one requirement row when both merged ranges fit', () => {
  const f = fixture()
  for (const id of ['a', 'b', 'c']) {
    f.requirement(id); f.task(`${id}f`, id, 'frontend', { status: 'done', completedWeek: '2026-11-02' }); f.task(`${id}b`, id, 'backend', { status: 'done', completedWeek: '2026-11-02' })
  }
  f.plan('front', ['af', 'cf'], '2026-11-02', 8); f.effort('front', 'front', '2026-11-02', 8)
  f.plan('back', ['ab', 'bb'], '2026-11-02', 4); f.effort('back', 'back', '2026-11-02', 4)
  const section = getManagementWeekReport(f.state, '2026-11-02').actual, layout = getWeekReportLayout(section.rows)
  assert.equal(layout.rows.length, 3)
  assert.equal(layout.rows[1].requirementId, 'a')
  checkLayoutAmounts(section, layout)
})

test('incompatible role groups split display rows without merging unrelated requirements or counting twice', async () => {
  const f = fixture()
  for (const id of ['a', 'b', 'c', 'd']) {
    f.requirement(id); f.task(`${id}f`, id, 'frontend', { status: 'done', completedWeek: '2026-11-02' }); f.task(`${id}b`, id, 'backend', { status: 'done', completedWeek: '2026-11-02' })
  }
  for (const [id, tasks, hours] of [['fab', ['af', 'bf'], 4], ['fcd', ['cf', 'df'], 8], ['bac', ['ab', 'cb'], 2], ['bbd', ['bb', 'db'], 6]]) {
    f.plan(id, tasks, '2026-11-02', hours); f.effort(id, id, '2026-11-02', hours)
  }
  const section = getManagementWeekReport(f.state, '2026-11-02').actual, layout = getWeekReportLayout(section.rows)
  assert(layout.rows.length > section.rows.length)
  checkLayoutAmounts(section, layout)
  const original = createManagementWorkbook(f.state, '2026-11-02', 'report')
  const book = await new ExcelJS.Workbook().xlsx.load(await original.xlsx.writeBuffer()), sheet = book.getWorksheet('本周实际')
  let hours = 0
  for (let index = 0; index < layout.rows.length; index++) for (const [role, column] of [['frontend', 7], ['backend', 11], ['product', 15]]) {
    const cell = sheet.getCell(index + 4, column)
    if (layout.hourSpans[index][role] > 0) hours += cell.result || 0
    if (layout.hourSpans[index][role] > 1) assert.equal(sheet.getCell(index + 5, column).master.address, cell.address)
  }
  assert.equal(hours, 20)
  assert.equal(section.hours, 20)
})

test('additional single-item effort stays outside the shared amount and filtering never alters source work', () => {
  const f = fixture()
  for (const id of ['a', 'b']) { f.requirement(id); f.task(`${id}f`, id, 'frontend') }
  f.plan('shared', ['af', 'bf'], '2026-11-02', 8); f.effort('shared', 'shared', '2026-11-02', 8)
  f.save('people', { id: 'front2', name: '蒋世彤', roles: ['frontend'], weeklyCapacity: 40 })
  f.task('aextra', 'a', 'frontend', { ownerId: 'front2' }); f.plan('extra', ['aextra'], '2026-11-02', 2); f.effort('extra', 'extra', '2026-11-02', 2)
  const section = getManagementWeekReport(f.state, '2026-11-02').actual, before = structuredClone(section)
  const layout = getWeekReportLayout(section.rows)
  assert.equal(layout.rows.length, 3)
  checkLayoutAmounts(section, layout)
  const filtered = getWeekReportLayout(section.rows.filter(row => row.requirementId === 'b'))
  assert.equal(filtered.rows[0].cells.frontend[0].hours, 8)
  assert.equal(filtered.hourSpans[0].frontend, 1)
  assert.deepEqual(section, before)
})

test('uncompleted plans do not leak estimated hours into actual totals and early future plans stay out of future totals', () => {
  const f = fixture(); f.requirement('a'); f.requirement('b'); f.task('af', 'a'); f.task('bf', 'b', 'frontend', { status: 'done', completedWeek: '2026-11-02' })
  f.plan('pending', ['af'], '2026-11-02', 16); f.plan('early', ['bf'], '2026-11-09', 8, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('early', 'early', '2026-11-02', 4)
  const book = createManagementWorkbook(f.state, '2026-11-02', 'report'), actual = book.getWorksheet('本周实际'), next = book.getWorksheet('下周计划')
  assert.equal(actual.getCell('G5').value.result, 4)
  assert.equal(actual.getCell('G7').value, null)
  assert.equal(next.getCell('G4').result, 0)
  assert.equal(next.getCell('G6').value.result, 8)
  assert.equal(next.getCell('H6').fill.fgColor.argb, 'FFFFF16A')
})

test('confirmed reports freeze next-week capacity, names and schedules independently from later edits', () => {
  const f = fixture(); f.requirement(); f.task(); f.plan('p', ['af'], '2026-11-09', 16)
  f.save('capacities', { id: 'current', personId: 'front', week: '2026-11-02', hours: 40 }); f.save('capacities', { id: 'future', personId: 'front', week: '2026-11-09', hours: 20 })
  f.apply({ type: 'snapshot', week: '2026-11-02', note: '周五确认' })
  const snapshot = structuredClone(f.state.snapshots[0]), frozen = { ...f.state, ...snapshot.data }, before = getManagementWeekReport(frozen, '2026-11-02')
  f.save('capacities', { id: 'future', hours: 8 }); f.save('plans', { id: 'p', plannedHours: 32 }); f.save('requirements', { id: 'a', title: '修改后的名称' })
  assert.equal(before.nextPeople.find(person => person.personId === 'front').capacity, 20)
  assert.equal(before.nextPeople.find(person => person.personId === 'front').load, .8)
  assert.equal(getManagementWeekReport({ ...f.state, ...snapshot.data }, '2026-11-02').next.hours, 16)
  assert.equal(getManagementWeekReport(f.state, '2026-11-02').next.hours, 32)
  assert.deepEqual(f.state.snapshots[0], snapshot)
})

test('empty report exports valid headers and zero cached totals without including examples', async () => {
  const book = createManagementWorkbook(emptyManagementState(), '2026-11-02', 'report')
  const saved = await new ExcelJS.Workbook().xlsx.load(await book.xlsx.writeBuffer())
  assert.equal(saved.getWorksheet('本周实际').getCell('G4').result, 0)
  assert.equal(saved.getWorksheet('下周计划').getCell('G4').result, 0)
  assert.equal(saved.getWorksheet('工时核对').rowCount, 1)
})

test('cancelled task scopes leave future capacity while retaining historical actual effort', () => {
  const f = fixture(); f.requirement(); f.task(); f.plan('p', ['af'], '2026-11-09', 8); f.effort('e', 'p', '2026-11-02', 2)
  f.save('tasks', { id: 'af', status: 'cancelled' })
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.equal(report.next.rows.length, 0)
  assert.equal(report.next.hours, 0)
  assert.equal(report.actual.hours, 2)
  assert.equal(report.actual.rows.length, 1)
})

test('confirmed report status uses its confirmation date when reopened in a later week', () => {
  const f = fixture(); f.requirement(); f.task('af', 'a', 'frontend', { progress: 50, status: 'active' }); f.plan('p', ['af'], '2026-10-26', 8); f.effort('e', 'p', '2026-10-26', 4)
  const report = getManagementWeekReport(f.state, '2026-10-26', '2026-10-30')
  assert.equal(report.actual.cells[0].status, '进行中（50%）')
  const book = createManagementWorkbook(f.state, '2026-10-26', 'report', { snapshotRevision: 1, confirmedAt: '2026-10-30T10:00:00Z' })
  assert.equal(book.getWorksheet('本周实际').getCell('I4').value, report.actual.cells[0].status)
})

test('multiple people on one requirement retain their names, sum their sources, and expand the row height', async () => {
  const f = fixture(); f.requirement(); f.task()
  f.save('people', { id: 'front2', name: '蒋世彤', roles: ['frontend'], weeklyCapacity: 40 })
  f.task('af2', 'a', 'frontend', { ownerId: 'front2' })
  f.plan('first', ['af'], '2026-11-02', 4); f.effort('first', 'first', '2026-11-02', 4)
  f.plan('second', ['af2'], '2026-11-02', 2); f.effort('second', 'second', '2026-11-02', 2)
  const original = createManagementWorkbook(f.state, '2026-11-02', 'report')
  const book = await new ExcelJS.Workbook().xlsx.load(await original.xlsx.writeBuffer()), sheet = book.getWorksheet('本周实际')
  assert.equal(sheet.getCell('H4').value, '高正峰\n蒋世彤')
  assert.equal(sheet.getCell('G4').result, 6)
  assert(sheet.getRow(4).height >= 38)
})

test('weekly work, next plans and exported totals follow editable personnel order while shared hours remain merged', async () => {
  const f = fixture(), expected = ['赵浩程', '曹鑫哲', '常天翼', '高正峰', '刘宇', '蒋世彤']
  const people = [['zhao', '赵浩程', 'product'], ['product', '曹鑫哲', 'qa'], ['chang', '常天翼', 'frontend'], ['front', '高正峰', 'frontend'], ['back', '刘宇', 'backend'], ['jiang', '蒋世彤', 'backend']]
  for (const [index, [id, name, role]] of people.entries()) {
    f.save('people', { id, name, roles: [role], sortOrder: index + 1 })
    f.requirement(id); f.task(`task-${id}`, id, role, { ownerId: id })
    const tasks = [`task-${id}`]
    if (id === 'chang') { f.requirement('chang-extra'); f.task('chang-extra', 'chang-extra', role, { ownerId: id }); tasks.push('chang-extra') }
    f.plan(id, tasks, '2026-11-02', 4); f.effort(id, id, '2026-11-02', 4)
    f.plan(`next-${id}`, tasks, '2026-11-09', 4)
  }
  const report = getManagementWeekReport(f.state, '2026-11-02'), layout = getWeekReportLayout(report.actual.rows)
  const primaryPerson = row => reportColumns.flatMap(role => row.cells[role]).slice().sort((a, b) => a.personOrder - b.personOrder)[0].person
  assert.deepEqual(layout.rows.map(primaryPerson), ['赵浩程', '曹鑫哲', '常天翼', '常天翼', '高正峰', '刘宇', '蒋世彤'])
  assert.deepEqual(getWeekReportLayout(report.next.rows).rows.map(primaryPerson), layout.rows.map(primaryPerson))
  assert.deepEqual(report.nextPeople.map(person => f.state.people.find(item => item.id === person.personId).name), expected)
  assert.deepEqual(getPlansForWeek(f.state, '2026-11-02').map(plan => f.state.people.find(person => person.id === plan.personId).name), expected)
  checkLayoutAmounts(report.actual, layout)
  const original = createManagementWorkbook(f.state, '2026-11-02', 'report')
  const book = await new ExcelJS.Workbook().xlsx.load(await original.xlsx.writeBuffer()), sheet = book.getWorksheet('本周实际')
  assert.equal(sheet.getCell('P4').value, '赵浩程')
  assert.equal(sheet.getCell('P5').value, '曹鑫哲')
  assert.equal(sheet.getCell('H6').value, '常天翼')
  assert.equal(sheet.getCell('G7').master.address, 'G6')
  assert.equal(sheet.getCell('G6').result, 4)
  assert.deepEqual(expected.map((_, index) => book.getWorksheet('周报汇总').getCell(index + 3, 1).value), expected)
  assert.equal(report.actual.hours, 24)
})

test('completed early work follows all regular work in personnel order in weekly views and exports', async () => {
  const f = fixture(), people = [['zhao', '赵浩程', 'product'], ['product', '曹鑫哲', 'qa'], ['chang', '常天翼', 'frontend'], ['front', '高正峰', 'frontend'], ['back', '刘宇', 'backend'], ['jiang', '蒋世彤', 'backend']]
  for (const [index, [id, name, role]] of people.entries()) f.save('people', { id, name, roles: [role], sortOrder: index + 1 })
  for (const [id, , role] of [...people].reverse()) for (const kind of ['early', 'planned']) {
    const key = `${kind}-${id}`, week = kind === 'early' ? '2026-11-09' : '2026-11-02'
    f.requirement(key)
    f.task(`task-${key}`, key, role, { ownerId: id, status: 'done', completedWeek: '2026-11-02', plannedStartWeek: week, plannedEndWeek: week })
    f.plan(key, [`task-${key}`], week, 4, { outcome: 'done', completedWeek: '2026-11-02' })
    f.effort(key, key, '2026-11-02', 4)
  }
  const before = structuredClone(f.state), report = getManagementWeekReport(f.state, '2026-11-02'), layout = getWeekReportLayout(report.actual.rows)
  const expected = ['planned', 'early'].flatMap(kind => people.map(([id]) => `${kind}-${id}`))
  assert.deepEqual(report.actual.rows.map(row => row.requirementId), expected)
  assert.deepEqual(layout.rows.map(row => row.requirementId), expected)
  assert.deepEqual(getPlansForWeek(f.state, '2026-11-02').map(plan => plan.id), expected)
  assert.deepEqual(getWeekReportLayout(report.advanced.rows).rows.map(row => row.requirementId), people.map(([id]) => `early-${id}`))
  assert(report.actual.rows.slice(0, 6).every(row => reportColumns.flatMap(role => row.cells[role]).every(cell => cell.status === '已完成')))
  assert(report.actual.rows.slice(6).every(row => reportColumns.flatMap(role => row.cells[role]).every(cell => cell.status === '已完成（提前）')))
  checkLayoutAmounts(report.actual, layout)
  assert.equal(report.actual.hours, 48)
  const book = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'report').xlsx.writeBuffer())
  const actual = book.getWorksheet('本周实际')
  assert.deepEqual(expected.map((_, index) => actual.getCell(index + 4, 5).value), layout.rows.map(getWeekReportWorkText))
  assert.equal(actual.columnCount, 17)
  const detail = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'week').xlsx.writeBuffer())
  assert.deepEqual(expected.map((_, index) => detail.getWorksheet('周排期与复盘').getCell(index + 2, 4).value), expected.map(id => `排期${id}`))
  assert.deepEqual(f.state, before)
})

test('moving early completions last retains mixed-role requirements and merged group hours', async () => {
  const f = fixture()
  for (const id of ['a', 'b']) {
    f.requirement(id)
    f.task(`${id}f`, id, 'frontend', { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-09' })
  }
  f.plan('early-group', ['af', 'bf'], '2026-11-09', 8, { outcome: 'done', completedWeek: '2026-11-02' })
  f.effort('early-group', 'early-group', '2026-11-02', 8)
  f.task('ab', 'a', 'backend', { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-02' })
  f.plan('on-time', ['ab'], '2026-11-02', 4, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('on-time', 'on-time', '2026-11-02', 4)
  f.requirement('normal'); f.task('normal', 'normal', 'backend')
  f.plan('normal', ['normal'], '2026-11-02', 2); f.effort('normal', 'normal', '2026-11-02', 2)
  const section = getManagementWeekReport(f.state, '2026-11-02').actual, before = structuredClone(section), layout = getWeekReportLayout(section.rows)
  assert.equal(layout.rows[0].requirementId, 'normal')
  const mixed = layout.rows.find(row => row.requirementId === 'a')
  assert.equal(mixed.cells.frontend[0].status, '已完成（提前）')
  assert.equal(mixed.cells.backend[0].status, '已完成')
  assert.equal(layout.rows.length, 3)
  checkLayoutAmounts(section, layout)
  assert.equal(section.hours, 14)
  const book = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'report').xlsx.writeBuffer())
  const sheet = book.getWorksheet('本周实际')
  assert.equal(sheet.getCell('G6').master.address, 'G5')
  assert.equal(sheet.getCell('G5').result, 8)
  assert.equal(sheet.getCell('K7').result, 6)
  assert.deepEqual(section, before)
})

test('work merely started early stays with regular plans ahead of completed early work', async () => {
  const f = fixture()
  f.requirement('complete'); f.task('complete', 'complete', 'frontend', { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-09' })
  f.plan('complete', ['complete'], '2026-11-09', 8, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('complete', 'complete', '2026-11-02', 8)
  f.requirement('active'); f.task('active', 'active', 'backend', { status: 'active', progress: 50, plannedStartWeek: '2026-11-09', plannedEndWeek: '2026-11-09' })
  f.plan('active', ['active'], '2026-11-09', 8, { outcome: 'partial' }); f.effort('active', 'active', '2026-11-02', 4)
  const report = getManagementWeekReport(f.state, '2026-11-02')
  assert.deepEqual(getWeekReportLayout(report.actual.rows).rows.map(row => row.requirementId), ['active', 'complete'])
  assert.deepEqual(getPlansForWeek(f.state, '2026-11-02').map(plan => plan.id), ['active', 'complete'])
  assert.equal(report.next.hours, 8)
  assert.equal(report.actual.hours, 12)
  const book = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'week').xlsx.writeBuffer())
  assert.equal(book.getWorksheet('周排期与复盘').getCell('D2').value, '排期active')
  assert.equal(book.getWorksheet('周排期与复盘').getCell('D3').value, '排期complete')
})

test('next-week export omits status columns and aligns all three role groups, totals and print area', async () => {
  const f = fixture()
  for (const [role, hours] of [['frontend', 4], ['backend', 6], ['product', 8]]) {
    f.requirement(role); f.task(role, role, role); f.plan(role, [role], '2026-11-09', hours)
  }
  const book = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'report').xlsx.writeBuffer())
  const next = book.getWorksheet('下周计划'), actual = book.getWorksheet('本周实际')
  assert.equal(next.columnCount, 14)
  assert.equal(actual.columnCount, 17)
  assert(!next.getRow(3).values.includes('状态'))
  assert.deepEqual(['F2', 'I2', 'L2'].map(address => next.getCell(address).value), ['前端', '后端', '产品经理'])
  assert.deepEqual(['F3', 'G3', 'H3'].map(address => next.getCell(address).value), ['任务复杂度', '排期（H）', '人员'])
  assert.equal(next.getCell('N3').value, '人员')
  assert.equal(next.getCell('N1').master.address, 'A1')
  const find = text => next.getRows(4, 3).find(row => String(row.getCell(5).value).includes(text))
  assert.equal(find('功能frontend').getCell(7).result, 4)
  assert.equal(find('功能frontend').getCell(8).value, '高正峰')
  assert.equal(find('功能backend').getCell(10).result, 6)
  assert.equal(find('功能backend').getCell(11).value, '刘宇')
  assert.equal(find('功能product').getCell(13).result, 8)
  assert.equal(find('功能product').getCell(14).value, '曹鑫哲')
  assert.deepEqual([7, 10, 13].map(column => next.getCell(7, column).result), [4, 6, 8])
  assert.equal(actual.getCell('I3').value, '状态')
  assert.equal(next.pageSetup.printArea, `A1:N${next.rowCount}`)
})

test('early completions combine by project and people while keeping full requirements and unique role hours', async () => {
  const f = fixture()
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    f.requirement(id)
    for (const role of ['frontend', 'backend']) f.task(`${id}-${role}`, id, role, { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-09' })
  }
  for (const [id, ids, hours] of [['front-ab', ['a-frontend', 'b-frontend'], 4], ['front-cde', ['c-frontend', 'd-frontend', 'e-frontend'], 6], ['back-all', ['a-backend', 'b-backend', 'c-backend', 'd-backend', 'e-backend'], 5]]) {
    f.plan(id, ids, '2026-11-09', hours, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort(id, id, '2026-11-02', hours)
  }
  f.requirement('regular'); f.task('regular', 'regular', 'frontend', { status: 'done', completedWeek: '2026-11-02' })
  f.plan('regular', ['regular'], '2026-11-02', 2, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort('regular', 'regular', '2026-11-02', 2)
  const before = structuredClone(f.state), report = getManagementWeekReport(f.state, '2026-11-02'), layout = getWeekReportLayout(report.actual.rows, { groupEarly: true })
  assert.equal(report.actual.rows.length, 6)
  assert.equal(layout.rows.length, 2)
  assert.equal(layout.rows[0].requirementId, 'regular')
  const grouped = layout.rows[1]
  assert.equal(grouped.groupedRows.length, 5)
  assert.equal(grouped.cells.frontend.length, 2)
  assert.equal(grouped.cells.backend.length, 1)
  assert.equal(grouped.cells.frontend.reduce((hours, cell) => hours + cell.hours, 0), 10)
  assert.equal(grouped.cells.backend[0].hours, 5)
  assert.deepEqual(grouped.groupedRows.map(row => row.requirementId), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(getWeekReportWorkText(grouped), grouped.groupedRows.map((row, index) => `${index + 1}、${getWeekReportWorkText(row)}`).join('\n'))
  assert.equal(getWeekReportEditCells(grouped.groupedRows[0])[0].planId, 'front-ab')
  const book = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'report').xlsx.writeBuffer())
  const actual = book.getWorksheet('本周实际')
  assert.equal(actual.getCell('E5').value, getWeekReportWorkText(grouped))
  assert.equal(actual.getCell('G5').result, 10); assert.equal(actual.getCell('K5').result, 5)
  assert.equal(actual.getCell('H5').value, '高正峰'); assert.equal(actual.getCell('L5').value, '刘宇')
  assert.equal(actual.getCell('I5').value, '已完成（提前）')
  assert.equal(actual.getCell('G6').result, 12); assert.equal(actual.getCell('K6').result, 5)
  assert.equal(book.getWorksheet('工时核对').rowCount, 8)
  assert.deepEqual(f.state, before)
})

test('early grouping keeps modules, people and active or mixed-status shared scopes separate', () => {
  const f = fixture()
  f.save('projects', { id: 'p', modules: ['MES模块', 'CRM模块'] })
  f.save('people', { id: 'front2', name: '常天翼', roles: ['frontend'] })
  for (const [id, module, ownerId] of [['a', 'MES模块', 'front'], ['b', 'MES模块', 'front'], ['c', 'CRM模块', 'front'], ['d', 'MES模块', 'front2']]) {
    f.requirement(id, { module }); f.task(id, id, 'frontend', { ownerId, status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-09' })
    f.plan(id, [id], '2026-11-09', 2, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort(id, id, '2026-11-02', 2)
  }
  f.requirement('mixed-early'); f.task('mixed-early', 'mixed-early', 'frontend', { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-09' })
  f.requirement('mixed-on-time'); f.task('mixed-on-time', 'mixed-on-time', 'frontend', { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-02' })
  f.plan('mixed', ['mixed-early', 'mixed-on-time'], '2026-11-09', 4); f.effort('mixed', 'mixed', '2026-11-02', 4)
  const section = getManagementWeekReport(f.state, '2026-11-02').actual, layout = getWeekReportLayout(section.rows, { groupEarly: true })
  const groups = layout.rows.filter(row => row.groupedRows)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].groupedRows.map(row => row.requirementId), ['a', 'b'])
  assert(layout.rows.some(row => row.requirementId === 'c'))
  assert(layout.rows.some(row => row.requirementId === 'd'))
  assert(layout.rows.some(row => row.requirementId === 'mixed-early'))
  const mixedRow = layout.rows.findIndex(row => row.requirementId === 'mixed-early' || row.requirementId === 'mixed-on-time')
  assert.equal(layout.hourSpans[mixedRow].frontend, 2)
})

test('long early requirement lists split into readable Excel rows with merged project, people and totals', async () => {
  const f = fixture(), ids = Array.from({ length: 22 }, (_, index) => String(index + 1).padStart(2, '0'))
  for (const id of ids) {
    f.requirement(id, { title: `【平台管理后台】功能${id}的用户权限、业务规则、边界校验与操作记录追溯` })
    f.task(id, id, 'frontend', { status: 'done', completedWeek: '2026-11-02', plannedEndWeek: '2026-11-09' })
  }
  for (let index = 0; index < ids.length; index += 5) {
    const id = `group-${index}`, hours = index < 15 ? 4 : 2
    f.plan(id, ids.slice(index, index + 5), '2026-11-09', hours, { outcome: 'done', completedWeek: '2026-11-02' }); f.effort(id, id, '2026-11-02', hours)
  }
  const report = getManagementWeekReport(f.state, '2026-11-02'), layout = getWeekReportLayout(report.actual.rows, { groupEarly: true })
  assert.equal(layout.rows.length, 1); assert.equal(layout.rows[0].groupedRows.length, 22)
  const book = await new ExcelJS.Workbook().xlsx.load(await createManagementWorkbook(f.state, '2026-11-02', 'report').xlsx.writeBuffer())
  const sheet = book.getWorksheet('本周实际'), total = sheet.getRows(4, sheet.rowCount - 3).find(row => row.getCell(1).value === '本周实际合计（H）')
  assert(total.number > 5)
  const rows = sheet.getRows(4, total.number - 4), text = rows.map(row => row.getCell(5).value).join('\n')
  for (const requirement of f.state.requirements) assert(text.includes(`${requirement.title}（${requirement.code}）`))
  for (const row of rows) {
    assert(row.height <= 409)
    for (const column of [1, 2, 3, 4, 6, 7, 8, 9]) assert.equal(row.getCell(column).master.address, sheet.getCell(4, column).address)
    assert(!row.getCell(5).isMerged)
  }
  assert.equal(sheet.getCell('G4').result, 16)
  assert.equal(total.getCell(7).result, 16)
  assert.equal((sheet.getCell('G4').formula.match(/I\d+/g) || []).length, 5)
})
