/**
 * wysiwyg-decor.test.mjs — 编辑器装饰与交互的行为契约（2026-10-06 新增）
 * ---------------------------------------------------------------------------
 * 【为什么这组必须是机检】本轮修的三个缺陷**全都不报错**，界面表现只是
 * 「该渲染的没渲染」「按了回车没反应」：
 *
 *   1) 斜杠面板 Enter 无响应 —— confirm() 先 close()（清空 view/anchor）
 *      再 insertSlashItem(view, anchor)，守卫静默 return false。
 *      面板关了、文档没变，肉眼看不出「已经走到 confirm 了」。
 *   2) 表格 / 分割线 / 图片不渲染 —— lezer 的 Table / HorizontalRule /
 *      Image 节点一直都在（实测语法树确认），缺的是 wysiwyg.js 的装饰分支。
 *      没有节点、没有装饰，界面只是「管道符裸露」，一样不报错。
 *   3) 大纲当前节高亮失效 —— 模板传的是 Ref 对象而非数字，
 *      Vue prop 校验报 warning 但**不阻断**，高亮就是永远不亮。
 *
 * 三条都是「静默失败」型，只能靠断言钉住。
 *
 * [注意] 与 contracts.test.mjs 同理：只用 node:fs + JS RegExp，
 * 不用 shell grep（本仓 UTF-8 文件在 shell grep 下静默无输出）。
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const read = (...p) => readFileSync(join(SRC, ...p), 'utf8')

const wysiwyg = read('editor', 'wysiwyg.js')
const slashExt = read('editor', 'slashCommand.js')
const slashComp = read('components', 'SlashCommand.vue')
const appVue = read('App.vue')
const createEditor = read('editor', 'createEditor.js')
const wysiwygCss = read('themes', 'editor-wysiwyg.css')

/**
 * 剥掉注释，只留可执行代码。
 * [2026-10-06] 本文件第一版就是栽在这：断言 `!/node\.state\.doc/` 命中了
 * 我自己写的那行**说明性注释**（「曾写成 node.state.doc 直接把插件打崩」），
 * 于是代码明明改对了、测试却报红。本仓已因「匹配到注释里的代码」栽过 7 次，
 * 这是第 8 次 —— 故这里统一先剥注释再断言。
 */
function stripComments(src, lang) {
  // 行注释：// （.js/.vue 通用）
  let out = src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  // 块内注释与 CSS 注释
  if (lang === 'css') return out.replace(/\/\*[\s\S]*?\*\//g, '')
  return out.replace(/\/\*[\s\S]*?\*\//g, '')
}
const wysiwygCode = stripComments(wysiwyg)
const slashCompCode = stripComments(slashComp)
const appVueCode = stripComments(appVue)
const createEditorCode = stripComments(createEditor)

// ===========================================================================
// 1) 斜杠面板：confirm 的取上下文顺序
// ===========================================================================
describe('斜杠命令面板 · Enter 插入', () => {
  test('confirm() 必须先取上下文再 close()，否则插入静默失败', () => {
    const body = slashCompCode.slice(
      slashCompCode.indexOf('function confirm()'),
      slashCompCode.indexOf('function close()'),
    )
    assert.ok(body, '未找到 confirm() 函数体')
    // close() 会把 view/anchor 清空；insertSlashItem 必须用提前存下的副本
    assert.match(body, /const\s+targetView\s*=\s*view/, 'confirm() 未保存 view 副本')
    assert.match(body, /const\s+targetAnchor\s*=\s*anchor/, 'confirm() 未保存 anchor 副本')
    assert.match(
      body,
      /insertSlashItem\(\s*targetView\s*,\s*item\s*,\s*targetAnchor\s*\)/,
      'insertSlashItem 未使用提前保存的上下文 —— 拿到的是 close() 清空后的 null/-1，' +
        '守卫会静默 return false（表现为「按了回车面板关了但什么都没插入」）',
    )
    // 顺序：取上下文必须在 close() 之前
    const iCopy = body.indexOf('targetAnchor = anchor')
    const iClose = body.indexOf('close()')
    const iInsert = body.indexOf('insertSlashItem(')
    assert.ok(iCopy >= 0 && iCopy < iClose, `取上下文的时机应早于 close()（copy@${iCopy} close@${iClose}）`)
    assert.ok(iClose < iInsert, 'close() 应早于 insertSlashItem（让 updateListener 看到 isOpen=false）')
  })

  test('insertSlashItem 的守卫失败必须留痕，不得静默 return false', () => {
    // 静默失败是本缺陷能活到用户手上的直接原因：界面只表现为「没反应」
    const start = slashExt.indexOf('export function insertSlashItem')
    const guard = slashExt.slice(start, start + 900)
    assert.match(
      guard,
      /console\.warn/,
      'insertSlashItem 的守卫命中必须打 warn —— 静默 return 会让同类缺陷再次隐身',
    )
  })

  test('openMenu 拿不到光标坐标时也必须留痕', () => {
    const fn = slashCompCode.slice(
      slashCompCode.indexOf('function openMenu('),
      slashCompCode.indexOf('function isOpen()'),
    )
    assert.match(fn, /console\.warn/, 'openMenu 的 coords 为空分支应打 warn，否则面板不显示且无任何线索')
  })

  test('斜杠扩展仍在 Prec.high 内（须压过 defaultKeymap 的 Enter/Escape）', () => {
    assert.match(slashExt, /Prec\.high\(keymap\.of\(\[/, '斜杠键位必须包在 Prec.high 里')
    for (const k of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
      assert.ok(slashExt.includes(`key: '${k}'`), `斜杠扩展缺少 ${k} 键位`)
    }
  })
})

// ===========================================================================
// 2) wysiwyg 装饰：表格 / 分割线 / 图片
// ===========================================================================
describe('wysiwyg 装饰 · 表格 / 分割线 / 图片', () => {
  test('必须处理 HorizontalRule（否则 --- 裸露）', () => {
    assert.match(wysiwygCode, /name === 'HorizontalRule'/, '未处理 HorizontalRule 节点 —— `---` 会原样显示')
    assert.match(wysiwygCode, /hrDeco/, 'HorizontalRule 分支未产出装饰')
  })

  test('必须处理 TableDelimiter（否则表格管道符裸露）', () => {
    assert.match(
      wysiwygCode,
      /name === 'TableDelimiter'/,
      '未处理 TableDelimiter 节点 —— GFM 表格的管道符与分隔行会原样显示',
    )
  })

  test('必须处理 Image（否则图片语法裸露）', () => {
    assert.match(wysiwygCode, /name === 'Image'/, '未处理 Image 节点')
    assert.match(wysiwygCode, /class ImageWidget/, '缺少图片预览 widget')
    // 图片 widget 必须用「非活跃行才替换」的语义（活跃行显形是 §3.2 硬约束）
    assert.match(
      wysiwygCode,
      /if\s*\(canHide\(node\.from\)\)\s*\{[^}]*new ImageWidget/s,
      'Image 替换必须走 canHide（活跃行保持源码）',
    )
  })

  test('取 URL/alt 必须用闭包里的 doc，不得访问 node.state（SyntaxNode 无该属性）', () => {
    // 实测踩过：写成 node.state.doc 直接把 wysiwyg 插件打崩
    // （CodeMirror plugin crashed: Cannot read properties of undefined）
    assert.ok(
      !/node\.state\.doc/.test(wysiwygCode),
      '不得访问 node.state.doc —— lezer 的 SyntaxNode 没有 state/doc 属性，会打崩插件',
    )
    assert.match(wysiwygCode, /function urlOf\(node,\s*doc\)/, 'urlOf 应显式接收 doc')
    assert.match(wysiwygCode, /function altOf\(node,\s*doc\)/, 'altOf 应显式接收 doc')
  })

  test('分割线装饰必须撑开高度（纯空替换会让行高塌陷）', () => {
    assert.match(
      wysiwygCss,
      /\.cm-md-hr\s*\{[^}]*height:\s*0[^}]*border-top/s,
      '.cm-md-hr 需 height:0 + border-top 撑出可见横线',
    )
  })

  test('.cm-md-* 的视觉定义只允许出现在 editor-wysiwyg.css（不得与 theme 重复）', () => {
    // 迁移原因见该文件头注：写进 createEditor.js 的 theme 会顶破行数棘轮。
    // 风险从「同键覆盖」转移到「两处并存」，故用断言守住唯一定义处。
    const themeBody = createEditorCode.slice(
      createEditorCode.indexOf('EditorView.theme({'),
      createEditorCode.indexOf('updateListener,'),
    )
    for (const cls of ['cm-md-bullet', 'cm-md-task-box', 'cm-md-hr', 'cm-md-img']) {
      assert.ok(
        !themeBody.includes(cls),
        `${cls} 的样式不应再出现在 createEditor.js 的 theme 里（已迁至 themes/editor-wysiwyg.css）`,
      )
    }
  })

  test('图片加载失败须有可读占位，不得留碎图标', () => {
    assert.match(wysiwygCode, /addEventListener\('error'/, '图片 widget 缺少 onError 处理')
    assert.match(wysiwygCss, /\.cm-md-img\.is-broken/, '缺少加载失败的占位样式')
  })
})

// ===========================================================================
// 3) 模板传参：不得把 Ref 对象直接送进 prop
// ===========================================================================
describe('模板传参 · 顶层 ref 解包', () => {
  test('App.vue 不得把嵌套在对象里的 ref 直接传给 prop', () => {
    // Vue 只对**顶层** setup 的 ref 自动解包；composables 实例的字段是普通对象，
    // 其 .value 不会被展开 —— 传进去的是 Ref 对象，prop 校验 warning、
    // 功能静默失效（本轮实测：active-index=Ref< -1 >，大纲高亮永不生效）。
    assert.ok(
      !/outlineSync\.outlineActive/.test(appVueCode),
      'App.vue 仍传 outlineSync.outlineActive（Ref 对象）—— 必须先解包成顶层 const',
    )
    assert.match(appVueCode, /const\s*\{\s*outlineActive\s*\}\s*=\s*outlineSync/, '缺少顶层解包')
  })

  test('其他 composables 实例字段也不得直接进模板 prop', () => {
    // 通用扫描：<实例名>.<小写字段> 形态出现在 :prop="..." 上
    const propExprs = [...appVueCode.matchAll(/:[\w-]+="([a-zA-Z_$][\w$.]*)"/g)].map((m) => m[1])
    const offenders = propExprs.filter((e) => /^(workspace|session|docState|cmds|prefs|outlineSync|fileOps|assets|help)\./.test(e))
    assert.deepEqual(
      offenders,
      [],
      '这些 prop 收到的是 Ref 对象而非值（Vue 不解包嵌套 ref）—— 先在 script 里解包成顶层 const',
    )
  })
})

// ===========================================================================
// 4) 暗色 chrome：毛玻璃层不透明度有下限
// ===========================================================================
describe('macOS 毛玻璃 · 暗色可读性', () => {
  const css = read('themes', 'platform-darwin.css')

  test('侧栏 / 标题栏 / 状态栏底色不透明度不得低于 88%', () => {
    // 真机截图实测：78% 时暗色主题下 chrome 透出桌面壁纸，整片被冲淡成
    // 浅灰，表现为「暗色模式下大纲颜色没变」（正文深色、侧栏浅色）。
    const m = css.match(/\.main \.sidebar\s*\{[^}]*?(\d+)%\s*,?\s*transparent/s)
    assert.ok(m, '未找到侧栏的 color-mix 规则')
    const pct = Number(m[1])
    assert.ok(
      pct >= 88,
      `侧栏底色不透明度 ${pct}% 过低 —— 暗色主题下会透出桌面壁纸被冲淡为浅色（真机实测 78% 即出问题）`,
    )
  })

  test('.app 底色不透明度不得低于 90%', () => {
    const m = css.match(/\.app\s*\{[^}]*?(\d+)%\s*,?\s*transparent/s)
    assert.ok(m, '未找到 .app 的 color-mix 规则')
    const pct = Number(m[1])
    assert.ok(pct >= 90, `.app 底色不透明度 ${pct}% 过低（正文写作面须由主题决定明暗）`)
  })
})