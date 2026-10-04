/**
 * contracts.test.mjs — 静态契约检查（QA 独占）
 * ---------------------------------------------------------------------------
 * 契约来源：docs/spec/SPEC-engineering-baseline-v1.md §4.2（5 项）+ §6 AC-03 / AC-07
 *
 * 【为什么这些必须是机检，而不是靠人看】
 *  这 5 条全是「错了不报错」的类型：
 *   - Go 加了菜单项但前端没注册 → 点菜单没反应，没有任何报错
 *   - ⌘P 被两个菜单同时占用 → 行为不确定，且不崩
 *   - 打印时遮罩没关 → 打印出一坨黑色遮罩，用户才骂
 *   - emoji 图标 → 视觉质量降级（但这是 P0，不接受）
 *   - 文件膨胀 → 迟早失控（App.vue 已经 1368 行就是证据）
 *  人工 review 只能抓到「刚好这轮改到的地方」，机检能抓到全仓。
 *
 * 【[注意] 必须用 Node 读文件做匹配，不要用 shell grep】
 *  Spec §8 记录的坑：本仓 UTF-8 文件在 shell grep 下会静默无输出。
 *  本文件全程只用 node:fs 读文件 + JS RegExp 匹配。
 *  额外血泪：本机 grep 是 BSD/toybox，连 `\\x{...}` 这种 GNU 扩展都不支持会直接报
 *  bad regex —— 详见 emoji 那组的注释。
 */

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

// ---------------------------------------------------------------------------
// 路径解析：全部相对本文件定位，保证从任意 cwd 调用都能跑
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url)) // frontend/tests
const FRONTEND = join(HERE, '..') // frontend
const REPO = join(FRONTEND, '..') // 仓库根
const SRC = join(FRONTEND, 'src')

const read = (p) => readFileSync(p, 'utf8')

/** 递归列出目录下所有文件（跳过 node_modules / dist / .git 等噪声） */
function listFiles(dir, acc = []) {
  const SKIP = new Set(['node_modules', 'dist', '.git', '.wails', 'bin', 'tests'])
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) listFiles(full, acc)
    else acc.push(full)
  }
  return acc
}

/** 仓库相对路径（用于报错信息，跨机器可读） */
const rel = (abs) => relative(REPO, abs).split(sep).join('/')

/**
 * 行数口径：**wc -l**（末尾无换行不计一行）。
 * Node 的 split('\n').length 会把「末尾有换行」多算 1 行，与 Spec §4.2 写的
 * 1368 不符（Node 算 1369，wc -l 算 1368）。这里统一用 wc -l 口径。
 */
function countLines(text) {
  if (text.length === 0) return 0
  const n = text.split('\n').length
  return text.endsWith('\n') ? n - 1 : n
}

// ===========================================================================
// 契约 1：菜单事件双向闭合
// ===========================================================================

/**
 * Go 侧发出的事件名。
 * 覆盖 main.go 里三种发出方式：
 *   emit("x")                    —— 普通菜单项
 *   emitChecked("x", setter)     —— checkbox 菜单项
 *   runtime.EventsEmit(ctx, "x") —— 直接发（最近打开等动态项）
 *
 * [注意] 引号风格无关（`"` / `` ` `` / `'` 都是合法 Go 字符串）——
 * 早先只认双引号，写成反引号会导致扫不到、进而让下游差集检查**静默放行**。
 * 这就是「解析器把『看起来像』当成『是』」那类坑，与 shell grep 静默无输出同源。
 */
function collectGoEmitted(goSrc) {
  const names = new Map() // name -> 首个出现的行号（1-based）
  // 事件名一律用双引号字面量（Go 社区惯例），但解析不假设引号风格
  const Q = '["`\']'
  const patterns = [
    new RegExp(`\\bemit\\(\\s*${Q}([^"'\`]+)${Q}`, 'g'), // emit("...")
    new RegExp(`\\bemitChecked\\(\\s*${Q}([^"'\`]+)${Q}`, 'g'), // emitChecked("...")
    new RegExp(`\\bEventsEmit\\(\\s*[\\w.]+\\s*,\\s*${Q}([^"'\`]+)${Q}`, 'g'), // EventsEmit(ctx, "...")
  ]
  for (const re of patterns) {
    for (const m of goSrc.matchAll(re)) {
      if (!names.has(m[1])) {
        names.set(m[1], goSrc.slice(0, m.index).split('\n').length)
      }
    }
  }
  return names
}

/**
 * 统计 main.go 里**字面量形式**的 emit 调用点数量（缺陷 3 的对账基准）。
 *
 * 为什么要这个对账：`collectGoEmitted` 只认「引号紧跟括号」的写法。
 * 若 Go 侧把事件名抽成常量（`const evtNewFile = "menu:new-file"` + `emit(evtNewFile)`，
 * 这是 Go 里常见且推荐的做法），解析器就**扫不到那个事件**了 ——
 * 于是差集变空、误判成「前端多注册了事件」，**报错方向指向前端，真因在解析器**。
 * 有了这个计数，两者不等就能立刻定位到解析器，而不是让人去查前端。
 *
 * 只统计「看起来是 emit 调用点」的：`emit(` / `emitChecked(` / `EventsEmit(`。
 * 函数**声明**本身（`emit := func(...)`）不计。
 */
function countGoEmitCallSites(goSrc) {
  const callSites = goSrc.match(/\b(?:emit|emitChecked|EventsEmit)\s*\(/g) || []
  // 减去闭包声明：`emit := func(` / `emitChecked := func(` 各计 1 次
  const decls = goSrc.match(/\b(?:emit|emitChecked)\s*:=\s*func\s*\(/g) || []
  return callSites.length - decls.length
}


/** 前端侧注册的事件名（safeEventsOn） */
function collectFrontendRegistered(src) {
  const names = new Map()
  for (const m of src.matchAll(/safeEventsOn\(\s*'([^']+)'/g)) {
    if (!names.has(m[1])) {
      names.set(m[1], src.slice(0, m.index).split('\n').length)
    }
  }
  return names
}

/**
 * 前端事件注册面 = App.vue ∪ main.js。
 *
 * [注意] **偏离 Spec 字面，理由如下（已向总监报备）**
 * Spec §4.2 原文写「全部出现在 App.vue 的 safeEventsOn('…')」。
 * 但实测 main.go 发出的 64 个事件里，`menu:toggle-theme` **不在 App.vue**，
 * 而在 `frontend/src/main.js:25` 注册 —— 因为它在 Vue mount 之前注册，
 * 用于主题切换不闪烁（与 prefs.js「首帧前落好内联变量」同一约定）。
 * 这是正确设计，不是漏注册。
 * 若严格只看 App.vue，本检查会因「判据不完整」而假失败。
 * 扩到注册面全集后，AC-03 依然成立：Go 新增一个两端都没注册的事件必失败。
 */
const EVENT_SURFACE_FILES = ['src/App.vue', 'src/main.js']

/**
 * 反向白名单：前端注册了、但 Go 侧不通过 `emit*` 发出的事件。
 * 每条必须写明来源，否则将来凭空多出来的注册会被本检查放行。
 */
const FRONTEND_ONLY_EVENT_WHITELIST = {
  'fs:changed': 'Wails 文件监听事件，由 Wails runtime 自行派发，不经 main.go 的 emit/emitChecked',
}

describe('契约 1 · 菜单事件双向闭合（AC-03）', () => {
  const goSrc = read(join(REPO, 'main.go'))
  const emitted = collectGoEmitted(goSrc)

  const registered = new Map() // name -> {file, line}
  for (const f of EVENT_SURFACE_FILES) {
    const p = join(FRONTEND, f)
    for (const [name, line] of collectFrontendRegistered(read(p))) {
      if (!registered.has(name)) registered.set(name, { file: f, line })
    }
  }

  test('main.go 确实发出了菜单事件（防止扫描规则本身失效而假通过）', () => {
    // 这条是「扫描器自检」：如果正则写坏了，上面的差集会是空集，测试会假通过
    assert.ok(
      emitted.size >= 50,
      `只扫到 ${emitted.size} 个事件，正则很可能失效（预期 60+）`
    )
    assert.ok(
      [...emitted.keys()].every((n) => n.startsWith('menu:')),
      `扫到了非 menu: 前缀的事件，可能是正则误匹配: ${[...emitted.keys()].filter((n) => !n.startsWith('menu:'))}`
    )
  })

  /**
   * 缺陷 3 的核心守卫：**解析器能力对账**。
   *
   * 背景：把事件名抽成常量（`const evtX = "menu:x"` + `emit(evtX)`）会让
   * `collectGoEmitted` 扫不到该事件。此时差集变空，下游「前端多注册」用例报错 ——
   * 但**真因在解析器，报错却指向前端**，会让人白查半天。
   * 我们正要大规模改 main.go，这种假失败的返工代价是实打实的。
   *
   * 判据：字面量 emit 调用点数必须等于解析出的事件数。
   * 不等 = 解析器已覆盖不全 → 直接指向解析器，**先于任何差集断言**。
   */
  test('解析器必须覆盖 main.go 全部 emit 调用点（能力对账，防归因错报）', () => {
    const callSites = countGoEmitCallSites(goSrc)
    const parsed = emitted.size
    assert.equal(
      parsed,
      callSites,
      `解析器覆盖不全：main.go 有 ${callSites} 个 emit 调用点，只解析出 ${parsed} 个事件。` +
        '说明 Go 侧出现了本检查无法解析的写法（最常见：事件名被抽成常量，' +
        '如 const evtX = "menu:x" 后写成 emit(evtX)）。' +
        '请更新 collectGoEmitted / countGoEmitCallSites 以支持该写法 —— ' +
        '不要去改前端，本条报的是**解析器**的账。'
    )
  })

  test('Go 发出的每个事件都必须在前端注册面（App.vue ∪ main.js）里有 safeEventsOn', () => {
    const missing = [...emitted.entries()].filter(([name]) => !registered.has(name))
    assert.deepEqual(
      missing.map(([name, line]) => `${name} (main.go:${line})`),
      [],
      'Go 侧发出但前端未注册的事件 —— 点了菜单不会有任何反应，也没有报错。' +
        '修复：在前端补 safeEventsOn 注册，或从 main.go 移除该菜单项。'
    )
  })

  test('前端多注册的每个事件都必须有显式白名单理由（防白名单被无声扩大）', () => {
    const extra = [...registered.keys()].filter((name) => !emitted.has(name))
    const unlicensed = extra.filter((name) => !(name in FRONTEND_ONLY_EVENT_WHITELIST))
    assert.deepEqual(
      unlicensed,
      [],
      '前端注册了 Go 侧不发出的事件，且不在 FRONTEND_ONLY_EVENT_WHITELIST 里。' +
        '要么是 Go 侧误删了 emit（请恢复），要么是前端注册残留（请删除），' +
        '确认无误才可显式加入白名单并写明理由。'
    )
  })

  test('白名单里的每条理由都必须非空（防「留个空字符串占位」）', () => {
    for (const [name, reason] of Object.entries(FRONTEND_ONLY_EVENT_WHITELIST)) {
      assert.ok(
        typeof reason === 'string' && reason.trim().length >= 10,
        `白名单项 ${name} 缺少充分理由（当前: ${JSON.stringify(reason)}）`
      )
    }
  })

  test('menu:toggle-theme 必须在注册面里（防有人把它从 main.js 挪走导致闪烁回归）', () => {
    // 专项锁定：它注册在 main.js 而非 App.vue，容易被「统一风格」重构误删
    assert.ok(
      registered.has('menu:toggle-theme'),
      'menu:toggle-theme 丢失注册 —— 主题切换会退回闪烁（main.js mount 前注册失效）'
    )
    const where = registered.get('menu:toggle-theme')
    assert.equal(
      where.file,
      'src/main.js',
      'menu:toggle-theme 应留在 main.js（mount 前注册）；若确需迁移到 App.vue，请同步更新本断言与注释'
    )
  })
})

// ===========================================================================
// 契约 2：⌘P 唯一性
// ===========================================================================

/**
 * ⌘P 绑定的匹配器（引号风格无关）。
 *
 * Go 的字符串有三种写法 —— `"p"` / `` `p` `` / `'p'` 都合法。
 * 早先这里用精确子串 `keys.CmdOrCtrl("p")`，改成反引号就会**静默漏检**，
 * 于是「唯一性」名存实亡（实测：注入第 2 个反引号写法的 ⌘P，门禁仍放行）。
 * 这类「解析器把『看起来像』当成『是』」的坑与 shell grep 静默无输出同源。
 *
 * [职责边界 — 必读，加检查前先看这里]
 *   **键位语义一致性由 `scripts/verify/verify-shortcuts.mjs` 负责**
 *   （CI job `docs-contract`，真源 = main.go buildMenu()，覆盖 main.go ↔ README
 *     ↔ App.vue SHORTCUTS 三方对齐）。
 *   **本组仅守 main.go 内部的键位唯一性，不承担跨文件语义校验。**
 *
 *   为什么不再加更宽的键位检查（已实测论证，见 Spec §10）：
 *     1. 计数式判据有结构盲区 —— 2026-10-04 修过的 ⌘B 撞键 bug，在 main.go 里
 *        `⌘B`/`⌘⇧B` 各只出现 1 次、本身完全合法，冲突只存在于
 *        「App.vue 速查表声称 ⌘B=加粗」与「main.go 里 ⌘B=大纲」之间。
 *        任何基于「数 main.go 里有几个 ⌘X」的检查都抓不到它。
 *     2. 再加一道 = 两道口径不同的重复门禁（那边数 43 项 accelerator、
 *        这边数 1 个 ⌘P），main.go 一变就可能只修一边 —— 重复口径即漂移源。
 *   ⏳ 待 `scripts/parse-main-menu.mjs` 落地后，把「main.go 内部 accelerator
 *      唯一性」挪进那个真源解析器，**本组届时删除**，避免留下两套口径。
 */
const CMD_P_RE = /keys\.CmdOrCtrl\(\s*["'`]p["'`]\s*\)/

describe('契约 2 · ⌘P 键位唯一性', () => {
  test('全仓 ⌘P 绑定只能出现 1 次（打印）', () => {
    const files = [
      ...listFiles(REPO).filter((f) => /\.(go|vue|js|mjs|ts|tsx|jsx)$/.test(f)),
    ]
    const hits = []
    for (const f of files) {
      const text = read(f)
      text.split('\n').forEach((line, i) => {
        if (CMD_P_RE.test(line)) hits.push(`${rel(f)}:${i + 1}`)
      })
    }
    assert.equal(
      hits.length,
      1,
      `⌘P 绑定出现 ${hits.length} 次（${hits.join(', ')}）。` +
        '⌘P 必须唯一（当前归属：打印）。导出 PDF 应为 ⇧⌘P（keys.Combo）。' +
        '两处同键会导致行为不确定且不报错。'
    )
  })

  test('命中点必须落在 main.go 的「打印」菜单项上', () => {
    const goSrc = read(join(REPO, 'main.go'))
    const line = goSrc.split('\n').find((l) => CMD_P_RE.test(l))
    assert.ok(line, 'main.go 应存在 ⌘P 绑定')
    assert.ok(
      line.includes('打印'),
      `⌘P 应绑定到「打印」，实际行: ${line.trim()}`
    )
  })

  test('导出 PDF 必须是 ⇧⌘P（keys.Combo），不得占用 ⌘P', () => {
    const goSrc = read(join(REPO, 'main.go'))
    const line = goSrc.split('\n').find((l) => l.includes('menu:export-pdf'))
    assert.ok(line, 'main.go 应存在导出 PDF 菜单项')
    assert.ok(
      line.includes('keys.Combo("p", keys.CmdOrCtrlKey, keys.ShiftKey)'),
      `导出 PDF 应为 ⇧⌘P，实际行: ${line.trim()}`
    )
    assert.ok(
      !line.includes('keys.CmdOrCtrl("p")'),
      '导出 PDF 不得使用裸 ⌘P'
    )
  })
})

// ===========================================================================
// 契约 3：打印样式存在性
// ===========================================================================

/**
 * 剥掉 CSS/JS 注释，返回「原样长度的字符串」：
 * 注释内的字符替换为空格（保留换行以维持行号），注释外的字符原样保留。
 *
 * [注意] 这是缺陷 2 的修复核心。早先直接按行扫 `@media print`，
 * 于是**块注释里提到「@media print」的那一行被当成真实规则** ——
 * 实测 SettingsPanel.vue:263 就是这种情形，被误判成一个 print 块。
 * 危险场景已构造验证：把某组件的 @media print 整块删掉、只在注释里留字样，
 * 早先的判据**认为通过** → 打印时遮罩会印出来（用户才骂）。
 * 这与「shell grep 静默无输出」「unquote() 后判引号恒 false」同源：
 * *解析器把「看起来像」当成「是」*。
 */
function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  // 状态：normal | line-comment | block-comment | in-string
  let state = 'normal'
  let quote = ''
  while (i < n) {
    const c = src[i]
    const c2 = src.slice(i, i + 2)
    if (state === 'normal') {
      if (c2 === '//') {
        out += '  '
        i += 2
        state = 'line-comment'
        continue
      }
      if (c2 === '/*') {
        out += '  '
        i += 2
        state = 'block-comment'
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        state = 'in-string'
        quote = c
        out += c
        i++
        continue
      }
      out += c
      i++
      continue
    }
    if (state === 'line-comment') {
      if (c === '\n') {
        out += '\n'
        state = 'normal'
      } else {
        out += ' ' // 注释内容抹成空格，长度不变
      }
      i++
      continue
    }
    if (state === 'block-comment') {
      if (c2 === '*/') {
        out += '  '
        i += 2
        state = 'normal'
        continue
      }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    // state === 'in-string'：字符串内部的注释符号不算注释
    if (c === '\\') {
      out += src.slice(i, i + 2)
      i += 2
      continue
    }
    if (c === quote) {
      state = 'normal'
      out += c
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * 取出 .vue 文件里所有 @media print 块（连同所属 <style> 是否 scoped）。
 *
 * 两道修复（缺陷 2）：
 *   1. 先 stripComments —— 注释里的 @media print 不再被当成真实规则
 *   2. 块提取用**花括号计数配平**，而不是「吃到第一个只含 } 的行为止」——
 *      早先的写法遇到空块 `@media print { }` 会越过它、把相邻规则吞进块内
 *      （潜伏隐患：块内出现别的选择器会让「含 display:none」误判为真）
 */
function collectPrintBlocks(vueSrc) {
  const lines = stripComments(vueSrc).split('\n')
  const blocks = []
  let inStyle = false
  let styleScoped = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^<style/.test(line)) {
      inStyle = true
      styleScoped = /\bscoped\b/.test(line)
      continue
    }
    if (inStyle && /^<\/style>/.test(line)) {
      inStyle = false
      continue
    }
    if (!inStyle || !/@media\s+print/.test(line)) continue

    // 从本行起做花括号配平，找到真正属于本 @media 块的右花括号
    let depth = 0
    let started = false
    const body = []
    for (let j = i; j < lines.length; j++) {
      body.push(lines[j])
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth++
          started = true
        } else if (ch === '}') {
          depth--
        }
      }
      // 配平（depth<=0）且已经见过 '{' 才算块结束
      if (started && depth <= 0) break
    }
    blocks.push({ line: i + 1, scoped: styleScoped, body: body.join('\n') })
  }
  return blocks
}

describe('契约 3 · 打印样式存在性', () => {
  const appSrc = read(join(SRC, 'App.vue'))
  const appBlocks = collectPrintBlocks(appSrc)

  test('App.vue 必须有 @media print 块', () => {
    assert.ok(
      appBlocks.length >= 1,
      'App.vue 缺少 @media print —— 打印会把工具条/侧栏/状态栏一起打出来'
    )
  })

  test('App.vue 的 @media print 必须隐藏 .dialog-mask（否则打印出黑色遮罩）', () => {
    const covering = appBlocks.filter((b) => b.body.includes('.dialog-mask'))
    assert.ok(
      covering.length >= 1,
      'App.vue 的 @media print 未提及 .dialog-mask —— 打印时对话框遮罩会盖住正文'
    )
    // 必须真的隐藏，而不是只是提到选择器
    const hit = covering.find((b) => /display:\s*none/.test(b.body))
    assert.ok(
      hit,
      `App.vue 虽提到 .dialog-mask 但未 display:none。实际块:\n${covering[0].body}`
    )
  })

  test('App.vue 的 @media print 必须同时隐藏状态栏与历史面板', () => {
    const block = appBlocks.find((b) => b.body.includes('.dialog-mask'))
    assert.ok(
      /display:\s*none/.test(block.body),
      'App.vue @media print 缺少 display:none'
    )
    // 这两个 chrome 元素打印时都不该出现
    for (const chrome of ['statusbar', 'history-panel']) {
      assert.ok(
        block.body.includes(chrome),
        `App.vue @media print 应隐藏 ${chrome}，实际块:\n${block.body}`
      )
    }
  })

  /**
   * 逐组件检查：带遮罩的组件必须有自己的 @media print。
   *
   * 为什么要「自己的」：App.vue 的 @media print 只作用于 App.vue 自己的 DOM。
   * Vue scoped 样式会把选择器编译成带 data-v-xxx 的形式，父组件的规则
   * **打不到子组件内部** —— 这是 Vue 最常见的静默失效之一。
   */
  const componentsDir = join(SRC, 'components')
  const components = readdirSync(componentsDir).filter((f) => f.endsWith('.vue'))

  test('每个带遮罩的 .vue 组件必须在自己的 scoped 块内声明 @media print', () => {
    const offenders = []
    for (const file of components) {
      const src = read(join(componentsDir, file))
      // 组件模板里是否用了遮罩
      const hasMask = /class="[^"]*\bmask\b/.test(src)
      if (!hasMask) continue
      const blocks = collectPrintBlocks(src)
      const ok = blocks.some((b) => b.scoped && /display:\s*none/.test(b.body))
      if (!ok) {
        offenders.push(
          `${file}（mask=${hasMask}, @media print 块数=${blocks.length}，` +
            `其中 scoped 内含 display:none 的=${blocks.filter((b) => b.scoped && /display:\s*none/.test(b.body)).length}）`
        )
      }
    }
    assert.deepEqual(
      offenders,
      [],
      '以下带遮罩的组件没有自己的 @media print（打印时会输出遮罩）：' +
        offenders.join('; ')
    )
  })

  test('遮罩组件清单非空（防止上面那条因「没找到带遮罩组件」而假通过）', () => {
    const withMask = components.filter((f) =>
      /class="[^"]*\bmask\b/.test(read(join(componentsDir, f)))
    )
    assert.ok(
      withMask.length >= 1,
      '未发现任何带遮罩的组件 —— 遮罩检查可能已失效，请人工确认'
    )
  })

  test('SettingsPanel.vue 必须在 @media print 里隐藏自己的遮罩', () => {
    // 专项锁定：设置面板是最近新增的带遮罩组件，最容易漏打印样式
    const src = read(join(componentsDir, 'SettingsPanel.vue'))
    const blocks = collectPrintBlocks(src)
    assert.ok(blocks.length >= 1, 'SettingsPanel.vue 缺少 @media print')
    const hit = blocks.find((b) => /display:\s*none/.test(b.body))
    assert.ok(hit, `SettingsPanel.vue 的 @media print 未隐藏遮罩。块:\n${blocks[0].body}`)
    assert.ok(
      /mask/.test(hit.body),
      `SettingsPanel.vue 的 @media print 应针对遮罩类名。实际:\n${hit.body}`
    )
  })
})

// ===========================================================================
// 契约 4：emoji（P0-1 零容忍）
// ===========================================================================

/**
 * 加载 P0-1 emoji 正则（**不在测试里复制第二份**）。
 *
 * [注意][注意] 血泪记录（QA 实测，务必保留此注释）：
 *   原 scripts/p0-check-emoji.sh 用的是 GNU grep 扩展语法（码点写成 `\x{H}` 形式），
 *   但 macOS 自带 grep 是 BSD/toybox（本机 toybox 0.8.13），**不支持 `\x{}`**，
 *   会报 `bad regex: invalid character range` 并 exit 2。
 *   而脚本第 13-16 行写了 `2>/dev/null`（吞掉报错）+ `|| true`（吞掉非零退出码），
 *   于是 $HITS 恒为空 → 走「未发现 emoji」分支 → **永远打印「通过」**。
 *
 *   实测复现：往 frontend/src 注入真实 U+1F600，shell 脚本仍输出「通过」exit 0，
 *   而本测试同时报 fail（`frontend/src/components/StatusBar.vue:51`）。
 *   也就是说当时的 shell 门禁在 macOS 上是**假绿灯**，AC-07 曾无证据支撑。
 *
 * 加载顺序（**双源兼容**，避免与前端正在做的「正则真源搬到 Node 模块」互相踩坏）：
 *   1. 优先 `scripts/emoji-pattern.mjs`（若前端已把真源搬过去）
 *      —— 接受两种导出形态：已构造的 RegExp，或 shell 风格字符串
 *   2. 回退 `scripts/p0-check-emoji.sh` 的 `PATTERN='...'`
 *   3. 两处都没有 → 明确报错（绝不静默退化为「不检查」）
 */
function loadEmojiPattern() {
  // ---- 路径 1：共享 JS 模块（前端改写后的真源）----
  const mjsPath = join(REPO, 'scripts', 'emoji-pattern.mjs')
  if (existsSync(mjsPath)) {
    const mod = read(mjsPath)
    for (const name of ['EMOJI_PATTERN', 'EMOJI_REGEX', 'PATTERN']) {
      const re = new RegExp(`export\\s+const\\s+${name}\\s*=`, 'm')
      if (!re.test(mod)) continue
      // 形态 A：直接导出 RegExp 字面量
      const literal = mod.match(
        new RegExp(`export\\s+const\\s+${name}\\s*=\\s*/(.+?)/([a-z]*)`, 'm')
      )
      if (literal) {
        return { source: rel(mjsPath), form: 'RegExp 字面量', re: new RegExp(literal[1], literal[2]) }
      }
      // 形态 B：导出字符串（shell 风格 \x{H} 或 JS 风格 \u{H}）
      const str = mod.match(
        new RegExp(`export\\s+const\\s+${name}\\s*=\\s*'([^']+)'`, 'm')
      )
      if (str) {
        const translated = translatePattern(str[1])
        return { source: rel(mjsPath), form: '字符串', raw: str[1], translated, re: new RegExp(translated, 'u') }
      }
    }
  }

  // ---- 路径 2：shell 脚本的 PATTERN ----
  const shPath = join(REPO, 'scripts', 'p0-check-emoji.sh')
  if (existsSync(shPath)) {
    const sh = read(shPath)
    const m = sh.match(/^PATTERN='([^']+)'/m)
    if (m) {
      const translated = translatePattern(m[1])
      return { source: rel(shPath), form: 'shell PATTERN', raw: m[1], translated, re: new RegExp(translated, 'u') }
    }
  }

  // ---- 路径 3：都没有 → 失败（绝不静默跳过）----
  assert.fail(
    '未能从 scripts/emoji-pattern.mjs 或 scripts/p0-check-emoji.sh 加载 P0-1 emoji 正则。' +
      'P0-1 是零容忍门禁，正则真源丢失必须让测试失败，绝不能静默跳过检查。'
  )
}

/** `\\x{H}` → `\\u{H}`（JS RegExp 在 u flag 下语义等价） */
function translatePattern(shellStyle) {
  return shellStyle.replace(/\\x\{([0-9A-Fa-f]+)\}/g, (_, h) => `\\u{${h}}`)
}

/**
 * 从已翻译的 PATTERN 里抽出码点区间集合（用于双源交叉校验）。
 * 只关心「覆盖了哪些码点」，不关心书写形式。
 */
function extractRanges(translated) {
  const set = new Set()
  if (!translated) return set
  for (const m of translated.matchAll(/\\u\{[0-9A-Fa-f]+\}(?:-[\\u\{]?[0-9A-Fa-f]+\}?)?/g)) {
    set.add(m[0])
  }
  return set
}

const EMOJI = loadEmojiPattern()
const EMOJI_EXTS = ['.vue', '.js', '.ts', '.jsx', '.tsx', '.html', '.mjs']

describe('契约 4 · 源码零 emoji（P0-1，AC-07）', () => {
  test('emoji 正则解析成功且能匹配真实 emoji（扫描器自检）', () => {
    assert.ok(EMOJI.re.test(String.fromCodePoint(0x1f600)), '正则应匹配 U+1F600')
    assert.ok(EMOJI.re.test(String.fromCodePoint(0x2705)), '正则应匹配 U+2705（[对勾]）')
    assert.ok(EMOJI.re.test(String.fromCodePoint(0x1f680)), '正则应匹配 U+1F680（[火箭]）')
    assert.ok(
      !EMOJI.re.test('const a = 1; // 普通中文注释'),
      '正则不应误伤普通中文/ASCII'
    )
  })

  test('P0-1 正则来自共享真源而非本文件内嵌（禁止复制第二份码点区间表）', () => {
    // 记录实际加载来源，便于排错（真源搬家时这条会直接告诉你是哪个文件）
    assert.ok(
      EMOJI.source && existsSync(join(REPO, EMOJI.source)),
      `emoji 正则应从 scripts/ 下的真源加载，实际来源: ${EMOJI.source}`
    )
    assert.ok(
      EMOJI.source.startsWith('scripts/'),
      `emoji 正则真源必须在 scripts/ 下，实际: ${EMOJI.source}`
    )
    // 本文件不得内嵌码点区间表（那会让「改真源忘改测试」变成静默失效）。
    // 被禁的码点用拼接构造，避免本守卫自己成为「内嵌区间表」而被自己判红 ——
    // 这样既不必排除任何行，也不会因行号漂移而失效。
    const FORBIDDEN = ['1F' + '300', '1F' + '9FF', '1F' + 'A70']
    const self = read(new URL(import.meta.url).pathname)
    for (const token of FORBIDDEN) {
      assert.ok(
        !self.includes(token),
        `contracts.test.mjs 不得内嵌 emoji 码点区间（含 ${token} 的区间表），必须从 scripts/ 下的真源读取`
      )
    }
  })

  test('若 shell 与 JS 模块双源并存，P0-1 码点覆盖范围必须一致（防改一边忘一边）', () => {
    const shPath = join(REPO, 'scripts', 'p0-check-emoji.sh')
    const mjsPath = join(REPO, 'scripts', 'emoji-pattern.mjs')
    if (!existsSync(shPath) || !existsSync(mjsPath)) {
      // 单源 —— 无需交叉校验（不是静默跳过：这是正常的单源状态）
      return
    }
    const sh = read(shPath)
    const m = sh.match(/^PATTERN='([^']+)'/m)
    if (!m) return
    const shRanges = extractRanges(translatePattern(m[1]))
    const mjsRanges = extractRanges(EMOJI.translated || EMOJI.re.source)
    assert.deepEqual(
      [...mjsRanges].sort(),
      [...shRanges].sort(),
      'scripts/emoji-pattern.mjs 与 p0-check-emoji.sh 的 P0-1 码点区间不一致 —— ' +
        '两个真源并存却内容不同，改一边忘一边会让门禁口径分裂'
    )
  })

  test('frontend/src 全目录零 emoji（后门路径）', () => {
    const hits = []
    for (const f of listFiles(SRC)) {
      if (!EMOJI_EXTS.some((e) => f.endsWith(e))) continue
      const text = read(f)
      text.split('\n').forEach((line, i) => {
        // 与 shell 脚本一致：跳过整行注释（// 开头）
        if (/^\s*\/\//.test(line)) return
        if (EMOJI.re.test(line)) hits.push(`${rel(f)}:${i + 1}`)
      })
    }
    assert.deepEqual(
      hits,
      [],
      `源码中发现 emoji（P0-1 零容忍，必须替换为项目图标库中的语义图标）：\n${hits.join('\n')}`
    )
  })

  test('本次交付物自身零 emoji（防止测试代码破门）', () => {
    const hits = []
    for (const f of listFiles(HERE)) {
      if (!EMOJI_EXTS.some((e) => f.endsWith(e))) continue
      const text = read(f)
      text.split('\n').forEach((line, i) => {
        if (EMOJI.re.test(line)) hits.push(`${rel(f)}:${i + 1}`)
      })
    }
    assert.deepEqual(hits, [], `tests/ 内发现 emoji：\n${hits.join('\n')}`)
  })
})

// ===========================================================================
// 契约 5：行数门禁
// ===========================================================================

const LINE_LIMIT = 300

/**
 * 显式豁免白名单：每条必须写明豁免理由（Spec §4.2）。
 * [注意] 这是「已知既有债」的登记处，不是永久豁免：
 * 拆分完成后应下调或删除对应条目（App.vue 的目标见 Spec §5-C：≤600 行）。
 */
const LINE_EXEMPTIONS = {
  'frontend/src/App.vue': {
    limit: 1368,
    reason:
      'Spec §5-C 已列为 C 任务拆分对象（目标 ≤600 行）。当前把 useDialog / ' +
      'useShortcutsHelp / useFileOps / useDivider 四类职责塞在一个文件里，' +
      '本轮先建回归网（B）再拆（C），拆分完成后必须下调此阈值。',
  },
  'frontend/src/editor/createEditor.js': {
    limit: 387,
    reason:
      'CodeMirror 6 扩展装配集中地（extensions 数组 + 主题 + 事件绑定），' +
      '拆分需先有 createEditor 的行为测试网。与 App.vue 同属既有债，' +
      '待 C 任务一并处理。' +
      '【下一轮优先目标】Wave 2 把 App.vue 拆到 900 以下后，本文件将成为' +
      '最接近 300 红线的白名单项，白名单会开始掩盖真实超限文件 —— ' +
      '届时应优先为 createEditor 建立行为测试网并拆分，而不是继续调阈值。',
  },
  'frontend/src/editor/commands.js': {
    limit: 341,
    reason:
      '行操作命令集（增删复制移动/缩进/清除格式 + 选区转 HTML），' +
      '命令数量多且共享同一 selection 上下文，过早拆分易破坏语义。' +
      '与 App.vue 同属既有债，待 C 任务一并处理。' +
      '【下一轮优先目标】Wave 2 把 App.vue 拆到 900 以下后，本文件将成为' +
      '最接近 300 红线的白名单项 —— 与 createEditor.js 同为下一轮优先目标。',
  },
}

describe('契约 5 · 行数门禁（≤300 行）', () => {
  const codeFiles = listFiles(SRC).filter((f) => /\.(vue|js|mjs|ts)$/.test(f))

  test('扫描到足够多的源文件（防扫描规则失效而假通过）', () => {
    assert.ok(
      codeFiles.length >= 15,
      `只扫到 ${codeFiles.length} 个源文件，预期 15+`
    )
  })

  test('白名单每条都必须写明豁免理由（防空字符串占位）', () => {
    for (const [file, meta] of Object.entries(LINE_EXEMPTIONS)) {
      assert.ok(
        meta.reason && meta.reason.trim().length >= 20,
        `${file} 的豁免理由不充分（当前: ${JSON.stringify(meta.reason)}）`
      )
      assert.ok(
        Number.isInteger(meta.limit) && meta.limit > 0,
        `${file} 的豁免阈值非法: ${meta.limit}`
      )
    }
  })

  test('豁免白名单里的文件必须真实存在（防白名单残留已删除的路径）', () => {
    const stale = Object.keys(LINE_EXEMPTIONS).filter(
      (p) => !codeFiles.some((f) => rel(f) === p)
    )
    assert.deepEqual(
      stale,
      [],
      `豁免白名单里的文件已不存在，请删除条目：\n${stale.join('\n')}`
    )
  })

  test('白名单外的前端源文件必须全部 ≤300 行', () => {
    const oversized = []
    for (const f of codeFiles) {
      const r = rel(f)
      if (r in LINE_EXEMPTIONS) continue
      const n = countLines(read(f))
      if (n > LINE_LIMIT) oversized.push(`${r} (${n} 行)`)
    }
    assert.deepEqual(
      oversized,
      [],
      `以下文件超过 ${LINE_LIMIT} 行且不在豁免白名单里：\n${oversized.join('\n')}\n` +
        '要么拆分，要么在 LINE_EXEMPTIONS 里显式登记并写明理由。'
    )
  })

  test('豁免文件不得超出自己的阈值（防止 App.vue 拆分后反而变大）', () => {
    const violations = []
    for (const [r, meta] of Object.entries(LINE_EXEMPTIONS)) {
      const f = codeFiles.find((x) => rel(x) === r)
      if (!f) continue
      const n = countLines(read(f))
      if (n > meta.limit) {
        violations.push(`${r}: ${n} 行 > 豁免阈值 ${meta.limit} 行`)
      }
    }
    assert.deepEqual(
      violations,
      [],
      `豁免文件超出自身阈值（说明代码在变大而不是变小）：\n${violations.join('\n')}`
    )
  })

  test('App.vue 必须始终在豁免白名单里（它长期超限是已知债，不是新问题）', () => {
    assert.ok(
      'frontend/src/App.vue' in LINE_EXEMPTIONS,
      'App.vue 应保留显式豁免（拆分完成前不摘掉，拆完下调阈值）'
    )
  })
})
