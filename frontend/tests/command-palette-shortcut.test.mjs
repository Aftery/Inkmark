/**
 * command-palette-shortcut.test.mjs — ⌘⇧A 打开命令面板：一次按键只翻转一次
 * ---------------------------------------------------------------------------
 * 被测对象：src/components/CommandPalette.vue 的 onKeydown 打开分支
 *           + src/composables/useShortcuts.js 的 installGlobalShortcuts
 *
 * 【这个文件为什么存在：2026-10 真机缺陷「⌘⇧A 命令面板快捷键没用」】
 * 上一轮（commit 2539280）只做了静态审查，没有真机验证，实测失效。
 * 根因不是 accelFromEvent 归一化错、不是 CM keymap 抢占、不是 Go 侧 accelerator，
 * 而是**双监听导致命令被分发两次**：
 *
 *   CommandPalette.vue  : window.addEventListener('keydown', onKeydown, true)  ← capture 阶段
 *   useShortcuts.js     : window.addEventListener('keydown', onKeydown)         ← bubble 阶段
 *
 * 两条路径都命中 ⌘⇧A 并各自 emitCommand('view.commandPalette')，
 * 而 useCommands.js 注册的处理器是**翻转** uiState.paletteOpen（不是置真）。
 * 于是同一次按键翻转两次：先 true 后 false，面板一闪即关，
 * 用户看到的就是「按了没反应」。
 *
 * 当时只调了 e.preventDefault() —— 它只取消浏览器默认行为，
 * **不阻止事件传播**，所以 bubble 阶段照样跑到。
 *
 * 【为什么用「静态提取 + 真实派发」而不是整体 mock】
 * 把 onKeydown 抄一遍进测试，测的就不是源码了：删掉 stopPropagation()
 * 测试仍然会绿（因为它测的是抄来的那份）。故本文件从 .vue 源码里
 * 正则提取打开分支的真实结构，与真实的 installGlobalShortcuts 组合派发，
 * 断言「一次按键 → 处理器只被调一次 → 面板最终是开的」。
 * 这样删 stopPropagation()、把 emitCommand 写两遍、改判定条件都会让测试变红。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// 最小 DOM 事件派发器：按 DOM Living Standard "dispatch" 算法实现
// ---------------------------------------------------------------------------
// 为什么不用 jsdom：本项目测试网零第三方依赖（tests/README.md §3.1），
// 且这里不需要布局 / 渲染，只需要「capture 阶段与 bubble 阶段谁先谁后、
// stopPropagation 之后还会不会继续」这一个语义。
// 规范要点（每个监听器调用后都要查停止标志）：
//   capture：path 从根往 target 走（单节点 path 即该节点自身的 capture 监听器）
//   bubble ：path 从 target 往根走（单节点 path 即该节点自身的 bubble 监听器）
//   stopPropagation() 置位后，当前阶段剩余监听器与后续所有阶段都不再执行
class FakeWindow {
  constructor() { this.listeners = [] }
  addEventListener(type, fn, capture) {
    assert.equal(type, 'keydown', '本测试只关心 keydown')
    this.listeners.push({ fn, capture: !!capture })
  }
  removeEventListener(type, fn, capture) {
    const i = this.listeners.findIndex((l) => l.fn === fn && l.capture === !!capture)
    if (i >= 0) this.listeners.splice(i, 1)
  }
  /** 派发一个合成 KeyboardEvent，返回 { preventDefaultCalls, stopPropagationCalls } */
  dispatch(ev) {
    ev._stop = false
    // capture 阶段
    for (const l of this.listeners.filter((l) => l.capture)) {
      l.fn(ev)
      if (ev._stop) return
    }
    // bubble 阶段
    for (const l of this.listeners.filter((l) => !l.capture)) {
      l.fn(ev)
      if (ev._stop) return
    }
  }
}

/** 合成 KeyboardEvent：字段与真实事件对齐（key 已按平台归一，见 accelFromEvent） */
function keyEvent({ key, meta = false, shift = false, alt = false, ctrl = false, isComposing = false }) {
  return {
    key, metaKey: meta, shiftKey: shift, altKey: alt, ctrlKey: ctrl, isComposing,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this._stop = true },
  }
}

/** 从 CommandPalette.vue 源码里提取 onKeydown 的函数体（用于结构断言） */
const paletteSrc = readFileSync(
  new URL('../src/components/CommandPalette.vue', import.meta.url), 'utf8')

/**
 * 从源码提取「打开分支」的代码块，按 onKeydown 的 if (!open.value) 为锚。
 * 取到与之配对的右花括号为止，保证改动一定发生在该分支内才有效。
 */
function extractOpenBranch(src) {
  const start = src.indexOf('if (!open.value) {')
  assert.ok(start >= 0, 'CommandPalette.vue 必须保留 if (!open.value) { 打开分支')
  let depth = 0
  let i = src.indexOf('{', start)
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('打开分支花括号不配对')
}

// ---------------------------------------------------------------------------
// 组装真实的运行时：真实 useShortcuts（含 installGlobalShortcuts 与命令总线）
// ---------------------------------------------------------------------------
// useShortcuts.js 顶层会读 navigator.platform（fmtAccel 里），node 下该属性
// 是只读 getter，不能整体赋值，只能改字段（若已存在）。它只被 fmtAccel 用到，
// 与本测试的键位归一无关。
if (typeof globalThis.navigator === 'undefined' || !globalThis.navigator.platform) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: 'MacIntel' }, configurable: true, writable: true,
  })
}
globalThis.window = globalThis.window || new FakeWindow()

const {
  accelFromEvent, installGlobalShortcuts, uiState, onCommand, emitCommand, COMMANDS, getCommand,
} = await import('../src/composables/useShortcuts.js?palette-shortcut')
/** 模块命名空间引用：setup 的 ignoreAvoidance 需要真实 matchCommand，不能抄一份 */
const shortcutsModule = {
  accelFromEvent, installGlobalShortcuts, uiState, onCommand, emitCommand, COMMANDS, getCommand,
  matchCommand: (e) => {
    const accel = accelFromEvent(e)
    return accel ? (COMMANDS.find((c) => c.accel === accel) || {}).id || null : null
  },
}

const PALETTE_ACCEL = getCommand('view.commandPalette').accel

/** 复刻 useCommands.js 注册的同名处理器：翻转（不是置真）—— 这是缺陷的一半成因 */
function registerToggleHandler() {
  let calls = 0
  onCommand('view.commandPalette', () => {
    calls++
    uiState.paletteOpen.value = !uiState.paletteOpen.value
  })
  return () => calls
}

/**
 * 复刻 CommandPalette.vue 的 capture 监听：直接执行源码里提取出的打开分支。
 * 这样测的就是 .vue 里的真实结构，而不是抄写的副本。
 */
function makeCaptureHandler() {
  const cmd = getCommand('view.commandPalette')
  // 与 .vue 里一致：open 指向模块级 ref
  const open = uiState.paletteOpen
  const branch = extractOpenBranch(paletteSrc)
  // 把提取出的分支包成一个函数体；open/cmd/emitCommand/accelFromEvent/PALETTE_ID
  // 都由闭包提供 —— 分支体本身仍逐字来自 .vue 源码
  const factory = new Function(
    'e', 'open', 'cmd', 'emitCommand', 'accelFromEvent', 'PALETTE_ID',
    `${branch}\nreturn`,
  )
  return (e) => factory(e, open, cmd, emitCommand, accelFromEvent, 'view.commandPalette')
}

/**
 * 搭好「capture + bubble」双监听环境，返回计数与派发入口。
 *
 * 【为什么要 ignoreAvoidance 这个开关】两道防线的职责必须能分开验证：
 *   installGlobalShortcuts 的避让规则读的是 uiState.paletteOpen，而第一次 emit
 *   会**立刻**把它置真 —— 于是「删掉 capture 里的 stopPropagation()」这个变异
 *   会被避让规则顺手挡掉，行为测试反而全绿，根本钉不住 stopPropagation。
 *   打开本开关即强制 bubble 阶段无视避让、按最朴素的「命中就分发」跑，
 *   从而把 stopPropagation 单独置于放大镜下：它才是切断传播的唯一手段。
 */
function setup({ ignoreAvoidance = false } = {}) {
  const win = new FakeWindow()
  globalThis.window = win
  // installGlobalShortcuts 内部读的是全局 window，故必须在它之前换好
  const removeBubble = installGlobalShortcuts()
  if (ignoreAvoidance) {
    // 把刚注册的 bubble 监听换成「无视面板态」的版本，模拟避让规则缺失时的情形
    win.listeners = win.listeners.filter((l) => l.capture)
    const { matchCommand } = shortcutsModule
    win.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      const id = matchCommand(e)
      if (!id) return
      e.preventDefault()
      emitCommand(id)
    })
  }
  const capture = makeCaptureHandler()
  win.addEventListener('keydown', capture, true)
  uiState.paletteOpen.value = false
  let calls = 0
  onCommand('view.commandPalette', () => {
    calls++
    uiState.paletteOpen.value = !uiState.paletteOpen.value
  })
  return {
    win,
    calls: () => calls,
    dispatch: (ev) => win.dispatch(ev),
    teardown: () => removeBubble(),
  }
}

// ===========================================================================
// 根因钉死：一次 ⌘⇧A 只允许翻转一次
// ===========================================================================
describe('命令面板 · ⌘⇧A 单次分发（真机缺陷「快捷键没用」的根因）', () => {
  test('一次 ⌘⇧A 只触发命令处理器一次（不是两次）', () => {
    const env = setup()
    env.dispatch(keyEvent({ key: 'a', meta: true, shift: true }))
    assert.equal(
      env.calls(), 1,
      '处理器被调用 2 次 = 翻转两次 = 打开后立刻关闭。' +
      'capture 阶段命中后必须 stopPropagation() 切断 bubble 阶段的 installGlobalShortcuts',
    )
    env.teardown()
  })

  test('避让规则缺失时仍只分发一次：stopPropagation 是独立生效的防线', () => {
    // 【为什么必须有用例覆盖 ignoreAvoidance】installGlobalShortcuts 的避让读
    // uiState.paletteOpen，而第一次 emit 会立刻把它置真 —— 于是「删掉 capture 里
    // 的 stopPropagation()」这个变异会被避让规则顺手挡掉，行为测试全绿，
    // 根本钉不住 stopPropagation。本用例强制 bubble 无视面板态跑，
    // 把 stopPropagation 单独置于放大镜下。
    const env = setup({ ignoreAvoidance: true })
    env.dispatch(keyEvent({ key: 'a', meta: true, shift: true }))
    assert.equal(
      env.calls(), 1,
      '即使 bubble 阶段不做避让，capture 命中后也必须靠 stopPropagation() 切断它，' +
        '否则同一次按键分发两次（这正是 2026-10 真机缺陷的直接机理）',
    )
    assert.equal(
      uiState.paletteOpen.value, true,
      '只分发一次 => 面板应保持打开；若为 false，说明 stopPropagation 缺失导致翻转两次',
    )
    env.teardown()
  })

  test('一次 ⌘⇧A 后面板必须是打开状态', () => {
    const env = setup()
    env.dispatch(keyEvent({ key: 'a', meta: true, shift: true }))
    assert.equal(
      uiState.paletteOpen.value, true,
      '按 ⌘⇧A 后面板应处于打开状态；若为 false，说明同一次按键被翻转了两次',
    )
    env.teardown()
  })

  test('e.key 大写或小写都能打开（WKWebView 两种上报都见过）', () => {
    for (const key of ['a', 'A']) {
      const env = setup()
      env.dispatch(keyEvent({ key, meta: true, shift: true }))
      assert.equal(uiState.paletteOpen.value, true, `e.key = ${JSON.stringify(key)} 时应打开面板`)
      assert.equal(env.calls(), 1, `e.key = ${JSON.stringify(key)} 时应只分发一次`)
      env.teardown()
    }
  })

  test('再按一次 ⌘⇧A：面板开着时不得被重复分发（避让规则）', () => {
    const env = setup()
    env.dispatch(keyEvent({ key: 'a', meta: true, shift: true }))
    assert.equal(uiState.paletteOpen.value, true, '第一次应打开')
    // 第二次：capture 监听见 open=true 而放行，bubble 的 installGlobalShortcuts
    // 必须同样避让 —— 否则面板开着时按 ⌘⇧A 会被它关掉（本用例钉住的缺陷）。
    const before = env.calls()
    env.dispatch(keyEvent({ key: 'a', meta: true, shift: true }))
    assert.equal(
      env.calls(), before,
      '面板已打开时再按 ⌘⇧A 不得再触发命令处理器 —— installGlobalShortcuts ' +
        '需对 view.commandPalette 避让，否则用户正看着的面板被关掉',
    )
    assert.equal(uiState.paletteOpen.value, true, '面板应保持打开')
    env.teardown()
  })

  test('preventDefault 必须被调用（否则 ⌘⇧A 的浏览器默认行为仍会跑）', () => {
    const env = setup()
    const ev = keyEvent({ key: 'a', meta: true, shift: true })
    env.dispatch(ev)
    assert.equal(ev.defaultPrevented, true, '命中键位必须 preventDefault')
    env.teardown()
  })
})

// ===========================================================================
// 源码结构契约：stopPropagation 必须在「命中打开键位」的分支里
// ===========================================================================
describe('命令面板 · 打开分支的传播切断契约', () => {
  const branch = extractOpenBranch(paletteSrc)

  test('打开分支必须调用 stopPropagation()', () => {
    assert.ok(
      /e\.stopPropagation\(\)/.test(branch),
      '打开分支缺少 e.stopPropagation() —— bubble 阶段的 installGlobalShortcuts 会再 emit 一次，' +
        '导致 uiState.paletteOpen 翻转两次（按了没反应）。这正是 2026-10 真机缺陷的根因',
    )
  })

  test('stopPropagation() 必须在 emitCommand 之前（先切断再分发）', () => {
    const stop = branch.indexOf('e.stopPropagation()')
    const emit = branch.indexOf('emitCommand(PALETTE_ID)')
    assert.ok(stop >= 0 && emit >= 0, '打开分支必须同时含 stopPropagation 与 emitCommand')
    assert.ok(
      stop < emit,
      '必须先 stopPropagation() 再 emitCommand：反过来会让处理器在事件仍可传播时执行，' +
        '翻转与 bubble 阶段的第二次 emit 之间存在竞态',
    )
  })

  test('capture 监听必须带第三个参数 true（否则抢不过编辑器 keymap）', () => {
    assert.ok(
      /window\.addEventListener\('keydown',\s*onKeydown,\s*true\)/.test(paletteSrc),
      'CommandPalette.vue 的 keydown 监听必须是 capture 阶段（第三个参数 true），' +
        '否则 ⌘⇧A 可能被 CodeMirror 的 keymap 先吃掉',
    )
  })

  test('stopPropagation 不得无条件执行（否则会拦死面板开着时的按键接管）', () => {
    // 无条件拦死会让 Esc/Enter/↑↓ 到不了 installGlobalShortcuts 之外的监听器。
    // 判据：onKeydown 函数体内，stopPropagation 调用点必须嵌套在
    // 「accel 比对为真」的条件里 —— 用缩进深度近似判定（比正则更抗重构）。
    const body = paletteSrc.slice(paletteSrc.indexOf('function onKeydown(e) {'))
    const lines = body.split('\n')
    const stopLine = lines.find((l) => /e\.stopPropagation\(\)/.test(l))
    assert.ok(stopLine, '未找到 e.stopPropagation() 调用')
    const indent = stopLine.match(/^\s*/)[0].length
    assert.ok(
      indent >= 6,
      `e.stopPropagation() 的缩进为 ${indent} 空格，疑似被提到了条件分支之外 —— ` +
        '它只应拦「命中打开键位」那一次按键，面板开着时的 Esc/Enter/↑↓ 必须放行',
    )
  })
})

// ===========================================================================
// 作用域钉死：只有 ⌘⇧A 被切断传播，其他键位一律放行
// ===========================================================================
describe('命令面板 · 传播切断的作用域（只拦打开键位）', () => {
  test('Esc / Enter / ↑↓ 面板开着时不得切断传播', () => {
    const env = setup()
    uiState.paletteOpen.value = true // 先让面板处于打开态
    for (const key of ['Escape', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      const ev = keyEvent({ key })
      env.dispatch(ev)
      assert.equal(
        ev._stop, false,
        `面板开着时按 ${key} 不应 stopPropagation —— 该键由面板自己接管，` +
          '切断传播会让其他监听器收不到',
      )
    }
    env.teardown()
  })

  test('其他快捷键（⌘B / ⌘S）不得被本监听切断传播', () => {
    const env = setup()
    for (const [key, meta, shift] of [['b', true, false], ['s', true, false], ['a', true, false]]) {
      const ev = keyEvent({ key, meta, shift })
      env.dispatch(ev)
      assert.equal(
        ev._stop, false,
        `${meta ? '⌘' : ''}${shift ? '⇧' : ''}${key.toUpperCase()} 不是打开键位，` +
          '不得切断传播（否则其他命令的快捷键会失效）',
      )
    }
    env.teardown()
  })

  test('裸字母键（打字）不得被切断传播', () => {
    const env = setup()
    const ev = keyEvent({ key: 'a' })
    env.dispatch(ev)
    assert.equal(ev._stop, false, '无修饰键的裸键必须放行，否则编辑器里没法打字')
    assert.equal(env.calls(), 0, '裸键不得触发任何命令')
    env.teardown()
  })

  test('accelFromEvent 对 ⌘⇧A 的归一化与 COMMANDS 表写法一致', () => {
    // 这一条挡住「表里写 ⌘⇧A、事件归一成别的串」这类静默失效
    for (const key of ['a', 'A']) {
      assert.equal(
        accelFromEvent(keyEvent({ key, meta: true, shift: true })), '⌘⇧A',
        `e.key=${key} + ⌘ + ⇧ 应归一成 '⌘⇧A'`,
      )
    }
    assert.equal(PALETTE_ACCEL, '⌘⇧A', 'COMMANDS 表里 view.commandPalette 的 accel 应为 ⌘⇧A')
  })
})

// ===========================================================================
// 回归护栏：菜单点击 / 总线路径仍走同一个开关（修法不得破坏契约 1 的设计意图）
// ===========================================================================
describe('命令面板 · 三条入口仍收敛到同一开关', () => {
  test('不经键盘、直接 emitCommand 也能打开（菜单点击 / 总线路径）', () => {
    uiState.paletteOpen.value = false
    let calls = 0
    onCommand('view.commandPalette', () => {
      calls++
      uiState.paletteOpen.value = !uiState.paletteOpen.value
    })
    emitCommand('view.commandPalette')
    assert.equal(uiState.paletteOpen.value, true, '总线路径必须仍能打开面板')
    assert.equal(calls, 1)
  })

  test('uiState.paletteOpen 是跨组件单一真源（CommandPalette 不另持 ref）', () => {
    // 双真源是这类「键位开了、菜单点了没反应」缺陷的另一半成因
    assert.ok(
      /const open = uiState\.paletteOpen/.test(paletteSrc),
      'CommandPalette.vue 必须直接用 uiState.paletteOpen，不得另持一个 ref',
    )
  })
})
