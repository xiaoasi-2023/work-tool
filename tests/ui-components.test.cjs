const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { createSSRApp, h, resolveComponent } = require('vue')
const { renderToString } = require('@vue/server-renderer')
const { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } = require('element-plus')

const file = path.resolve('src/renderer/element-components.ts')
const compiled = new Module(file, module)
compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file))
compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file)
const { registerElementComponents } = compiled.exports

function vueFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? vueFiles(path.join(directory, entry.name)) : entry.name.endsWith('.vue') ? [path.join(directory, entry.name)] : [])
}
function appFor(render) {
  const app = createSSRApp({ render })
  registerElementComponents(app)
  app.provide(ID_INJECTION_KEY, { prefix: 1024, current: 0 })
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 })
  return app
}

test('all Element Plus tags used by the application resolve to registered components', () => {
  const app = appFor(() => null), missing = []
  for (const file of vueFiles(path.resolve('src/renderer'))) {
    const source = fs.readFileSync(file, 'utf8')
    for (const [tag] of source.matchAll(/<el-[a-z-]+/g)) {
      const name = tag.slice(1).split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')
      if (!app.component(name)) missing.push(path.relative(process.cwd(), file) + ': ' + name)
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'Unregistered components can silently lose labels and controls in the browser')
})

test('website form controls render real labels, inputs, sort controls and dropdown buttons without a browser', async () => {
  const warnings = []
  const app = appFor(() => h(resolveComponent('ElForm'), { labelPosition: 'top' }, () => [
    h(resolveComponent('ElFormItem'), { label: '网站名称', required: true }, () => h(resolveComponent('ElInput'), { modelValue: 'GSAP v3 文档', 'aria-label': '网站名称' })),
    h(resolveComponent('ElFormItem'), { label: '分类内排序' }, () => h(resolveComponent('ElInputNumber'), { modelValue: 100, min: 0, max: 1000000, controlsPosition: 'right', 'aria-label': '分类内排序' })),
    h(resolveComponent('ElDropdown'), { trigger: 'click' }, { default: () => h('button', '更多操作'), dropdown: () => h(resolveComponent('ElDropdownMenu'), null, () => h(resolveComponent('ElDropdownItem'), { command: 'pinned' }, () => '置顶')) })
  ]))
  app.config.warnHandler = message => warnings.push(message)
  const html = await renderToString(app)
  assert.match(html, /el-form-item__label[^>]*>[\s\S]*?网站名称/)
  assert.match(html, /<input[^>]*type="text"[^>]*aria-label="网站名称"/)
  assert.match(html, /<input[^>]*max="1000000"[^>]*min="0"[^>]*type="number"/)
  assert.match(html, /aria-label="分类内排序"/)
  assert.match(html, /el-dropdown/)
  assert.match(html, /aria-haspopup="menu"/)
  assert.doesNotMatch(html, /<el-(?:form|form-item|input-number|dropdown)(?:\s|>)/i)
  assert.equal(warnings.some(message => /Failed to resolve component/.test(message)), false)
})
