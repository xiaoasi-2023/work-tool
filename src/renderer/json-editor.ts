import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { linter, lintKeymap } from '@codemirror/lint'
import { parseJson } from '../shared/json'

const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--json-key)' },
  { tag: tags.string, color: 'var(--json-string)' },
  { tag: tags.number, color: 'var(--json-number)' },
  { tag: tags.bool, color: 'var(--json-bool)' },
  { tag: tags.null, color: 'var(--subtle)' },
  { tag: tags.punctuation, color: 'var(--muted)' }
])
export function editorExtensions(label: string, format: 'json' | 'yaml' = 'json'): Extension[] {
  return [
    format === 'yaml' ? yaml() : json(), history(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(),
    bracketMatching(), indentOnInput(), syntaxHighlighting(jsonHighlight), highlightSelectionMatches(),
    search({ top: true }), placeholder(format === 'yaml' ? '粘贴或导入 YAML…' : '粘贴或导入 JSON…'),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, ...lintKeymap]),
    EditorView.contentAttributes.of({ 'aria-label': label, role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' }),
    // Validate without converting large numeric values to JavaScript numbers.
    linter(view => {
      if (format === 'yaml') return []
      const text = view.state.doc.toString()
      if (!text.trim()) return []
      try { parseJson(text); return [] }
      catch (error) {
        const message = (error as Error).message
        const position = /position\s+(\d+)/i.exec(message)
        const from = Math.min(position ? Number(position[1]) : 0, text.length)
        return [{ from, to: Math.min(from + 1, text.length), severity: 'error', message }]
      }
    }, { delay: 400 }),
    EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)' }, '.cm-scroller': { fontFamily: "'Cascadia Code', Consolas, 'Microsoft YaHei UI', monospace", lineHeight: '1.7', overflow: 'auto' }, '.cm-content': { padding: '12px 0', minHeight: '100%' }, '.cm-line': { padding: '0 12px' }, '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--subtle)', borderRight: '1px solid var(--line)' }, '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--hover)' }, '&.cm-focused': { outline: 'none' }, '.cm-cursor': { borderLeftColor: 'var(--text)' }, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--accent-soft)' }, '.cm-panels': { backgroundColor: 'var(--bg)', color: 'var(--text)' }, '.cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--line)' }, '.cm-searchMatch': { backgroundColor: '#e8ba5155' }, '.cm-foldPlaceholder': { backgroundColor: 'var(--bg)', color: 'var(--muted)', borderColor: 'var(--line)' } }),
    EditorState.tabSize.of(2),
    EditorState.phrases.of({ 'Find': '查找', 'Replace': '替换', 'next': '下一项', 'previous': '上一项', 'all': '全部', 'match case': '区分大小写', 'regexp': '正则表达式', 'by word': '全字匹配', 'replace': '替换', 'replace all': '全部替换', 'close': '关闭', 'folded code': '已折叠代码', 'unfold': '展开', 'Fold line': '折叠行', 'Unfold line': '展开行', 'No diagnostics': '没有错误', 'Diagnostics': '校验结果' })
  ]
}
export function numberExtensions(show: boolean): Extension { return show ? [lineNumbers(), foldGutter()] : [] }
export function wrapExtensions(wrap: boolean): Extension { return wrap ? EditorView.lineWrapping : [] }
export function indentExtensions(indent: number | string): Extension { return indentUnit.of(typeof indent === 'number' ? ' '.repeat(indent) : indent) }
