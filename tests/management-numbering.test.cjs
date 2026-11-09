const { test } = require('node:test')
const assert = require('node:assert/strict')
const { emptyManagementState, applyManagementCommand, validateManagementState } = require('../dist-electron/shared/management.js')
const { extractRequirementCode, prepareManagementNumberingBackfill } = require('../dist-electron/shared/management-numbering.js')
const { createManagementWorkbook } = require('../dist-electron/shared/management-spreadsheet.js')

function fixture() {
  let state = emptyManagementState(), serial = 0
  const apply = command => { state = applyManagementCommand(state, command, '2026-11-08T10:00:00Z', () => `generated-${++serial}`); return state }
  const save = (entity, value) => apply({ type: 'upsert', entity, value })
  save('projects', { id: 'project', name: '4.0项目' })
  save('people', { id: 'person', name: '开发人员', roles: ['frontend'] })
  save('versions', { id: 'version', projectId: 'project', code: 'v1', name: '首期' })
  const requirement = (id = 'requirement', value = {}) => { save('requirements', { id, projectId: 'project', versionId: 'version', title: '功能', ...value }); return state.requirements.find(item => item.id === id) }
  return { get state() { return state }, apply, save, requirement }
}

test('existing TAPD, sales and foundation identifiers are extracted without losing leading zeros', () => {
  for (const [source, code, title] of [
    ['TAPD-0124 · 设置入口与系列显示', 'TAPD-0124', '设置入口与系列显示'],
    ['销260518-33 · 客户名称默认取公司名称', '销260518-33', '客户名称默认取公司名称'],
    ['BASE-01 · 工程初始化、接口契约与公共基础', 'BASE-01', '工程初始化、接口契约与公共基础'],
    ['tapd 0009：需求名称', 'TAPD-0009', '需求名称'],
    ['【REQ-000009】需求名称', 'REQ-000009', '需求名称'],
    ['TAPD-0124', 'TAPD-0124', 'TAPD-0124'],
  ]) assert.deepEqual(extractRequirementCode(source), { code, title })
  for (const title of ['4.0项目', '2026/11/02 排期', 'ES搜索优化', '功能中的 TAPD-0124 引用', 'feature-toggle']) assert.equal(extractRequirementCode(title), null)
})

test('projects and requirements receive separate sequential identifiers and support manual codes', () => {
  const f = fixture()
  assert.equal(f.state.projects[0].code, 'PRJ-0001')
  f.save('projects', { id: 'manual-project', code: 'prj-0008', name: '手动编号项目' })
  f.save('projects', { id: 'next-project', name: '下一项目' })
  assert.equal(f.state.projects[1].code, 'PRJ-0008')
  assert.equal(f.state.projects[2].code, 'PRJ-0009')
  assert.equal(f.requirement().code, 'REQ-000001')
  const external = f.requirement('external', { title: 'TAPD-0124 · 设置入口' })
  assert.equal(external.code, 'TAPD-0124')
  assert.equal(external.title, '设置入口')
  assert.equal(f.requirement('next').code, 'REQ-000002')
  assert.equal(f.state.versions[0].code, 'v1')
})

test('editing titles, moving projects, and submitting blank identifiers retain established numbers', () => {
  const f = fixture(), original = f.requirement('requirement', { title: '销260325-06 · 批量导入' })
  f.save('projects', { id: 'other', name: '另一项目' })
  f.save('requirements', { id: original.id, title: '修改后的名称', code: '', projectId: 'other', versionId: '' })
  assert.equal(f.state.requirements[0].code, '销260325-06')
  f.save('projects', { id: 'project', code: '', name: '修改后的项目' })
  assert.equal(f.state.projects[0].code, 'PRJ-0001')
  const own = f.requirement('own', { code: 'my-001', title: '自定义需求' })
  assert.equal(own.code, 'MY-001')
  validateManagementState(f.state)
})

test('identifiers are unique across active and archived records, with atomic conflict rejection', () => {
  const f = fixture(); f.requirement('existing', { code: 'tapd-0001' })
  f.save('projects', { id: 'project', status: 'archived' })
  const before = structuredClone(f.state)
  assert.throws(() => f.save('projects', { name: '冲突项目', code: 'prj-0001' }), /项目编号重复/)
  assert.throws(() => f.requirement('duplicate', { code: 'TAPD-0001' }), /需求编号重复/)
  assert.throws(() => f.apply({ type: 'batch', commands: [
    { type: 'upsert', entity: 'requirements', value: { id: 'new', projectId: 'project', title: '新增需求' } },
    { type: 'upsert', entity: 'requirements', value: { id: 'duplicate', projectId: 'project', title: 'TAPD-0001 · 冲突需求' } },
  ] }), /需求编号重复/)
  assert.deepEqual(f.state, before)
})

test('deleted or replaced generated identifiers are not silently reused', () => {
  const f = fixture(); f.requirement()
  f.apply({ type: 'delete', entity: 'requirements', id: 'requirement' })
  assert.equal(f.requirement('next').code, 'REQ-000002')
  f.save('requirements', { id: 'next', code: 'CUSTOM-1' })
  assert.equal(f.requirement('third').code, 'REQ-000003')
  f.save('projects', { id: 'standalone', name: '独立项目' })
  f.apply({ type: 'delete', entity: 'projects', id: 'standalone' })
  f.save('projects', { id: 'another', name: '新独立项目' })
  assert.equal(f.state.projects.find(item => item.id === 'another').code, 'PRJ-0003')
})

test('legacy backfill reserves embedded generated codes before filling missing identifiers', () => {
  const f = fixture(); f.requirement('missing'); f.requirement('embedded'); f.requirement('external')
  const raw = structuredClone(f.state)
  raw.audit = []
  delete raw.projects[0].code
  raw.requirements.forEach(item => { delete item.code })
  raw.requirements[1].title = 'REQ-000001 · 已有系统编号'
  raw.requirements[2].title = 'TAPD-0124 · 原始需求'
  const legacy = validateManagementState(raw), before = structuredClone(legacy)
  const command = prepareManagementNumberingBackfill(legacy)
  assert.deepEqual(legacy, before)
  const after = applyManagementCommand(legacy, command)
  assert.equal(after.projects[0].code, 'PRJ-0001')
  assert.equal(after.requirements[0].code, 'REQ-000002')
  assert.equal(after.requirements[1].code, 'REQ-000001')
  assert.equal(after.requirements[1].title, '已有系统编号')
  assert.equal(after.requirements[2].code, 'TAPD-0124')
  assert.equal(after.requirements[2].title, '原始需求')
  for (const entity of ['tasks', 'plans', 'efforts', 'baselines', 'versions', 'people', 'snapshots']) assert.deepEqual(after[entity], before[entity])
  assert.equal(prepareManagementNumberingBackfill(after), null)
  assert.equal(after.audit[0].before.code, '')
})

test('legacy duplicate extracted codes fail without partially updating the original state', () => {
  const f = fixture(); f.requirement('first'); f.requirement('second')
  const state = structuredClone(f.state)
  state.requirements.forEach(item => { item.code = ''; item.title = 'TAPD-0001 · 重复来源' })
  const before = structuredClone(state)
  assert.throws(() => applyManagementCommand(state, prepareManagementNumberingBackfill(state)), /需求编号重复/)
  assert.deepEqual(state, before)
})

test('malformed identifier fields are rejected and legacy fields remain readable until migration', () => {
  const f = fixture()
  for (const code of [123, null, 'A B', 'bad\ncode', '<script>', '-100', 'X'.repeat(81)]) assert.throws(() => f.save('projects', { id: 'project', code }), /编号/)
  const raw = structuredClone(f.state); delete raw.projects[0].code
  const legacy = validateManagementState(raw)
  assert.equal(legacy.projects[0].code, '')
  assert.equal(raw.projects[0].code, undefined)
  f.save('projects', { id: 'project', code: '业务-001' })
  assert.equal(f.state.projects[0].code, '业务-001')
})

test('batch creation allocates different identifiers within the same transaction', () => {
  const f = fixture()
  f.apply({ type: 'batch', commands: ['a', 'b', 'c'].map(id => ({ type: 'upsert', entity: 'requirements', value: { id, projectId: 'project', title: id } })) })
  assert.deepEqual(f.state.requirements.map(item => item.code), ['REQ-000001', 'REQ-000002', 'REQ-000003'])
})

test('numbering leaves task, weekly effort and snapshot references intact and exports identifiers', () => {
  const f = fixture(); f.requirement('requirement', { title: 'TAPD-0124 · 设置入口' })
  f.save('tasks', { id: 'task', requirementId: 'requirement', name: '前端', role: 'frontend', stage: 'frontend' })
  f.save('plans', { id: 'plan', projectId: 'project', versionId: 'version', week: '2026-11-02', personId: 'person', role: 'frontend', stage: 'frontend', taskIds: ['task'], title: '前端组合', goal: '开发', plannedHours: 8, status: 'confirmed' })
  f.save('efforts', { id: 'effort', projectId: 'project', versionId: 'version', personId: 'person', role: 'frontend', stage: 'frontend', week: '2026-11-02', hours: 8, planId: 'plan', taskIds: ['task'] })
  f.apply({ type: 'snapshot', week: '2026-11-02' })
  const before = structuredClone(f.state)
  f.save('requirements', { id: 'requirement', code: 'CUSTOM-0124' })
  for (const entity of ['tasks', 'plans', 'efforts', 'baselines', 'snapshots']) assert.deepEqual(f.state[entity], before[entity])
  const workbook = createManagementWorkbook(f.state, '2026-11-02', 'week')
  for (const name of ['周排期与复盘', '功能排期对比', '角色排期对比']) {
    const sheet = workbook.getWorksheet(name), headers = sheet.getRow(1).values
    assert.equal(sheet.getRow(2).getCell(headers.indexOf('项目编号')).value, 'PRJ-0001')
    assert.equal(sheet.getRow(2).getCell(headers.indexOf('需求编号')).value, 'CUSTOM-0124')
  }
  assert.equal(f.state.snapshots[0].data.requirements[0].code, 'TAPD-0124')
})
