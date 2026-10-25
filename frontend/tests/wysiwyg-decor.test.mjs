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

  test('表格移交 tableRender 真渲染（wysiwyg 不得再碰 Table）', () => {
    // 2026-10-14 产品决策：Bear 式管道隐藏退役，表格由 tableRender.js 的
    // StateField block 装饰整体渲染成可编辑 <table>。wysiwyg 只有行内装饰、
    // 不得再处理 Table 任何节点（包括 TableDelimiter），避免两套装饰打架。
    assert.ok(
      !wysiwygCode.includes('TableDelimiter'),
      'wysiwyg.js 不应再出现 TableDelimiter（表格已移交 tableRender.js）',
    )
    assert.match(wysiwygCode, /name === 'Table'\)\s*return false/, 'wysiwyg 必须跳过整个 Table 子树')
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
// 2b) 间距几何：分割线不「飘远」、表格单元格不「挤成一团」
// ===========================================================================
/**
 * 【这两条为什么会静默劣化】它们都是**纯观感**缺陷：不报错、不抛异常，
 * 只有用户截图才暴露。2026-10-25 用户反馈「分割线和下面内容太远」
 * 「表格里面内容太挤」，实测根因（1440×1100、正文 15px/1.7）：
 *
 *   ① 分割线：`.cm-md-hr` 曾是 `display:block` + `margin:16px 0`。
 *      block 级 child 的上下 margin 会**实打实加进** `.cm-line` 行盒
 *      （.cm-line 是普通块级盒，不像相邻兄弟那样发生 margin 合并），
 *      行盒实测 87.4px；叠加正文半行距后，分割线上下各约 43px 空白。
 *      改成 inline-block + margin:0 后行盒回落到 27.2px（= 一行 line-height），
 *      上下各约 14/12px。
 *
 *   ② 表格单元格：`white-space` / `word-break` 都是**继承属性**，而 CM6 给
 *      `.cm-lineWrapping` 写的是 `white-space: break-spaces` +
 *      `word-break: break-word`。单元格没显式复位 ⇒ 单词中间也会断行，
 *      真机实测「Markdown」被拆成「Markdow / n」，首列被压到 88.9px。
 *      复位成 normal + overflow-wrap:break-word 后首列 124.9px、不再拆词，
 *      同时长 URL 仍不会撑破正文栏。
 *
 *      【overflow-wrap 必须是 break-word，不能是 anywhere —— 本轮踩过】
 *      第一版写的是 anywhere，断言也照着写，结果**功能其实是坏的**：
 *      anywhere 把每个字都算作合法断点 ⇒ 列 min-content 塌到一个字符 ⇒
 *      浏览器又把首列压回 89.4px ⇒ 单词重新被拆开，等于没修。
 *      故下面的用例把取值钉死为 break-word，anywhere 会被判红。
 *
 * 这里只能守「声明存在且取值正确」这一层 —— 具体像素由
 * scripts/probe/probe-spacing.mjs 在真浏览器里量（改前/改后对照）。
 */
describe('间距几何 · 分割线与表格单元格', () => {
  const cssClean = wysiwygCss.replace(/\/\*[\s\S]*?\*\//g, '')

  /** 取「选择器 → 规则体」，容忍选择器中的换行与逗号后空白差异 */
  function bodyOf(...selectors) {
    const re = /([^{}]+)\{([^{}]*)\}/g
    for (const m of cssClean.matchAll(re)) {
      const sel = m[1].trim().replace(/\s+/g, ' ')
      for (const want of selectors) {
        if (sel === want.replace(/\s+/g, ' ')) return m[2]
      }
    }
    return null
  }

  const cellBody = () => bodyOf('.cm-md-table th, .cm-md-table td')

  test('分割线必须是 inline-block（block + margin 会把行盒撑到 87px，看起来「离下面太远」）', () => {
    const body = bodyOf('.cm-md-hr')
    assert.ok(body, '未找到 .cm-md-hr 规则（判据失效）')
    assert.match(
      body,
      /display:\s*inline-block/,
      '.cm-md-hr 必须 display:inline-block —— block 级 child 的上下 margin 会加进 ' +
        '.cm-line 行盒（实测 87.4px vs 27.2px），分割线上下各多出约 30px 空白，' +
        '用户侧表现就是「分割线和下面的内容隔得太远」。',
    )
    assert.match(
      body,
      /(^|[;\s])margin:\s*0[,;]?/,
      '.cm-md-hr 的 margin 必须是 0：间距交给行高本身，' +
        '否则行高与 margin 两个来源各加一次，又变回「太远」。',
    )
    assert.match(body, /border-top:\s*1px solid/, '.cm-md-hr 仍需 1px 可见横线')
  })

  test('表格单元格必须复位 white-space / word-break（否则继承 break-spaces，单词被从中间拆开）', () => {
    const body = cellBody()
    assert.ok(body, '未找到 .cm-md-table th/td 规则（判据失效）')
    assert.match(
      body,
      /white-space:\s*normal/,
      '单元格必须显式 white-space:normal —— 它是继承属性，CM6 的 .cm-lineWrapping ' +
        '给的是 break-spaces，不复位就会漏到 td/th 上。',
    )
    assert.match(
      body,
      /word-break:\s*normal/,
      '单元格必须显式 word-break:normal —— 继承来的 break-word 允许在**单词中间**断行，' +
        '真机实测「Markdown」被拆成「Markdow / n」，这是「表格内容太挤」的根因之一。',
    )
    assert.match(
      body,
      /overflow-wrap:\s*break-word/,
      '单元格需要 overflow-wrap:break-word 兜住长 URL / 长路径 —— ' +
        '只用 word-break:normal 会让长串把表格撑出正文栏。',
    )
    // 反向断言：anywhere 会毁掉列宽算法（本轮真实踩坑，见文件头 ② 的注记）
    assert.ok(
      !/overflow-wrap:\s*anywhere/.test(body),
      'overflow-wrap 不能写 anywhere：它把每个字都算成断点，列的 min-content 塌到一个字符，' +
        '浏览器据此把窄列压回约 89px，单词重新被拆开 —— 实测首列 124.9px(break-word) vs ' +
        '89.4px(anywhere)，等于没修。',
    )
  })

  test('表格单元格留白足够（不低于 10px / 14px 这一档）', () => {
    const body = cellBody()
    assert.ok(body, '未找到 .cm-md-table th/td 规则（判据失效）')
    const m = body.match(/padding:\s*([^;]+);/)
    assert.ok(m, '单元格缺少 padding 声明（内容会贴到边框上）')
    const px = m[1].trim().split(/\s+/).map((v) => {
      const t = v.match(/^([\d.]+)px$/)
      return t ? Number(t[1]) : null
    })
    assert.ok(
      px.every((v) => v !== null),
      `单元格 padding 需用 px 直写以便本断言量化（当前: ${m[1].trim()}）—— ` +
        '若改用 var() token，请同步调整本用例并说明如何量化',
    )
    assert.ok(
      px[0] >= 10 && (px[1] ?? px[0]) >= 14,
      `单元格留白偏小（当前 ${m[1].trim()}）—— 实测 8px/12px 时内容贴边、观感「太挤」，` +
        '已定为 10px/14px 这一档。',
    )
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
// 4) 暗色 chrome：底色必须由主题决定，不得透出桌面壁纸
// ===========================================================================
describe('macOS 毛玻璃 · 暗色一致性', () => {
  const css = read('themes', 'platform-darwin.css')

  test('侧栏 / 标题栏 / 状态栏必须是主题实色（不透明，不透壁纸）', () => {
    // 真机截图实测：chrome 层半透明（曾用 92% / 55%）在暗色主题下会透出桌面
    // 壁纸 —— 壁纸若是浅色，整片 chrome 被冲淡成浅灰，而正文是深色，同一屏
    // 两种明暗，表现为用户报告的「窗口颜色不一致」。故 chrome 层必须回到
    // 主题实色（--surface / --bg，alpha 100%），材质感只留给 .app 正文面。
    const targets = ['.main .sidebar', '.app > .statusbar', '.app > .titlebar']
    for (const sel of targets) {
      // 取出该选择器对应的 { ... } 规则块（非贪婪，截止到第一个 }）
      const re = new RegExp(escapeSel(sel).replace(/\\s\+/g, '\\s*') + '\\s*\\{([^}]*)\\}')
      const block = css.match(re)
      assert.ok(block, `未找到 ${sel} 的规则块`)
      const body = block[1]
      // 不得再出现「color-mix(... transparent)」——那是透壁纸的半透明写法
      assert.ok(
        !/color-mix\([^)]*transparent\)/.test(body),
        `${sel} 仍含 color-mix(... transparent) —— 暗色下会透出壁纸导致颜色不一致`,
      )
      // 必须用主题实色变量
      assert.ok(
        /var\(--(?:surface|bg)\)/.test(body),
        `${sel} 未使用主题实色变量（--surface / --bg）`,
      )
    }
  })

  test('.app 正文面保留材质感（可半透明）', () => {
    const m = css.match(/\.app\s*\{[^}]*?(\d+)%\s*,?\s*transparent/s)
    assert.ok(m, '未找到 .app 的 color-mix 规则（正文面应保留一丝材质感）')
    const pct = Number(m[1])
    assert.ok(pct >= 90, `.app 底色不透明度 ${pct}% 过低（正文写作面须由主题决定明暗）`)
  })
})

// 把「.main .sidebar」「.app > .statusbar」这类选择器转成可匹配的正则片段
// （转义 . > 等元字符，空白归一为 \s+）
function escapeSel(sel) {
  return sel.replace(/[.[>]/g, (c) => '\\' + c).replace(/\s+/g, '\\s+')
}
// ===========================================================================
// 5) 代码块行号：选择器特异性必须压过 CodeMirror theme 的基础 padding
// ===========================================================================
/**
 * 【这条守的是一个真机可见的缺陷，且属于「注释说谎」型】
 *
 * CodeMirror 的 EditorView.theme 把 '.cm-line' 渲染成**后代**选择器
 * `.ͼ5 .cm-line`（buildTheme 用 `main + " " + sel` 拼），特异性 (0,2,0)。
 * `editor-wysiwyg.css` 里给代码块行号留白的规则原先是**单类**
 * `.cm-md-codeline` = (0,1,0)，**输给了** theme 的 `padding: 0 var(--space-6)`：
 * 实际 padding-left 恒为 24px，而行号伪元素绝对定位在 left:24px、宽 1.6em，
 * 正好压在这 24px 里 —— 行号数字与代码文字**重叠**，真机显示成
 * `co1nst a = 1` 这种鬼样子。
 *
 * 【为什么这条必须机检】它在 CSS 里完全合法（没有语法错误、没有 warning），
 * 构建通过、测试通过，只有肉眼盯着代码块才看得见。而且当时那段注释还写着
 * 「双类 > 单类，足以胜出」—— 注释描述的意图是对的，代码却没照做。
 * 正则断言是唯一能在 CI 里拦住「改回单类」的手段。
 */
describe('代码块行号 · 选择器特异性', () => {
  const css = read('themes', 'editor-wysiwyg.css')

  /** 剥掉 CSS 注释（否则注释里的中文会污染选择器匹配，见下） */
  function stripCssComments(cssText) {
    return cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  }

  /**
   * 取出包含指定声明的规则块（返回 { selector, body } 列表）。
   *
   * [注意] 必须先剥注释：本文件在规则前有整段中文说明，注释里也出现了
   * `.cm-md-codeline` 字样；不剥的话 `([^{}]+)\{` 会把注释吞进 selector，
   * 于是「选择器是不是单类」永远判不出（变异体杀不掉 → 假绿）。
   */
  function rulesWithDeclaration(cssText, prop) {
    const out = []
    const clean = stripCssComments(cssText)
    const re = /([^{}]+)\{([^{}]*)\}/g
    for (const m of clean.matchAll(re)) {
      const selector = m[1].trim()
      const body = m[2]
      if (new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(body)) out.push({ selector, body })
    }
    return out
  }

  test('留白规则必须是双类 .cm-line.cm-md-codeline（单类必输给 theme 的 padding）', () => {
    const rules = rulesWithDeclaration(css, 'padding-left')
      .filter((r) => r.selector.includes('cm-md-codeline'))
    assert.ok(rules.length > 0, '未找到给代码块行号留白的 padding-left 规则（判据可能失效）')

    for (const r of rules) {
      assert.ok(
        /\.cm-line\.cm-md-codeline/.test(r.selector),
        `留白规则的选择器是「${r.selector}」—— 必须是同元素双类 .cm-line.cm-md-codeline。\n` +
          '单类 (0,1,0) 会输给 CodeMirror theme 生成的 `.ͼ5 .cm-line` (0,2,0)，' +
          '导致 padding-left 恒为 24px、行号与代码文字重叠（真机表现为 co1nst a = 1）。',
      )
    }
  })

  test('不得出现单类 .cm-md-codeline 的 padding 规则（改回单类即回归）', () => {
    // 单独成选择器（前面不是 .cm-line）的 padding-left 规则一律不允许
    const bad = rulesWithDeclaration(css, 'padding-left').filter((r) => {
      const first = r.selector.split(',')[0].trim()
      return first === '.cm-md-codeline'
    })
    assert.deepEqual(
      bad.map((r) => r.selector),
      [],
      '出现了单类 .cm-md-codeline 的 padding 规则 —— 特异性 (0,1,0) 不足，行号会与代码文字重叠',
    )
  })

  test('前提核实：CM theme 确实把 .cm-line 渲染成后代选择器 (0,2,0)', () => {
    // 若哪天 CM 改了渲染方式（例如改成同元素双类），上面两条的结论要复核。
    // 这里直接读 CM 源码里的 buildTheme，断言它用的是「前缀 + 空格 + 选择器」。
    const cm = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@codemirror', 'view', 'dist', 'index.js'),
      'utf8',
    )
    assert.match(
      cm,
      /function buildTheme\(main, spec, scopes\)/,
      '前提核实失败：找不到 buildTheme，CM 可能已重构 —— 请复核特异性断言是否仍成立',
    )
    assert.match(
      cm,
      /main \+ " " \+ sel/,
      '前提核实失败：buildTheme 已不再用「前缀 + 空格 + 选择器」拼接 —— ' +
        '若 CM 改成同元素双类，本组断言的结论需要重新评估',
    )
  })
})
