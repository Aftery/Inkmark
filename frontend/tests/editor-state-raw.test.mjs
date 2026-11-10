// 回归契约：多标签页的 EditorState 不得落进 Vue 的深层响应式代理。
//
// 2026-11-10 真机缺陷：切一次标签后 WYSIWYG 即时渲染永久失效。
// 根因链：sessions 是 ref([]) → 读取 session.state 得到 Vue 代理 →
// view.setState(代理) → CodeMirror 的 viewPlugin facet 取到代理后的 spec →
// view.plugin(spec) 用对象身份（===）查找失败 → 该 ViewPlugin 的装饰不再应用。
// 表格等 StateField 装饰不受影响，所以肉眼看起来只有「即时渲染掉了」。
//
// 这份契约把「state 必须 markRaw」钉在源码层：漏一处就会在切标签时静默复发。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { stripComments } from './helpers/lexer.mjs'

const FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', 'src', 'composables', 'useEditorSession.js',
)
const code = stripComments(readFileSync(FILE, 'utf8'))

test('会话 state 的每次赋值都必须走 rawState / markRaw', () => {
  const assigns = [...code.matchAll(/\.state\s*=\s*([^\n;]+)/g)].map((m) => m[0].trim())
  const unwrapped = assigns.filter((line) => !/rawState\(|markRaw\(/.test(line))
  assert.deepEqual(
    unwrapped,
    [],
    `发现未 markRaw 的 state 赋值（切标签后 ViewPlugin 装饰会静默失效）：\n${unwrapped.join('\n')}`,
  )
})

test('会话创建与 EditorView 挂载也必须 markRaw', () => {
  assert.match(code, /state:\s*rawState\(createEditorState\(/)
  assert.match(code, /editorRef\.value = markRaw\(view\)/)
})
