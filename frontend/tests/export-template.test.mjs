// 导出模板契约：<html lang> 必须跟随界面语言，且不得被语言值注入破坏属性。
// 背景见 README「已知问题」#15：模板此前固定 lang="zh-CN"，
// 英文/日文界面导出的产物在断行、字体回退与屏幕朗读上仍是中文口径。
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildHtmlDocument } from '../src/export/exporters.js'

test('导出模板：<html lang> 跟随界面语言', () => {
  assert.match(
    buildHtmlDocument('文档', '<p>x</p>', 'light', '46rem', 'en-US'),
    /<html lang="en-US" data-theme="light">/,
  )
  assert.match(
    buildHtmlDocument('文档', '<p>x</p>', 'light', '46rem', 'ja-JP'),
    /<html lang="ja-JP"/,
  )
  assert.match(
    buildHtmlDocument('文档', '<p>x</p>', 'light'),
    /<html lang="zh-CN"/,
  )
})

test('导出模板：语言值经过转义，不破坏属性', () => {
  const html = buildHtmlDocument('文档', '<p>x</p>', 'light', '46rem', '"><script>')
  assert.ok(!html.includes('<script>'))
  assert.match(html, /<html lang="&quot;&gt;&lt;script&gt;"/)
})

test('导出模板：measure 与主题仍按入参注入', () => {
  const html = buildHtmlDocument('文档', '<p>x</p>', 'dark', '622px')
  assert.match(html, /--export-measure:622px/)
  assert.match(html, /data-theme="dark"/)
})
