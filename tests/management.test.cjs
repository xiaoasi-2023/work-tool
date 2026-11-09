const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { emptyManagementState, applyManagementCommand, validateManagementState, getRequirementPhase, isRequirementClosed, requirementPhaseLabels, getVersionPhase, getVersionSummary, getVersionProductContributions, getRequirementWork, getTaskEffortSummary, getTaskEffortWeeks, getTaskWeekEffort, prepareTaskWeekEffort, getWeekSummary, getManagementAlerts, getProjectModules, sortManagementPeople, nextPersonSortOrder, weekStart, addWeeks, hoursToDays } = require('../dist-electron/shared/management.js')
const { ManagementService, MANAGEMENT_STORAGE_KEY } = require('../dist-electron/main/management.js')
const { Store } = require('../dist-electron/main/store.js')

function fixture() {
  let state = emptyManagementState(), serial = 0
  const apply = command => { state = applyManagementCommand(state, command, '2026-11-07T10:00:00.000Z', () => `id-${++serial}`); return state }
  const save = (entity, value, reason) => apply({ type: 'upsert', entity, value, reason })
  save('people', { id: 'person', name: '开发人员', roles: ['frontend'], weeklyCapacity: 40 })
  save('projects', { id: 'project', name: '业务项目' })
  save('versions', { id: 'version', projectId: 'project', code: 'v1.1', name: '报价专项', startedAt: '2026-11-02', plannedDevEnd: '2026-11-06', plannedTestEnd: '2026-11-12' })
  save('requirements', { id: 'requirement', projectId: 'project', versionId: 'version', title: '客户信息', phase: 'development', nextAction: '安排后端', followUpDate: '2026-11-09' })
  save('tasks', { id: 'task', requirementId: 'requirement', name: '小程序前端', stage: 'frontend', role: 'frontend', ownerId: 'person' })
  return { get state() { return state }, apply, save }
}

test('weekly dates use Monday boundaries and civil dates without timezone drift', () => {
  assert.equal(weekStart('2026-11-07'), '2026-11-02')
  assert.equal(weekStart('2026-11-08'), '2026-11-02')
  assert.equal(addWeeks('2026-12-28'), '2027-01-04')
  assert.equal(hoursToDays(12), 1.5)
  assert.throws(() => weekStart('2026-02-29'), /日期/)
})

test('person order supports legacy records, stable ties and new people appended after configured positions', () => {
  const f = fixture(), legacy = structuredClone(f.state)
  delete legacy.people[0].sortOrder
  const validated = validateManagementState(legacy)
  assert.equal(validated.people[0].sortOrder, undefined)
  const before = structuredClone(validated)
  assert.equal(sortManagementPeople(validated.people)[0].name, '开发人员')
  assert.deepEqual(validated, before)
  f.save('people', { id: 'person', sortOrder: 20 })
  f.save('people', { id: 'first', name: '先展示的人员', sortOrder: 0 })
  f.save('people', { id: 'last', name: '新成员' })
  assert.equal(f.state.people.find(person => person.id === 'last').sortOrder, 21)
  assert.deepEqual(sortManagementPeople(f.state.people).map(person => person.id), ['first', 'person', 'last'])
  f.save('people', { id: 'person', notes: '调整其他字段' })
  assert.equal(f.state.people.find(person => person.id === 'person').sortOrder, 20)
  f.save('people', { id: 'first', sortOrder: 20 })
  assert.deepEqual(sortManagementPeople(f.state.people).map(person => person.id), ['person', 'first', 'last'])
  assert.equal(nextPersonSortOrder(f.state.people), 22)
})

test('person order validates integers and confirmed weeks preserve their captured personnel order', () => {
  const f = fixture()
  for (const sortOrder of [-1, 1.5, '2', null, NaN, 1000001]) {
    const before = structuredClone(f.state)
    assert.throws(() => f.save('people', { id: 'person', sortOrder }), /人员排序/)
    assert.deepEqual(f.state, before)
  }
  f.save('people', { id: 'product', name: '产品经理', roles: ['product'], sortOrder: 0 })
  f.apply({ type: 'snapshot', week: '2026-11-02' })
  const snapshot = structuredClone(f.state.snapshots[0])
  f.save('people', { id: 'product', sortOrder: 10 })
  assert.deepEqual(getWeekSummary(f.state, '2026-11-02').people.map(person => person.personId), ['person', 'product'])
  assert.deepEqual(getWeekSummary({ ...f.state, ...snapshot.data }, '2026-11-02').people.map(person => person.personId), ['product', 'person'])
  assert.deepEqual(f.state.snapshots[0], snapshot)
})

test('grouped planning counts once, carryover keeps source and never copies effort', () => {
  const f = fixture()
  f.save('tasks', { id: 'task-2', requirementId: 'requirement', name: 'PC前端', stage: 'frontend', role: 'frontend' })
  f.save('plans', { id: 'plan', projectId: 'project', versionId: 'version', week: '2026-11-02', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task', 'task-2'], title: '前端组合工作', goal: '完成页面', plannedHours: 8, status: 'confirmed', outcome: 'partial' })
  f.save('efforts', { id: 'effort', projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02', role: 'frontend', stage: 'frontend', planId: 'plan', taskIds: ['task', 'task-2'], hours: 5 })
  const original = structuredClone(f.state.plans[0])
  f.apply({ type: 'carryover', planId: 'plan', week: '2026-11-09', plannedHours: 4 })
  assert.deepEqual(f.state.plans[0], original)
  assert.equal(f.state.plans[1].plannedHours, 4)
  assert.equal(f.state.plans[1].outcome, 'pending')
  assert.equal(f.state.plans[1].sourcePlanId, 'plan')
  assert.equal(f.state.plans[1].status, 'draft')
  assert.equal(f.state.efforts.length, 1)
  assert.equal(getWeekSummary(f.state, '2026-11-02').plannedHours, 8)
  assert.equal(getVersionSummary(f.state, 'version').hours, 5)
  assert.throws(() => f.apply({ type: 'carryover', planId: 'plan', week: '2026-11-09', plannedHours: 4 }), /已经结转/)
  assert.throws(() => f.apply({ type: 'carryover', planId: 'plan', week: '2026-11-02', plannedHours: 4 }), /后续周/)
})

test('confirmed plans allow omitted or cleared goals and carry over without requiring repeated descriptions', () => {
  const f = fixture()
  f.save('plans', { id: 'plan', projectId: 'project', versionId: 'version', week: '2026-11-02', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], title: '客户信息', plannedHours: 4, status: 'confirmed' })
  assert.equal(f.state.plans[0].goal, '')
  f.save('plans', { id: 'plan', goal: '完成客户信息页面的布局调整' })
  f.save('plans', { id: 'plan', goal: '   ' })
  assert.equal(f.state.plans[0].goal, '')
  assert.deepEqual(validateManagementState(JSON.parse(JSON.stringify(f.state))), f.state)
  f.apply({ type: 'carryover', planId: 'plan', week: '2026-11-09', plannedHours: 2 })
  const carried = f.state.plans.find(plan => plan.sourcePlanId === 'plan')
  f.save('plans', { id: carried.id, status: 'confirmed' })
  assert.equal(f.state.plans.find(plan => plan.id === carried.id).goal, '')
  const before = structuredClone(f.state)
  assert.throws(() => f.save('plans', { id: carried.id, plannedHours: null }), /确认排期前请填写预计工时/)
  assert.deepEqual(f.state, before)
})

test('hours are edited rather than appended and aggregate/detail duplication is rejected', () => {
  const f = fixture(), base = { id: 'effort', projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02', role: 'frontend', stage: 'frontend', hours: 8 }
  f.save('efforts', base)
  f.save('efforts', { id: 'effort', hours: 10 })
  assert.equal(getVersionSummary(f.state, 'version').hours, 10)
  assert.equal(getVersionSummary(f.state, 'version').days, 1.25)
  assert.throws(() => f.save('efforts', { ...base, id: 'another' }), /汇总投入/)
  assert.throws(() => f.save('efforts', { ...base, id: 'detail', taskIds: ['task'] }), /汇总投入和任务明细/)
  assert.equal(f.state.efforts.length, 1)
  f.save('efforts', { id: 'effort', hours: 0 })
  assert.equal(getWeekSummary(f.state, '2026-11-02').actualHours, 0)
})

test('one task accumulates weekly hours and correcting the same week replaces its existing record', () => {
  const f = fixture(), tasksBefore = structuredClone(f.state.tasks), requirementsBefore = structuredClone(f.state.requirements)
  const input = { taskId: 'task', personId: 'person', week: '2026-11-04', hours: 2.5, notes: '首周页面开发' }
  const initial = structuredClone(f.state)
  const command = prepareTaskWeekEffort(f.state, input)
  assert.deepEqual(f.state, initial)
  f.apply(command)
  const first = structuredClone(f.state.efforts[0])
  assert.equal(first.week, '2026-11-02')
  f.apply(prepareTaskWeekEffort(f.state, { ...input, week: '2026-11-09', hours: 3.5, notes: '第二周补齐功能' }))
  assert.equal(getRequirementWork(f.state, 'requirement').byRole.frontend.hours, 6)
  f.apply(prepareTaskWeekEffort(f.state, { ...input, hours: 4 }))
  assert.equal(f.state.efforts.length, 2)
  assert.equal(f.state.efforts[0].id, first.id)
  assert.equal(getRequirementWork(f.state, 'requirement').byRole.frontend.hours, 7.5)
  assert.equal(getVersionSummary(f.state, 'version').hours, 7.5)
  assert.deepEqual(f.state.tasks, tasksBefore)
  assert.deepEqual(f.state.requirements, requirementsBefore)
  f.apply(prepareTaskWeekEffort(f.state, { ...input, hours: 0 }))
  assert.equal(getTaskWeekEffort(f.state, 'task', 'person', input.week).hours, 0)
  assert.equal(getRequirementWork(f.state, 'requirement').byRole.frontend.hours, 3.5)
  for (const hours of [NaN, Infinity, -1]) assert.throws(() => prepareTaskWeekEffort(f.state, { ...input, hours }), /有效数字/)
})

test('weekly entry reuses its plan and retains historical coverage and rework classification on edits', () => {
  const f = fixture()
  f.save('plans', { id: 'plan', projectId: 'project', versionId: 'version', week: '2026-11-02', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], title: '本周页面', goal: '完成页面', plannedHours: 8, status: 'confirmed' })
  const input = { taskId: 'task', personId: 'person', week: '2026-11-02', hours: 5, notes: '' }
  f.apply(prepareTaskWeekEffort(f.state, input))
  assert.equal(f.state.efforts[0].planId, 'plan')
  f.save('efforts', { id: f.state.efforts[0].id, taskIds: [], coveredStart: '2026-11-04', coveredEnd: '2026-11-05', kind: 'rework' })
  const original = structuredClone(f.state.efforts[0])
  f.apply(prepareTaskWeekEffort(f.state, { ...input, hours: 6 }))
  assert.deepEqual(f.state.efforts[0], { ...original, hours: 6 })
  assert.equal(getTaskEffortSummary(f.state, ['task']).hours, 6)
})

test('quick weekly entry refuses to duplicate grouped effort or an unassigned version total', () => {
  const f = fixture(), input = { taskId: 'task', personId: 'person', week: '2026-11-02', hours: 3, notes: '' }
  f.save('tasks', { id: 'second-task', requirementId: 'requirement', name: '第二项', stage: 'frontend', role: 'frontend' })
  f.save('efforts', { id: 'shared', projectId: 'project', versionId: 'version', week: '2026-11-02', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task', 'second-task'], hours: 8 })
  const before = structuredClone(f.state)
  assert.throws(() => prepareTaskWeekEffort(f.state, input), /共用工时/)
  assert.deepEqual(f.state, before)
  f.save('efforts', { id: 'shared', taskIds: [] })
  assert.throws(() => prepareTaskWeekEffort(f.state, input), /汇总工时/)
})

test('standalone design and testing tasks accumulate separately without changing ownership or counting history twice', () => {
  const f = fixture()
  f.save('people', { id: 'product-person', name: '产品经理', roles: ['product', 'qa'] })
  for (const [id, role, stage] of [['design', 'product', 'design'], ['test', 'qa', 'testing']]) {
    f.save('requirements', { id: `${id}-requirement`, projectId: 'project', versionId: 'version', title: id })
    f.save('tasks', { id, requirementId: `${id}-requirement`, name: id, role, stage, ownerId: 'product-person' })
    for (const [week, hours] of [['2026-11-02', 2], ['2026-11-09', 3]]) f.apply(prepareTaskWeekEffort(f.state, { taskId: id, personId: 'product-person', week, hours, notes: '' }))
    assert.equal(getRequirementWork(f.state, `${id}-requirement`).byRole[role].hours, 5)
  }
  f.save('baselines', { id: 'design-history', projectId: 'project', versionId: 'version', personId: 'product-person', role: 'product', stage: 'design', taskId: 'design', hours: 12, asOf: '2026-10-30' })
  assert.equal(getRequirementWork(f.state, 'design-requirement').byRole.product.hours, 17)
  assert.equal(getRequirementWork(f.state, 'test-requirement').byRole.qa.hours, 5)
  assert.equal(getVersionSummary(f.state, 'version').hours, 22)
  const input = { taskId: 'design', personId: 'product-person', week: '2026-10-26', hours: 2, notes: '' }
  assert.throws(() => f.apply(prepareTaskWeekEffort(f.state, input)), /期初范围重叠/)
})

test('product design and TAPD documentation are separate parts of product hours without double counting', () => {
  const f = fixture()
  f.save('tasks', { id: 'docs-task', requirementId: 'requirement', name: 'TAPD文档', role: 'product', stage: 'documentation' })
  f.save('plans', { id: 'docs-plan', projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02', role: 'product', stage: 'documentation', taskIds: ['docs-task'], title: '补齐需求文档', goal: '完成文档', plannedHours: 4, status: 'confirmed' })
  const scope = { projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02' }
  f.save('efforts', { ...scope, id: 'design-hours', role: 'product', stage: 'design', hours: 4.5 })
  f.save('efforts', { ...scope, id: 'docs-hours', role: 'product', stage: 'documentation', hours: 3.5, planId: 'docs-plan', taskIds: ['docs-task'] })
  f.save('efforts', { ...scope, id: 'other-product-hours', role: 'product', stage: 'other', hours: 1.25 })
  f.save('efforts', { ...scope, id: 'qa-hours', role: 'qa', stage: 'design', hours: 2 })
  f.save('efforts', { ...scope, id: 'backend-hours', role: 'backend', stage: 'backend', hours: 3 })
  f.save('baselines', { id: 'product-opening', projectId: 'project', versionId: 'version', personId: 'person', role: 'product', hours: 8, asOf: '2026-10-31' })
  const summary = getVersionSummary(validateManagementState(f.state), 'version')
  assert.deepEqual(summary.byProductStage, { design: 4.5, documentation: 3.5, unclassified: 9.25 })
  assert.equal(summary.byRole.product, 17.25)
  assert.equal(summary.hours, 22.25)
  assert.equal(Object.values(summary.byProductStage).reduce((sum, hours) => sum + hours, 0), summary.byRole.product)
  f.save('efforts', { id: 'docs-hours', hours: 5.5 })
  assert.equal(getVersionSummary(f.state, 'version').byProductStage.documentation, 5.5)
  assert.equal(getVersionSummary(f.state, 'version').hours, 24.25)
})

test('classified historical product hours retain their stage without inventing weekly allocations', () => {
  const f = fixture()
  f.save('baselines', { id: 'prototype-history', projectId: 'project', versionId: 'version', personId: 'person', role: 'product', stage: 'design', hours: 72, asOf: '2026-07-10' })
  f.save('efforts', { id: 'review', projectId: 'project', versionId: 'version', personId: 'person', week: '2026-08-03', coveredStart: '2026-08-04', coveredEnd: '2026-08-04', role: 'product', stage: 'design', hours: 8 })
  f.save('efforts', { id: 'docs', projectId: 'project', versionId: 'version', personId: 'person', week: '2026-10-05', role: 'product', stage: 'documentation', hours: 12 })
  const saved = validateManagementState(JSON.parse(JSON.stringify(f.state)))
  assert.equal(saved.baselines[0].stage, 'design')
  assert.deepEqual(getVersionSummary(saved, 'version').byProductStage, { design: 80, documentation: 12, unclassified: 0 })
  assert.equal(getVersionSummary(saved, 'version').hours, 92)
  assert.equal(getWeekSummary(saved, '2026-07-06').actualHours, 0)
  assert.throws(() => f.save('baselines', { id: 'prototype-history', stage: 'unknown' }), /工作环节/)
})

test('requirement work shows assigned and actual people while distinguishing missing hours from recorded zero', () => {
  const f = fixture()
  f.save('people', { id: 'replacement', name: '接手开发人员', roles: ['frontend'] })
  f.save('people', { id: 'backend-person', name: '后端人员', roles: ['backend'] })
  f.save('tasks', { id: 'backend-task', requirementId: 'requirement', name: '后端开发', role: 'backend', stage: 'backend' })
  f.save('plans', { id: 'backend-plan', projectId: 'project', versionId: 'version', week: '2026-11-02', personId: 'backend-person', role: 'backend', stage: 'backend', taskIds: ['backend-task'], title: '后端开发', goal: '完成接口', plannedHours: 8, status: 'confirmed' })
  f.save('efforts', { id: 'actual', projectId: 'project', versionId: 'version', personId: 'replacement', week: '2026-11-02', role: 'frontend', stage: 'frontend', taskIds: ['task'], hours: 0 })
  const before = structuredClone(f.state)
  const work = getRequirementWork(f.state, 'requirement')
  assert.deepEqual(work.byRole.frontend.ownerIds, ['person', 'replacement'])
  assert.equal(work.byRole.frontend.hours, 0)
  assert.equal(work.byRole.backend.hours, null)
  assert.deepEqual(work.byRole.backend.ownerIds, ['backend-person'])
  assert.deepEqual(f.state, before)
})

test('requirement actuals count same-requirement tasks once and retain cross-requirement group hours separately', () => {
  const f = fixture()
  f.save('tasks', { id: 'pc-task', requirementId: 'requirement', name: 'PC前端', stage: 'frontend', role: 'frontend', ownerId: 'person' })
  f.save('requirements', { id: 'other-requirement', projectId: 'project', versionId: 'version', title: '其他功能' })
  f.save('tasks', { id: 'other-task', requirementId: 'other-requirement', name: '前端开发', stage: 'frontend', role: 'frontend', ownerId: 'person' })
  const scope = { projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend' }
  f.save('efforts', { ...scope, id: 'same-requirement', week: '2026-11-02', taskIds: ['task', 'pc-task'], hours: 6 })
  f.save('efforts', { ...scope, id: 'shared-requirements', week: '2026-11-09', taskIds: ['task', 'other-task'], hours: 16 })
  f.save('efforts', { ...scope, id: 'direct', week: '2026-11-16', taskIds: ['pc-task'], hours: 2 })
  const work = getRequirementWork(f.state, 'requirement').byRole.frontend
  assert.equal(work.hours, 8)
  assert.equal(work.sharedHours, 16)
  assert.deepEqual(work.efforts.map(e => e.id), ['same-requirement', 'direct'])
  assert.deepEqual(work.sharedEfforts.map(e => e.id), ['shared-requirements'])
  assert.equal(getRequirementWork(f.state, 'other-requirement').byRole.frontend.hours, null)
  assert.equal(getTaskEffortSummary(f.state, ['task']).sharedHours, 22)
  assert.equal(getTaskEffortSummary(f.state, ['task']).hours, null)
  assert.equal(getVersionSummary(f.state, 'version').hours, 24)
})

test('weekly actuals remain visible after completion and accumulate in chronological order', () => {
  const f = fixture(), scope = { projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend' }
  for (const [week, end, hours, goal] of [
    ['2026-10-26', '2026-10-30', 28, '完成优化'],
    ['2026-10-05', '2026-10-09', 5, '阶段进度20%'],
    ['2026-10-12', '2026-10-16', 4, '阶段进度35%']
  ]) {
    f.save('plans', { ...scope, id: `plan-${week}`, week, title: 'ES搜索优化', taskIds: ['task'], goal, plannedHours: hours, status: 'confirmed', outcome: 'done' })
    f.save('efforts', { ...scope, id: `effort-${week}`, week, planId: `plan-${week}`, hours, coveredStart: week, coveredEnd: end })
  }
  f.save('tasks', { id: 'task', status: 'done' })
  const before = structuredClone(f.state), rows = getTaskEffortWeeks(f.state, ['task'])
  assert.deepEqual(rows.map(row => [row.week, row.hours, row.cumulativeHours]), [
    ['2026-10-05', 5, 5], ['2026-10-12', 4, 9], ['2026-10-26', 28, 37]
  ])
  assert.deepEqual(rows.map(row => [row.coveredStart, row.coveredEnd]), [
    ['2026-10-05', '2026-10-09'], ['2026-10-12', '2026-10-16'], ['2026-10-26', '2026-10-30']
  ])
  assert.equal(f.state.plans.find(plan => plan.id === rows[0].efforts[0].planId).goal, '阶段进度20%')
  assert.equal(getTaskEffortSummary(f.state, ['task']).hours, 37)
  assert.deepEqual(f.state, before)
})

test('weekly actuals group same-week entries once and keep shared totals and historical baselines separate', () => {
  const f = fixture(), scope = { projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend' }
  f.save('people', { id: 'second-person', name: '协作人员', roles: ['frontend'] })
  f.save('tasks', { id: 'second-task', requirementId: 'requirement', name: '第二项', stage: 'frontend', role: 'frontend' })
  f.save('requirements', { id: 'other-requirement', projectId: 'project', versionId: 'version', title: '其他需求' })
  f.save('tasks', { id: 'other-task', requirementId: 'other-requirement', name: '其他任务', stage: 'frontend', role: 'frontend' })
  f.save('baselines', { ...scope, id: 'history', taskId: 'task', hours: 80, asOf: '2026-10-30' })
  f.save('efforts', { ...scope, id: 'first', taskIds: ['task', 'second-task'], week: '2026-11-02', coveredStart: '2026-11-03', coveredEnd: '2026-11-04', hours: 0.1 })
  f.save('efforts', { ...scope, id: 'second', personId: 'second-person', taskIds: ['second-task'], week: '2026-11-02', coveredStart: '2026-11-05', coveredEnd: '2026-11-06', hours: 0.2 })
  f.save('efforts', { ...scope, id: 'shared', taskIds: ['task', 'other-task'], week: '2026-11-09', hours: 16 })
  f.save('efforts', { ...scope, id: 'zero', taskIds: ['task'], week: '2026-11-16', hours: 0 })
  const before = structuredClone(f.state), rows = getTaskEffortWeeks(f.state, ['task', 'second-task', 'task'])
  assert.deepEqual(rows.map(row => [row.week, row.hours, row.cumulativeHours]), [['2026-11-02', 0.3, 0.3], ['2026-11-16', 0, 0.3]])
  assert.equal(rows[0].coveredStart, '2026-11-03')
  assert.equal(rows[0].coveredEnd, '2026-11-06')
  assert.equal(rows[0].efforts.length, 2)
  assert.equal(getTaskEffortSummary(f.state, ['task', 'second-task']).hours, 80.3)
  assert.equal(getTaskEffortWeeks(f.state, ['task', 'second-task', 'other-task'])[1].cumulativeHours, 16.3)
  assert.deepEqual(getTaskEffortWeeks(f.state, []), [])
  assert.deepEqual(f.state, before)
})

test('version product context retains aggregate people and history without assigning hours to individual requirements', () => {
  const f = fixture()
  f.save('people', { id: 'product-person', name: '产品人员', roles: ['product'] })
  f.save('baselines', { id: 'product-history', projectId: 'project', versionId: 'version', personId: 'product-person', role: 'product', stage: 'design', hours: 72, asOf: '2026-07-10' })
  f.save('baselines', { id: 'pooled-history', projectId: 'project', versionId: 'version', peopleLabel: '历史文档人员', role: 'product', stage: 'documentation', hours: 12, asOf: '2026-10-10' })
  const work = getRequirementWork(f.state, 'requirement')
  assert.deepEqual(work.byRole.product.ownerIds, [])
  assert.equal(work.byRole.product.hours, null)
  assert.deepEqual(work.versionProduct, { ownerIds: ['product-person'], peopleLabels: ['历史文档人员'], hours: 84 })
  f.save('requirements', { id: 'unversioned', projectId: 'project', title: '未排版本的功能' })
  assert.deepEqual(getRequirementWork(f.state, 'unversioned').versionProduct, { ownerIds: [], peopleLabels: [], hours: null })
})

test('actuals linked through a plan resolve its tasks while explicit effort tasks retain their narrower scope', () => {
  const f = fixture()
  f.save('requirements', { id: 'other-requirement', projectId: 'project', versionId: 'version', title: '其他功能' })
  f.save('tasks', { id: 'other-task', requirementId: 'other-requirement', name: '前端开发', role: 'frontend', stage: 'frontend' })
  const scope = { projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend' }
  f.save('plans', { ...scope, id: 'plan', week: '2026-11-02', taskIds: ['task', 'other-task'], title: '组合排期', goal: '完成开发', plannedHours: 8, status: 'confirmed' })
  f.save('efforts', { ...scope, id: 'plan-actual', week: '2026-11-02', planId: 'plan', hours: 8 })
  assert.equal(getRequirementWork(f.state, 'requirement').byRole.frontend.sharedHours, 8)
  assert.equal(getRequirementWork(f.state, 'requirement').byRole.frontend.hours, null)
  f.save('efforts', { id: 'plan-actual', taskIds: ['task'] })
  assert.equal(getRequirementWork(f.state, 'requirement').byRole.frontend.hours, 8)
  assert.equal(getRequirementWork(f.state, 'requirement').byRole.frontend.sharedHours, 0)
  assert.equal(getRequirementWork(f.state, 'other-requirement').byRole.frontend.hours, null)
})

test('product overview separates each person and stage and counts historical effort once per version', () => {
  const f = fixture()
  f.save('people', { id: 'designer', name: '原型人员', roles: ['product'] })
  f.save('people', { id: 'writer', name: '文档人员', roles: ['product'] })
  f.save('baselines', { id: 'design-history', projectId: 'project', versionId: 'version', personId: 'designer', role: 'product', stage: 'design', hours: 80, asOf: '2026-07-10' })
  f.save('baselines', { id: 'doc-history', projectId: 'project', versionId: 'version', personId: 'writer', role: 'product', stage: 'documentation', hours: 12, asOf: '2026-10-10' })
  const rows = getVersionProductContributions(f.state, 'version')
  assert.deepEqual(rows, [
    { personId: 'designer', peopleLabel: '', stage: 'design', hours: 80 },
    { personId: 'writer', peopleLabel: '', stage: 'documentation', hours: 12 }
  ])
  assert.equal(rows.reduce((total, row) => total + row.hours, 0), getVersionSummary(f.state, 'version').byRole.product)
  f.save('efforts', { id: 'later-design', projectId: 'project', versionId: 'version', personId: 'designer', week: '2026-11-02', role: 'product', stage: 'design', hours: 4 })
  f.save('efforts', { id: 'later-docs', projectId: 'project', versionId: 'version', personId: 'designer', week: '2026-11-02', role: 'product', stage: 'documentation', hours: 2 })
  assert.deepEqual(getVersionProductContributions(f.state, 'version'), [
    { personId: 'designer', peopleLabel: '', stage: 'design', hours: 84 },
    { personId: 'designer', peopleLabel: '', stage: 'documentation', hours: 2 },
    { personId: 'writer', peopleLabel: '', stage: 'documentation', hours: 12 }
  ])
  assert.deepEqual(getVersionProductContributions(f.state, 'other-version'), [])
})

test('linked historical product effort is visible on its requirement and task without adding a weekly allocation', () => {
  const f = fixture()
  f.save('people', { id: 'designer', name: '原型人员', roles: ['product'] })
  f.save('people', { id: 'writer', name: '文档人员', roles: ['product'] })
  f.save('requirements', { id: 'prototype', projectId: 'project', versionId: 'version', title: '原型设计' })
  f.save('requirements', { id: 'docs', projectId: 'project', versionId: 'version', title: '需求文档' })
  f.save('tasks', { id: 'prototype-task', requirementId: 'prototype', name: '原型设计', role: 'product', stage: 'design', ownerId: 'designer' })
  f.save('tasks', { id: 'docs-task', requirementId: 'docs', name: '需求文档', role: 'product', stage: 'documentation', ownerId: 'writer' })
  f.save('baselines', { id: 'prototype-history', projectId: 'project', versionId: 'version', personId: 'designer', role: 'product', stage: 'design', taskId: 'prototype-task', hours: 80, asOf: '2026-07-10' })
  f.save('baselines', { id: 'docs-history', projectId: 'project', versionId: 'version', personId: 'writer', role: 'product', stage: 'documentation', taskId: 'docs-task', hours: 12, asOf: '2026-10-10' })
  const saved = validateManagementState(JSON.parse(JSON.stringify(f.state)))
  assert.equal(saved.baselines[0].taskId, 'prototype-task')
  assert.equal(getRequirementWork(saved, 'prototype').byRole.product.hours, 80)
  assert.equal(getRequirementWork(saved, 'docs').byRole.product.hours, 12)
  assert.equal(getRequirementWork(saved, 'requirement').byRole.product.hours, null)
  assert.deepEqual(getRequirementWork(saved, 'requirement').byRole.product.ownerIds, [])
  assert.equal(getTaskEffortSummary(saved, ['prototype-task']).hours, 80)
  assert.equal(getTaskEffortSummary(saved, ['prototype-task']).baselines[0].hours, 80)
  assert.equal(getWeekSummary(saved, '2026-07-06').actualHours, 0)
  assert.equal(getVersionSummary(saved, 'version').hours, 92)
  f.save('efforts', { id: 'later-product-work', projectId: 'project', versionId: 'version', personId: 'designer', role: 'product', stage: 'design', taskIds: ['prototype-task'], week: '2026-11-02', hours: 4 })
  assert.equal(getTaskEffortSummary(f.state, ['prototype-task']).hours, 84)
  assert.equal(getVersionSummary(f.state, 'version').hours, 96)
})

test('historical task links reject mismatched scopes and can be removed without changing accumulated hours', () => {
  const f = fixture()
  f.save('versions', { id: 'other-version', projectId: 'project', code: 'v2', name: '下一版本' })
  f.save('requirements', { id: 'other-requirement', projectId: 'project', versionId: 'other-version', title: '其他功能' })
  f.save('tasks', { id: 'other-task', requirementId: 'other-requirement', name: '前端开发', role: 'frontend', stage: 'frontend' })
  const baseline = { id: 'history', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', hours: 80, asOf: '2026-10-31' }
  assert.throws(() => f.save('baselines', { ...baseline, taskId: 'other-task' }), /同一专项版本/)
  assert.throws(() => f.save('baselines', { ...baseline, role: 'backend', taskId: 'task' }), /项目、角色或工作环节/)
  assert.throws(() => f.save('baselines', { ...baseline, stage: 'backend', taskId: 'task' }), /项目、角色或工作环节/)
  f.save('baselines', { ...baseline, taskId: 'task' })
  assert.throws(() => f.apply({ type: 'delete', entity: 'tasks', id: 'task' }), /期初关联任务/)
  f.save('baselines', { id: 'history', taskId: '' })
  assert(!Object.hasOwn(f.state.baselines[0], 'taskId'))
  assert.equal(getTaskEffortSummary(f.state, ['task']).hours, null)
  assert.equal(getVersionSummary(f.state, 'version').hours, 80)
})

test('snapshot revisions retain names, task statuses and effort amounts after changes', () => {
  const f = fixture()
  f.save('efforts', { id: 'effort', projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02', role: 'frontend', hours: 8 })
  f.apply({ type: 'snapshot', week: '2026-11-02', note: '周五确认' })
  const first = structuredClone(f.state.snapshots[0])
  f.save('tasks', { id: 'task', status: 'done' })
  f.save('people', { id: 'person', name: '新名字' })
  f.save('efforts', { id: 'effort', hours: 10 }, '补正实际投入')
  f.apply({ type: 'snapshot', week: '2026-11-02', note: '补正版本' })
  assert.deepEqual(f.state.snapshots[0], first)
  assert.equal(first.data.tasks[0].status, 'pending')
  assert.equal(first.data.people[0].name, '开发人员')
  assert.equal(first.data.efforts[0].hours, 8)
  assert.equal(f.state.snapshots[1].revision, 2)
  assert.equal(f.state.snapshots[1].data.efforts[0].hours, 10)
  assert.equal(validateManagementState(f.state).snapshots.length, 2)
})

test('development, test and release dates are independent and only outstanding stages become overdue', () => {
  const f = fixture()
  assert.throws(() => f.save('versions', { id: 'version', devCompletedAt: '2026-11-06' }), /必要开发任务/)
  f.save('tasks', { id: 'task', status: 'done' })
  f.save('versions', { id: 'version', devCompletedAt: '2026-11-06', submittedAt: '2026-11-09', testStartedAt: '2026-11-10', testCompletedAt: '2026-11-12', releasedAt: '2026-11-15' })
  assert.equal(getVersionSummary(f.state, 'version').developmentDays, 5)
  const version = f.state.versions[0]
  assert.equal(version.devCompletedAt, '2026-11-06')
  assert.equal(version.testCompletedAt, '2026-11-12')
  assert.equal(version.releasedAt, '2026-11-15')
  assert.ok(!getManagementAlerts(f.state, '2026-11-20').some(a => a.entity === 'version'))
  f.save('efforts', { projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-16', role: 'qa', stage: 'testing', hours: 3 })
  assert.equal(getVersionSummary(f.state, 'version').hours, 3)
  assert.throws(() => f.save('versions', { id: 'version', devCompletedAt: '2026-11-01' }), /开始日期/)
})

test('future scheduled task does not become unscheduled and zero capacity stays defined', () => {
  const f = fixture()
  f.save('plans', { projectId: 'project', versionId: 'version', week: '2026-11-23', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], title: '未来任务', plannedHours: 8 })
  assert.ok(!getManagementAlerts(f.state, '2026-11-07').some(a => a.id === 'unscheduled:task'))
  f.save('capacities', { personId: 'person', week: '2026-11-23', hours: 0 })
  assert.equal(getWeekSummary(f.state, '2026-11-23').people[0].load, null)
})

test('historical development completion preserves unknown actual milestone dates', () => {
  const f = fixture(), history = structuredClone(f.state)
  history.requirements[0].phase = 'developed'
  history.tasks[0].status = 'done'
  history.tasks[0].progress = 100
  history.tasks[0].completedAt = ''
  f.apply({ type: 'restore', data: history, reason: '导入历史开发完成情况，具体完成日期未知' })
  assert.equal(f.state.requirements[0].phase, 'developed')
  assert.equal(f.state.tasks[0].status, 'done')
  assert.equal(f.state.tasks[0].completedAt, '')
  f.save('tasks', { id: 'task', notes: '补充历史进展，仍未提供具体完成日期' })
  assert.equal(f.state.tasks[0].completedAt, '')
  for (const entity of ['requirements', 'versions']) {
    for (const field of ['devCompletedAt', 'submittedAt', 'testCompletedAt', 'releasedAt']) assert.equal(f.state[entity][0][field], '')
  }
  assert.equal(validateManagementState(f.state).requirements[0].phase, 'developed')
})

test('completed product work has one phase for display, filtering and closed status', () => {
  const f = fixture()
  for (const [id, stage] of [['prototype', 'design'], ['documentation', 'documentation']]) {
    f.save('requirements', { id, projectId: 'project', versionId: 'version', title: id, phase: 'ready', followUpDate: '2026-11-01' })
    f.save('tasks', { id: `${id}-task`, requirementId: id, name: id, role: 'product', stage, status: 'done' })
  }
  f.save('requirements', { id: 'waiting', projectId: 'project', versionId: 'version', title: '待开发需求', phase: 'ready' })
  const before = structuredClone(f.state)
  const filtered = phase => f.state.requirements.filter(r => getRequirementPhase(f.state, r.id) === phase).map(r => r.id)
  assert.deepEqual(filtered('ready'), ['waiting'])
  assert.deepEqual(filtered('completed'), ['prototype', 'documentation'])
  assert.equal(requirementPhaseLabels[getRequirementPhase(f.state, 'prototype')], '已完成')
  assert.equal(isRequirementClosed(f.state, 'prototype'), true)
  assert.equal(isRequirementClosed(f.state, 'documentation'), true)
  assert.equal(isRequirementClosed(f.state, 'waiting'), false)
  assert.ok(!getManagementAlerts(f.state, '2026-11-08').some(a => a.entityId === 'prototype' || a.entityId === 'documentation'))
  assert.deepEqual(f.state, before)
})

test('product completion follows reopened tasks and never completes mixed development requirements', () => {
  const f = fixture()
  f.save('requirements', { id: 'product', projectId: 'project', versionId: 'version', title: '原型设计', phase: 'ready' })
  f.save('tasks', { id: 'product-task', requirementId: 'product', name: '原型设计', role: 'product', stage: 'design', status: 'done' })
  f.save('tasks', { id: 'cancelled-product-task', requirementId: 'product', name: '取消的设计', role: 'product', stage: 'design', status: 'cancelled' })
  assert.equal(getRequirementPhase(f.state, 'product'), 'completed')
  f.save('tasks', { id: 'product-task', status: 'active', progress: 50 }, '原型调整返工')
  assert.equal(getRequirementPhase(f.state, 'product'), 'ready')
  assert.equal(isRequirementClosed(f.state, 'product'), false)
  f.save('tasks', { id: 'product-task', status: 'done' })
  f.save('tasks', { id: 'frontend-task', requirementId: 'product', name: '前端开发', role: 'frontend', stage: 'frontend', status: 'done' })
  assert.equal(getRequirementPhase(f.state, 'product'), 'ready')
  f.save('requirements', { id: 'product', phase: 'testing' })
  assert.equal(getRequirementPhase(f.state, 'product'), 'testing')
})

test('testing without known dates updates version phase and clears development handoff reminders', () => {
  const f = fixture()
  f.save('requirements', { id: 'product-requirement', projectId: 'project', versionId: 'version', title: '原型设计', phase: 'ready' })
  f.save('tasks', { id: 'product-task', requirementId: 'product-requirement', name: '原型设计', stage: 'design', role: 'product', status: 'done' })
  f.save('tasks', { id: 'task', status: 'done' })
  f.save('requirements', { id: 'requirement', phase: 'developed' })
  assert.equal(getVersionPhase(f.state, 'version'), '开发完成')
  assert.ok(getManagementAlerts(f.state).some(a => a.id === 'handoff:requirement'))
  f.save('requirements', { id: 'requirement', phase: 'testing' })
  const before = structuredClone(f.state)
  assert.equal(getVersionPhase(f.state, 'version'), '测试中')
  assert.ok(!getManagementAlerts(f.state).some(a => a.id === 'handoff:requirement'))
  assert.equal(f.state.requirements[0].submittedAt, '')
  assert.equal(f.state.versions[0].testStartedAt, '')
  assert.deepEqual(f.state, before)
  f.save('versions', { id: 'version', devCompletedAt: '2026-11-07' })
  assert.equal(getVersionPhase(f.state, 'version'), '测试中')
  f.save('requirements', { id: 'unfinished', projectId: 'project', versionId: 'version', title: '未完成的需求', phase: 'development' })
  f.save('versions', { id: 'version', devCompletedAt: '' })
  assert.equal(getVersionPhase(f.state, 'version'), '开发中')
  f.save('versions', { id: 'version', testStartedAt: '2026-11-08' })
  assert.equal(getVersionPhase(f.state, 'version'), '测试中')
  f.save('versions', { id: 'version', status: 'paused' })
  assert.equal(getVersionPhase(f.state, 'version'), '暂停')
})

test('editing historical active tasks does not invent a start date', () => {
  const f = fixture(), history = structuredClone(f.state)
  Object.assign(history.tasks[0], { status: 'active', progress: 50, startedAt: '' })
  f.apply({ type: 'restore', data: history, reason: '补录历史进行中任务' })
  f.save('tasks', { id: 'task', notes: '仅补充说明' })
  assert.equal(f.state.tasks[0].startedAt, '')
  f.save('tasks', { id: 'task', status: 'done' })
  assert.equal(f.state.tasks[0].completedAt, '2026-11-07')
})

test('invalid amounts, dates, relationships and dependency cycles fail without mutating source', () => {
  const f = fixture(), before = structuredClone(f.state)
  for (const hours of [NaN, Infinity, -1, '8']) assert.throws(() => f.save('efforts', { projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02', hours }), /有效数字/)
  assert.throws(() => f.save('versions', { id: 'version', startedAt: '2026-02-29' }), /有效日期/)
  assert.throws(() => f.save('efforts', { projectId: 'other', versionId: 'version', personId: 'person', week: '2026-11-02', hours: 1 }), /不存在/)
  assert.throws(() => f.save('tasks', { id: 'task', dependencies: ['task'] }), /自己/)
  assert.throws(() => f.apply({ type: 'delete', entity: 'projects', id: 'project' }), /不存在/)
  assert.deepEqual(f.state, before)
  f.save('tasks', { id: 'task-2', requirementId: 'requirement', name: '后端', dependencies: ['task'] })
  assert.throws(() => f.save('tasks', { id: 'task', dependencies: ['task-2'] }), /循环依赖/)
})

test('requirement reassignment moves linked plans and hours once while preserving weeks, snapshots and unrelated work', () => {
  const f = fixture(), scope = { projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend' }
  f.save('tasks', { id: 'second-task', requirementId: 'requirement', name: '另一端', role: 'frontend', stage: 'frontend' })
  f.save('plans', { ...scope, id: 'plan', week: '2026-11-02', baselineWeek: '2026-11-09', baselineHours: 8, taskIds: ['task', 'second-task'], title: '本周开发', goal: '完成页面', plannedHours: 8, status: 'confirmed' })
  f.save('efforts', { ...scope, id: 'effort', planId: 'plan', week: '2026-11-02', hours: 5, coveredEnd: '2026-11-06' })
  f.save('baselines', { ...scope, id: 'history', taskId: 'task', hours: 4, asOf: '2026-10-30' })
  f.save('efforts', { ...scope, id: 'unlinked', role: 'product', stage: 'design', week: '2026-11-02', hours: 3 })
  f.save('versions', { id: 'next-version', projectId: 'project', name: '长期迭代' })
  f.apply({ type: 'snapshot', week: '2026-11-02' })
  const before = structuredClone(f.state)
  f.save('requirements', { id: 'requirement', versionId: 'next-version' })
  for (const entity of ['plans', 'efforts', 'baselines']) for (const old of before[entity].filter(entry => entry.id !== 'unlinked')) {
    const entry = f.state[entity].find(item => item.id === old.id)
    assert.deepEqual(entry, { ...old, versionId: 'next-version' })
    assert(f.state.audit.some(item => item.entityId === entry.id && item.before?.versionId === 'version' && item.after?.versionId === 'next-version'))
  }
  assert.deepEqual(f.state.tasks, before.tasks)
  assert.deepEqual(f.state.snapshots, before.snapshots)
  assert.deepEqual(f.state.efforts.find(entry => entry.id === 'unlinked'), before.efforts.find(entry => entry.id === 'unlinked'))
  assert.equal(getVersionSummary(f.state, 'version').hours, 3)
  assert.equal(getVersionSummary(f.state, 'next-version').hours, 9)
  assert.equal(getVersionSummary(f.state, 'next-version').plannedHours, 8)
  assert.equal(getWeekSummary(f.state, '2026-11-02').actualHours, 8)
  assert.throws(() => getTaskWeekEffort(f.state, 'task', 'person', '2026-11-02'), /共用工时/)
  validateManagementState(f.state)
})

test('saving the current version repairs legacy linked records and supports moving to another project', () => {
  const f = fixture(), scope = { projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend' }
  f.save('plans', { ...scope, id: 'plan', taskIds: [], week: '2026-11-02', title: '本周开发', plannedHours: 8 })
  f.save('efforts', { ...scope, id: 'effort', planId: 'plan', taskIds: ['task'], week: '2026-11-02', hours: 5 })
  f.save('versions', { id: 'next-version', projectId: 'project', name: '长期迭代' })
  const legacy = structuredClone(f.state)
  legacy.requirements[0].versionId = 'next-version'
  f.apply({ type: 'restore', data: legacy })
  f.save('requirements', { id: 'requirement', versionId: 'next-version' })
  assert.equal(f.state.plans[0].versionId, 'next-version')
  assert.equal(f.state.efforts[0].versionId, 'next-version')
  assert.equal(getVersionSummary(f.state, 'next-version').hours, 5)
  f.save('projects', { id: 'other-project', name: '另一个项目' })
  f.save('versions', { id: 'other-version', projectId: 'other-project', name: '其他专项' })
  f.save('requirements', { id: 'requirement', projectId: 'other-project', versionId: 'other-version' })
  assert.equal(f.state.plans[0].projectId, 'other-project')
  assert.equal(f.state.efforts[0].projectId, 'other-project')
  assert.equal(getVersionSummary(f.state, 'other-version').hours, 5)
  const before = structuredClone(f.state)
  assert.throws(() => f.save('requirements', { id: 'requirement', versionId: '' }), /选择专项版本/)
  assert.deepEqual(f.state, before)
})

test('shared hours reject a partial version transfer atomically and move once when the whole group is reassigned', () => {
  const f = fixture(), scope = { projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend' }
  f.save('requirements', { id: 'other', projectId: 'project', versionId: 'version', title: '其他需求' })
  f.save('tasks', { id: 'other-task', requirementId: 'other', name: '其他前端', role: 'frontend', stage: 'frontend' })
  f.save('plans', { ...scope, id: 'shared-plan', taskIds: ['task', 'other-task'], week: '2026-11-02', title: '组合开发', goal: '完成页面', plannedHours: 8, status: 'confirmed' })
  f.save('efforts', { ...scope, id: 'shared-effort', planId: 'shared-plan', week: '2026-11-02', hours: 5 })
  f.save('versions', { id: 'next-version', projectId: 'project', name: '长期迭代' })
  const before = structuredClone(f.state)
  assert.throws(() => f.save('requirements', { id: 'requirement', versionId: 'next-version' }), /共用排期或工时/)
  assert.deepEqual(f.state, before)
  f.apply({ type: 'batch', commands: ['requirement', 'other'].map(id => ({ type: 'upsert', entity: 'requirements', value: { id, versionId: 'next-version' } })) })
  assert.equal(f.state.plans[0].versionId, 'next-version')
  assert.equal(f.state.efforts[0].versionId, 'next-version')
  assert.equal(f.state.efforts.length, 1)
  assert.equal(getVersionSummary(f.state, 'version').hours, 0)
  assert.equal(getVersionSummary(f.state, 'next-version').hours, 5)
  assert.equal(getVersionSummary(f.state, 'next-version').plannedHours, 8)
})

test('version transfer validates destination conflicts and snapshots capture the synchronized assignment', () => {
  const f = fixture(), scope = { projectId: 'project', personId: 'person', role: 'frontend', stage: 'frontend' }
  f.save('efforts', { ...scope, id: 'effort', versionId: 'version', taskIds: ['task'], week: '2026-11-02', hours: 5 })
  f.save('versions', { id: 'next-version', projectId: 'project', name: '长期迭代' })
  f.save('efforts', { ...scope, id: 'target-summary', versionId: 'next-version', week: '2026-11-02', hours: 3 })
  const before = structuredClone(f.state)
  assert.throws(() => f.save('requirements', { id: 'requirement', versionId: 'next-version' }), /汇总投入和任务明细/)
  assert.deepEqual(f.state, before)
  f.apply({ type: 'delete', entity: 'efforts', id: 'target-summary', reason: '移除错误汇总' })
  f.apply({ type: 'batch', commands: [{ type: 'upsert', entity: 'requirements', value: { id: 'requirement', versionId: 'next-version' } }, { type: 'snapshot', week: '2026-11-02' }] })
  assert.equal(f.state.snapshots[0].data.requirements[0].versionId, 'next-version')
  assert.equal(f.state.snapshots[0].data.efforts[0].versionId, 'next-version')
  assert.equal(getVersionSummary(f.state, 'next-version').hours, 5)
})

test('new arrangements enforce active people and current version after requirement reassignment', () => {
  const f = fixture(), plan = { id: 'plan', projectId: 'project', versionId: 'version', week: '2026-11-02', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], title: '原版本工作', plannedHours: 8 }
  f.save('plans', plan)
  f.save('versions', { id: 'next-version', projectId: 'project', name: '下一版本' })
  f.save('requirements', { id: 'requirement', versionId: 'next-version' }, '后续交付调整到下一版本')
  f.save('plans', { id: 'plan', notes: '保留原周排期' })
  assert.equal(f.state.plans[0].versionId, 'next-version')
  assert.equal(f.state.plans[0].week, '2026-11-02')
  assert.throws(() => f.save('plans', { ...plan, id: 'wrong-version', week: '2026-11-09' }), /同一专项版本/)
  f.save('plans', { ...plan, id: 'next-plan', versionId: 'next-version', week: '2026-11-09' })
  f.save('people', { id: 'person', active: false })
  f.save('plans', { id: 'next-plan', notes: '历史修正' })
  assert.throws(() => f.save('plans', { ...plan, id: 'inactive-plan', taskIds: [], week: '2026-11-16' }), /停用人员/)
  assert.throws(() => f.apply({ type: 'carryover', planId: 'next-plan', week: '2026-11-16', plannedHours: 4 }), /停用人员/)
  f.save('people', { id: 'person', active: true })
  f.save('versions', { id: 'next-version', status: 'archived' })
  assert.throws(() => f.apply({ type: 'carryover', planId: 'next-plan', week: '2026-11-16', plannedHours: 4 }), /归档/)
})

test('malformed entity commands, unexplained cancellation and duplicate schedule updates are rejected', () => {
  const f = fixture()
  assert.throws(() => f.apply({ type: 'upsert', value: { name: '非法记录' } }), /数据类别/)
  assert.throws(() => f.apply({ type: 'delete', id: 'project' }), /数据类别/)
  f.save('tasks', { id: 'task', notes: '已有进展说明' })
  assert.throws(() => f.save('tasks', { id: 'task', status: 'cancelled' }), /取消任务/)
  f.save('tasks', { id: 'task', status: 'done' })
  assert.throws(() => f.save('tasks', { id: 'task', status: 'active', progress: 50 }), /返工原因/)
  f.save('tasks', { id: 'task', status: 'active', progress: 50 }, '测试发现遗漏，需要返工')
  const plan = { projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], title: '前端工作', plannedHours: 8 }
  f.save('plans', { ...plan, id: 'plan-1', week: '2026-11-02' })
  f.save('plans', { ...plan, id: 'plan-2', week: '2026-11-09' })
  assert.throws(() => f.save('plans', { id: 'plan-2', week: '2026-11-02' }), /重复安排/)
  f.save('plans', { id: 'plan-2', week: '2026-11-02' }, '拆分两段交付，保留两次安排')
  assert.equal(f.state.plans.length, 2)
})

test('opening balances only enter lifetime totals and prevent overlapping or repeated imports', () => {
  const f = fixture(), baseline = { id: 'baseline', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', hours: 38.4, asOf: '2026-11-06', source: 'historical.xlsx' }
  f.save('baselines', baseline)
  assert.equal(getVersionSummary(f.state, 'version').hours, 38.4)
  assert.equal(getWeekSummary(f.state, '2026-11-02').actualHours, 0)
  assert.throws(() => f.save('baselines', { ...baseline, id: 'repeated' }), /期初投入范围/)
  assert.throws(() => f.save('efforts', { projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02', role: 'frontend', hours: 4 }), /期初范围重叠/)
  f.save('efforts', { id: 'partial-week', projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02', coveredStart: '2026-11-07', coveredEnd: '2026-11-08', role: 'frontend', hours: 2 })
  assert.equal(getWeekSummary(f.state, '2026-11-02').actualHours, 2)
  assert.throws(() => f.save('efforts', { id: 'partial-week', coveredStart: '2026-11-06' }), /期初范围重叠/)
  assert.throws(() => f.save('efforts', { id: 'partial-week', coveredEnd: '2026-11-09' }), /所属周内/)
  f.save('efforts', { projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-09', role: 'frontend', hours: 1.2 })
  assert.equal(getVersionSummary(f.state, 'version').hours, 41.6)
})

test('batch reducer is atomic and validates the final graph', () => {
  const f = fixture(), before = structuredClone(f.state)
  assert.throws(() => f.apply({ type: 'batch', commands: [{ type: 'upsert', entity: 'people', value: { name: '临时人员' } }, { type: 'upsert', entity: 'versions', value: { name: '错误版本', projectId: 'missing' } }] }), /不存在/)
  assert.deepEqual(f.state, before)
  f.apply({ type: 'batch', commands: [{ type: 'upsert', entity: 'projects', value: { id: 'new-project', name: '新项目' } }, { type: 'upsert', entity: 'versions', value: { id: 'new-version', projectId: 'new-project', name: '专项' } }] })
  assert.equal(f.state.versions.find(v => v.id === 'new-version').projectId, 'new-project')
})

test('imported historical plans still allow recording while new mismatched effort is rejected', () => {
  const f = fixture()
  const base = { projectId: 'project', versionId: 'version', personId: 'person', week: '2026-11-02', role: 'frontend', stage: 'frontend', taskIds: ['task'], hours: 4 }
  f.save('plans', { ...base, id: 'old-plan', title: '原版本安排', plannedHours: 8 })
  f.save('versions', { id: 'next-version', projectId: 'project', name: '下一版本' })
  const legacy = structuredClone(f.state)
  legacy.requirements[0].versionId = 'next-version'
  f.apply({ type: 'restore', data: legacy, reason: '导入历史版本与排期归属' })
  assert.throws(() => f.save('efforts', { ...base, id: 'wrong' }), /同一专项版本/)
  f.save('efforts', { ...base, id: 'historical', planId: 'old-plan' })
  f.save('efforts', { id: 'historical', hours: 6 }, '补录原周投入')
  assert.equal(getVersionSummary(f.state, 'version').hours, 6)
  assert.equal(getVersionSummary(f.state, 'next-version').hours, 0)
})

test('pooled opening balances cannot also be counted as individual opening balances', () => {
  const f = fixture()
  f.save('baselines', { id: 'pooled', projectId: 'project', versionId: 'version', peopleLabel: '开发人员、其他人员', role: 'frontend', hours: 16, asOf: '2026-10-31' })
  assert.throws(() => f.save('baselines', { id: 'individual', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', hours: 8, asOf: '2026-10-31' }), /人员范围重叠/)
  assert.equal(getVersionSummary(f.state, 'version').hours, 16)
})

test('released acceptance work keeps follow-up reminders and reopened work flags milestone review', () => {
  const f = fixture()
  f.save('tasks', { id: 'task', status: 'done' })
  f.save('requirements', { id: 'requirement', closing: 'acceptance', phase: 'released', releasedAt: '2026-11-06', devCompletedAt: '2026-11-05', followUpDate: '2026-11-07', nextAction: '安排业务验收' })
  assert.ok(getManagementAlerts(f.state, '2026-11-07').some(a => a.id === 'follow:requirement'))
  f.save('requirements', { id: 'requirement', closing: 'release' })
  assert.ok(!getManagementAlerts(f.state, '2026-11-07').some(a => a.id === 'follow:requirement'))
  f.save('tasks', { id: 'task', status: 'active', progress: 50 }, '发现交付遗漏，需要返工')
  assert.ok(getManagementAlerts(f.state, '2026-11-07').some(a => a.id === 'review:requirement'))
})

test('snapshot backup validation rejects duplicated record ids', () => {
  const f = fixture()
  f.apply({ type: 'snapshot', week: '2026-11-02' })
  const corrupted = structuredClone(f.state)
  corrupted.snapshots[0].data.people.push(corrupted.snapshots[0].data.people[0])
  assert.throws(() => validateManagementState(corrupted), /周记录明细编号重复/)
})

test('Friday review surfaces unfinished work without a future plan and missing review or effort', () => {
  const f = fixture()
  f.save('plans', { id: 'week-plan', projectId: 'project', versionId: 'version', week: '2026-11-02', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], title: '本周开发', goal: '完成页面', plannedHours: 8, status: 'confirmed' })
  assert.ok(!getManagementAlerts(f.state, '2026-11-05').some(a => a.id === 'carryover:task'))
  const friday = getManagementAlerts(f.state, '2026-11-06')
  assert.ok(friday.some(a => a.id === 'carryover:task'))
  assert.ok(friday.some(a => a.id === 'reviewplan:week-plan'))
  assert.ok(friday.some(a => a.id === 'effort:week-plan'))
  f.apply({ type: 'carryover', planId: 'week-plan', week: '2026-11-09', plannedHours: 4 })
  assert.ok(!getManagementAlerts(f.state, '2026-11-06').some(a => a.id === 'carryover:task'))
})

test('clearing requirement details removes their visible history while preserving work, weekly notes and other requirements', () => {
  const f = fixture()
  f.save('requirements', { id: 'requirement', externalUrl: 'https://example.com/task', notes: '清理旧备注', description: '保留需求内容' })
  f.save('tasks', { id: 'task', notes: '保留任务进展' })
  f.save('baselines', { id: 'history', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskId: 'task', hours: 8, asOf: '2026-10-30', notes: '保留历史投入备注' })
  f.save('plans', { id: 'plan', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], week: '2026-11-02', title: '保留周计划', goal: '本周开发', plannedHours: 16, status: 'confirmed', notes: '保留排期备注' })
  f.save('efforts', { id: 'effort', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], planId: 'plan', week: '2026-11-02', hours: 12, notes: '保留功能明细与用时备注' })
  f.save('requirements', { id: 'other', projectId: 'project', versionId: 'version', title: '其他需求', externalUrl: 'https://example.com/other', notes: '其他备注' })
  f.save('tasks', { id: 'other-task', requirementId: 'other', name: '其他任务', role: 'frontend', stage: 'frontend' })
  f.apply({ type: 'snapshot', week: '2026-11-02' })
  const before = structuredClone(f.state), scope = new Set(['requirement', 'task', 'history'])
  const after = applyManagementCommand(before, { type: 'clear-requirement-details', requirementIds: ['requirement'], reason: '清理导入备注和最近变更' })
  assert.deepEqual(after.requirements[0], { ...before.requirements[0], externalUrl: '', notes: '' })
  assert.deepEqual(after.requirements[1], before.requirements[1])
  for (const entity of ['projects', 'people', 'versions', 'tasks', 'plans', 'efforts', 'baselines', 'capacities', 'snapshots']) assert.deepEqual(after[entity], before[entity])
  assert(!after.audit.some(item => scope.has(item.entityId)))
  assert.deepEqual(after.audit.slice(0, -1), before.audit.filter(item => !scope.has(item.entityId)))
  assert.equal(after.audit.at(-1).action, 'requirements.clear-details')
  assert.equal(after.audit.at(-1).entityId, '')
  assert.equal(getRequirementWork(after, 'requirement').byRole.frontend.hours, 20)
  assert.deepEqual(getVersionSummary(after, 'version'), getVersionSummary(before, 'version'))
  assert.deepEqual(f.state, before)
  const updated = applyManagementCommand(after, { type: 'upsert', entity: 'requirements', value: { id: 'requirement', notes: '后续新备注' }, reason: '正常更新' })
  assert.equal(updated.audit.filter(item => scope.has(item.entityId)).length, 1)
})

test('clearing only requirement history preserves all business data and allows future changes to appear', () => {
  const f = fixture()
  f.save('requirements', { id: 'requirement', externalUrl: 'https://example.com/task', notes: '保留需求备注', description: '保留需求内容' })
  f.save('tasks', { id: 'task', notes: '保留任务进展' })
  f.save('baselines', { id: 'history', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskId: 'task', hours: 8, asOf: '2026-10-30' })
  f.save('plans', { id: 'plan', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], week: '2026-11-02', title: '周计划', goal: '本周开发', plannedHours: 16, status: 'confirmed' })
  f.save('efforts', { id: 'effort', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], planId: 'plan', week: '2026-11-02', hours: 12, notes: '保留工时备注' })
  f.save('requirements', { id: 'other', projectId: 'project', versionId: 'version', title: '其他需求' })
  f.save('tasks', { id: 'other-task', requirementId: 'other', name: '其他任务', role: 'frontend', stage: 'frontend' })
  f.apply({ type: 'snapshot', week: '2026-11-02' })
  const before = structuredClone(f.state), scope = new Set(['requirement', 'task', 'history'])
  const after = applyManagementCommand(before, { type: 'clear-requirement-history', requirementIds: ['requirement'], reason: '清空最近变更' })
  for (const entity of ['projects', 'requirements', 'people', 'versions', 'tasks', 'plans', 'efforts', 'baselines', 'capacities', 'snapshots']) assert.deepEqual(after[entity], before[entity])
  assert.equal(after.revision, before.revision + 1)
  assert(!after.audit.some(item => scope.has(item.entityId)))
  assert.deepEqual(after.audit.slice(0, -1), before.audit.filter(item => !scope.has(item.entityId)))
  assert.equal(after.audit.at(-1).action, 'requirements.clear-history')
  assert.equal(after.audit.at(-1).entityId, '')
  assert.equal(after.audit.at(-1).before.history, before.audit.filter(item => scope.has(item.entityId)).length)
  assert.deepEqual(after.audit.at(-1).after, { history: 0 })
  assert.deepEqual(f.state, before)
  const updated = applyManagementCommand(after, { type: 'upsert', entity: 'requirements', value: { id: 'requirement', title: '后续更新' }, reason: '新的调整' })
  assert.equal(updated.audit.filter(item => scope.has(item.entityId)).length, 1)
})

test('requirement clearing rejects missing reasons and unknown or duplicate scopes atomically', () => {
  const f = fixture(), before = structuredClone(f.state)
  for (const type of ['clear-requirement-details', 'clear-requirement-history']) for (const command of [
    { type, requirementIds: ['requirement'], reason: '' },
    { type, requirementIds: [], reason: '清理' },
    { type, requirementIds: ['requirement', 'missing'], reason: '清理' },
    { type, requirementIds: ['requirement', 'requirement'], reason: '清理' }
  ]) assert.throws(() => applyManagementCommand(before, command))
  assert.deepEqual(f.state, before)
})

for (const type of ['clear-requirement-details', 'clear-requirement-history']) test(`${type} backs up the previous state before persisting`, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-clear-details-'))
  try {
    const f = fixture()
    f.save('requirements', { id: 'requirement', notes: '备份中的原始备注' })
    let saved = structuredClone(f.state)
    const service = new ManagementService({ directory, get: () => structuredClone(saved), set: (_key, data) => { saved = structuredClone(data) } })
    const before = service.read()
    const after = service.mutate({ revision: before.revision, command: { type, requirementIds: ['requirement'], reason: '用户要求清理' } })
    assert.equal(after.requirements[0].notes, type === 'clear-requirement-history' ? before.requirements[0].notes : '')
    const backups = fs.readdirSync(path.join(directory, 'management-backups'))
    assert.equal(backups.length, 1)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'management-backups', backups[0]), 'utf8')), before)
    assert.deepEqual(service.read(), after)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('module summaries only list configured project modules and never derive modules from requirement labels', () => {
  const f = fixture()
  f.save('projects', { id: 'project', modules: ['报价模块', '库存模块', 'CRM模块', 'CAPP模块', 'MES模块', '公共模块', '采购模块'] })
  f.save('requirements', { id: 'requirement', module: '报价模块' })
  f.save('requirements', { id: 'closed', projectId: 'project', title: '已完成需求', module: '报价模块', phase: 'accepted' })
  f.save('requirements', { id: 'legacy', projectId: 'project', title: '历史需求', module: '未登记历史模块' })
  f.save('requirements', { id: 'unassigned', projectId: 'project', title: '未关联需求' })
  f.save('projects', { id: 'other-project', name: '其他项目' })
  f.save('requirements', { id: 'other', projectId: 'other-project', title: '其他项目需求', module: '报价模块' })
  const modules = getProjectModules(f.state, 'project')
  assert.deepEqual(modules.map(row => row.name), f.state.projects[0].modules)
  assert.equal(modules.length, 7)
  assert.deepEqual(modules[0], { name: '报价模块', requirementIds: ['requirement', 'closed'], activeCount: 1 })
  assert(!modules.some(row => row.name === '未登记历史模块'))
  assert.equal(modules[1].requirementIds.length, 0)
  assert.deepEqual(getProjectModules(f.state, 'missing'), [])
  assert.deepEqual(getProjectModules(f.state, 'other-project'), [])
})

test('module renaming updates all linked requirements in its project while retaining work and snapshots', () => {
  const f = fixture()
  f.save('projects', { id: 'project', modules: ['报价模块', '库存模块'] })
  f.save('requirements', { id: 'requirement', module: '报价模块' })
  f.save('requirements', { id: 'closed', projectId: 'project', versionId: 'version', title: '已上线需求', module: '报价模块', phase: 'released', releasedAt: '2026-10-29' })
  f.save('projects', { id: 'other-project', name: '其他项目', modules: ['报价模块'] })
  f.save('requirements', { id: 'other', projectId: 'other-project', title: '其他项目需求', module: '报价模块' })
  f.save('efforts', { id: 'actual', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], week: '2026-11-02', hours: 8, notes: '保留周记录' })
  f.apply({ type: 'snapshot', week: '2026-11-02' })
  const before = structuredClone(f.state)
  const after = f.apply({ type: 'project-module', projectId: 'project', action: 'rename', name: '报价模块', newName: '报价中心', reason: '更新模块名称' })
  assert.deepEqual(after.projects[0].modules, ['报价中心', '库存模块'])
  assert.deepEqual(after.requirements.map(row => row.module), ['报价中心', '报价中心', '报价模块'])
  assert.deepEqual(after.requirements.map(row => row.id), before.requirements.map(row => row.id))
  for (const entity of ['tasks', 'plans', 'efforts', 'baselines', 'snapshots']) assert.deepEqual(after[entity], before[entity])
  assert.deepEqual(getVersionSummary(after, 'version'), getVersionSummary(before, 'version'))
  assert.deepEqual(getRequirementWork(after, 'requirement'), getRequirementWork(before, 'requirement'))
  assert.deepEqual(after.audit.slice(-3).map(row => [row.action, row.entityId]), [['projects.update', 'project'], ['requirements.update', 'requirement'], ['requirements.update', 'closed']])
  assert.deepEqual(before.projects[0].modules, ['报价模块', '库存模块'])
})

test('linked module deletion requires an exact confirmed scope and cannot be bypassed by editing the project', () => {
  const f = fixture()
  f.save('projects', { id: 'project', modules: ['报价模块', '库存模块'] })
  f.save('requirements', { id: 'requirement', module: '报价模块' })
  const before = structuredClone(f.state)
  const remove = { type: 'project-module', projectId: 'project', action: 'delete', name: '报价模块', targetModule: '', confirmedRequirementIds: ['requirement'], reason: '确认删除模块' }
  for (const command of [
    { ...remove, confirmedRequirementIds: undefined },
    { ...remove, confirmedRequirementIds: [] },
    { ...remove, confirmedRequirementIds: ['missing'] },
    { ...remove, confirmedRequirementIds: ['requirement', 'missing'] },
    { ...remove, confirmedRequirementIds: ['requirement', 'requirement'] },
    { ...remove, targetModule: '不存在模块' },
    { ...remove, targetModule: '报价模块' },
    { ...remove, reason: '' },
    { ...remove, name: '不存在模块' },
    { ...remove, action: undefined },
    { ...remove, action: 'unknown' },
    { type: 'upsert', entity: 'projects', value: { id: 'project', modules: ['库存模块'] } },
    { type: 'upsert', entity: 'projects', value: { id: 'project', modules: ['新报价模块', '库存模块'] } }
  ]) {
    assert.throws(() => applyManagementCommand(before, command))
    assert.deepEqual(f.state, before)
  }
  f.save('projects', { id: 'project', name: '更新项目名称' })
  assert.deepEqual(f.state.projects[0].modules, ['报价模块', '库存模块'])
})

test('confirmed module deletion transfers or clears associations and preserves requirements and accumulated hours', () => {
  for (const targetModule of ['', '库存模块']) {
    const f = fixture()
    f.save('projects', { id: 'project', modules: ['报价模块', '库存模块'] })
    f.save('requirements', { id: 'requirement', module: '报价模块' })
    f.save('efforts', { id: 'actual', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], week: '2026-11-02', hours: 12 })
    const before = structuredClone(f.state)
    const after = f.apply({ type: 'project-module', projectId: 'project', action: 'delete', name: '报价模块', targetModule, confirmedRequirementIds: ['requirement'], reason: '用户二次确认删除并处理需求归属' })
    assert.deepEqual(after.projects[0].modules, ['库存模块'])
    assert.deepEqual(after.requirements, before.requirements.map(row => ({ ...row, module: targetModule })))
    for (const entity of ['people', 'versions', 'tasks', 'plans', 'efforts', 'baselines', 'snapshots']) assert.deepEqual(after[entity], before[entity])
    assert.deepEqual(getVersionSummary(after, 'version'), getVersionSummary(before, 'version'))
    assert.deepEqual(getRequirementWork(after, 'requirement'), getRequirementWork(before, 'requirement'))
    assert.equal(after.audit.at(-1).action, 'requirements.update')
  }
})

test('only explicitly configured modules can be renamed or deleted and old requirement labels remain separate', () => {
  const f = fixture()
  f.save('requirements', { id: 'requirement', module: '历史模块' })
  assert.deepEqual(getProjectModules(f.state, 'project'), [])
  assert.throws(() => f.apply({ type: 'project-module', projectId: 'project', action: 'rename', name: '历史模块', newName: '报价模块' }), /模块不存在/)
  assert.throws(() => f.apply({ type: 'project-module', projectId: 'project', action: 'delete', name: '历史模块', targetModule: '', confirmedRequirementIds: ['requirement'], reason: '清理分类' }), /模块不存在/)
  f.apply({ type: 'project-module', projectId: 'project', action: 'create', name: ' 历史模块 ' })
  assert.deepEqual(f.state.projects[0].modules, ['历史模块'])
  assert.equal(f.state.requirements[0].module, '历史模块')
  assert.throws(() => f.apply({ type: 'project-module', projectId: 'project', action: 'create', name: '历史模块' }), /已存在/)
  f.apply({ type: 'project-module', projectId: 'project', action: 'create', name: '未使用模块' })
  f.apply({ type: 'project-module', projectId: 'project', action: 'delete', name: '未使用模块', targetModule: '', confirmedRequirementIds: [], reason: '删除空模块' })
  assert.deepEqual(f.state.projects[0].modules, ['历史模块'])
  f.save('requirements', { id: 'legacy', projectId: 'project', title: '未登记模块的历史需求', module: '旧模块' })
  assert.throws(() => f.apply({ type: 'project-module', projectId: 'project', action: 'rename', name: '旧模块', newName: '登记后的模块' }), /模块不存在/)
  f.apply({ type: 'project-module', projectId: 'project', action: 'create', name: '旧模块' })
  f.apply({ type: 'project-module', projectId: 'project', action: 'rename', name: '旧模块', newName: '登记后的模块' })
  assert.deepEqual(f.state.projects[0].modules, ['历史模块', '登记后的模块'])
  assert.equal(f.state.requirements[1].module, '登记后的模块')
  f.save('requirements', { id: 'legacy-2', projectId: 'project', title: '另一条历史需求', module: '待整理旧模块' })
  f.apply({ type: 'project-module', projectId: 'project', action: 'create', name: '待整理旧模块' })
  f.apply({ type: 'project-module', projectId: 'project', action: 'delete', name: '待整理旧模块', targetModule: '历史模块', confirmedRequirementIds: ['legacy-2'], reason: '整理历史模块归属' })
  assert.equal(f.state.requirements[2].module, '历史模块')
  assert.deepEqual(f.state.projects[0].modules, ['历史模块', '登记后的模块'])
})

test('module name validation prevents accidental merges and rolls back a failed batch', () => {
  const f = fixture()
  f.save('projects', { id: 'project', modules: ['报价模块', '库存模块'] })
  f.save('requirements', { id: 'requirement', module: '未登记历史模块' })
  const before = structuredClone(f.state)
  for (const newName of ['', '报价模块', '库存模块', '未登记历史模块', 'x'.repeat(501)]) assert.throws(() => f.apply({ type: 'project-module', projectId: 'project', action: 'rename', name: '报价模块', newName }))
  for (const name of ['', 'x'.repeat(501)]) assert.throws(() => f.apply({ type: 'project-module', projectId: 'project', action: 'create', name }))
  assert.throws(() => f.apply({ type: 'project-module', projectId: 'missing', action: 'create', name: '新模块' }))
  assert.throws(() => f.apply({ type: 'batch', commands: [
    { type: 'project-module', projectId: 'project', action: 'create', name: '新模块' },
    { type: 'project-module', projectId: 'project', action: 'rename', name: '库存模块', newName: '新模块' }
  ] }))
  assert.deepEqual(f.state, before)
})

test('module rename and confirmed deletion back up previous associations before persisting', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-modules-'))
  try {
    const f = fixture()
    f.save('projects', { id: 'project', modules: ['报价模块'] })
    f.save('requirements', { id: 'requirement', module: '报价模块' })
    let saved = structuredClone(f.state)
    const service = new ManagementService({ directory, get: () => structuredClone(saved), set: (_key, data) => { saved = structuredClone(data) } })
    const before = service.read()
    const renamed = service.mutate({ revision: before.revision, command: { type: 'project-module', projectId: 'project', action: 'rename', name: '报价模块', newName: '报价中心' } })
    const after = service.mutate({ revision: renamed.revision, command: { type: 'project-module', projectId: 'project', action: 'delete', name: '报价中心', targetModule: '', confirmedRequirementIds: ['requirement'], reason: '确认删除' } })
    assert.equal(after.requirements[0].module, '')
    const backups = fs.readdirSync(path.join(directory, 'management-backups')).map(file => JSON.parse(fs.readFileSync(path.join(directory, 'management-backups', file), 'utf8'))).sort((a, b) => a.revision - b.revision)
    assert.deepEqual(backups, [before, renamed])
    assert.deepEqual(service.read(), after)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('failed persistence restores previous in-memory data and revision', () => {
  let saved = emptyManagementState(), fail = false
  const service = new ManagementService({ directory: os.tmpdir(), get: () => structuredClone(saved), set: (_key, data) => { saved = structuredClone(data); if (fail) { fail = false; throw new Error('simulated write failure') } } })
  fail = true
  assert.throws(() => service.mutate({ revision: 0, command: { type: 'upsert', entity: 'projects', value: { name: '写入失败项目' } } }), /simulated write failure/)
  assert.equal(service.read().revision, 0)
  assert.equal(service.read().projects.length, 0)
})

test('SQLite service preserves existing Git settings, checks revisions, persists reload and backs up restore', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-management-'))
  try {
    const store = new Store(directory); await store.init()
    store.set('projects', [{ id: 'git-project', name: 'Git仓库', path: '/sample' }]); store.set('settings', { gitPath: 'custom-git' })
    const service = new ManagementService(store), initial = service.read()
    assert.equal(initial.revision, 0)
    assert.ok(fs.readdirSync(path.join(directory, 'management-backups')).some(n => n.endsWith('.sqlite')))
    const updated = service.mutate({ revision: 0, command: { type: 'upsert', entity: 'projects', value: { name: '业务项目' } } })
    assert.equal(updated.revision, 1)
    assert.throws(() => service.mutate({ revision: 0, command: { type: 'snapshot', week: '2026-11-02' } }), /已更新/)
    const reopenedStore = new Store(directory); await reopenedStore.init()
    const reopened = new ManagementService(reopenedStore)
    assert.equal(reopened.read().projects[0].name, '业务项目')
    assert.equal(reopenedStore.get('settings', {}).gitPath, 'custom-git')
    assert.equal(reopenedStore.get('projects', [])[0].id, 'git-project')
    const backup = reopened.backup()
    assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).revision, 1)
    const restored = reopened.restore(initial, 1)
    assert.equal(restored.revision, 2)
    assert.equal(restored.projects.length, 0)
    assert.ok(restored.audit.some(a => a.action === 'backup.restore'))
    assert.equal(reopenedStore.get(MANAGEMENT_STORAGE_KEY, {}).revision, 2)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('backup history paginates newest first, recognizes old files and reports damaged backups without changing data', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-backup-history-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const original = fixture().state
  let saved = structuredClone(original)
  const service = new ManagementService({ directory, get: () => saved, set: (_key, value) => { saved = structuredClone(value) } }, 'browser')
  const empty = service.listBackups()
  assert.equal(empty.storage, 'browser')
  assert.equal(empty.dataFile, path.join(directory, 'management.json'))
  assert.equal(empty.directory, path.join(directory, 'management-backups'))
  assert.deepEqual(empty.records, [])
  assert.equal(empty.total, 0)
  assert.equal(empty.page, 1)
  const record = service.createBackup()
  assert.equal(record.source, 'manual')
  assert.equal(record.valid, true)
  assert.equal(record.revision, original.revision)
  assert.deepEqual(record.counts, { projects: 1, requirements: 1, plans: 0, efforts: 0 })
  assert.deepEqual(service.readBackup(record.id), original)
  assert.deepEqual(saved, original)
  const ids = [record.id]
  for (let index = 1; index < 11; index++) ids.push(path.basename(service.backup()))
  const legacy = 'management-2026-10-19T01-00-00-000Z.json', damaged = 'management-broken.json'
  fs.writeFileSync(path.join(empty.directory, legacy), JSON.stringify(original), 'utf8')
  fs.writeFileSync(path.join(empty.directory, damaged), '{invalid', 'utf8')
  ids.push(legacy, damaged)
  ids.forEach((id, index) => { const time = new Date(1700000000000 + index * 1000); fs.utimesSync(path.join(empty.directory, id), time, time) })
  fs.writeFileSync(path.join(empty.directory, 'before-management.sqlite'), 'unrelated')
  fs.mkdirSync(path.join(empty.directory, 'management-folder.json'))
  const page1 = service.listBackups(), page2 = service.listBackups(2)
  assert.equal(page1.total, 13)
  assert.equal(page1.pageSize, 10)
  assert.deepEqual([...page1.records, ...page2.records].map(item => item.id), ids.slice().reverse())
  assert.equal(service.listBackups(999).page, 2)
  assert.equal(page1.records[0].valid, false)
  assert.equal(page1.records[0].counts, null)
  assert.ok(page1.records[0].error)
  assert.equal(page1.records[1].source, 'history')
  assert.equal(page1.records[1].valid, true)
  for (const page of [0, -1, 1.5, NaN, '1']) assert.throws(() => service.listBackups(page), /页码/)
  fs.writeFileSync(path.join(empty.directory, damaged), JSON.stringify(original), 'utf8')
  assert.equal(service.listBackups().records.find(item => item.id === damaged).valid, true)
  assert.deepEqual(saved, original)
})

test('restoring a saved backup preserves current SQLite data first and rejects stale, unsafe or damaged records', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-backup-restore-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const store = new Store(directory)
  await store.init()
  store.set('settings', { gitPath: 'custom-git' })
  store.set(MANAGEMENT_STORAGE_KEY, fixture().state)
  const service = new ManagementService(store), original = service.read(), record = service.createBackup()
  const updated = service.mutate({ revision: original.revision, command: { type: 'upsert', entity: 'projects', value: { id: 'project', name: 'Changed project' } } })
  const damaged = path.join(directory, 'management-backups', 'management-broken.json')
  fs.writeFileSync(damaged, '{invalid', 'utf8')
  assert.throws(() => service.restoreBackup(record.id, original.revision), /已更新/)
  assert.throws(() => service.restoreBackup(path.basename(damaged), updated.revision))
  for (const id of ['../management.json', '..\\management.json', record.id + '/..', 'management-missing.json']) assert.throws(() => service.readBackup(id))
  const oversized = path.join(directory, 'management-backups', 'management-oversized.json')
  fs.closeSync(fs.openSync(oversized, 'w'))
  fs.truncateSync(oversized, 30 * 1024 * 1024 + 1)
  assert.throws(() => service.readBackup(path.basename(oversized)), /30 MB/)
  assert.deepEqual(service.read(), updated)
  assert.equal(service.listBackups().total, 3)
  const restored = service.restoreBackup(record.id, updated.revision)
  assert.equal(restored.revision, updated.revision + 1)
  assert.deepEqual(restored.projects, original.projects)
  assert.ok(restored.audit.some(entry => entry.action === 'backup.restore'))
  const protection = service.listBackups().records.find(item => item.source === 'automatic' && item.revision === updated.revision)
  assert.ok(protection)
  assert.deepEqual(service.readBackup(protection.id), updated)
  const reopenedStore = new Store(directory)
  await reopenedStore.init()
  assert.deepEqual(new ManagementService(reopenedStore).read(), restored)
  assert.equal(reopenedStore.get('settings', {}).gitPath, 'custom-git')
  assert.equal(service.listBackups().dataFile, path.join(directory, 'workbench.sqlite'))
})
