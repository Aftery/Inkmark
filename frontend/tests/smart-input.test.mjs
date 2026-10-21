/**
 * smart-input.test.mjs — 智能符号补全 + 智能标点的纯逻辑
 * ---------------------------------------------------------------------------
 * 被测对象：editor/smartInput.js 的 decide / backspacePlan / inCodeAt，
 *           editor/smartPunct.js 的 smartPunctFor / quoteFor / isCjkContext。
 *
 * 【为什么这些必须是行为测试而不是源码正则】自动配对的失败形态全是「多一个字符 /
 * 少一个字符」的静默产物：`**粗体***`、`don''t`、`snake__case`、行首 `* |*`。
 * 只有把「文本 + 光标 + 键入字符」真喂进去、断言产出的变更集，才能钉住语义。
 *
 * 【期望值来源】CommonMark 的 flanking / intraword 规则、VS Code 的
 * languageDefined 启发式、以及本仓对「代码块内不干预」的既有裁决 —— 不是
 * 「跑一遍实现拿输出当期望」。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, backspacePlan } from '../src/editor/smartInput.js'
import { smartPunctFor, quoteFor, isCjkContext, fullwidthOf } from '../src/editor/smartPunct.js'

/** 把变更集套到局部文本上，得到「按键之后」的文档，并把光标换算成绝对下标 */
function apply(text, plan) {
  if (!plan) return { text, caret: null }
  let out = text
  for (const c of [...(plan.changes ?? [])].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to ?? c.from)
  }
  return { text: out, caret: plan.selection.anchor }
}

/**
 * 在文本的 `|` 处模拟一次键入。
 * plan 为 null = 放行给 CM 默认插入，此时**必须等价于「字符原样落一个」** ——
 * 这正是「不干预」的语义，不能让测试误以为字符消失了。
 */
function type(marked, ch, opts = {}) {
  const from = marked.indexOf('|')
  assert.ok(from >= 0, '用例必须用 | 标出光标')
  const text = marked.slice(0, from) + marked.slice(from + 1)
  const plan = decide(text, from, from, ch, opts)
  if (!plan) {
    return { plan, text: text.slice(0, from) + ch + text.slice(from), caret: from + 1 }
  }
  const res = apply(text, plan)
  return { plan, text: res.text, caret: res.caret ?? from + 1 }
}

/** 带光标的期望值写法：把期望文本里的 `|` 换成光标下标 */
function expectText(marked) {
  return { text: marked.replace('|', ''), caret: marked.indexOf('|') }
}

describe('智能符号 · 空光标处的成对补全', () => {
  test('每个登记的左符号都会补出右半并把光标放在中间', () => {
    // 期望值 = 用户敲一个符号后「能直接继续写内容」的最小产物。
    // `*` / `_` / `` ` `` / `"` 刻意从一个已有字符之后录入：行首裸 `*` 是列表
    // 标记位、词内 `_` 是 snake_case，两者都属「不该配对」（见下面各条）。
    const table = [
      ['a|', '*', 'a*|*'],
      ['a |', '_', 'a _|_'],
      ['a|', '`', 'a`|`'],
      ['|', '[', '[|]'],
      ['|', '(', '(|)'],
      ['a|', '"', 'a"|"'],
    ]
    for (const [marked, ch, expected] of table) {
      const r = type(marked, ch)
      assert.deepEqual({ text: r.text, caret: r.caret }, expectText(expected), `键入 ${ch}`)
    }
  })

  test('行首裸 * 是列表标记位，不配对（否则按空格写出 `* |*`）', () => {
    const r = type('|', '*')
    assert.equal(r.text, '*', '行首的 * 必须原样落一个字')
    assert.equal(r.plan, null, '应完全放行给 CM 默认插入')
  })

  test('列表项内部的 * 同样视作标记位，不配对', () => {
    const r = type('- |', '*')
    assert.equal(r.text, '- *')
  })

  test('词内 _ 不配对（snake_case），词后/词首才配对', () => {
    // CommonMark 的 intraword emphasis 对 `_` 是关闭的：`snake_case` 里的下划线
    // 本来就不会渲染成强调，配对只会把标识符拆坏
    assert.equal(type('snake|', '_').text, 'snake_')
    assert.deepEqual(
      { text: type('snake |', '_').text, caret: type('snake |', '_').caret },
      expectText('snake _|_'),
    )
  })

  test("词内 ' 是撇号，不配对（don't）", () => {
    assert.equal(type('don|', "'").text, "don'")
    assert.deepEqual(
      { text: type("|", "'").text, caret: type("|", "'").caret },
      expectText("'|'"),
    )
  })

  test('左括号后紧接单词字符时不配对（用户更可能想包住已有文字）', () => {
    assert.equal(type('|abc', '(').text, '(abc', '后接单词字符 → 不配对，只落一个左括号')
    assert.equal(type('| abc', '(').text, '() abc', '后接空格 → 配对')
    assert.equal(type('|[', '(').text, '()[', '后接非单词字符 → 配对')
  })

  test('已被反斜杠转义的字符不配对', () => {
    const r = type('\\|', '*')
    assert.equal(r.text, '\\*', '前有反斜杠时按字面量插入')
  })

  test('代码上下文一律不干预（arr[0] / a * b 不该被配对打断）', () => {
    for (const ch of ['[', '(', '*', '`']) {
      const plan = decide('', 0, 0, ch, { inCode: true })
      assert.equal(plan, null, `代码内键入 ${ch} 必须放行`)
    }
  })

  test('开关关闭时完全不干预', () => {
    const plan = decide('', 0, 0, '*', { autoPair: false })
    assert.equal(plan, null)
  })
})

describe('智能符号 · 越过已存在的闭合符', () => {
  test('光标后是配对的右符 → 只移动光标，不重复插入', () => {
    // 手工敲出来的 `**粗体**`，在结尾处再按一次 * 应「越过」而不是变成 ***
    const marked = '**粗体*|**'
    const from = marked.indexOf('|')
    const text = marked.replace('|', '')
    const plan = decide(text, from, from, '*', {})
    assert.equal(plan.changes, null, '越过不应产生文档变更')
    assert.equal(plan.selection.anchor, from + 1)
  })

  test('越过对异形成对符号同样生效（[] / ()）', () => {
    const plan = decide('[]', 1, 1, ']', {})
    assert.equal(plan.changes, null)
    assert.equal(plan.selection.anchor, 2)
  })

  test('被转义的闭合符不越过（\\* 是字面量）', () => {
    const plan = decide('\\*', 1, 1, '*', {})
    assert.notEqual(plan?.changes, null, '转义场景应按普通插入处理')
  })
})

describe('智能符号 · 选区包裹', () => {
  test('有选区时包裹而非替换，且选区仍框住内容', () => {
    const text = 'hello world'
    const plan = decide(text, 0, 5, '*', {})
    const out = apply(text, plan)
    // 单个 `*` = 斜体对（`**` 需要用户敲第二颗星，见「越过」用例）
    assert.equal(out.text, '*hello* world')
    assert.deepEqual(
      [plan.selection.anchor, plan.selection.head],
      [1, 6],
      '包裹后选区必须仍是原内容（继续输入即替换、点一下即取消）',
    )
  })

  test('跨行选区不做行内强调包裹（产物不会渲染）', () => {
    const text = 'a\nb'
    assert.equal(decide(text, 0, 3, '*', {}), null)
    assert.equal(decide(text, 0, 3, '`', {}), null)
  })
})

describe('智能符号 · 三连反引号围栏', () => {
  test('行首敲第三个反引号 → 展开成围栏块，光标落在块内空行', () => {
    const text = '``'
    const plan = decide(text, 2, 2, '`', {})
    const out = apply(text, plan)
    assert.equal(out.text, '```\n\n```', '必须产出首尾两块围栏')
    // 光标在第二行（` ```\n` 之后 = 下标 4）
    assert.equal(plan.selection.anchor, 4)
  })

  test('行内已有其它内容时不展开（只在行首成块）', () => {
    // 不是围栏：退回普通成对补全（再补一对反引号），doc 结构不被改写成块
    const plan = decide('``x', 2, 2, '`', {})
    assert.equal(plan.changes.length, 1, '只应是一次插入')
    assert.equal(plan.changes[0].insert, '``')
    const after = decide('a``', 3, 3, '`', {})
    assert.equal(after.changes[0].insert, '``', '行首没有 `` 前缀 → 不当围栏')
  })
})

describe('智能符号 · 成对退格', () => {
  test('光标夹在空配对中间时一次删两侧', () => {
    for (const s of ['[]', '()', '``', '""', '**', '__']) {
      const pos = 1
      const plan = backspacePlan(s, pos)
      assert.deepEqual(plan, { from: 0, to: 2, insert: '' }, `${s} 应整体删除`)
    }
  })

  test('`**|**` 不是空配对（两侧还有同形符号）→ 交给默认退格', () => {
    assert.equal(backspacePlan('****', 2), null)
  })

  test('中间有内容时不整体删除', () => {
    assert.equal(backspacePlan('[abc]', 4), null)
    assert.equal(backspacePlan('[]', 0), null)
  })
})

describe('智能标点 · 中文语境全角化', () => {
  test('CJK 语境下的半角标点转全角', () => {
    const cases = [
      [',', '，'],
      ['.', '。'],
      ['?', '？'],
      ['!', '！'],
      [':', '：'],
      [';', '；'],
      ['(', '（'],
      [')', '）'],
    ]
    for (const [half, full] of cases) {
      const text = `中文${half}`
      const pos = text.length - 1
      assert.equal(smartPunctFor(text, pos, half)?.ch, full, `${half} → ${full}`)
      assert.equal(fullwidthOf(half), full, '映射表与解析结果必须同源')
    }
  })

  test('ASCII 语境一律不动（Hello, world 不能被改）', () => {
    assert.equal(smartPunctFor('Hello,', 5, ','), null)
    assert.equal(smartPunctFor(',', 0, ','), null, '行首无前文时不替换')
  })

  test('跨空格仍算中文语境（`你好 ，` 是常见写法）', () => {
    // 判定依据是「更前一个非空白字符是 CJK」，不是「紧邻字符是 CJK」
    assert.equal(isCjkContext('你好  ', 4), true)
    assert.equal(smartPunctFor('你好 ', 3, ',')?.ch, '，', '空格之后仍应全角化')
    assert.equal(smartPunctFor('abc ', 4, ','), null, '空格前是 ASCII → 不动')
  })

  test('代码内不替换由调用方拦（smartPunctFor 本身不做代码判定）', () => {
    // 这条是分工说明的机检：smartInput.decide 在 inCode 时整体放行
    assert.equal(decide('中文,', 3, 3, ',', { smartPunct: 'curly', inCode: true }), null)
  })
})

describe('智能标点 · 引号配平', () => {
  test('行内无开引号时键入 " → 开引号，再键入 → 闭引号', () => {
    assert.equal(quoteFor('中文', 2, '"'), '\u201C')
    assert.equal(quoteFor('中文\u201C引文', 5, '"'), '\u201D', '已有开引号 → 本次是闭合')
  })

  test('删掉一半引号后不会整体反相（就近配平而非交替）', () => {
    // 只有开引号（闭引号被删）→ 下一次仍是闭合，不会误判成再开一个
    assert.equal(quoteFor('他\u201C说', 3, '"'), '\u201D')
    assert.equal(quoteFor('他\u201C说', 3, '"'), '\u201D')
  })

  test("单引号同样配平（'中文语录'）", () => {
    assert.equal(quoteFor('中文', 2, "'"), '\u2018')
    assert.equal(quoteFor('中文\u2018引用', 5, "'"), '\u2019')
  })

  test('英文语境不改引号（It\'s 里的撇号方向会错）', () => {
    assert.equal(quoteFor('It', 2, "'"), null)
    assert.equal(quoteFor('say', 3, '"'), null)
  })

  test('开引号后自动补闭引号，光标落在中间', () => {
    const text = '中文'
    const plan = decide(text, 2, 2, '"', { smartPunct: 'curly' })
    const out = apply(text, plan)
    assert.equal(out.text, '中文\u201C\u201D')
    assert.equal(plan.selection.anchor, 3)
  })

  test('智能标点关闭时引号保持半角（不悄悄改字符）', () => {
    const plan = decide('中文', 2, 2, '"', { smartPunct: 'off' })
    assert.equal(apply('中文', plan).text, '中文""', '关掉开关就是直引号成对，不得偷换成弯引号')
  })

  test('直角引号档：「」成对，开闭方向由行内配平决定', () => {
    const open = decide('中文', 2, 2, '"', { smartPunct: 'corner' })
    assert.equal(apply('中文', open).text, '中文「」', '开引号 → 补出「」并把光标放中间')

    // 已有开引号时，再敲一次就是闭合（不重复开）
    const text = '中文「引文'
    const close = decide(text, text.length, text.length, '"', { smartPunct: 'corner' })
    assert.equal(apply(text, close).text, '中文「引文」')
  })

  test('直角引号档下单引号是『』（与「」成对出现，不混用弯引号）', () => {
    const plan = decide('中文', 2, 2, "'", { smartPunct: 'corner' })
    assert.equal(apply('中文', plan).text, '中文『』')
  })

  test('lexical 兼容：smartPunct 传布尔 true 等同于弯引号档', () => {
    const plan = decide('中文', 2, 2, '"', { smartPunct: true })
    assert.equal(apply('中文', plan).text, '中文\u201C\u201D')
  })
})
