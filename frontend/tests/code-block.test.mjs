// code-block.test.mjs — 围栏代码块：行号 / 一键复制 / 语言高亮映射
// ----------------------------------------------------------------------------
// 【为什么必须机检】这三项全是「坏了不报错」的形态：
//   - 行号算错 → 报错栈定位指到错误的行，用户排查方向直接跑偏；
//   - 复制把围栏（```lang）一起复制走 → 粘进终端就是语法错误；
//   - 语言映射写错 → 静默退化成纯文本（无高亮），没人会报 bug。
// DOM 层（按钮外观 / 悬停）只能真机看，这里钉纯逻辑。

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeLineDecorations, codeBlockContent, fencedCodeAt } from '../src/editor/codeBlock.js'
import codeLanguages from '../src/editor/markdownHighlight.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')

/** 建一个带 markdown 语法树的 state（行号/内容都依赖解析结果） */
function mkState(doc) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  })
}

/** 把行装饰解析成 [{line, dataLine}]，便于断言 */
function lineNos(state) {
  const deco = codeLineDecorations(state, 0, state.doc.length)
  const out = []
  const cur = deco.iter()
  while (cur.value) {
    const line = state.doc.lineAt(cur.from).number
    out.push({ line, dataLine: cur.value.spec.attributes?.['data-line'] })
    cur.next()
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. 行号
// ---------------------------------------------------------------------------
describe('行号 · 只标注围栏内的内容行', () => {
  test('单行代码块：围栏行不标号，内容行从 1 开始', () => {
    // 行1 ```js / 行2 const a = 1 / 行3 ```
    const s = mkState('```js\nconst a = 1\n```')
    assert.deepEqual(lineNos(s), [{ line: 2, dataLine: '1' }], '只有第 2 行是内容行，编号为 1')
  })

  test('多行代码块：编号连续且从 1 起', () => {
    const s = mkState('```\na\nb\nc\n```')
    assert.deepEqual(lineNos(s), [
      { line: 2, dataLine: '1' },
      { line: 3, dataLine: '2' },
      { line: 4, dataLine: '3' },
    ])
  })

  test('同一文档多个代码块：**各自**从 1 重新计数（这是 counter 方案做不到的关键点）', () => {
    const doc = ['```', 'a', 'b', '```', '', '```js', 'x', '```'].join('\n')
    const nos = lineNos(mkState(doc))
    // 第一个块：第 2、3 行 → 1、2；第二个块：第 7 行 → 1
    assert.deepEqual(nos, [
      { line: 2, dataLine: '1' },
      { line: 3, dataLine: '2' },
      { line: 7, dataLine: '1' },
    ], '跨块必须重新从 1 开始，否则行号一路累加就失去了定位意义')
  })

  test('未闭合围栏：内容行照样编号（打字过程中不能让行号闪烁消失）', () => {
    const s = mkState('```js\na\nb')
    const nos = lineNos(s)
    assert.ok(nos.length >= 1, '未闭合时也要给出行号')
    assert.equal(nos[0].dataLine, '1')
  })

  test('空代码块不产生任何行号', () => {
    assert.deepEqual(lineNos(mkState('```\n```')), [])
  })

  test('行号装饰只影响行首位置（不产生跨行替换，否则会被 CM 拒绝）', () => {
    const s = mkState('```\na\nb\n```')
    const deco = codeLineDecorations(s, 0, s.doc.length)
    const cur = deco.iter()
    while (cur.value) {
      assert.equal(cur.from, cur.to, '行装饰的 from 必须等于 to（零宽）')
      assert.equal(cur.value.spec.attributes?.['data-line'] !== undefined, true)
      cur.next()
    }
  })
})

// ---------------------------------------------------------------------------
// 2. 一键复制：内容必须**不含**围栏
// ---------------------------------------------------------------------------
describe('复制内容 · 必须剥掉围栏', () => {
  test('带语言标记的代码块：复制结果不含 ```lang 与闭围栏', () => {
    const doc = '```go\nfunc main() {}\n```'
    const s = mkState(doc)
    const node = fencedCodeAt(s, 8) // 光标落在内容行
    assert.ok(node, '应能定位到 FencedCode 节点')
    assert.equal(codeBlockContent(s.doc, node), 'func main() {}',
      '粘进终端时围栏就是语法错误，必须剥掉')
  })

  test('多行内容逐字保留（缩进 / 空行 / 尾随空格）', () => {
    const body = '  indented\n\n  x := 1  '
    const doc = '```py\n' + body + '\n```'
    const s = mkState(doc)
    const node = fencedCodeAt(s, doc.indexOf('indented'))
    assert.equal(codeBlockContent(s.doc, node), body,
      '内容必须逐字保留：代码的缩进与空行是有意义的')
  })

  test('空代码块复制出空串（不是 "undefined" 或整个围栏）', () => {
    const s = mkState('```\n```')
    const node = fencedCodeAt(s, 0)
    assert.equal(codeBlockContent(s.doc, node), '')
  })

  test('未闭合围栏：复制到文档末尾', () => {
    const doc = '```js\nline1\nline2'
    const s = mkState(doc)
    const node = fencedCodeAt(s, 10)
    assert.equal(codeBlockContent(s.doc, node), 'line1\nline2')
  })

  test('光标不在代码块内时定位返回 null（复制按钮不该出现在普通段落旁）', () => {
    const s = mkState('普通段落\n\n```\ncode\n```')
    assert.equal(fencedCodeAt(s, 1), null)
  })
})

// ---------------------------------------------------------------------------
// 2b. 复制按钮的可见性规则
// ---------------------------------------------------------------------------
describe('复制按钮 · 何时出现', () => {
  test('光标在某个代码块内 → 只有那一块有按钮（就近操作）', () => {
    const src = read(join('editor', 'codeBlock.js'))
    // 规则写在代码里，测试锁住「按光标就近」这个语义不被悄悄改掉
    assert.match(src, /focused\.from === node\.from/,
      '光标在块内时应只给该块显示按钮')
    assert.match(src, /!focused \|\| focused\.from === node\.from/,
      '光标不在任何块内时应给所有可见块显示按钮（保持可发现性）')
  })

  test('按钮不是靠 hover 才存在（触屏 / 无鼠标环境必须可达）', () => {
    const src = read(join('editor', 'codeBlock.js'))
    // 渲染层是常驻 widget，CSS 只调不透明度；不存在「mouseleave 就移除」
    assert.ok(!/mouseleave.*remove/i.test(src), '按钮不得在 mouseleave 时被移除')
  })

  test('选区变化会重建按钮（光标进出代码块要能显隐）', () => {
    const src = read(join('editor', 'codeBlock.js'))
    assert.match(src, /u\.selectionSet/, '选区变化必须触发重建')
  })
})

// ---------------------------------------------------------------------------
// 3. 语言高亮映射
// ---------------------------------------------------------------------------
describe('语言映射 · 编辑器侧高亮', () => {
  test('常用别名都能解析出 Language（返回对象而非 undefined）', () => {
    for (const lang of ['js', 'ts', 'jsx', 'tsx', 'python', 'py', 'java', 'html', 'xml', 'css', 'json']) {
      const out = codeLanguages(lang)
      assert.ok(out, `${lang} 应解析出 Language，实得 ${out}`)
      assert.equal(typeof out, 'object', `${lang} 必须返回 Language 对象（不是 LanguageSupport）`)
    }
  })

  test('大小写与额外参数都能容忍（```JS title="x" 这种写法）', () => {
    assert.ok(codeLanguages('JS'))
    assert.ok(codeLanguages('python title="demo.py"'))
  })

  test('无语言标记 / 未知语言返回 null（退化为纯文本，不报错）', () => {
    assert.equal(codeLanguages(''), null)
    assert.equal(codeLanguages(null), null)
    assert.equal(codeLanguages('no-such-language'), null)
  })

  test('已知的依赖边界：go / rust 在编辑器侧不支持（只在预览区高亮）', () => {
    // 这条不是「期望缺失」，而是把边界**写死**：将来若真的装了语言包，
    // 这条测试会红，提醒同步更新注释与文档，而不是让边界悄悄漂移。
    assert.equal(codeLanguages('go'), null, '编辑器侧无 go 语言包；预览区由 highlight.js 覆盖')
    assert.equal(codeLanguages('rust'), null, '同上')
  })
})

// ---------------------------------------------------------------------------
// 4. 接线契约
// ---------------------------------------------------------------------------
describe('代码块 · 接线契约', () => {
  test('createEditor 注册了行号插件与复制按钮装饰', () => {
    const src = read(join('editor', 'createEditor.js'))
    assert.match(src, /codeLinePlugin/, '必须注册行号插件')
    assert.match(src, /codeCopyPlugin/, '必须注册复制按钮装饰')
  })

  test('复制走真实剪贴板 API，且有失败兜底（静默失败不可接受）', () => {
    const src = read(join('editor', 'codeBlock.js'))
    assert.match(src, /navigator\.clipboard/, '优先用 navigator.clipboard')
    assert.match(src, /execCommand\('copy'\)/, '必须有 execCommand 兜底（WKWebView 场景）')
    assert.match(src, /copyFailed/, '复制失败必须有可见反馈')
  })

  test('行号是视觉信息，不进入文档文本', () => {
    const src = read(join('editor', 'codeBlock.js'))
    // 行号只能通过装饰属性/伪元素呈现；一旦写进 insert 就是污染文档
    assert.ok(!/insert:\s*String\(/.test(src), '行号绝不能被写进文档')
    assert.match(src, /attributes: \{ 'data-line'/, '行号经装饰属性交给 CSS')
  })
})
