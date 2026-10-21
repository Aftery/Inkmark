/**
 * editor-wiring.test.mjs — 新交互扩展的接线契约（顺序 / 覆盖 / 开关联动）
 * ---------------------------------------------------------------------------
 * 【为什么需要这一层】纯函数测试证明「规则对」，但这一整轮改动里最容易静默
 * 失效的是**接线**，而它在纯函数层完全看不见：
 *   ① keymap 顺序 —— listIndent 若排在 indentWithTab 之后，Tab 永远轮不到列表
 *      缩进（不报错，只是行为没变）；
 *   ② inputHandler 是否真的进了扩展列表（函数写了但没装 = 用户按了没反应）；
 *   ③ 偏好开关是否真的被读到（读错 key 会导致开关永远「关」）；
 *   ④ 命令表 ↔ 处理器注册面双向闭合（门禁已有，这里补一条针对新命令的定点断言，
 *      避免将来有人只删一半）。
 *
 * 判据一律是「真实模块的导出与扩展结构」，不是源码正则 —— 正则连注释里的绑定
 * 都会算通过（HANDOFF §4 ⑲ 的教训）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { smartInputExtension, decide, inCodeAt } from '../src/editor/smartInput.js'
import { listIndentExtension } from '../src/editor/listIndentKeymap.js'
import { listIndentChanges } from '../src/editor/listIndent.js'
import { COMMANDS } from '../src/composables/useShortcuts.js'
import { PREFS_DEFAULTS, PREF_OPTIONS } from '../src/themes/prefs.js'

/**
 * 取某个扩展贡献的 keymap 绑定（只算它自己那份）。
 * 【为什么要做差集】markdown() 语言包自带 Enter/Backspace（continue-markup），
 * 直接读整个 facet 会把它们算进来 —— 那样断言「Tab 绑上了」即使没绑也可能
 * 因为别的键存在而通过，是典型的假绿。
 */
function boundKeys(ext) {
  const base = EditorState.create({
    doc: '',
    extensions: [markdown({ base: markdownLanguage })],
  }).facet(keymap).flat()
  const withExt = EditorState.create({
    doc: '',
    extensions: [markdown({ base: markdownLanguage }), ext],
  }).facet(keymap).flat()
  const seen = new Set(base.map((b) => b.key))
  return withExt.filter((b) => !seen.has(b.key)).map((b) => b.key)
}

/** 取某个扩展新增的 inputHandler 数量（CM 的 inputHandler 是 facet，需做差集） */
function inputHandlerCount(ext, EditorView) {
  const base = EditorState.create({
    doc: '',
    extensions: [markdown({ base: markdownLanguage })],
  }).facet(EditorView.inputHandler).length
  const withExt = EditorState.create({
    doc: '',
    extensions: [markdown({ base: markdownLanguage }), ext],
  }).facet(EditorView.inputHandler).length
  return withExt - base
}

describe('接线 · 列表缩进 keymap', () => {
  test('Tab 与 Shift+Tab 都绑上了（且 shift 形态不是漏的）', () => {
    const keys = boundKeys(listIndentExtension())
    assert.deepEqual(keys.sort(), ['Shift-Tab', 'Tab'], `实际绑定：${JSON.stringify(keys)}`)
  })

  test('该扩展必须先于 indentWithTab 声明（顺序错了 Tab 会被通用缩进抢走）', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/editor/createEditor.js', import.meta.url), 'utf8'),
    )
    // 只在 extensions 数组体内找锚点：注释里也出现过这两个词，全文 indexOf 会
    // 匹到注释（本仓「注释抢先命中」已经坑过一次门禁自证）。
    const body = src.slice(src.indexOf('extensions: ['))
    const expand = body.indexOf('listIndentExtension()')
    const tab = body.indexOf('indentWithTab,')
    assert.ok(expand > 0 && tab > 0, `两处锚点都必须存在（否则判据失效，不得假绿）：${expand}/${tab}`)
    assert.ok(
      expand < tab,
      'listIndentExtension() 必须写在 indentWithTab 之前 —— CM 的 keymap 按扩展声明顺序定优先级',
    )
  })

  test('缩进扩展对非列表行返回空（不吞掉代码块的 Tab）', async () => {
    const { Text } = await import('@codemirror/state')
    const doc = Text.of(['```js', 'const a = 1', '```'])
    assert.equal(listIndentChanges(doc, [{ from: 0, to: 0 }], 1), null)
  })
})

describe('接线 · 智能符号 inputHandler', () => {
  test('扩展里真的挂了 inputHandler（写了没装 = 按键没反应）', async () => {
    const { EditorView } = await import('@codemirror/view')
    const ext = smartInputExtension(() => ({ smartPair: 'on', smartPunct: 'off' }))
    assert.equal(inputHandlerCount(ext, EditorView), 1, '必须恰好一个 inputHandler')
  })

  test('扩展同时提供成对退格键位（markdown 自带 Backspace，故按新增数判定）', async () => {
    const { EditorView } = await import('@codemirror/view')
    const count = (ext) =>
      EditorState.create({ doc: '', extensions: [markdown({ base: markdownLanguage }), ext] })
        .facet(keymap)
        .flat()
        .filter((b) => b.key === 'Backspace').length
    const before = count([])
    const after = count(smartInputExtension(() => ({ smartPair: 'on' })))
    assert.equal(after, before + 1, '成对退格必须额外绑一个 Backspace 处理器')
    assert.ok(EditorView, '保持 EditorView 引用，避免误删导入')
  })

  test('偏好每次按键现读（设置面板切换后立即生效，无需重建编辑器）', async () => {
    const { EditorView } = await import('@codemirror/view')
    let prefs = { smartPair: 'off' }
    const ext = smartInputExtension(() => prefs)
    assert.equal(inputHandlerCount(ext, EditorView), 1)
    prefs = { smartPair: 'on' }
    assert.equal(inputHandlerCount(ext, EditorView), 1, '扩展结构与开关无关，读的是调用时的值')
  })

  test('代码上下文判定直接吃真语法树（行内代码 / 围栏都算代码）', async () => {
    const { ensureSyntaxTree } = await import('@codemirror/language')
    const state = EditorState.create({
      doc: ['```js', 'const a = 1', '```', '', '行内 `code` 片段'].join('\n'),
      extensions: [markdown({ base: markdownLanguage })],
    })
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)
    assert.ok(tree, '语法树必须可用（否则判据无效）')
    // 围栏内的位置
    assert.equal(inCodeAt(tree, 12), true, '围栏代码块内应判为代码')
    // 行内代码内部
    const inline = state.doc.toString().indexOf('code')
    assert.equal(inCodeAt(tree, inline), true, '行内代码内应判为代码')
    // 普通正文
    assert.equal(inCodeAt(tree, 0), false, '围栏之外不是代码')
  })
})

describe('接线 · 新增偏好项', () => {
  test('两个开关都有出厂默认值与合法取值白名单（漏一个就静默失效）', () => {
    for (const key of ['smartPair', 'smartPunct']) {
      assert.ok(key in PREFS_DEFAULTS, `PREFS_DEFAULTS 缺 ${key}`)
      assert.ok(Array.isArray(PREF_OPTIONS[key]), `PREF_OPTIONS 缺 ${key}`)
      assert.ok(
        PREF_OPTIONS[key].includes(PREFS_DEFAULTS[key]),
        `${key} 的默认值必须落在白名单里，否则 setPref 永远写不进去`,
      )
    }
  })

  test('默认值口径：补全默认开、智能标点默认关（强干预需显式授权）', () => {
    assert.equal(PREFS_DEFAULTS.smartPair, 'on')
    assert.equal(PREFS_DEFAULTS.smartPunct, 'off')
    // 引号形态是三档而不是布尔：用户点名了直角引号，不能只给「开/关」
    assert.deepEqual(PREF_OPTIONS.smartPunct, ['off', 'curly', 'corner'])
  })
})

describe('接线 · 标题命令', () => {
  test('⌘1~⌘6 / ⌘⌥0 / ⌘⌥↑↓ 都在命令表里且键位唯一', () => {
    const ids = ['format.h1', 'format.h2', 'format.h3', 'format.h4', 'format.h5', 'format.h6',
      'format.body', 'format.headingUp', 'format.headingDown']
    const accels = new Map()
    for (const id of ids) {
      const c = COMMANDS.find((x) => x.id === id)
      assert.ok(c, `命令表缺 ${id}`)
      assert.ok(c.accel, `${id} 必须有键位`)
      assert.ok(!accels.has(c.accel), `键位 ${c.accel} 被 ${id} 与 ${accels.get(c.accel)} 同时占用`)
      accels.set(c.accel, id)
    }
    assert.deepEqual([...accels.keys()], ['⌘1', '⌘2', '⌘3', '⌘4', '⌘5', '⌘6', '⌘⌥0', '⌘⌥↑', '⌘⌥↓'])
  })

  test('⌘0 / ⌘= / ⌘- 仍是视图缩放（不得被标题命令抢走）', () => {
    const zoom = ['view.zoomIn', 'view.zoomOut', 'view.zoomReset'].map((id) => {
      const c = COMMANDS.find((x) => x.id === id)
      assert.ok(c, `命令表缺 ${id}`)
      return c.accel
    })
    assert.deepEqual(zoom, ['⌘=', '⌘-', '⌘0'])
  })
})

describe('接线 · 规则可被独立驱动（不依赖编辑器实例）', () => {
  test('decide 的开关组合语义：只开标点也必须生效', () => {
    // 关闭配对、开启智能标点，「中文,」仍应被全角化 —— 两个开关互不牵连
    const plan = decide('中文', 2, 2, ',', { autoPair: false, smartPunct: 'curly' })
    assert.equal(plan.changes[0].insert, '，')
  })

  test('decide 对多字符输入一律放行（粘贴不走智能补全）', () => {
    assert.equal(decide('', 0, 0, 'ab', {}), null)
  })
})
