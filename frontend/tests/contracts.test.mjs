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
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { countTotalLines, countEffectiveLines, LINE_METRIC } from './helpers/line-metric.mjs'

// ---------------------------------------------------------------------------
// 路径解析：全部相对本文件定位，保证从任意 cwd 调用都能跑
// ---------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url)) // frontend/tests
const FRONTEND = join(HERE, '..') // frontend
const REPO = join(FRONTEND, '..') // 仓库根
const SRC = join(FRONTEND, 'src')

// ===========================================================================
// 并发修改守卫（读两次 + 内容哈希比对）
// ===========================================================================
/**
 * [注意] 为什么要这个守卫 —— 一条真实的协作事故链
 *
 *   2026-10-04：QA 做变异自证（临时改 main.go 再 git checkout 还原），
 *   同时前端在跑 npm test（也在读 main.go）→ 读到半写状态 →
 *   事件数暂时对不上 → 前端报「前端注册了 Go 侧不发出的 menu:new-file」。
 *
 *   危害不在这一次 flaky，而在**它污染所有自证结论**：
 *   QA 报 fail、另一人报 flaky，各说各话，最后没人说得清是代码坏了还是环境在抖。
 *
 * 机制：被检查的文件在「读取时」留一份内容哈希，在「断言时」再读一次比对。
 *   不一致 → 明确报「文件在测试运行期间发生变化」，并给出协作提示
 *   （变异自证 / git 操作 / 另一个 agent 正在写仓库，要求串行执行）。
 *
 * 关键设计：**这类报告必须优先于任何业务差集断言**。否则会出现
 *   「文件在变」被误报成「前端多注册了事件」—— 归因错，排查方向就废了。
 */
const STABILITY_GUARDS = new Map() // 仓库相对路径 -> {hash, size, at}

/** 读文件并登记稳定性守卫（返回内容，供后续解析） */
function readStable(absPath) {
  const text = readFileSync(absPath, 'utf8')
  const buf = readFileSync(absPath) // 再读一次原始字节用于哈希
  const key = rel(absPath)
  if (!STABILITY_GUARDS.has(key)) {
    STABILITY_GUARDS.set(key, {
      hash: createHash('sha256').update(buf).digest('hex'),
      size: buf.length,
      at: new Date().toISOString(),
    })
  }
  return text
}

/**
 * 计算指定文件列表中，哪些在登记哈希之后被改动过（返回漂移描述列表）。
 * 抽成独立函数，便于守卫自检复用同一套逻辑 —— 自检必须走**生产代码路径**，
 * 否则「测的是另一份实现」，守卫坏了自检也发现不了。
 */
function driftedFor(keys) {
  const drifted = []
  for (const key of keys) {
    const snap = STABILITY_GUARDS.get(key)
    if (!snap) continue
    const abs = join(REPO, key)
    if (!existsSync(abs)) {
      drifted.push(`${key}（已被删除）`)
      continue
    }
    const now = createHash('sha256').update(readFileSync(abs)).digest('hex')
    if (now !== snap.hash) {
      drifted.push(`${key}（读取时 size=${snap.size}，现在 size=${statSync(abs).size}）`)
    }
  }
  return drifted
}

/**
 * 断言所有已登记的文件在测试运行期间内容未变。
 * 任何差集类断言之前都必须先过这一关。
 */
function assertFilesUnchanged(only) {
  const targets = only
    ? [only]
    : [...STABILITY_GUARDS.keys()]
  const drifted = driftedFor(targets)
  assert.deepEqual(
    drifted,
    [],
    drifted.length
      ? '检测到仓库文件在测试运行期间发生变化：\n  ' +
          drifted.join('\n  ') +
          '\n这几乎不是代码缺陷，而是有其他进程正在并发修改仓库' +
          '（变异自证 / git checkout / 另一个 agent 在写文件）。' +
          '\n后果：基于半写状态的差集结果是**误导性的**（例如把「文件在变」' +
          '报成「前端多注册了事件」）。' +
          '\n请串行执行：一时刻只允许一个人写仓库，变异自证与他人验证必须错开。' +
          '\n本条刻意排在所有业务差集断言之前，就是为了让归因指向「环境在抖」而非「代码坏了」。'
      : ''
  )
}

const read = (p) => readFileSync(p, 'utf8')

// ===========================================================================
// 并发守卫自检（证明守卫本身有效 —— 守卫失效等于没装）
// ===========================================================================
describe('并发守卫自检 · 守卫本身必须能发现漂移', () => {
  // 用临时文件做「登记 → 改动 → 断言检出」的完整闭环，
  // 避免靠真实仓库竞态来验证（竞态不可重复，等于没验证）。
  test('readStable 登记后文件被改动，assertFilesUnchanged 必须检出并指名道姓', () => {
    const tmp = join(SRC, '__guard_selftest.tmp')
    const key = rel(tmp)
    writeFileSync(tmp, 'original\n', 'utf8')
    try {
      readStable(tmp) // 登记哈希
      // 未改动时不应报漂移
      assert.deepEqual(
        driftedFor([key]),
        [],
        '未改动时不应报漂移（守卫过于敏感会把正常测试也判红）'
      )
      // 改动后必须报漂移，且指名道姓
      writeFileSync(tmp, 'CHANGED by concurrent writer\n', 'utf8')
      const drifted = driftedFor([key])
      assert.equal(drifted.length, 1, `改动后应恰好检出 1 个漂移，实际: ${JSON.stringify(drifted)}`)
      assert.ok(
        drifted[0].includes(key),
        `漂移报告应指名文件 ${key}，实际: ${drifted[0]}`
      )
      // 还原后不再报漂移（证明报告不是一次性的）
      writeFileSync(tmp, 'original\n', 'utf8')
      assert.deepEqual(driftedFor([key]), [], '还原后不应再报漂移')
    } finally {
      rmSync(tmp, { force: true })
      STABILITY_GUARDS.delete(key)
    }
  })

  test('文件被删除也要检出（不能因读不到就静默跳过）', () => {
    const tmp = join(SRC, '__guard_selftest2.tmp')
    const key = rel(tmp)
    writeFileSync(tmp, 'x\n', 'utf8')
    try {
      readStable(tmp)
      rmSync(tmp, { force: true })
      const drifted = driftedFor([key])
      assert.equal(drifted.length, 1, '文件被删除应被检出')
      assert.ok(drifted[0].includes('已被删除'), `应说明是删除: ${drifted[0]}`)
    } finally {
      rmSync(tmp, { force: true })
      STABILITY_GUARDS.delete(key)
    }
  })
})

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
 * 行数口径已迁移到 helpers/line-metric.mjs（唯一真源）：
 *   - 阻断口径：有效代码行 = 剥注释 + 去空行（2026-10-05 由总行数改来）
 *   - 总行数：仅作 advisory 展示，不参与判定
 * 详见该模块顶部的「口径变更登记」。
 */

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
  // 全部经 readStable 读取并登记哈希 —— 供下方稳定性守卫比对
  const goSrc = readStable(join(REPO, 'main.go'))
  const emitted = collectGoEmitted(goSrc)

  const registered = new Map() // name -> {file, line}
  for (const f of EVENT_SURFACE_FILES) {
    const p = join(FRONTEND, f)
    for (const [name, line] of collectFrontendRegistered(readStable(p))) {
      if (!registered.has(name)) registered.set(name, { file: f, line })
    }
  }

  /**
   * [必须排在本组第一位] 被读文件在测试运行期间不得变化。
   *
   * 排在差集断言之前是关键：文件在变时，事件数会暂时对不上，
   * 后续差集用例会报出「前端多注册了事件」这类**误导性**结论
   * （2026-10-04 真实发生过一次并发 flaky）。先把归因钉成「环境在抖」，
   * 后面的结论才可信。
   */
  test('被读文件在测试运行期间未被并发修改（并发守卫）', () => {
    assertFilesUnchanged()
  })

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
// 契约 2：⌘P / 键位唯一性 —— 已职责转移，本组用例移除
// ===========================================================================

/**
 * [职责边界 — 键位类检查请看这里，本文件不再承担]
 *
 *   **键位相关的一切检查都已由真源解析器承担**：
 *   - `scripts/parse-main-menu.mjs` 的 `findAcceleratorDuplicates`
 *     —— main.go **内部** accelerator 唯一性（独立于文档比对）
 *   - `scripts/verify/verify-shortcuts.mjs`（CI job `docs-contract`）
 *     —— main.go ↔ README ↔ App.vue SHORTCUTS 的**跨文件语义**一致性
 *
 *   两者合起来覆盖了本文件原先那三条用例（⌘P 唯一 / 命中打印 / 导出 PDF 不得占 ⌘P），
 *   且判据更强：真源解析器按 MOD_ORDER 规范化 accelerator，能区分
 *   `keys.CmdOrCtrl("p")`（⌘P）与 `keys.Combo("p", Cmd, Shift)`（⇧⌘P），
 *   而原先的正则做不到这个规范化。
 *
 * [本组用例已随之移除 —— 这是「职责转移」，不是「检查消失」]
 *   时间线：
 *   - `0fbee9d` 本文件建立三条 ⌘P 用例（当时唯一性无任何覆盖）
 *   - `d76b5aa` 抽出共享解析模块 `parse-main-menu.mjs`（**仍无**唯一性检查）
 *   - `3ef4e12` 修复引号敏感性（精确子串 → 引号无关正则）
 *   - `5d2d494` **真源检查落地**：`findAcceleratorDuplicates`，
 *              并已跑出变异自证（三种引号风格各注入一个 ⌘P → 三次都报红；
 *              ⇧⌘P 与 ⌘P 判定为不冲突）→ 本组用例随即移除
 *
 * [为什么不在此再加一道键位检查 —— 已实测论证，勿重复踩]
 *   1. **计数式判据有结构盲区**：2026-10-04 修过的 ⌘B 撞键 bug，在 main.go 里
 *      `⌘B`/`⌘⇧B` 各只出现 1 次、本身完全合法；冲突只存在于
 *      「App.vue 速查表声称 ⌘B=加粗」与「main.go 里 ⌘B=大纲」之间。
 *      任何基于「数 main.go 里有几个 ⌘X」的检查都抓不到它 ——
 *      已用对照实验确认：复现该 bug 时本文件当时**静默放行**，
 *      而 `verify-shortcuts.mjs` 精确报错。
 *   2. **重复口径即漂移源**：真源解析器数 43 项 accelerator，本文件数 1 个 ⌘P；
 *      两套口径并存，main.go 一变就可能只修一边。
 *   3. 因此：键位问题**请改真源解析器**，不要在测试里另起一套正则。
 *
 * 保留本段注释的唯一目的：让后来人知道检查去了哪里、以及**不要重复造轮子**。
 */
describe('契约 2 · ⌘P 键位唯一性（已职责转移，用例移除）', () => {
  /**
   * 本组不再有实际断言，只保留一条「指针」用例：
   * 确认真源解析器仍然存在且导出唯一性检查 —— 防止有人重构时
   * 把 `findAcceleratorDuplicates` 删掉，导致键位唯一性**静默失去覆盖**。
   * 这正是本轮反复踩的那一类：检查消失时没人报错。
   */
  test('真源解析器仍在且导出唯一性检查（防键位唯一性静默失去覆盖）', () => {
    const p = join(REPO, 'scripts', 'verify', 'parse-main-menu.mjs')
    assert.ok(
      existsSync(p),
      `真源解析器 ${rel(p)} 不存在 —— 若键位唯一性已迁移到别处，请同步更新本段职责说明`
    )
    const mod = read(p)
    assert.ok(
      /export\s+function\s+findAcceleratorDuplicates/.test(mod),
      'parse-main-menu.mjs 不再导出 findAcceleratorDuplicates —— ' +
        'main.go 内部 accelerator 唯一性将失去覆盖，而这种移除**不会有任何报错**。' +
        '若确实要移除，请先在 verify-shortcuts.mjs 里落地等价检查再改这里。'
    )
    // 键位语义（跨文件）那一侧也要在
    const sp = join(REPO, 'scripts', 'verify', 'verify-shortcuts.mjs')
    assert.ok(
      existsSync(sp),
      `键位语义校验脚本 ${rel(sp)} 不存在（CI job docs-contract 依赖它）`
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
  const appSrc = readStable(join(SRC, 'App.vue'))
  const appBlocks = collectPrintBlocks(appSrc)

  /**
   * [必须排在本组第一位] Wave 2 正在拆 App.vue —— 这组读的就是 App.vue。
   * 拆分期间文件必然在变，若不先拦一道，「遮罩没关」类结论会全是假的。
   */
  test('被读文件在测试运行期间未被并发修改（并发守卫）', () => {
    assertFilesUnchanged()
  })

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
 * 阈值口径 = **有效代码行**（helpers/line-metric.mjs）；limit 为登记时实际值，
 * 增长即红（棘轮只许降不许升）。totalAtRegistration 仅供 advisory 展示。
 * [注意] 这是「已知既有债」的登记处，不是永久豁免：拆分完成后应下调或摘除。
 */
const LINE_EXEMPTIONS = {
  'frontend/src/App.vue': {
    limit: 1142,
    totalAtRegistration: 1363,
    reason:
      '有效代码行 1142 / 总行数 1363（2026-10-05 新口径重新登记；旧口径 1280 已作废）。' +
      '仍是全仓最大单文件：useDivider（分栏拖拽）、视图四态、滚动联动、保存编排' +
      '这四类交互重、当前测试网覆盖不到的部分**刻意未拆**（拆了也没有安全网兜底）。' +
      '拆分前须先补相应行为测试。',
  },
  'frontend/src/editor/createEditor.js': {
    limit: 299,
    totalAtRegistration: 386,
    reason:
      '有效代码行 299 / 总行数 386（2026-10-06 用修好的 stripComments 重新登记；' +
      '此前登记的 344 是【口径失真】下的虚高值 —— lexer 对含 ${} 插值的模板串失步，' +
      '导致其后 49 行注释被当成有效代码）。' +
      '有效行已低于 300 红线，**本条实际可摘除**；暂留作棘轮基线，' +
      '下一轮整理白名单时优先处理。',
  },
  'frontend/src/editor/commands.js': {
    limit: 264,
    totalAtRegistration: 340,
    reason:
      '有效代码行 264 / 总行数 340（2026-10-06 同上，重新登记；此前 272 亦为失真值）。' +
      '行操作命令集共享同一 selection 上下文，过早拆分易破坏语义（当前无行为测试网）。' +
      '有效行已低于 300 红线，**本条实际可摘除**；暂留作棘轮基线。',
  },
}

/**
 * 非阻断 advisory 的阈值：达到各自阈值的 90% 即提示。
 *
 * [为什么需要它] 棘轮只在**超过**阈值时才响，于是「再加几行就触顶」
 * 这件事是**静默**的 —— 而登记本身不痛，**不登记才痛**（白名单一旦积累，
 * 掩盖的是真实超限文件）。让它在报告里显形，但**不阻断**：
 * 为了清一条 warning 去拆文件，正是本轮反复讨论的「白名单掩盖问题」。
 */
const LINE_ADVISORY_RATIO = 0.9

describe('契约 5 · 行数门禁（有效代码行 ≤300）', () => {
  const codeFiles = listFiles(SRC).filter((f) => /\.(vue|js|mjs|ts)$/.test(f))
  // 全量登记哈希：本组要数所有源文件的行数，是最容易被并发写入影响的一组
  for (const f of codeFiles) readStable(f)

  /**
   * [必须排在本组第一位] 行数门禁对「文件在变」极其敏感：
   * 拆分中途读到半成品文件，会同时污染「超限清单」与「豁免阈值」两侧结论。
   */
  test('被读文件在测试运行期间未被并发修改（并发守卫）', () => {
    assertFilesUnchanged()
  })

  test('扫描到足够多的源文件（防扫描规则失效而假通过）', () => {
    assert.ok(
      codeFiles.length >= 15,
      `只扫到 ${codeFiles.length} 个源文件，预期 15+`
    )
  })

  test('行数口径必须被显式登记（防悄悄放水/偷偷改口径）', () => {
    assert.equal(LINE_METRIC.name, 'effective-code-lines')
    assert.ok(LINE_METRIC.from && LINE_METRIC.to, '口径变更必须写明 from/to')
    assert.ok(
      LINE_METRIC.reason && LINE_METRIC.reason.trim().length >= 20,
      '口径变更必须写明理由（登记制）'
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

  test('白名单外的前端源文件必须全部 ≤300 有效代码行', () => {
    const oversized = []
    for (const f of codeFiles) {
      const r = rel(f)
      if (r in LINE_EXEMPTIONS) continue
      const n = countEffectiveLines(read(f))
      if (n > LINE_LIMIT) oversized.push(`${r} (${n} 有效代码行)`)
    }
    assert.deepEqual(
      oversized,
      [],
      `以下文件超过 ${LINE_LIMIT} 有效代码行且不在豁免白名单里：\n${oversized.join('\n')}\n` +
        '要么拆分，要么在 LINE_EXEMPTIONS 里显式登记并写明理由。'
    )
  })

  test('豁免文件不得超出自己的阈值（有效代码行，只许降不许升）', () => {
    const violations = []
    for (const [r, meta] of Object.entries(LINE_EXEMPTIONS)) {
      const f = codeFiles.find((x) => rel(x) === r)
      if (!f) continue
      const n = countEffectiveLines(read(f))
      if (n > meta.limit) {
        violations.push(`${r}: ${n} 有效代码行 > 豁免阈值 ${meta.limit}`)
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

  /**
   * [非阻断 advisory] 豁免项体量：有效代码行数按阈值报，总行数仅展示。
   * 口径变更后「总行数」不再阻断，但仍要在报告里可见，避免真实体量被藏起来。
   */
  test('advisory · 豁免项体量（有效代码行 vs 总行数，不阻断）', (t) => {
    const info = []
    const warn = []
    for (const [r, meta] of Object.entries(LINE_EXEMPTIONS)) {
      const f = codeFiles.find((x) => rel(x) === r)
      if (!f) continue
      const eff = countEffectiveLines(read(f))
      const total = countTotalLines(read(f))
      info.push(`${r}：有效代码行 ${eff} / 阈值 ${meta.limit}；总行数 ${total}（仅展示，不计入债务）`)
      if (eff >= meta.limit * LINE_ADVISORY_RATIO) {
        warn.push(
          `${r}：有效代码行 ${eff} 已达阈值 ${meta.limit} 的 ` +
            `${Math.round(LINE_ADVISORY_RATIO * 100)}% —— 增长即红，优先拆分（先补行为测试网）。`
        )
      }
    }
    if (info.length) {
      t.diagnostic(`\n[advisory] 豁免项体量：\n  - ` + info.join('\n  - '))
    }
    if (warn.length) {
      t.diagnostic(`\n[advisory] 以下豁免项已达阈值警戒线：\n  - ` + warn.join('\n  - '))
    }
    // 刻意不做 assert —— advisory 的意义就是不阻断
  })

  /**
   * [非阻断 advisory] 白名单外的文件也接近红线时同样提示。
   * 这一条更关键：**它离红线很近，意味着下次改动就可能触发「新增豁免债」**。
   */
  test('advisory · 白名单外文件接近红线时提示（不阻断）', (t) => {
    const warn = []
    for (const f of codeFiles) {
      const r = rel(f)
      if (r in LINE_EXEMPTIONS) continue
      const n = countEffectiveLines(read(f))
      if (n >= LINE_LIMIT * LINE_ADVISORY_RATIO && n <= LINE_LIMIT) {
        warn.push(
          `${r}：当前 ${n} 有效代码行，距 ${LINE_LIMIT} 行红线仅 ${LINE_LIMIT - n} 行。` +
            `再加就会变成「新增一笔豁免债」—— **拆分前需先有它自己的行为测试网**。`
        )
      }
    }
    if (warn.length) {
      t.diagnostic(
        `\n[advisory] 以下文件接近 ${LINE_LIMIT} 行红线（尚未超限，故不阻断）：\n  - ` +
          warn.join('\n  - ')
      )
    }
  })
})
