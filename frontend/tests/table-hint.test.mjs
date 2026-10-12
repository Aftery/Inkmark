/**
 * table-hint.test.mjs — 「表格没渲染」提示的行为契约（2026-10-12 新增）
 * ---------------------------------------------------------------------------
 * 【为什么这组必须是真行为测试，而不是源码断言】
 * 本仓的测试网此前全是「读文件 + 正则」（contracts / wysiwyg-decor 等），
 * 而本功能的核心是**判定逻辑**：给定一段 Markdown，判断它是不是
 * 「看起来像表格、但实际不是合法 GFM 表格」。用源码正则去断言这段逻辑，
 * 等于只验证「代码里写了这个正则」，验证不了「它判得对不对」。
 * 故这里直接构造**真实 EditorState + 真实语法树**，把判定函数跑起来。
 *
 * 【坑，勿改：必须用 base: markdownLanguage，而不是默认 markdown()】
 * @codemirror/lang-markdown 的默认 `markdown()` 用的是 **commonmark** 解析器，
 * 而编辑器（createEditor.js 第 242 行）传的是 `base: markdownLanguage`
 * —— 那是**扩展了 GFM** 的版本。实测（同一段合法表格）：
 *   markdown()                        → Document, Paragraph   （认不出表格！）
 *   markdown({ base: markdownLanguage }) → Document, Table, ... （认得出）
 * 若这里偷懒用默认 markdown()，合法表格会被判成「疑似未渲染」，
 * 测试就会**假红**；反过来若生产代码用错解析器，测试也会假绿。
 * 这正是 HANDOFF §4 记的「给语言包装上就有高亮」那一族错误：API 名字对 ≠ 行为对。
 *
 * 【与编辑器的一致性】detectSuspectTable 读的是 EditorState 自带的语法树，
 * 与 wysiwyg 装饰读的是同一棵树 —— 判定与渲染永远看到同一个事实。
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'

import { detectSuspectTable, __test__ } from '../src/editor/tableHint.js'

/** 与 createEditor.js 完全同款的扩展：GFM 解析器（见文件头「坑，勿改」） */
const GFM = markdown({ base: markdownLanguage })

/**
 * 造一个语法树已完整解析的 EditorState。
 * 必须用 ensureSyntaxTree：无头环境下 syntaxTree() 只给**部分**树
 * （实测对 3 行文档只解析出 Document+Paragraph），会导致判定失真。
 */
async function stateOf(doc) {
  const state = EditorState.create({ doc, extensions: [GFM] })
  const tree = await ensureSyntaxTree(state, state.doc.length, 5000)
  return { ...state, tree }
}

describe('表格提示 · 判定函数 detectSuspectTable', () => {
  test('合法表格不提示（最关键的假阳性防线）', async () => {
    const st = await stateOf('| 名称 | 作用 |\n| --- | --- |\n| ⌘O | 打开文件 |\n')
    assert.equal(detectSuspectTable(st), null, '合法 GFM 表格被解析成 Table 节点，不该提示')
  })

  test('示例文档里的两张表都不提示（默认文档打开即干净）', async () => {
    const { DEFAULT_DOC, SYNTAX_DOC } = await import('../src/editor/sampleDocs.js')
    for (const [name, doc] of [['DEFAULT_DOC', DEFAULT_DOC], ['SYNTAX_DOC', SYNTAX_DOC]]) {
      assert.equal(
        detectSuspectTable(await stateOf(doc)),
        null,
        `${name} 里含合法表格，启动时不该弹出提示`
      )
    }
  })

  test('缺分隔行（用户第一次报的场景）要提示，行号正确', async () => {
    const st = await stateOf('# 标题\n\n正文一行。\n\n| sd | s |\n|-ds-| --sd-|\n| sd | sd |\n')
    const hit = detectSuspectTable(st)
    assert.ok(hit, '分隔行含非法字符，应判定为疑似未渲染')
    assert.equal(hit.line, 5, '行号应指向疑似块的第一行（1-based）')
  })

  test('只写两行管道、无分隔行（用户第二次报的场景）也要提示', async () => {
    const st = await stateOf('正文。\n\n|| ||\n|| ||\n')
    const hit = detectSuspectTable(st)
    assert.ok(hit, '连续两行管道、缺分隔行，正是用户截图的场景，必须提示')
    assert.equal(hit.line, 3)
  })

  test('普通正文不提示（假阳性防线）', async () => {
    const st = await stateOf('这是一段普通中文正文，没有任何管道符号。\n第二行也是。\n')
    assert.equal(detectSuspectTable(st), null)
  })

  test('孤立单行管道不提示（可能是正文里的合法竖线）', async () => {
    // 这一条是「连续 ≥2 行才提示」这条规则的**唯一覆盖**，必须用真正只有
    // 一行管道行的输入：写成「两行正文各含一个竖线」是无效的 —— 那些行根本
    // 不是 pipeRow（不以 | 开头），无论判据怎么改都会通过 = 假绿灯。
    const st = await stateOf('| a | b |\n这段是表格下方的说明文字。\n')
    assert.equal(detectSuspectTable(st), null, '只有一个管道行，不该判为表格意图')
  })

  test('代码块内的管道表格不提示（围栏内是代码，不是表格）', async () => {
    const st = await stateOf('```\n| a | b |\n| c | d |\n```\n')
    assert.equal(detectSuspectTable(st), null, '围栏代码块内的管道行是代码，不该提示')
  })

  test('引用块内的管道表格不提示（只判顶层段落）', async () => {
    // 【为什么必须用三行形态】实测两行形态（`> | a | b |\n| c | d |`，惰性续行）
    // 挡不住变异：段落的**第一行**是 `> | a | b |`（以 `>` 开头，不是 pipeRow），
    // 最长连续段只有 1，删掉顶层判定后照样返回 null —— 那条用例等于零覆盖。
    // 三行形态下第 2、3 行都满足 pipeRow（连续 2 行），才真正落在
    // Blockquote 的 Paragraph 里，是唯一能击穿顶层判定的输入。
    const st = await stateOf('> | a | b |\n> | c | d |\n> | e | f |\n')
    assert.equal(detectSuspectTable(st), null, '引用块内的管道表格不该提示')
  })

  test('列表项内的管道表格不提示（只判顶层段落）', async () => {
    const st = await stateOf('- | a | b |\n  | c | d |\n  | e | f |\n')
    assert.equal(detectSuspectTable(st), null, '列表项内的管道表格不该提示')
  })

  test('空状态不抛错（无语法树时安全返回）', () => {
    assert.equal(detectSuspectTable(null), null)
    assert.equal(detectSuspectTable({ doc: { lineAt: () => ({ number: 1 }) } }), null)
  })
})

describe('表格提示 · isPipeRow 判据本身', () => {
  const { isPipeRow } = __test__
  test('识别典型表格行', () => {
    assert.equal(isPipeRow('| a | b |'), true)
    assert.equal(isPipeRow('  | sd | s |  '), true, '前后空白应容忍')
    assert.equal(isPipeRow('| --- | --- |'), true, '分隔行本身也是管道行')
  })
  test('拒绝非表格行', () => {
    assert.equal(isPipeRow('普通文字'), false)
    assert.equal(isPipeRow('| 单个竖线'), false, '只有一个竖线不成行')
    assert.equal(isPipeRow('结尾竖线 |'), false, '不以竖线开头不算')
  })
})

// ===========================================================================
// 接线契约：提示必须真的从编辑器流到状态栏，否则就是「检测对了但没人看见」
// ===========================================================================
describe('表格提示 · 接线闭合（防检测到了却无处显示）', () => {
  test('useEditorSession 在更新时调用 checkTableHint', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(fileURLToPath(new URL('../src/composables/useEditorSession.js', import.meta.url))),
      'utf8'
    )
    assert.ok(
      /checkTableHint\(\s*u\.state\s*\)/.test(src),
      'useEditorSession 的 onEditorUpdate 必须调 checkTableHint(u.state) —— ' +
        '不接的话用户输入时提示永远不更新，且没有任何报错'
    )
    assert.ok(
      /checkTableHint\(\s*editorRef\.value\.state\s*\)/.test(src),
      'syncAfterDocReplace 必须手工重算（replaceDocument 走 setState 不触发 ' +
        'updateListener），否则切换文档后上一份文档的提示会残留'
    )
    assert.ok(
      /clearTableHint\(\)/.test(src),
      'onBeforeUnmount 必须清空提示（编辑器销毁后状态栏不该还显示）'
    )
  })

  test('StatusBar 渲染提示且走 t()（不得硬编码文案）', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(fileURLToPath(new URL('../src/components/StatusBar.vue', import.meta.url))),
      'utf8'
    )
    assert.ok(
      /t\(\s*'statusbar\.tableHint'/.test(src),
      "StatusBar 必须用 t('statusbar.tableHint') 取文案 —— 硬编码会切不了语言"
    )
    assert.ok(
      /class="sb-hint"/.test(src),
      'StatusBar 模板缺少提示元素 —— 检测逻辑再对，用户也看不见'
    )
  })

  test('三档字典都有该 key（漏一档 = 该语言下显示 key 原文）', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { join } = await import('node:path')
    for (const loc of ['zh-CN', 'en-US', 'ja-JP']) {
      const src = readFileSync(
        join(fileURLToPath(new URL(`../src/i18n/${loc}.js`, import.meta.url))),
        'utf8'
      )
      assert.ok(
        src.includes("'statusbar.tableHint'"),
        `${loc}.js 缺少 statusbar.tableHint`
      )
    }
  })
})