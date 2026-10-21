/**
 * heading-level.test.mjs — 标题定级 / 逐级升降（⌘1~⌘6、⌘⌥↑↓）
 * ---------------------------------------------------------------------------
 * 被测对象：editor/headingLevel.js 的 levelOf / withLevel / nextLevel /
 *           headingChanges（CM 命令 promoteHeading / demoteHeading 的底座）。
 *
 * 【期望值来源】CommonMark 的 ATX 标题语法 + 产品裁决「正文(0) 与 h6 相邻、
 * 两端 clamp 不循环」。有序级别阶梯是这条交互最容易做错的地方（循环会让
 * 「升级」变成「字变小」），故逐级走一遍全阶梯钉死。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { Text } from '@codemirror/state'
import { levelOf, withLevel, nextLevel, headingChanges } from '../src/editor/headingLevel.js'

/** 把变更集套到文档文本上 */
function apply(docText, changes) {
  let out = docText
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  }
  return out
}

const run = (text, from, to, dir) => {
  const doc = Text.of(text.split('\n'))
  return apply(text, headingChanges(doc, from, to, dir))
}

describe('levelOf / withLevel · 级数读写', () => {
  test('识别 1~6 级与正文', () => {
    for (let n = 1; n <= 6; n++) {
      assert.equal(levelOf(`${'#'.repeat(n)} 标题`), n)
    }
    assert.equal(levelOf('正文段落'), 0)
    assert.equal(levelOf('#没有空格'), 0, 'ATX 要求 # 后有空格，否则不是标题')
    assert.equal(levelOf('####### 七级'), 0, '最多六级')
  })

  test('定级保留缩进与正文（不改块结构）', () => {
    assert.equal(withLevel('正文', 3), '### 正文')
    assert.equal(withLevel('## 旧标题', 1), '# 旧标题', '换级不叠加 #')
    assert.equal(withLevel('### 标题', 0), '标题', '0 = 去标题')
    assert.equal(withLevel('  ## 缩进标题', 4), '  #### 缩进标题', '缩进必须保留')
  })

  test('级数越界被夹到 1~6（调用方不必自己 clamp）', () => {
    assert.equal(withLevel('正文', 9), '###### 正文')
    assert.equal(withLevel('正文', -2), '正文')
  })
})

describe('nextLevel · 单调阶梯（两端 clamp，不循环）', () => {
  test('升级：正文 → h6 → h5 → … → h1，到 h1 停住', () => {
    const ladder = [0, 6, 5, 4, 3, 2, 1, 1]
    for (let i = 0; i < ladder.length - 1; i++) {
      assert.equal(nextLevel(ladder[i], 1), ladder[i + 1], `从 ${ladder[i]} 升级`)
    }
  })

  test('降级：h1 → h2 → … → h6 → 正文，正文停住', () => {
    const ladder = [1, 2, 3, 4, 5, 6, 0, 0]
    for (let i = 0; i < ladder.length - 1; i++) {
      assert.equal(nextLevel(ladder[i], -1), ladder[i + 1], `从 ${ladder[i]} 降级`)
    }
  })

  test('关键不变量：h1 再升级不得跳到正文（否则「变大」变「变小」）', () => {
    assert.equal(nextLevel(1, 1), 1)
  })
})

describe('headingChanges · 选区整块同级', () => {
  test('单行可反复升降（模拟连按 ⌘⌥↑）', () => {
    let text = '正文'
    for (const expected of ['###### 正文', '##### 正文', '#### 正文']) {
      text = run(text, 1, 1, 1)
      assert.equal(text, expected)
    }
  })

  test('混排选区以首行级数为基准整体升降（拉齐而不是保持差距）', () => {
    // h2 起手升级 → 目标是 h1，h3 那行也变 h1（用户意图是「这一节都提上去」）
    assert.equal(run('## 甲\n### 乙', 1, 2, 1), '# 甲\n# 乙')
  })

  test('首行是正文时下行标题一起还原正文', () => {
    assert.equal(run('正文\n### 乙', 1, 2, -1), '正文\n乙')
  })

  test('已在端点时不产生变更（命令应返回 false，不写无意义的撤销记录）', () => {
    const doc = Text.of(['# 已是顶级'])
    assert.deepEqual(headingChanges(doc, 1, 1, 1), [])
    const body = Text.of(['正文'])
    assert.deepEqual(headingChanges(body, 1, 1, -1), [])
  })
})
