const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseJson, printJson, sortJson, mutateJson, parseField, jsonKind, jsonPointer } = require('../dist-electron/shared/json.js')

test('formatting, sorting and field edits preserve large and decimal numbers', () => {
  const raw = '{"z":90071992547409931234,"nested":{"b":1.234567890123456789,"a":1e400},"a":[3,1,2]}'
  const sorted = printJson(sortJson(parseJson(raw)))
  assert.match(sorted, /90071992547409931234/)
  assert.match(sorted, /1\.234567890123456789/)
  assert.match(sorted, /1e400/)
  assert.ok(sorted.indexOf('"a"') < sorted.indexOf('"z"'))
  assert.deepEqual(parseJson(sorted).a.map(value => value.toString()), ['3', '1', '2'])
  const edited = mutateJson(raw, { action: 'edit', path: ['z'], key: 'id', value: parseField('999999999999999999999999', 'number') })
  assert.match(edited, /"id": 999999999999999999999999/)
  assert.equal(Object.hasOwn(parseJson(edited), 'z'), false)
})

test('nested array insertion, editing and deletion use actual indices', () => {
  const raw = '{"items":[{"name":"one"},{"name":"two"}]}'
  const added = mutateJson(raw, { action: 'add', path: ['items'], key: '1', value: parseJson('{"name":"inserted"}') })
  const edited = mutateJson(added, { action: 'edit', path: ['items', 1, 'name'], key: 'title', value: 'new value' })
  const deleted = mutateJson(edited, { action: 'delete', path: ['items', 0] })
  assert.deepEqual(parseJson(deleted), { items: [{ title: 'new value' }, { name: 'two' }] })
  assert.throws(() => mutateJson(raw, { action: 'add', path: ['items'], key: '5', value: null }), /范围/)
  assert.throws(() => mutateJson(raw, { action: 'add', path: ['items'], key: '1.5', value: null }), /索引/)
})

test('field operations reject collisions and do not pollute object prototypes', () => {
  const raw = '{"a":1,"b":2,"__proto__":{"safe":true}}'
  assert.throws(() => mutateJson(raw, { action: 'edit', path: ['a'], key: 'b', value: null }), /已存在/)
  assert.throws(() => mutateJson(raw, { action: 'add', path: [], key: 'a', value: null }), /已存在/)
  const edited = mutateJson(raw, { action: 'edit', path: ['a'], key: 'constructor', value: 'own value' })
  const parsed = parseJson(edited)
  assert.equal(Object.hasOwn(parsed, '__proto__'), true)
  assert.deepEqual(parsed.__proto__, { safe: true })
  assert.equal(parsed.constructor, 'own value')
  assert.equal(Object.prototype.safe, undefined)
  const added = mutateJson('{}', { action: 'add', path: [], key: '__proto__', value: parseJson('{"safe":true}') })
  assert.equal(Object.hasOwn(parseJson(added), '__proto__'), true)
  assert.throws(() => mutateJson('{}', { action: 'edit', path: ['__proto__', 'safe'], value: true }), /不存在/)
})

test('root values, explicit types, escaped paths and duplicate keys are handled', () => {
  assert.equal(mutateJson('{}', { action: 'edit', path: [], value: null }), 'null')
  assert.equal(jsonKind(parseField('true', 'boolean')), 'boolean')
  assert.equal(parseField('false', 'string'), 'false')
  assert.equal(jsonKind(parseField('0', 'number')), 'number')
  assert.throws(() => parseField('"123"', 'number'), /类型/)
  assert.throws(() => parseField('01', 'number'))
  assert.throws(() => mutateJson('{}', { action: 'delete', path: [] }), /根节点/)
  assert.throws(() => parseJson('{"duplicate":1,"duplicate":2}'))
  assert.equal(jsonPointer(['a/b', '~key', 0, '']), '/a~1b/~0key/0/')
})
