const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

const url = process.env.WORKBENCH_WEB_URL || 'http://127.0.0.1:5173'
const output = path.resolve(__dirname, '../output/playwright')
const errors = []
function track(page) {
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'warning' && /resolve component|resolve directive/.test(message.text())) errors.push(message.text())
  })
}
async function assertComponents(page) {
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('*')].filter(node => node.tagName.startsWith('EL-')).map(node => node.tagName)), [])
}
async function catalog(page) {
  const home = page.getByRole('button', { name: '全部工具', exact: false }).first()
  if (!await home.isVisible()) await page.getByRole('button', { name: '切换导航', exact: true }).click()
  await home.click()
}
async function snapshot(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' }) }

async function main() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport }); track(page)
      await page.goto(url)
      await page.locator('.tool-card').first().waitFor()
      assert.equal(await page.locator('.tool-card').count(), 10)
      await snapshot(page, `verified-home-${viewport.width}`)
      await page.locator('.tool-title').filter({ hasText: 'JSON' }).click()
      await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).fill('{"big":90071992547409931234}')
      await page.getByRole('button', { name: '格式化', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.cm-content[aria-label="处理结果"]')?.textContent.includes('90071992547409931234'))
      const box = await page.getByRole('textbox', { name: '处理结果', exact: true }).boundingBox()
      assert.ok(box.width > 100 && box.height > 40)
      await page.getByRole('button', { name: '放大结果', exact: true }).click()
      assert.equal(await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).isVisible(), false)
      await page.getByRole('button', { name: '恢复双栏', exact: true }).click()
      await page.getByRole('tab', { name: '结构', exact: true }).click()
      await page.getByRole('button', { name: '打开工具', exact: true }).click()
      await page.getByRole('combobox', { name: '搜索工具和操作', exact: true }).fill('time')
      await page.getByRole('combobox', { name: '搜索工具和操作', exact: true }).press('Enter')
      await page.getByRole('heading', { name: '时间戳工作台', exact: true }).waitFor()
      await page.getByRole('navigation', { name: '打开的工具', exact: true }).getByRole('button', { name: 'JSON 工作台', exact: true }).click()
      await page.getByRole('tab', { name: '结构', exact: true }).waitFor()
      assert.equal(await page.getByRole('tab', { name: '结构', exact: true }).getAttribute('aria-selected'), 'true')
      assert.match(await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).innerText(), /90071992547409931234/)
      await assertComponents(page)
      await snapshot(page, `verified-json-${viewport.width}`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await catalog(page)
      await page.locator('.tool-title').filter({ hasText: '文本工作台' }).click()
      await page.getByRole('textbox', { name: '文本输入', exact: true }).fill('alpha\nalpha\n beta ')
      await page.getByRole('button', { name: '去重', exact: true }).click()
      assert.equal(await page.getByRole('textbox', { name: '处理结果', exact: true }).inputValue(), 'alpha\nbeta')
      await catalog(page)
      await page.locator('.tool-title').filter({ hasText: '时间戳' }).click()
      await page.getByRole('textbox', { name: 'Unix 时间戳', exact: true }).fill('0')
      await page.getByRole('button', { name: '转换', exact: true }).first().click()
      await page.locator('.conversion-results').waitFor()
      assert.match(await page.locator('.conversion-results').innerText(), /1970-01-01T00:00:00.000Z/)
      await page.getByRole('button', { name: '工作台设置', exact: true }).click()
      await page.getByRole('textbox', { name: 'Git 可执行文件路径', exact: true }).fill('unsaved-git-draft')
      await page.getByRole('textbox', { name: '保护分支规则', exact: true }).fill('unsaved-protection-draft')
      await page.getByRole('button', { name: '切换为深色', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('workbench-preview')).settings.theme === 'dark')
      await page.locator('.el-radio-button.is-active input[value="dark"]').waitFor({ state: 'attached' })
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(25, 27, 31)')
      assert.equal(await page.getByRole('textbox', { name: 'Git 可执行文件路径', exact: true }).inputValue(), 'unsaved-git-draft')
      assert.equal(await page.getByRole('textbox', { name: '保护分支规则', exact: true }).inputValue(), 'unsaved-protection-draft')
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('workbench-preview')).settings.gitPath), 'git')
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('workbench-preview')).settings.protectedBranches), ['main', 'master', 'develop', 'release/*'])
      await assertComponents(page)
      await snapshot(page, `verified-settings-${viewport.width}`)
      await catalog(page)
      await page.locator('.tool-title').filter({ hasText: 'JSON' }).click()
      await page.getByRole('textbox', { name: 'JSON 输入', exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
      await page.reload()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      await page.getByRole('button', { name: '工作台设置', exact: true }).click()
      await page.locator('.el-radio-button').filter({ hasText: '浅色' }).click()
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && JSON.parse(localStorage.getItem('workbench-preview')).settings.theme === 'light')
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(246, 247, 249)')
      await page.close()
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); track(page)
    // Exercise the native-facing renderer without modifying an actual repository.
    await page.addInitScript(() => {
      const project = { id: 'qa', name: 'qa-project', path: 'C:/qa/project', addedAt: new Date().toISOString() }
      const state = { projects: [], favorites: [], recent: [], settings: { gitPath: 'git', protectedBranches: ['main'], theme: 'light' }, history: [], dataPath: 'C:/qa/data', version: '0.1.2', desktop: true }
      const branch = { hash: 'a'.repeat(40), subject: 'initial', author: 'QA', date: new Date().toISOString(), upstream: '', ahead: 0, behind: 0, kind: 'local', remote: '', remoteBranch: '', merged: true }
      const detail = { current: 'main', dirty: 0, baseRef: 'refs/heads/main', remotes: [], detached: false, branches: [
        { ...branch, ref: 'refs/heads/main', name: 'main', current: true, protected: true, occupied: true },
        { ...branch, ref: 'refs/heads/feature', name: 'feature', current: false, protected: false, occupied: false }
      ] }
      window.toolbox = {
        state: async () => structuredClone(state), addProject: async () => { state.projects = [project]; return project },
        inspect: async () => structuredClone(detail), visit: async () => {}, fetch: async () => {},
        saveSettings: async settings => { state.settings = structuredClone(settings) },
        deleteBranches: async request => {
          detail.branches = detail.branches.filter(b => !request.refs.includes(b.ref))
          return request.refs.map(ref => ({ ref, success: true, message: '已删除' }))
        }
      }
    })
    await page.goto(url)
    await page.locator('.sidebar .nav-item').filter({ hasText: 'Git 项目管理' }).click()
    await page.getByRole('button', { name: '添加项目', exact: true }).first().click()
    await page.locator('.branch-table').waitFor()
    await page.locator('.branch-table .el-table__body tr').filter({ hasText: 'feature' }).locator('.el-checkbox').click()
    await page.getByRole('button', { name: '删除分支', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('button', { name: '删除 1 个分支', exact: true }).click()
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('dialog', { name: '确认删除分支', exact: true }).waitFor({ state: 'hidden' })
    await page.getByRole('dialog', { name: '删除结果', exact: true }).waitFor({ state: 'hidden' })
    await page.locator('.branch-table .el-loading-mask').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('.branch-table .el-table__body tr').count(), 1)
    await assertComponents(page)
    await snapshot(page, 'verified-git')
    await page.locator('.sidebar-bottom .nav-item').filter({ hasText: '设置' }).click()
    await page.locator('.el-radio-button').filter({ hasText: '深色' }).click()
    await page.waitForFunction(async () => (await window.toolbox.state()).settings.theme === 'dark')
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(25, 27, 31)')
    await page.evaluate(() => { window.toolbox.saveSettings = async () => { throw new Error('simulated theme save failure') } })
    await page.locator('.el-radio-button').filter({ hasText: '浅色' }).click()
    await page.locator('.el-message--error').filter({ hasText: 'simulated theme save failure' }).waitFor()
    await page.locator('.el-radio-button.is-active input[value="dark"]').waitFor({ state: 'attached' })
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
    assert.equal(await page.evaluate(async () => (await window.toolbox.state()).settings.theme), 'dark')
    assert.deepEqual(errors, [])
    console.log('Web smoke passed: 1440px/390px, async tools, lossless JSON, text, timestamps, immediate theme persistence, draft isolation, theme rollback, registered components, and mocked Git deletion.')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
