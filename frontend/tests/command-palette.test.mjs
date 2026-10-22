/**
 * command-palette.test.mjs — ⌘K 命令面板的过滤 / 导航纯逻辑
 * ---------------------------------------------------------------------------
 * 被测对象：composables/commandFilter.js
 *   filterCommands / clampIndex / moveIndex / searchableFields
 *
 * 【为什么这些判据必须存在】
 * 命令面板的价值全在「打得少、找得快」。它有两个静默失败形态，且都极难目视发现：
 *   ① 过滤太严 → 用户输入后列表空了，以为「没有这个命令」（功能其实在）
 *   ② 选中下标越界 → Enter 落到 undefined 上，「按了回车没反应」
 * 故这里断言的是**行为契约**（哪些查询必须命中、越界必须夹回），
 * 而不是「渲染出来长什么样」。
 *
 * 【期望值来源】用户真实输入习惯：中文打「保存」、英文打 save、记 id 打 saveAs、
 * 知道键位打 ⌘S；以及「记得两个碎片词但不记得顺序」时的跨词 AND。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampIndex, filterCommands, moveIndex, searchableFields,
} from '../src/composables/commandFilter.js'

/** 贴近真实 COMMANDS 的最小子集（label 已是翻译后的中文，与运行时一致） */
const COMMANDS = [
  { id: 'file.new', label: '新建', accel: '⌘N' },
  { id: 'file.save', label: '保存', accel: '⌘S' },
  { id: 'file.saveAs', label: '另存为', accel: '⌘⇧S' },
  { id: 'file.exportPdf', label: '导出 PDF', accel: '⌘⇧P' },
  { id: 'file.exportHtml', label: '导出 HTML', accel: '⌘⇧H' },
  { id: 'edit.bold', label: '加粗', accel: '⌘B' },
  { id: 'view.commandPalette', label: '命令面板', accel: '⌘K' },
]

describe('命令面板 · 过滤', () => {
  test('空查询返回全部（面板一打开就要能看见有什么）', () => {
    assert.equal(filterCommands('', COMMANDS).length, COMMANDS.length)
    assert.equal(filterCommands('   ', COMMANDS).length, COMMANDS.length)
    assert.equal(filterCommands(null, COMMANDS).length, COMMANDS.length)
    assert.equal(filterCommands(undefined, COMMANDS).length, COMMANDS.length)
  })

  test('空查询返回的是副本，不是原数组（调用方排序不得污染真源）', () => {
    const out = filterCommands('', COMMANDS)
    assert.notEqual(out, COMMANDS, '必须返回新数组')
    out.reverse()
    assert.equal(COMMANDS[0].id, 'file.new', '原数组顺序不得被改动')
  })

  test('中文子串命中显示名', () => {
    const ids = filterCommands('保存', COMMANDS).map((c) => c.id)
    assert.deepEqual(ids, ['file.save'], '「保存」只应命中「保存」，不应误命中「另存为」以外的项')
  })

  test('中文单字也能命中（不必打全词）', () => {
    const ids = filterCommands('导', COMMANDS).map((c) => c.id)
    assert.deepEqual(ids, ['file.exportPdf', 'file.exportHtml'], '「导」应命中两条导出命令')
  })

  test('英文 id 命中且大小写不敏感', () => {
    for (const q of ['save', 'SAVE', 'SaVe']) {
      const ids = filterCommands(q, COMMANDS).map((c) => c.id)
      assert.ok(ids.includes('file.save'), `${q} 应命中 file.save`)
      assert.ok(ids.includes('file.saveAs'), `${q} 应命中 file.saveAs（子串）`)
    }
  })

  test('键位可被搜索（知道键但记不住菜单在哪）', () => {
    const ids = filterCommands('⌘⇧P', COMMANDS).map((c) => c.id)
    assert.deepEqual(ids, ['file.exportPdf'], '搜 ⌘⇧P 应精确命中导出 PDF')
  })

  test('跨词 AND：「导出 pdf」命中导出 PDF（记碎片词、不记顺序）', () => {
    const ids = filterCommands('导出 pdf', COMMANDS).map((c) => c.id)
    assert.deepEqual(ids, ['file.exportPdf'], '两个词必须都在同一条命令的可搜索文本里')
  })

  test('跨词 AND：全角空格也能切词（中文输入法常见）', () => {
    const ids = filterCommands('导出\u3000PDF', COMMANDS).map((c) => c.id)
    assert.deepEqual(ids, ['file.exportPdf'], 'U+3000 全角空格必须被当作分隔符')
  })

  test('无结果返回空数组（不是 undefined，调用方可安全 .length）', () => {
    const out = filterCommands('不存在的命令xyz', COMMANDS)
    assert.ok(Array.isArray(out), '必须返回数组')
    assert.equal(out.length, 0)
  })

  test('保持入参顺序（顺序由调用方按分组决定，过滤不重排）', () => {
    const ids = filterCommands('导出', COMMANDS).map((c) => c.id)
    assert.deepEqual(ids, ['file.exportPdf', 'file.exportHtml'], '顺序须与 COMMANDS 中一致')
  })

  test('非数组入参不抛错（防御：命令表未就绪时为 undefined）', () => {
    assert.deepEqual(filterCommands('x', undefined), [])
    assert.deepEqual(filterCommands('x', null), [])
  })
})

describe('命令面板 · 可搜索字段口径', () => {
  test('id / label / accel 三者都进入搜索面', () => {
    const f = searchableFields({ id: 'file.saveAs', label: '另存为', accel: '⌘⇧S' })
    assert.ok(f.includes('file.saveas'), 'id 须小写化后进入')
    assert.ok(f.includes('另存为'), 'label 须进入（中文保持原样）')
    assert.ok(f.includes('⌘⇧s'), 'accel 须小写化后进入（⇧S 的 S）')
  })

  test('accel 为 null 时不产生空字段（空串会命中一切查询）', () => {
    const f = searchableFields({ id: 'file.rename', label: '重命名', accel: null })
    assert.equal(f.length, 2, '无 accel 时只有 id 与 label 两个字段')
    assert.ok(!f.includes(''), '绝不能出现空串字段 —— 它会让任何查询都命中')
  })
})

describe('命令面板 · 选中下标导航', () => {
  test('clampIndex：越界夹回两端', () => {
    assert.equal(clampIndex(0, 3), 0)
    assert.equal(clampIndex(2, 3), 2)
    assert.equal(clampIndex(9, 3), 2, '超出上限夹到末项')
    assert.equal(clampIndex(-5, 3), 0, '负下标夹到首项')
  })

  test('clampIndex：空列表返回 0（Enter 由调用方判空拦截）', () => {
    assert.equal(clampIndex(3, 0), 0)
    assert.equal(clampIndex(0, -1), 0)
  })

  test('moveIndex：上下移动并循环', () => {
    assert.equal(moveIndex(0, 1, 3), 1)
    assert.equal(moveIndex(2, 1, 3), 0, '末项向下回到首项')
    assert.equal(moveIndex(0, -1, 3), 2, '首项向上回到末项')
  })

  test('moveIndex：空列表不动（返回 0，不抛错）', () => {
    assert.equal(moveIndex(0, 1, 0), 0)
  })

  test('moveIndex：从越界位置移动也不脱轨', () => {
    // 【真实场景】过滤缩小后 selected 可能仍停在旧的下标上（如 9，而新列表只有 3 项）。
    // 此时按 ↓ 绝不能落到 undefined 上 —— 必须先夹回合法范围再位移。
    // 推导：clampIndex(9,3)=2（末项）→ (2+1)%3=0（循环回首项）。
    assert.equal(moveIndex(9, 1, 3), 0, '越界下标须先夹回末项(2)，再 +1 循环回首项(0)')
    // 反向同理：clampIndex(-5,3)=0 → (0-1+3)%3=2（末项）
    assert.equal(moveIndex(-5, -1, 3), 2, '负下标须先夹回首项(0)，再 -1 循环到末项(2)')
  })
})

// ===========================================================================
// 视觉层级契约（模态覆盖层必须压过提示与弹窗）
// ===========================================================================
import { readFileSync } from 'node:fs'
describe('命令面板 · 视觉层级', () => {
  const src = readFileSync(
    new URL('../src/components/CommandPalette.vue', import.meta.url), 'utf8')

  test('遮罩 z-index 必须高于 toast(1300) 与 dialog(1400)', () => {
    const m = src.match(/z-index:\s*(\d+)/)
    assert.ok(m, 'palette-mask 必须声明 z-index')
    const z = Number(m[1])
    assert.ok(z > 1400, `面板是模态覆盖层，z-index(${z}) 必须高于 toast/dialog(1300/1400)，否则保存失败 toast 会盖住输入框`)
  })
})
