// task-toggle.test.mjs — 任务列表交互式勾选（editor/taskToggle.js）
// ----------------------------------------------------------------------------
// 【为什么这些必须机检】勾选是「错了会静默毁内容」的一类：
//   - 翻转逻辑若把 `[x]` 改成 `[X]`（大写），GFM 仍认，但下一次渲染的
//     aria-label / 行样式判定会与用户预期漂移；
//   - 若用整段重写替代定点替换，撤销栈会退化成「整行撤销」，用户按一次
//     ⌘Z 丢掉的可能是整段而不是一次勾选；
//   - 若只改 DOM 不改文档（最诱人的错误实现），装饰重算时会弹回原状，
//     表现为「点了没反应」—— 本仓第 ⑱⑲ 类假绿灯。
// 故这里同时钉纯函数语义与「接线存在」。

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toggledMarker } from '../src/editor/taskToggle.js'
import { stripComments } from './helpers/lexer.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')

// ---------------------------------------------------------------------------
// 1. 纯函数：标记翻转
// ---------------------------------------------------------------------------
describe('toggledMarker · 标记翻转语义', () => {
  test('未勾选 → 勾选', () => {
    assert.equal(toggledMarker('[ ]'), '[x]')
  })

  test('已勾选 → 未勾选（小写与大写都认）', () => {
    assert.equal(toggledMarker('[x]'), '[ ]')
    assert.equal(toggledMarker('[X]'), '[ ]')
  })

  test('产物只有两种形态：`[ ]` / `[x]`（禁止输出大写 X 等第三种）', () => {
    // 反复翻转必须稳定在两种形态之间，不产生 `[X]` 之类的新写法
    let cur = '[ ]'
    for (let i = 0; i < 10; i++) {
      cur = toggledMarker(cur)
      assert.ok(cur === '[ ]' || cur === '[x]', `第 ${i} 次翻转产出异常形态 ${cur}`)
    }
  })

  test('长度不随翻转变化（避免行内位移与装饰区间错位）', () => {
    for (const t of ['[ ]', '[x]', '[X]']) {
      assert.equal(toggledMarker(t).length, t.length, `${t} 翻转后长度变了`)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. 接线契约：交互必须挂在编辑器上，且**必须改文档**
// ---------------------------------------------------------------------------
describe('任务勾选 · 接线契约', () => {
  test('createEditor 注册了 taskToggleHandlers', () => {
    assert.match(read(join('editor', 'createEditor.js')), /taskToggleHandlers\(\)/)
  })

  test('交互层必须 dispatch 文档变更（只改 DOM 会在装饰重算时弹回原状）', () => {
    const code = stripComments(read(join('editor', 'taskToggle.js')))
    assert.match(code, /view\.dispatch\(/, 'taskToggle 必须 dispatch 文档变更')
    assert.match(code, /changes:\s*\{\s*from:\s*node\.from/, '必须是定点替换而非整段重写')
  })

  test('wysiwyg.js 仍然只产装饰、不碰文档（架构 §3 的 5 条约束不许被本功能打破）', () => {
    const code = stripComments(read(join('editor', 'wysiwyg.js')))
    assert.ok(
      !/\.dispatch\(\s*\{\s*changes:/.test(code),
      'wysiwyg.js 出现「改文档」的 dispatch —— 它必须是纯装饰层，交互请放 taskToggle.js',
    )
  })

  test('类名与 wysiwyg.js 的 widget 一致（否则点击命中不了）', () => {
    const toggle = read(join('editor', 'taskToggle.js'))
    const wy = read(join('editor', 'wysiwyg.js'))
    assert.ok(toggle.includes("'cm-md-task-box'"), 'taskToggle 应引用 cm-md-task-box')
    assert.ok(wy.includes('cm-md-task-box'), 'wysiwyg 应产出 cm-md-task-box')
  })
})
