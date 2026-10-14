// table-render.test.mjs — 表格真渲染（tableRender.js）的行为测试
// ----------------------------------------------------------------------------
// DOM 层（单元格编辑 / IME / Tab 导航）只能在真机目视，这里覆盖纯逻辑层：
// 解析 / 序列化往返、StateField 的渲染判定（界内源码 / 界外渲染）、
// 以及 createEditor 的接线与 wysiwyg 的退位契约。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { parseTable, serializeTable, tableRenderField } from '../src/editor/tableRender.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p) => readFileSync(join(root, 'src', p), 'utf8')

const mkState = (doc, anchor = doc.length + 1) =>
  EditorState.create({
    doc,
    selection: { anchor: Math.min(anchor, doc.length) },
    extensions: [markdown({ base: markdownLanguage }), tableRenderField],
  })

const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')

test('parseTable：合法表格 / 对齐 / 转义竖线 / 非法输入', () => {
  const m = parseTable(TABLE)
  assert.deepEqual(m.header, ['a', 'b'])
  assert.deepEqual(m.rows, [['1', '2']])
  assert.deepEqual(m.aligns, ['left', 'left'])

  const aligned = parseTable('| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |')
  assert.deepEqual(aligned.aligns, ['left', 'center', 'right'])

  // \| 是字面竖线，不是列分隔
  const esc = parseTable('| a\\|b | c |\n| --- | --- |\n| 1 | 2 |')
  assert.deepEqual(esc.header, ['a|b', 'c'])

  assert.equal(parseTable('| a | b |'), null, '缺分隔行不是表格')
  assert.equal(parseTable('| a | b |\n| x | y |'), null, '分隔行不是 - 语法不算表格')
})

test('serializeTable：往返一致 + 单元格内竖线转义还原', () => {
  const m = parseTable(TABLE)
  assert.equal(serializeTable(m), TABLE, '未编辑的表格原样回写')

  const esc = parseTable('| a\\|b | c |\n| --- | --- |\n| 1 | 2 |')
  const out = serializeTable({ ...esc, rows: [['x|y', 'z']] })
  assert.equal(out, '| a\\|b | c |\n| --- | --- |\n| x\\|y | z |', '竖线必须转义，否则列错位')

  // 保留分隔行原貌（:---: 写法不被改写）
  const aligned = parseTable('| a |\n| :-: |\n| 1 |')
  assert.equal(serializeTable(aligned), '| a |\n| :-: |\n| 1 |')
})

test('StateField：界外渲染 / 界内源码 / 边界算界外', () => {
  const doc = `前文\n\n${TABLE}\n\n后文`
  const tFrom = doc.indexOf('| a |')
  const tTo = tFrom + TABLE.length

  const out = mkState(doc, 0) // 光标在文档开头
  assert.equal(out.field(tableRenderField).tables.length, 1)
  assert.equal(out.field(tableRenderField).deco.size, 1, '界外应产出 1 条 block 装饰')
  // RangeSet.iter() 返回的是光标（value/from/to + next()），不是 ES 迭代器
  const cur = out.field(tableRenderField).deco.iter()
  assert.equal(cur.from, tFrom)
  assert.equal(cur.to, tTo)
  assert.ok(cur.value?.widget, '装饰必须是带 widget 的 replace')

  const inside = mkState(doc, tFrom + 2) // 光标在表内
  assert.equal(inside.field(tableRenderField).deco.size, 0, '界内显示源码，无装饰')

  const edge = mkState(doc, tTo) // 光标恰在表格末尾边界 → 算界外（Esc 退出的前提）
  assert.equal(edge.field(tableRenderField).deco.size, 1, '边界位置保持渲染态')
})

test('StateField：引用块内的表格不渲染（行首有前缀，block 替换会切碎引文）', () => {
  const doc = '> | a | b |\n> | --- | --- |\n> | 1 | 2 |'
  const st = mkState(doc, 0)
  assert.equal(st.field(tableRenderField).deco.size, 0)
})

test('接线契约：createEditor 注册 tableRenderField，wysiwyg 退位', () => {
  assert.match(
    src(join('editor', 'createEditor.js')),
    /tableRenderField/,
    'createEditor 必须注册 tableRenderField',
  )
  const wy = src(join('editor', 'wysiwyg.js'))
  assert.ok(!wy.includes('TableDelimiter'), 'wysiwyg 不得再处理 TableDelimiter')
  // block 装饰只能来自 StateField（ViewPlugin 提供会被 CM 抛 RangeError）
  const tr = src(join('editor', 'tableRender.js'))
  assert.match(tr, /StateField\.define/, 'block 装饰必须出自 StateField')
  assert.match(tr, /block: true/, '表格替换必须是 block 装饰')
  assert.match(tr, /selfSync/, '必须带自同步 annotation 防装饰回环')
  assert.match(tr, /contentEditable/, '单元格必须可编辑（产品决策：单元格直接编辑）')
})
