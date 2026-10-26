/**
 * footnote-inline.test.mjs — 脚注在编辑器侧的装饰契约（2026-10-25 新增）
 * ---------------------------------------------------------------------------
 * 被测对象：frontend/src/editor/inlineExtras.js（isFootnoteLabel /
 * scanFootnoteRefs / footnoteDefRange / footnoteDefLines）+ wysiwyg.js 的两处
 * 接线（Link 分支、LinkReference 分支）+ markdown-it 侧的对照。
 *
 * 【为什么这组必须是机检】本轮三个缺陷**全都不抛异常、不留日志**，界面表现
 * 只是「少了一段字」：
 *
 *   A) 同一行多个脚注：lezer 把 `文字[^1]，还可以有命名脚注[^note]。` 合并成
 *      **一个** Link 节点（内部文本 `^1]，还可以有命名脚注[^note`）。旧判据只看
 *      `^` 前缀 ⇒ 这 20 字符整段被一个脚注 widget 顶掉 ⇒ 中间正文凭空消失，
 *      屏幕上只剩一个上标 1。这类「内容丢失」没有任何报错，用户只会觉得
 *      「编辑器把字吃了」。
 *   B) 多行脚注定义的缩进续行：lezer 只把首行算进 LinkReference，续行掉成
 *      Paragraph / CodeBlock（缩进 4 空格就是代码块）。旧实现只隐藏首行 ⇒
 *      编辑器里半条脚注内容 + 一段代码块，而预览/导出里是完整一条 ——
 *      **同一份文档两副面孔**，正是本轮反复在修的主线。
 *   C) 行内危险容器残留转义文本（见 tests/markdown-html.test.mjs 那条零残余用例，
 *      本文件不重复）。
 *
 * 判据来源（不拿实现输出当期望）：
 *   - 「两个脚注 = 两个 widget」来自 Markdown 脚注的领域定义（引用是行内短语，
 *     不是行级结构）；「中间正文没被任何 replace 覆盖」是缺陷 A 的决定性判据，
 *     不是「看起来对不对」。
 *   - 续行口径来自 markdown-it-footnote 的公开行为（紧跟定义行 + 缩进 ≥1 空格，
 *     空行终止）—— 故本文件有一组「编辑器 vs 渲染器不许分叉」的对照。
 *
 * 全部走**真实 EditorState + buildDecorations**（照 image-asset-context.test.mjs
 * 的写法），不拿源码正则假装验证。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { buildDecorations, wysiwygField } from '../src/editor/wysiwyg.js'
import { createRenderer, render } from '../src/preview/markdown.js'
import { initI18n } from '../src/i18n/index.js'

/**
 * 哨兵尾巴：把光标停在这里，让被测内容所处行**不是活跃行**。
 *
 * 【为什么必须这么做 —— 实测踩到的第一个坑】buildDecorations 按「活跃行显示源码」
 * 工作（activeLineSet 还会把选区上下各扩 1 行）。最初把选区放在 anchor:0、
 * 内容就在第 1 行，结果**所有装饰都是空的** —— 断言「没有 replace」会假绿。
 * 故统一在文档尾部追加两段哨兵，光标落在最后。
 */
const SENTINEL = '\n\n哨兵\n\n哨兵二\n'

initI18n()

/** 造一个只装本组关心的扩展的 EditorState（不装插件，直接驱动纯函数） */
function mkState(doc) {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage }), wysiwygField],
  })
}

/**
 * 跑一遍 buildDecorations，返回装饰集里的条目（含 widget 名与被覆盖的原文）。
 * @param {string} body 被测正文（哨兵会自动追加）
 */
function decorationsOf(body) {
  const doc = body + SENTINEL
  const state = mkState(doc)
  const { deco, atomic } = buildDecorations(state, [{ from: 0, to: doc.length }])
  const items = []
  deco.between(0, doc.length, (from, to, val) => {
    items.push({
      from,
      to,
      text: doc.slice(from, to),
      widget: val.widget ? val.widget.constructor.name : null,
      label: val.widget?.label,
      cls: val.spec?.class ?? null,
      atomic: null,
    })
  })
  // atomic 集合 = 被 replace 的区间（光标不能落在里面），缺陷 A 的判据要用它
  const atomics = []
  atomic.between(0, doc.length, (from, to) => atomics.push({ from, to }))
  // 把 atomic 标记回填到 items（同一区间即同一条 replace）
  for (const it of items) {
    it.atomic = atomics.some((a) => a.from === it.from && a.to === it.to)
  }
  return { items, doc, bodyStart: 0, bodyEnd: body.length }
}

const footnotesOf = (items) => items.filter((i) => i.widget === 'FootnoteRefWidget')
/** 去掉行尾换行后的长度（用来圈定「widget 之后的正文」区间） */
const DOC_LINE = (lineText) => lineText.replace(/\n$/, '').length
const replacesIn = (items, from, to) => items.filter((i) => i.widget && i.from < to && i.to > from)

// ===========================================================================
// 0) 判据自检 —— 先证明「探测器」本身能分辨好坏，否则后面全是假绿
// ===========================================================================
describe('探测手段自检 · 装饰探测器必须真的看得见东西', () => {
  test('单个脚注确实被替换成 widget（否则「没有 replace」类断言必然假绿）', () => {
    const { items } = decorationsOf('文字[^1] 结束\n')
    const fn = footnotesOf(items)
    assert.equal(fn.length, 1, `应有 1 个脚注 widget，实际 ${fn.length}（探测器或装饰集为空）`)
    assert.equal(fn[0].text, '[^1]', `widget 应覆盖源码 [^1]，实际覆盖 ${JSON.stringify(fn[0].text)}`)
    assert.equal(fn[0].label, '1', 'widget 的 label 应是去掉 ^ 的编号')
    assert.ok(fn[0].atomic, '脚注 replace 必须进 atomic 集合（否则光标能落进被替换区间）')
  })

  test('哨兵确实把光标挪开（活跃行会让装饰整体为空）', () => {
    // 反证：不追加哨兵、光标停在内容行 → 该行活跃 → 不产 widget
    const docActive = '文字[^1] 结束\n'
    const state = EditorState.create({
      doc: docActive,
      selection: { anchor: 0 },
      extensions: [markdown({ base: markdownLanguage }), wysiwygField],
    })
    const { deco } = buildDecorations(state, [{ from: 0, to: docActive.length }])
    let count = 0
    deco.between(0, docActive.length, (from, to, val) => {
      if (val.widget && val.widget.constructor.name === 'FootnoteRefWidget') count++
    })
    assert.equal(count, 0, '活跃行本不该产 widget —— 若这里也有，说明本组的哨兵前提写错了')
  })
})

// ===========================================================================
// 1) 缺陷 A：同一行多个脚注
// ===========================================================================
describe('缺陷 A · 同一行多个脚注不许吞掉中间正文', () => {
  // 真机截图里的原句（两个脚注 + 中间一段正文）
  const DOC = '这是一段带脚注的文字[^1]，还可以有命名脚注[^note]。\n'

  test('同一行两个脚注 → 恰好产出两个 FootnoteRefWidget（不是一个大 widget）', () => {
    const { items } = decorationsOf(DOC)
    const fn = footnotesOf(items)
    assert.equal(fn.length, 2, `应产出 2 个脚注 widget，实际 ${fn.length}`)
    assert.deepEqual(
      fn.map((f) => f.text),
      ['[^1]', '[^note]'],
      '两个 widget 应分别精确覆盖 [^1] 与 [^note]'
    )
    assert.deepEqual(fn.map((f) => f.label), ['1', 'note'], '第二个命名脚注的 label 应是 note')
  })

  test('**决定性判据**：中间正文没有被任何 replace 覆盖', () => {
    // 旧实现的现场：一个覆盖 20 字符的 widget 从 `[^1]` 一路吃到 `[^note]`，
    // 把「]，还可以有命名脚注[」这段正文一起换掉。
    const { items } = decorationsOf(DOC)
    const first = footnotesOf(items)[0]
    const second = footnotesOf(items)[1]
    assert.ok(first && second, '先决条件：两个 widget 都必须在')
    // 两个 widget 之间的整段区间（= 中间正文）不许与任何 replace 相交
    const between = { from: first.to, to: second.from }
    const text = DOC.slice(between.from, between.to)
    // 两个 widget 之间恰好是「], 还可以有命名脚注[」中间的那段正文（实测偏移 14..23）
    assert.equal(text, '，还可以有命名脚注', `区间取值与预期不符（排版问题？实际 ${JSON.stringify(text)}）`)
    assert.ok(!/[\[\]^]/.test(text), `中间正文里不该出现脚注语法字符：${JSON.stringify(text)}`)
    const offenders = replacesIn(items, between.from, between.to)
    assert.deepEqual(
      offenders.map((o) => `${o.widget}(${o.from}..${o.to} ${JSON.stringify(o.text)})`),
      [],
      '中间正文被 replace 覆盖了 —— 这正是缺陷 A：第二个脚注连同中间文字被一起吞掉'
    )
  })

  test('中间正文**没有**被染成链接色（合并型 Link 不上 cm-md-link）', () => {
    // 旧实现把合并 Link 的文字区间整体 mark 成链接色，那 20 字符会变成蓝色。
    const { items } = decorationsOf(DOC)
    const linkMarks = items.filter((i) => i.cls === 'cm-md-link')
    assert.deepEqual(
      linkMarks.map((m) => JSON.stringify(m.text)),
      [],
      '脚注行出现了链接色 —— 合并型 Link 的文字区间不是链接，不该上 cm-md-link'
    )
  })

  test('三个脚注也逐个产出（不是「只处理前两个」）', () => {
    const { items } = decorationsOf('a[^1] b[^two] c[^3]\n')
    assert.deepEqual(
      footnotesOf(items).map((f) => f.label),
      ['1', 'two', '3'],
      '三个脚注应逐个替换'
    )
  })

  test('单个脚注仍走节点分支（回归：修复不能把简单情形也推给行级扫描而失效）', () => {
    const { items } = decorationsOf('文字[^1] 中间正文\n')
    const fn = footnotesOf(items)
    assert.equal(fn.length, 1)
    assert.equal(fn[0].text, '[^1]')
    // 中间正文（widget 之后到行尾）不许被覆盖
    const lineEnd = DOC_LINE('文字[^1] 中间正文\n')
    assert.deepEqual(
      replacesIn(items, fn[0].to, lineEnd),
      [],
      `单个脚注后面的正文被覆盖了（widget 到 ${fn[0].to}，行尾 ${lineEnd}）`
    )
  })
})

// ===========================================================================
// 2) 代码上下文里的 `[^1]` 不许变成脚注
// ===========================================================================
describe('代码上下文 · `[^1]` 保持源码', () => {
  test('行内代码里的 `[^1]` 不产脚注 widget', () => {
    const { items } = decorationsOf('代码 `[^1]` 结束\n')
    assert.deepEqual(
      footnotesOf(items).map((f) => f.text),
      [],
      '行内代码里的 [^1] 被当成了脚注引用（它只是代码文本）'
    )
  })

  test('围栏代码里的 `[^1]` 不产脚注 widget', () => {
    const { items } = decorationsOf('```\n[^1]\n```\n')
    assert.deepEqual(
      footnotesOf(items).map((f) => f.text),
      [],
      '围栏代码里的 [^1] 被当成了脚注引用'
    )
    // 代码块本身仍要有底色类（证明这一行确实被当作代码处理过，不是整体没跑）
    assert.ok(
      items.some((i) => i.cls === 'cm-md-codeblock'),
      '围栏代码块缺少 cm-md-codeblock 行类 —— 装饰根本没跑到这一段'
    )
  })
})

// ===========================================================================
// 3) 图片 alt 里的 `[^x]` 归 ImageWidget
// ===========================================================================
describe('`![^x](a.png)` · 走图片 widget，不是脚注', () => {
  test('产出 ImageWidget 且**没有** FootnoteRefWidget', () => {
    const { items } = decorationsOf('![^x](a.png)\n')
    assert.deepEqual(footnotesOf(items).map((f) => f.text), [], '图片 alt 里的 [^x] 被当成了脚注')
    const imgs = items.filter((i) => i.widget === 'ImageWidget')
    assert.equal(imgs.length, 1, `应产出 1 个 ImageWidget，实际 ${imgs.length}`)
    assert.equal(imgs[0].text, '![^x](a.png)', '图片 widget 应整体覆盖源码')
  })
})

// ===========================================================================
// 4) 缺陷 B：多行脚注定义
// ===========================================================================
describe('缺陷 B · 多行脚注定义连缩进续行一起隐藏', () => {
  const DOC = '[^note]: 命名脚注可以写多行，\n    续行需要缩进。\n'

  /** 某一行是否被「整行隐藏」装饰覆盖 */
  const lineHidden = (items, doc, lineText) => {
    const start = doc.indexOf(lineText)
    assert.ok(start >= 0, `文档里找不到这一行：${JSON.stringify(lineText)}`)
    const end = start + lineText.replace(/\n$/, '').length
    return items.some((i) => i.widget === null && i.from <= start && i.to >= end && i.to > i.from)
  }

  test('**决定性判据**：首行与 4 空格缩进的续行**都**有隐藏装饰', () => {
    const { items, doc } = decorationsOf(DOC)
    const hideItems = items.filter((i) => i.widget === null && i.to > i.from)
    assert.ok(hideItems.length >= 2, `应至少有 2 条隐藏装饰（首行 + 续行），实际 ${hideItems.length}`)
    assert.ok(
      lineHidden(items, doc, '[^note]: 命名脚注可以写多行，'),
      '定义行首行没有被隐藏'
    )
    assert.ok(
      lineHidden(items, doc, '    续行需要缩进。'),
      '缩进续行没有被隐藏 —— 缺陷 B 复现：编辑器里续行留在正文（4 空格时还是代码块），而预览里是完整一条'
    )
  })

  test('续行口径与 markdown-it-footnote 对齐：2 空格与 4 空格都算续行', () => {
    for (const indent of ['  ', '    ']) {
      const body = `[^n]: 第一行\n${indent}第二行\n`
      const { items, doc } = decorationsOf(body)
      assert.ok(
        lineHidden(items, doc, `${indent}第二行`),
        `${indent.length} 空格缩进的续行没有被隐藏（与预览侧口径分叉）`
      )
    }
  })

  test('两层缩进的续行也一起隐藏（续行可再嵌套）', () => {
    const { items, doc } = decorationsOf('[^n]: 第一\n    第二\n      第三\n')
    assert.ok(lineHidden(items, doc, '      第三'), '更深缩进的续行漏出来了')
  })

  test('空行终止续行区：空行后的独立段落必须**不**被隐藏', () => {
    const { items, doc } = decorationsOf('[^a]: 内容\n\n独立段落\n')
    assert.ok(lineHidden(items, doc, '[^a]: 内容'), '定义行没有被隐藏')
    assert.ok(
      !lineHidden(items, doc, '独立段落'),
      '空行之后的独立段落被连带隐藏了 —— 续行区必须遇到空行就终止'
    )
  })

  test('非缩进行终止续行区（顶格的下一行不是续行）', () => {
    const { items, doc } = decorationsOf('[^a]: 内容\n独立段落\n')
    assert.ok(
      !lineHidden(items, doc, '独立段落'),
      '顶格的下一行被当成续行隐藏了 —— 续行必须缩进 ≥1 空格'
    )
  })

  test('两条相邻定义 → 各隐藏各的，不粘连', () => {
    const { items, doc } = decorationsOf('[^a]: 第一条\n[^b]: 第二条\n')
    const hideItems = items.filter((i) => i.widget === null && i.to > i.from)
    assert.equal(hideItems.length, 2, `两条定义应各有一条隐藏装饰，实际 ${hideItems.length}`)
    assert.ok(lineHidden(items, doc, '[^a]: 第一条'))
    assert.ok(lineHidden(items, doc, '[^b]: 第二条'))
    // 不沾连：任何一条隐藏区间都不许跨过行边界（跨行 replace 会被 CM 抛错）
    for (const h of hideItems) {
      const slice = doc.slice(h.from, h.to)
      assert.ok(!slice.includes('\n'), `隐藏区间跨行了：${JSON.stringify(slice)}`)
    }
  })

  test('缺陷 D 已修：续行紧接的另一条定义也必须整行隐藏（不留半截源码）', () => {
    // 【这条的前身是「形态固化」，2026-10-26 由 Lead 修复后改成正面断言】
    // 缺陷现场：`[^a]: 第一条` / `  续行` / `[^b]: 第二条` 三行连排时，lezer
    // **不产 LinkReference**（把第 3 行并进上一段的 Paragraph，实测
    // Paragraph(12..24)），于是跟着节点走的整块隐藏不执行，`[^b]` 反而被行级
    // 扫描换成上标 widget、`: 第二条` 半截源码裸露在正文里 —— 而预览/导出侧
    // （markdown-it-footnote）认它是完整的第 2 条脚注（实测 2 条 <li>）。
    // 修法：脚注定义改走**行级**口径（inlineExtras.footnoteDefLines），与行内
    // 公式、脚注引用同一取舍 —— 三者都是「词法规整、语法树不可靠」的语法。
    //
    // 判据（三条缺一不可，任何一条回到旧行为都会报红）：
    //   ① 两条定义（含续行）三行全隐藏；
    //   ② `[^b]` 不再被当成行内引用 widget（它是定义行，不是引用）；
    //   ③ `: 第二条` 不许以任何形式裸露在正文里。
    const body = '[^a]: 第一条\n  续行\n[^b]: 第二条\n'
    const { items, doc } = decorationsOf(body)
    assert.ok(lineHidden(items, doc, '[^a]: 第一条'), '第 1 条定义首行未隐藏')
    assert.ok(lineHidden(items, doc, '  续行'), '第 1 条定义的缩进续行未隐藏')
    assert.ok(
      lineHidden(items, doc, '[^b]: 第二条'),
      '缺陷 D 复现：第 2 条定义没被整行隐藏（lezer 没给它 LinkReference，行级口径也没兜住）'
    )
    const fn = footnotesOf(items)
    assert.deepEqual(
      fn.map((f) => f.text),
      [],
      '定义行里的 `[^b]` 被当成了行内引用 widget —— 定义行应整块隐藏，不该再产上标'
    )
    // ③ 裸露检查：隐藏装饰覆盖不到的地方不许剩 `: 第二条` 这半截
    const hiddenSpans = items.filter((i) => i.widget === null && i.to > i.from)
    const covered = (pos) => hiddenSpans.some((h) => h.from <= pos && h.to >= pos)
    const defStart = doc.indexOf('[^b]: 第二条')
    for (let i = defStart; i < defStart + '[^b]: 第二条'.length; i++) {
      assert.ok(covered(i), `第 ${i - defStart} 个字符没被隐藏装饰覆盖 —— 会留下半截源码`)
    }
  })
})

// ===========================================================================
// 5) 行内出现「定义形状」不算定义行
// ===========================================================================
describe('`说明[^1]: 这不是定义行` · 行内出现定义形状', () => {
  test('整行**不**被隐藏，只有 `[^1]` 换成脚注 widget', () => {
    const { items } = decorationsOf('说明[^1]: 这不是定义行\n')
    const hideItems = items.filter((i) => i.widget === null && i.to > i.from)
    assert.deepEqual(
      hideItems.map((h) => JSON.stringify(h.text)),
      [],
      '行内出现 `[^1]:` 就被整行隐藏了 —— 那会把「这不是定义行」这段用户正文吃掉'
    )
    const fn = footnotesOf(items)
    assert.equal(fn.length, 1, '`[^1]` 仍应按引用处理（一个上标）')
    assert.equal(fn[0].text, '[^1]')
  })

  test('行首缩进 4 空格的定义形状也不当定义行（超出 CommonMark 的 0~3 空格上限）', () => {
    // 4 空格是缩进代码块，markdown-it 也不会把它当脚注定义（实测渲染器侧
    // 输出 <pre><code>[^a]: 四空格…</code></pre>，且**不产** footnotes 区块）。
    const { items } = decorationsOf('    [^a]: 内容\n')
    assert.deepEqual(
      footnotesOf(items).map((f) => f.text),
      [],
      '4 空格缩进时不该产脚注引用 widget'
    )
    // 【2026-10-26 补】还必须断言「整行没被隐藏」—— 只断言「不产 widget」是个
    // 缺口：把 indent 上限从 {0,3} 放宽成 * 时，这段代码块会被当成定义整行隐藏，
    // 而 widget 断言仍然全绿（变异自证实测到这条假绿，故补上）。
    // 判据与渲染器对齐：预览里它是代码块源码，编辑器里就该看得见。
    const hideItems = items.filter((i) => i.widget === null && i.to > i.from)
    assert.deepEqual(
      hideItems.map((h) => JSON.stringify(h.text)),
      [],
      '4 空格缩进的「定义形状」被当成脚注定义整行隐藏了 —— 它是缩进代码块，渲染器侧也不认它'
    )
  })
})

// ===========================================================================
// 6) 编辑器 ↔ 渲染器对照：同一份文档不许两副面孔
// ===========================================================================
describe('编辑器 ↔ 渲染器对照 · 多行定义两侧一致', () => {
  const md = createRenderer()
  const DOC = '[^note]: 命名脚注可以写多行，\n    续行需要缩进。\n\n正文引用[^note]\n'

  test('渲染器侧：续行被并进**同一条**脚注（内容完整，不是半条）', () => {
    const html = render(md, DOC)
    assert.match(html, /<li id="fn1" class="footnote-item">/, '脚注条目缺失')
    // 首行与续行的文字都必须出现在脚注条目里
    assert.match(html, /命名脚注可以写多行/, '脚注首行内容缺失')
    assert.match(html, /续行需要缩进/, '续行内容缺失（渲染器没把缩进续行并进脚注）')
    // 且只产出一条脚注（续行不该变成第二个条目 / 独立段落）
    const items = [...html.matchAll(/<li id="fn\d+"/g)]
    assert.equal(items.length, 1, `应恰好 1 条脚注，实际 ${items.length}`)
  })

  test('编辑器侧：同一份文档里定义行 + 续行都被隐藏（与渲染器的「完整一条」对齐）', () => {
    const { items, doc } = decorationsOf(DOC)
    const hiddenTexts = items.filter((i) => i.widget === null && i.to > i.from).map((i) => i.text)
    assert.ok(
      hiddenTexts.some((t) => t.includes('命名脚注可以写多行')),
      `定义行首行没被隐藏（实际隐藏：${JSON.stringify(hiddenTexts)}）`
    )
    assert.ok(
      hiddenTexts.some((t) => t.includes('续行需要缩进')),
      `定义行续行没被隐藏 —— 编辑器与渲染器分叉（实际隐藏：${JSON.stringify(hiddenTexts)}）`
    )
    // 引用处仍有一个 widget
    assert.equal(footnotesOf(items).length, 1, '正文里的引用应产出 1 个上标 widget')
  })

  test('两侧对「同一行两个脚注」的个数判断一致（渲染器也是 2 个引用）', () => {
    const src = '正文[^1] 与[^note]\n\n[^1]: 一\n[^note]: 二\n'
    const html = render(md, src)
    const refs = [...html.matchAll(/<sup class="footnote-ref">/g)]
    assert.equal(refs.length, 2, `渲染器应产出 2 个脚注引用，实际 ${refs.length}`)
    // 中间正文不许被吞（缺陷 A 在渲染器侧的对照判据）
    assert.match(html, /正文[\s\S]*?与/, '渲染器把两个脚注之间的正文吞掉了')
  })
})
