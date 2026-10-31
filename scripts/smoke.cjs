const { _electron: electron, chromium } = require('playwright')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const execute = promisify(execFile)
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'output', 'playwright')
const git = async (cwd, ...args) => (await execute('git', args, { cwd, windowsHide: true })).stdout.trim()
const text = {
  home: '\u5168\u90e8\u5de5\u5177', git: 'Git \u9879\u76ee\u7ba1\u7406', add: '\u6dfb\u52a0\u9879\u76ee',
  json: 'JSON \u5de5\u4f5c\u53f0', format: '\u683c\u5f0f\u5316', jsonInput: 'JSON \u8f93\u5165', result: '\u5904\u7406\u7ed3\u679c',
  text: '\u6587\u672c\u53bb\u91cd', textInput: '\u6587\u672c\u8f93\u5165', dedupe: '\u53bb\u91cd', time: '\u65f6\u95f4\u6233\u8f6c\u6362',
  timestamp: 'Unix \u65f6\u95f4\u6233', convert: '\u8f6c\u6362', settings: '\u8bbe\u7f6e', save: '\u4fdd\u5b58\u8bbe\u7f6e', dark: '\u6df1\u8272', light: '\u6d45\u8272',
  delete: '\u5220\u9664\u5206\u652f', confirmDelete: '\u5220\u9664 1 \u4e2a\u5206\u652f', completed: '\u5b8c\u6210'
}
async function waitText(page, selector, expected) { await page.waitForFunction(({selector, expected}) => document.querySelector(selector)?.value.includes(expected), {selector,expected}) }
async function main() {
  await fs.mkdir(output, { recursive: true })
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-ui-'))
  const repo = path.join(temp, 'sample-project'); await fs.mkdir(repo)
  await git(repo, 'init', '--initial-branch=main'); await git(repo, 'config', 'user.name', 'Workbench QA'); await git(repo, 'config', 'user.email', 'qa@example.invalid')
  await fs.writeFile(path.join(repo, 'readme.txt'), 'sample'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'Initialize workspace')
  await git(repo, 'branch', 'ai/completed-task'); await git(repo, 'branch', 'release/1.0')
  await git(repo, 'switch', '-c', 'feature/new-tool'); await fs.writeFile(path.join(repo, 'new.txt'), 'feature'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'Add a new utility'); await git(repo, 'switch', 'main')
  const env = { ...process.env, WORKBENCH_DATA_DIR: path.join(temp, 'data') }; delete env.ELECTRON_RUN_AS_NODE; delete env.WORKBENCH_DEV_URL
  const executablePath = process.env.WORKBENCH_EXE || require('electron')
  let desktop
  const errors = []
  try {
    desktop = await electron.launch({ executablePath, args: process.env.WORKBENCH_EXE ? [] : [root], env, timeout: 60000 })
    const page = await desktop.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.screenshot({ path: path.join(output, 'desktop-home.png'), fullPage: true })
    assert.equal(await page.locator('.tool-card').count(), 4)
    await page.locator('.favorite-button').first().click()
    await page.locator('.nav-item').filter({ hasText: '\u6211\u7684\u6536\u85cf' }).click()
    assert.equal(await page.locator('.tool-card').count(), 1)
    await page.getByRole('button', { name: text.home, exact: false }).first().click()
    await page.locator('.tool-title').filter({ hasText: text.json }).click()
    await page.getByRole('textbox', { name: text.jsonInput, exact: true }).fill('{"big":90071992547409931234,"name":"\\u4e2d\\u6587"}')
    await page.getByRole('button', { name: text.format, exact: true }).click()
    await waitText(page, 'textarea[aria-label="' + text.result + '"]', '90071992547409931234')
    await page.screenshot({ path: path.join(output, 'desktop-json.png'), fullPage: true })
    await page.getByRole('textbox', { name: text.jsonInput, exact: true }).fill('{broken')
    await page.getByRole('button', { name: text.format, exact: true }).click(); await page.locator('.el-alert--error').waitFor()
    await page.getByRole('button', { name: text.home, exact: false }).first().click()
    await page.locator('.tool-title').filter({ hasText: text.text }).click()
    await page.getByRole('textbox', { name: text.textInput, exact: true }).fill('alpha\nalpha\n beta \n\nBeta')
    await page.getByRole('button', { name: text.dedupe, exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: text.result, exact: true }).inputValue(), 'alpha\nbeta\nBeta')
    await page.getByRole('button', { name: text.home, exact: false }).first().click()
    await page.locator('.tool-title').filter({ hasText: text.time }).click()
    await page.getByRole('textbox', { name: text.timestamp, exact: true }).fill('0')
    await page.getByRole('button', { name: text.convert, exact: true }).first().click()
    await page.locator('.conversion-results').waitFor(); assert.match(await page.locator('.conversion-results').innerText(), /1970-01-01T00:00:00.000Z/)
    await page.locator('.nav-item').filter({ hasText: text.git }).click()
    await desktop.evaluate(({dialog}, repo) => { dialog.showOpenDialog = async () => ({canceled:false, filePaths:[repo]}) }, repo)
    await page.getByRole('button', { name: text.add, exact: true }).first().click()
    await page.locator('.branch-table').waitFor()
    assert.equal(await page.locator('.branch-table .el-table__body tr').count(), 4)
    await page.screenshot({ path: path.join(output, 'desktop-git.png'), fullPage: true })
    const row = page.locator('.branch-table .el-table__body tr').filter({hasText:'ai/completed-task'})
    await row.locator('.el-checkbox').click()
    await page.getByRole('button', {name:text.delete,exact:true}).click()
    await page.getByRole('dialog').waitFor()
    await page.screenshot({path:path.join(output,'desktop-delete.png'),fullPage:true})
    await page.getByRole('button',{name:text.confirmDelete,exact:true}).click()
    await page.getByRole('button',{name:text.completed,exact:true}).waitFor({timeout:30000})
    assert.equal(await git(repo,'for-each-ref','--format=%(refname)','refs/heads/ai/completed-task'),'')
    await page.getByRole('button',{name:text.completed,exact:true}).click()
    await page.locator('.nav-item').filter({hasText:text.settings}).click()
    await page.locator('.el-radio-button').filter({hasText:text.dark}).click()
    await page.getByRole('button',{name:text.save,exact:true}).click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await page.waitForFunction(() => document.querySelector('input[type="radio"][value="dark"]')?.checked)
    await page.locator('.el-radio-button.is-active input[value="dark"]').waitFor({state:'attached'})
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(24, 27, 29)')
    await page.screenshot({path:path.join(output,'desktop-settings-dark.png'),fullPage:true,animations:'disabled'})
    await page.locator('.el-radio-button').filter({hasText:text.light}).click(); await page.getByRole('button',{name:text.save,exact:true}).click()
    const state = await page.evaluate(() => window.toolbox.state())
    assert.equal(state.projects.length,1); assert.equal(state.history.length,1); assert.equal(state.favorites[0],'git')
    assert.deepEqual(errors,[])
    console.log('Desktop smoke passed: catalog, favorites, lossless JSON, invalid JSON, text, timestamps, native project picker, branches, deletion, settings, SQLite.')
  } finally { if (desktop) await desktop.close(); await fs.rm(temp,{recursive:true,force:true}) }
  if (process.env.WORKBENCH_WEB_URL) {
    const browser = await chromium.launch({channel:'msedge',headless:true})
    try {
      for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
        const page = await browser.newPage({viewport})
        await page.goto(process.env.WORKBENCH_WEB_URL)
        await page.locator('.tool-card').first().waitFor()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false)
        await page.screenshot({path:path.join(output,`web-${viewport.width}.png`),fullPage:true})
        await page.close()
      }
      console.log('Browser screenshots passed: 1440px and 390px, no horizontal overflow.')
    } finally { await browser.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
