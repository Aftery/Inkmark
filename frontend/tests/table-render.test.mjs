// table-render.test.mjs — 表格真渲染（tableRender.js）的行为测试
// ----------------------------------------------------------------------------
// DOM 层（单元格编辑 / IME / Tab 导航）只能在真机目视，这里覆盖纯逻辑层：
// 解析 / 序列化往返、StateField 的渲染判定（界内源码 / 界外渲染）、
// 以及 createEditor 的接线与 wysiwyg 的退位契约。

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { parseTable, serializeTable, splitCells, tableRenderField } from '../src/editor/tableRender.js'

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

test('serializeTable：支持文档主换行符（CRLF 不跑行）', () => {
  // 直接构造 model（parseTable 按 \n 切，不处理 \r；这里测序列化侧）
  const m = { header: ['a', 'b'], aligns: ['left', 'left'], delimRaw: '| --- | --- |', rows: [['1', '2']] }
  // 默认 \n：与现有行为契约一致（旧测试依赖它）
  assert.equal(serializeTable(m), '| a | b |\n| --- | --- |\n| 1 | 2 |')
  // 传入 \r\n：回写文档时必须保持与相邻行一致的换行符，否则 CM 重渲染错位
  // （用户侧「输着输着跑行」的根因之一）
  assert.equal(serializeTable(m, '\r\n'), '| a | b |\r\n| --- | --- |\r\n| 1 | 2 |')
})

// ---------------------------------------------------------------------------
// 解析 / 序列化的边界往返
// ---------------------------------------------------------------------------
/**
 * 【为什么这些边界必须逐个钉】serializeTable 是「模型 → 文档」的唯一出口，
 * 它在每次按键后都会被调用一次。任何一条边界写错（漏转义、丢空格、混进 \r），
 * 都会把**看起来对的表格**写成**结构不同的表格**：GFM 一旦列数不一致，
 * 整张表就退化成普通段落 —— 用户看到的是「表格突然没了」，而控制台没有任何
 * 报错。往返（parse → serialize → parse）是这个函数唯一可靠的验收口径。
 */
describe('表格往返 · 边界单元格', () => {
  const f = (cells, delim = null) => {
    const d = delim ?? `| ${cells.map(() => '---').join(' | ')} |`
    return [`| ${cells.join(' | ')} |`, d, `| ${cells.map((_, i) => `v${i}`).join(' | ')} |`].join('\n')
  }

  // 每个用例：原文 —— 期望 parse 出的单元格 —— 期望「序列化再解析」稳定
  const CASES = [
    { name: '单元格含反斜杠', line: '| a\\b | c |', header: ['a\\b', 'c'] },
    { name: '单元格含反引号', line: '| `code` | c |', header: ['`code`', 'c'] },
    { name: '单元格含中文', line: '| 中文列 | 第二列 |', header: ['中文列', '第二列'] },
    { name: '空单元格', line: '|  | c |', header: ['', 'c'] },
    { name: '首尾空格被规整', line: '|  a  |   b |', header: ['a', 'b'] },
    { name: '转义竖线还原为字面竖线', line: '| a\\|b | c |', header: ['a|b', 'c'] },
    { name: '行内标记原样保留', line: '| **粗** | [l](u) |', header: ['**粗**', '[l](u)'] },
    { name: '模板占位符不被当语法', line: '| ${x} | %s |', header: ['${x}', '%s'] },
  ]

  for (const c of CASES) {
    test(`${c.name}：parse 正确且往返稳定`, () => {
      const src = c.line + '\n| --- | --- |\n| 1 | 2 |'
      const m = parseTable(src)
      assert.deepEqual(m.header, c.header, `${c.name} 的表头解析不对`)
      // 往返：序列化再解析，表头必须一模一样（否则每次按键都在悄悄改内容）
      const back = parseTable(serializeTable(m))
      assert.deepEqual(back.header, c.header, `${c.name} 往返后表头变了`)
      // 第二遍必须完全稳定（幂等：第 N 次按键不能和第 1 次产出不同文本）
      assert.equal(serializeTable(back), serializeTable(m), `${c.name} 序列化不幂等`)
    })
  }

  test('单元格里的竖线必须转义，否则会把一列劈成两列', () => {
    const m = parseTable(f(['a', 'b']))
    m.header[0] = 'x|y'
    const out = serializeTable(m)
    assert.ok(out.includes('x\\|y'), `竖线未转义：${out}`)
    // 转义后重新解析必须还是 2 列 —— 这是「列错位」的直接判据
    assert.equal(parseTable(out).header.length, 2, '转义失效会导致列数变化')
  })

  test('空单元格与空格单元格不得被写成 undefined 或丢列', () => {
    const m = parseTable('| a | b | c |\n| --- | --- | --- |\n|  |  |  |')
    const out = serializeTable(m)
    assert.equal(parseTable(out).header.length, 3, '列数必须保持 3')
    assert.ok(!out.includes('undefined'), `不得写出 undefined：${out}`)
  })

  test('缺列的行按表头列数补齐（GFM 要求列数一致，否则整表退化成段落）', () => {
    const m = parseTable('| a | b | c |\n| --- | --- | --- |\n| 1 |')
    const out = serializeTable(m)
    for (const line of out.split('\n')) {
      assert.equal(splitCells(line).length, 3, `每一行的列数都必须是 3：${line}`)
    }
  })
})

// ---------------------------------------------------------------------------
// CRLF：解析侧不得把 \r 漏进模型
// ---------------------------------------------------------------------------
/**
 * 【这条守的是一个「修了一半」的真坑】上一轮只改了 serializeTable 支持
 * lineBreak 参数，但 parseTable 仍是 `text.split('\n')` —— CRLF 文档切完，
 * 分隔行尾部剩下一个 '\r'，于是 `delimRaw === "| --- | --- |\r"`，
 * 回写时与换行符拼成 `"\r\r\n"`：多出一个控制字符混进用户文档，且
 * 「行数 / 字符偏移」从此对不上。序列化侧再正确也救不回来。
 */
describe('表格解析 · CRLF 不得污染模型', () => {
  const CRLF_TABLE = '| a | b |\r\n| --- | --- |\r\n| 1 | 2 |'

  test('delimRaw 不得含 \\r', () => {
    const m = parseTable(CRLF_TABLE)
    assert.ok(!m.delimRaw.includes('\r'), `delimRaw 含 \\r：${JSON.stringify(m.delimRaw)}`)
    assert.equal(m.delimRaw, '| --- | --- |')
  })

  test('表头 / 表体单元格不得含 \\r', () => {
    const m = parseTable(CRLF_TABLE)
    assert.deepEqual(m.header, ['a', 'b'])
    assert.deepEqual(m.rows, [['1', '2']])
    for (const row of [m.header, ...m.rows]) {
      for (const cell of row) assert.ok(!cell.includes('\r'), `单元格含 \\r：${JSON.stringify(cell)}`)
    }
  })

  test('CRLF 原文 → 解析 → 以 \\r\\n 序列化，必须逐字还原', () => {
    const m = parseTable(CRLF_TABLE)
    assert.equal(
      serializeTable(m, '\r\n'),
      CRLF_TABLE,
      'CRLF 文档往返不一致 —— 回写会把表格写成两种换行符混排',
    )
  })

  test('CRLF 文档里不得叠出 \\r\\r\\n', () => {
    const out = serializeTable(parseTable(CRLF_TABLE), '\r\n')
    assert.ok(!out.includes('\r\r'), `序列化结果出现 \\r\\r（delimRaw 带 \\r 的典型症状）：${JSON.stringify(out)}`)
  })

  test('孤立 \\r（老 Mac 换行）也被当行边界', () => {
    const m = parseTable('| a | b |\r| --- | --- |\r| 1 | 2 |')
    assert.deepEqual(m.header, ['a', 'b'], '孤立 \\r 也应切行')
    assert.deepEqual(m.rows, [['1', '2']])
  })
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
  // 【2026-10-20 口径更新】行列操作条让 tableRender.js 越过 300 有效行红线，
  // 故按契约 5 的要求拆分：widget（含 contentEditable）→ tableWidget.js，
  // 行列增删与操作条 → tableOps.js，selfSync 标记 → tableSync.js。
  // 判据因此跨四个文件 —— **锚点跟着代码走，不留指向已搬走内容的死规则**。
  const tw = src(join('editor', 'tableWidget.js'))
  assert.match(tw, /contentEditable/, '单元格必须可编辑（产品决策：单元格直接编辑）')
  assert.match(src(join('editor', 'tableSync.js')), /Annotation\.define/,
    '必须带自同步 annotation 防装饰回环')
  // 自同步标记必须真的被用上：装饰层见到它才保留 activeWidget，否则编辑中每键都重建 DOM
  assert.match(tr, /tr\.annotation\(selfSync\)/, '装饰层必须检查 selfSync 标记')
  assert.match(tw, /annotations: selfSync\.of\(true\)/, 'widget 同步必须打 selfSync 标记')
  // widget 必须被装饰层真正使用（拆出去但没人 new 就渲染不出表格）
  assert.match(tr, /new TableWidget\(/, 'block 装饰必须实例化 TableWidget')
})

// ---------------------------------------------------------------------------
// 行列增删（editor/tableOps.js）：纯 model 变换，可直接驱动
// ---------------------------------------------------------------------------
test('insertRow / removeRow：行结构正确，列数跟随表头', async () => {
  const { insertRow, removeRow } = await import('../src/editor/tableOps.js')
  const m = parseTable(TABLE) // 2 列 1 行

  insertRow(m, 1) // 追加到末尾
  assert.equal(m.rows.length, 2)
  assert.deepEqual(m.rows[1], ['', ''], '新行空单元格数必须等于列数')

  removeRow(m, 0)
  assert.equal(m.rows.length, 1)
  assert.deepEqual(m.rows[0], ['', ''], '删掉的是第 0 行')
})

test('insertColumn：表头/每行/对齐/分隔行四处同步，产物仍是合法 GFM', async () => {
  const { insertColumn } = await import('../src/editor/tableOps.js')
  const m = parseTable('| a | b |\n| --- | -: |\n| 1 | 2 |\n| 3 | 4 |')

  insertColumn(m, 1) // 插在 a 与 b 之间
  assert.deepEqual(m.header, ['a', '', 'b'])
  assert.deepEqual(m.rows, [['1', '', '2'], ['3', '', '4']], '每一行都要插，否则列数不一致')
  assert.deepEqual(m.aligns, ['left', 'left', 'right'])

  const out = serializeTable(m)
  // 关键判据：重新解析必须成功，且列数与写入时一致
  const back = parseTable(out)
  assert.ok(back, `产出的表格必须是合法 GFM:\n${out}`)
  assert.equal(back.header.length, 3)
  assert.ok(back.rows.every((r) => r.length === 3))
})

test('removeColumn：四处同步收缩，删到只剩 1 列仍合法', async () => {
  const { removeColumn } = await import('../src/editor/tableOps.js')
  const m = parseTable(TABLE)

  removeColumn(m, 0)
  assert.deepEqual(m.header, ['b'])
  assert.deepEqual(m.rows, [['2']])
  const out = serializeTable(m)
  assert.ok(parseTable(out), `单列表格必须仍能解析:\n${out}`)
})

test('对齐在列操作后不串位（center/right 必须跟着列走）', async () => {
  const { insertColumn, removeColumn } = await import('../src/editor/tableOps.js')
  const m = parseTable('| a | b | c |\n| :-: | --- | ---: |\n| 1 | 2 | 3 |')
  assert.deepEqual(m.aligns, ['center', 'left', 'right'])

  removeColumn(m, 0) // 删掉居中的 a
  assert.deepEqual(m.aligns, ['left', 'right'], 'b 左对齐、c 右对齐，不串位')
  const back = parseTable(serializeTable(m))
  assert.deepEqual(back.aligns, ['left', 'right'], '序列化后对齐必须还原一致')
})

test('行列操作条：按钮齐全且动作名与 runAction 的分支一致', async () => {
  const ops = await import('../src/editor/tableOps.js')
  const tw = src(join('editor', 'tableWidget.js'))
  // 操作条在 tableOps 里定义的动作名，必须都被 widget 的 switch 接住，
  // 否则点按钮静默无反应（本仓最恨的失效形态）。
  for (const action of ['add-row', 'del-row', 'add-col', 'del-col']) {
    assert.ok(typeof ops.insertColumn === 'function')
    assert.match(tw, new RegExp(`case '${action}':`), `widget 必须处理 ${action}`)
  }
  // 最少保留约束必须存在（否则能把表格删成 0 行/0 列，产出的 Markdown 不再是表格）
  assert.match(tw, /rows\.length <= 1/, '必须拒绝删除最后一行')
  assert.match(tw, /colCount <= 1/, '必须拒绝删除最后一列')
  // 行列操作后必须写回文档（只改 DOM 会在重渲染时弹回）
  assert.match(tw, /this\.writeModel\(\)/, '结构变更必须写回文档')
})
