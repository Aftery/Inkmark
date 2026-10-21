/**
 * list-indent.test.mjs — 列表 Tab / Shift+Tab 智能缩进（含有序列表自动重编号）
 * ---------------------------------------------------------------------------
 * 被测对象：editor/listIndent.js 的 listIndentChanges / parseListItem。
 *
 * 【为什么用真 Text 驱动】这类逻辑的全部难点都在「行号 / 偏移 / 多行选区」上，
 * 用字符串模拟很容易把「第几行」算错却依然全绿。这里直接用 @codemirror/state 的
 * Text（与编辑器里同一实现），断言产出的变更集套用后的最终文本。
 *
 * 【期望值来源】CommonMark 的列表嵌套口径（2 空格一级）+ 产品裁决
 * 「缩进/反缩进后序号必须跟着更新」。不是「跑一遍实现拿输出当期望」。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { Text } from '@codemirror/state'
import { listIndentChanges, parseListItem } from '../src/editor/listIndent.js'

/** 把变更集套到文档上，得到最终文本 */
function applyChanges(docText, changes) {
  let out = docText
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  }
  return out
}

/** 整篇文档选中指定行（1 起，闭区间）后缩进/反缩进的结果 */
function run(docText, lines, dir) {
  const doc = Text.of(docText.split('\n'))
  const ranges = lines.map(([a, b]) => ({ from: doc.line(a).from, to: doc.line(b).to }))
  const changes = listIndentChanges(doc, ranges, dir)
  return { changes, text: changes ? applyChanges(docText, changes) : docText }
}

describe('parseListItem · 列表项解析', () => {
  test('无序 / 有序 / 任务 / 两种有序分隔符都能识别', () => {
    assert.deepEqual(
      [parseListItem('- a').ordered, parseListItem('- a').indent],
      [false, 0],
    )
    assert.equal(parseListItem('  1. a').indent, 2, '缩进必须计入')
    assert.equal(parseListItem('1) a').ordered, true, '`)` 也是合法有序标记')
    assert.equal(parseListItem('1) a').delim, ')', '分隔符要原样保留')
    assert.equal(parseListItem('- [x] done').task, true)
    assert.equal(parseListItem('普通段落'), null)
    assert.equal(parseListItem('    ```js'), null, '围栏行不是列表项')
  })
})

describe('Tab · 缩进', () => {
  test('单行缩进 2 空格', () => {
    const r = run('- a\n- b', [[2, 2]], 1)
    assert.equal(r.text, '- a\n  - b')
  })

  test('多行选区整体缩进', () => {
    const r = run('- a\n- b\n- c', [[1, 2]], 1)
    assert.equal(r.text, '  - a\n  - b\n- c')
  })

  test('非列表行的选区不处理（交回 indentWithTab）', () => {
    assert.equal(run('普通段落\n另一个段落', [[1, 1]], 1).changes, null)
  })

  test('选区里混着非列表行时：只动列表行，段落原样', () => {
    const r = run('- a\n段落', [[1, 2]], 1)
    assert.equal(r.text, '  - a\n段落')
  })
})

describe('有序列表 · 缩进后自动重编号', () => {
  test('把第 2 项缩进成子项：父级剩下的顺序号必须接上', () => {
    // 1. / 2. / 3. → 把 2 缩进后，父级剩下 1. 与「原来的 3.」，
    // 若不重编号，屏幕上会出现「1. 3.」这种断裂（CommonMark 按实际序号渲染）
    const r = run('1. a\n2. b\n3. c', [[2, 2]], 1)
    assert.equal(r.text, '1. a\n  1. b\n2. c')
  })

  test('子列表默认从 1 开始（而不是沿用被缩进行的旧号）', () => {
    const r = run('1. a\n2. b', [[2, 2]], 1)
    assert.equal(r.text, '1. a\n  1. b', '缩进后的新组必须从 1 起，否则子列表从 2 开始很怪')
  })

  test('用户显式写 3. 开头的列表不因「顺手重编号」被掰回 1', () => {
    // 把首项缩进成子项后，旧组只剩 `4. b`：它现在是旧组的首项且自身未被改动，
    // 按「保留显式起始号」的口径应仍是 4.（CommonMark 渲染为 start=4）。
    // 这里刻意不把它改成 2. ——「重编号」的职责是接上断裂的序列，
    // 不是把用户写的起始号统一成 1。
    const r = run('3. a\n4. b', [[1, 1]], 1)
    assert.equal(r.text, '  1. a\n4. b', '被缩进的行成为新组开头（从 1 起），旧组首项保持原号')
  })

  test('未改动的整组保持原样（不得产生多余变更）', () => {
    const doc = Text.of(['1. a', '2. b'])
    const changes = listIndentChanges(doc, [{ from: 0, to: 0 }], 1)
    // 第 1 行缩进 → 它离开旧组；旧组只剩第 2 行（首项、未被改动）→ 保留 2.
    // 故只应有一条变更（第 1 行缩进），不得顺手把 2. 也改掉
    assert.equal(changes.length, 1, '只应有一条变更（第 1 行缩进）')
    assert.equal(changes[0].insert, '  1. a')
  })
})

describe('Shift+Tab · 反缩进', () => {
  test('没有父级时减 2 空格', () => {
    const r = run('  - a', [[1, 1]], -1)
    assert.equal(r.text, '- a')
  })

  test('有父级时吸附到父级缩进（手写 4 空格也能一次回到父级）', () => {
    const r = run('- 父\n    - 子', [[2, 2]], -1)
    assert.equal(r.text, '- 父\n- 子', '必须吸附到 0，而不是删 2 空格停在 2')
  })

  test('顶层列表反缩进不动（无可缩进空间）', () => {
    const r = run('- a', [[1, 1]], -1)
    assert.deepEqual(r.changes, [], '已在顶层 → 无变更，且不得误删标记')
  })

  test('反缩进后与父级同级 → 序号按父级组继续排', () => {
    const r = run('1. a\n  1. b\n2. c', [[2, 2]], -1)
    // 首项 `1. a` 未被改动 → 保留它的起始号 1，其后顺序递增 2/3
    assert.equal(r.text, '1. a\n2. b\n3. c', '反缩进后三项同级，必须接成 1/2/3')
  })

  test('空行是列表边界：不会越过空行去吸附', () => {
    const r = run('- a\n\n    - b', [[3, 3]], -1)
    assert.equal(r.text, '- a\n\n  - b', '空行之后当新块处理，只减 2 空格')
  })
})

describe('边界 · 不误伤', () => {
  test('围栏代码块内的 Tab 不归本模块（返回 null 交回 indentWithTab）', () => {
    assert.equal(run('```js', [[1, 1]], 1).changes, null)
  })

  test('任务列表缩进后保持勾选标记与正文', () => {
    const r = run('- [x] 完成\n- [ ] 未完成', [[1, 1]], 1)
    assert.equal(r.text, '  - [x] 完成\n- [ ] 未完成', '标记与正文都不能丢')
  })

  test('多光标（多个选区）各自动作', () => {
    const doc = Text.of(['- a', '- b', '- c'])
    const changes = listIndentChanges(
      doc,
      [{ from: doc.line(1).from, to: doc.line(1).to }, { from: doc.line(3).from, to: doc.line(3).to }],
      1,
    )
    assert.equal(applyChanges('- a\n- b\n- c', changes), '  - a\n- b\n  - c')
  })
})
