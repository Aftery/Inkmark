/**
 * parse-main-menu.mjs — main.go 菜单的【共享解析器】
 * ============================================================================
 * 存在理由：仓库里曾有两处独立解析同一份 main.go 菜单——
 *   1) scripts/verify/verify-shortcuts.mjs        解析 accelerator（⌘P / ⌘⇧P …）
 *   2) frontend/tests/contracts.test.mjs          解析事件名（menu:print …）
 * 两份实现各写各的解析逻辑，将来 main.go 语法一变（例如把事件名抽成常量、
 * 加 AddSubmenu 嵌套变体）必然只改一处、另一处静默失效。
 * 故把「解析」抽到这里，**下游校验与报告各自保留**（两边关心的字段不同：
 *   verify-shortcuts 关心 accelerator；contracts.test 关心事件名闭合）。
 *
 * 纯函数、零依赖、只用 node 内置——不引入任何第三方包。
 *
 * ============================================================================
 * 【三个已踩过的坑，本模块一次性解决并在代码里留证】
 *
 * 坑 1 · 逗号正则切实参会截断（静默假绿）
 *   最初用 /([^,]+)/ 切 AddText 的实参，结果在 keys.CmdOrCtrl("n") 内部的逗号
 *   处提前截断，parseAccel 收到 'keys.CmdOrCtrl("n"' 而抛错。更糟的形态是
 *   截断后恰好仍能匹配上，让「无 accelerator 项」被算成有值 → 21 项漏报成 0，
 *   门禁报「一致」而实际漏了一大片。
 *   对策：splitArgs() 做【括号深度 + 引号状态】感知的切分。
 *
 * 坑 2 · unquote() 之后又用 startsWith('"') 判断（恒为 false，静默假绿）
 *   unquote() 内部已把外层引号剥掉，返回值必然不以 '"' 开头；再判一次
 *   startsWith('"') 永远为 false，导致「无 accelerator 项」列表恒为空，
 *   报告里显示「无 accelerator 的菜单项: 0 项」而不报错。
 *   对策：unquote() 用「返回 null 表示非字面量」表达失败，调用方只判 null。
 *
 * 坑 3 · 修饰键书写顺序不同导致假警报
 *   main.go 的 keys.Combo("p", CmdOrCtrlKey, ShiftKey) 归一后是 '⌘⇧P'，
 *   而文档/速查表里可能按习惯写成 '⇧⌘P'（macOS 官方书写惯例正是 ⌘⇧P）。
 *   两者语义相同，若不归一就会判成「捏造键位」。
 *   对策：parseAccelerator() 内部按 MOD_ORDER 排序输出规范形式；
 *   文档侧用 canonToken() 走同一套 MOD_ORDER。
 *
 * 另附两个防御：
 *   - 动态标签（最近打开的 labels[i]）与变量标签（exportPDFTitle）不可静态枚举，
 *     label 返回 null 并置 labelIsDynamic=true，调用方【必须】显式处理，
 *     不允许静默当成字符串用。
 *   - 找不到 buildMenu 函数体时抛错，而不是返回空数组（空数组会让下游
 *     「差集为空 → 全部一致」从而假通过）。
 * ============================================================================
 */

/** 修饰键常量 → 内部代号 */
const MOD_CONST = {
  CmdOrCtrlKey: 'cmd',
  ShiftKey: 'shift',
  OptionOrAltKey: 'alt',
  ControlKey: 'ctrl',
}

/** 规范修饰键顺序：⌘ → ⇧ → ⌥ → ⌃（两处文档/代码共用，保证同一组合只有一种写法） */
export const MOD_ORDER = ['cmd', 'shift', 'alt', 'ctrl']

/** 内部代号 → 展示符号 */
export const MOD_DISPLAY = { cmd: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }

/** 展示符号 → 内部代号（供文档侧归一，见坑 3） */
const DISPLAY_TO_MOD = { '⌘': 'cmd', '⇧': 'shift', '⌥': 'alt', '⌃': 'ctrl' }

/** 非单字符键的展示名 */
const KEY_DISPLAY = { Up: '↑', Down: '↓' }

/** 单字符键归一：'p' → 'P'；符号键（`/ , - = .`）原样保留 */
function normKey(k) {
  if (KEY_DISPLAY[k]) return KEY_DISPLAY[k]
  return /^[a-z]$/.test(k) ? k.toUpperCase() : k
}

/**
 * 切分 Go 调用实参，感知括号深度与引号状态。
 * @param {string} argStr 形如 `"标签", keys.CmdOrCtrl("n"), emit("x")` 的括号内文本
 * @returns {string[]}
 */
export function splitArgs(argStr) {
  const out = []
  let depth = 0
  let cur = ''
  let inStr = false // 双引号
  let inRaw = false // 反引号
  let inChar = false // 单引号 rune
  for (let i = 0; i < argStr.length; i++) {
    const c = argStr[i]
    if (inStr) {
      cur += c
      if (c === '\\') { cur += argStr[++i] ?? ''; continue }
      if (c === '"') inStr = false
      continue
    }
    if (inRaw) { cur += c; if (c === '`') inRaw = false; continue }
    if (inChar) { cur += c; if (c === "'") inChar = false; continue }
    if (c === '"') { inStr = true; cur += c; continue }
    if (c === '`') { inRaw = true; cur += c; continue }
    if (c === "'") { inChar = true; cur += c; continue }
    if (c === '(' || c === '[') { depth++; cur += c; continue }
    if (c === ')' || c === ']') { depth--; cur += c; continue }
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

/**
 * 找出所有 `.Method(` 调用并返回实参数组（同样感知括号与引号，见坑 1）。
 * @param {string} text
 * @param {string} method 如 'AddText'
 * @returns {{args: string[], index: number}[]}
 */
export function findCalls(text, method) {
  const res = []
  const needle = `.${method}(`
  let i = 0
  while (true) {
    const at = text.indexOf(needle, i)
    if (at === -1) break
    const argStart = at + needle.length
    let depth = 1
    let j = argStart
    let inStr = false
    let inRaw = false
    let inChar = false
    while (j < text.length && depth > 0) {
      const c = text[j]
      if (inStr) { if (c === '\\') { j += 2; continue } if (c === '"') inStr = false; j++; continue }
      if (inRaw) { if (c === '`') inRaw = false; j++; continue }
      if (inChar) { if (c === "'") inChar = false; j++; continue }
      if (c === '"') { inStr = true; j++; continue }
      if (c === '`') { inRaw = true; j++; continue }
      if (c === "'") { inChar = true; j++; continue }
      if (c === '(') depth++
      else if (c === ')') depth--
      j++
    }
    res.push({ args: splitArgs(text.slice(argStart, j - 1)), index: at })
    i = j
  }
  return res
}

/**
 * 解析 accelerator 表达式（keys.CmdOrCtrl / keys.OptionOrAlt / keys.Combo）。
 * @param {string} expr 实参原文，如 'nil' 或 'keys.Combo("p", keys.CmdOrCtrlKey, keys.ShiftKey)'
 * @returns {{mods: string[], key: string}|null} null 表示无 accelerator
 * @throws {Error} 表达式形态未知时抛错（不静默当 null，否则门禁会假通过）
 */
export function parseAccelerator(expr) {
  const e = (expr || '').trim()
  if (e === '' || e === 'nil') return null

  let m = e.match(/^keys\.CmdOrCtrl\(\s*"(.+)"\s*\)$/)
  if (m) return { mods: ['cmd'], key: m[1] }

  m = e.match(/^keys\.OptionOrAlt\(\s*"(.+)"\s*\)$/)
  if (m) return { mods: ['alt'], key: m[1] }

  m = e.match(/^keys\.Combo\(\s*"(.+)"\s*(.*?)\s*\)$/s)
  if (m) {
    const mods = []
    for (const mm of m[2].matchAll(/keys\.(\w+)/g)) {
      if (!MOD_CONST[mm[1]]) {
        throw new Error(`未识别的修饰键常量 keys.${mm[1]}（出现在：${e}）`)
      }
      mods.push(MOD_CONST[mm[1]])
    }
    return { mods, key: m[1] }
  }

  throw new Error(`未识别的 accelerator 表达式：${e}`)
}

/**
 * 把 accelerator 归一成规范展示形式（坑 3）。
 * @param {{mods: string[], key: string}|null} acc
 * @returns {string|null}
 */
export function formatAccelerator(acc) {
  if (!acc) return null
  const mods = MOD_ORDER.filter((x) => acc.mods.includes(x)).map((x) => MOD_DISPLAY[x]).join('')
  return mods + normKey(acc.key)
}

/**
 * 归一「文档里写的键位」到与 formatAccelerator 相同的规范形式（坑 3）。
 * 文档可能按书写习惯把 ⇧ 放在 ⌘ 前面（'⇧⌘P'），语义与 '⌘⇧P' 相同。
 * @param {string} token 如 '⇧⌘P' / '⌥↑' / '⌘`'
 * @returns {string|null} null 表示该 token 不以修饰键开头
 */
export function canonToken(token) {
  const mods = []
  for (const ch of token) {
    if (DISPLAY_TO_MOD[ch]) mods.push(DISPLAY_TO_MOD[ch])
  }
  if (mods.length === 0) return null
  return formatAccelerator({ mods, key: token.slice(mods.length) })
}

/**
 * 反引号字符串字面量 → 字符串内容。
 * 用 JSON.parse 走标准转义规则，避免自写 unescape 漏掉 \n \" \\ 等。
 * @returns {string|null} null 表示不是字面量（变量 / 动态表达式）
 */
export function unquote(raw) {
  if (!raw) return null
  const s = raw.trim()
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  if (s.startsWith('`')) {
    // Go raw string：无转义，但只处理单行（真实标签不含换行）
    if (s.endsWith('`') && s.length >= 2) return s.slice(1, -1)
    return null
  }
  return null
}

/**
 * 解析 locales.go 的语言表，返回 zh-CN（基准语言）的 key → 文案映射。
 *
 * 为什么需要：v1.2 起菜单标签改成 t(locale, "key") 查表，若不回查语言表，
 * 每个菜单项都会被判成「动态标签」，丢掉可读的定位信息。
 *
 * [注意] 语言表在**另一个文件**（locales.go），不在 main.go 里 —— 调用方必须
 * 一并传入，否则解析出 0 条、所有 key 都会被报成「缺失」。
 *
 * 容忍实现细节上的两种写法（都是 Go 合法语法）：
 *   - 缩进/换行自由：用「找 locale 块的起止大括号」而非逐行正则；
 *   - 注释块内出现同名字符串也不受影响（先剥注释）。
 * @param {string} localeSrc locales.go 全文
 * @returns {Map<string,string>} zh-CN 的 key → 文案；解析不到时返回空 Map
 */
export function parseLocaleTable(localeSrc) {
  const table = new Map()
  if (!localeSrc) return table
  // [注意] 这里【刻意不做完整的注释剥离】——试过，状态机在 Go 的 \ 转义、
  //   字符串内 // 等边界上反复出错（实测把整张表解析成 0 条）。
  //   本仓已在「剥注释」这件事上栽过 5 次（shell grep 静默 / @media print
  //   注释误判 / JSDoc 示例误判 / menuLabels 匹配到注释 / 反斜杠转义），
  //   收益不值得再投。改用最笨但可控的方式：逐行解析 + 显式跳过整行注释。
  //
  // 定位 menuLabels：找不以 // 开头、且含 'var menuLabels' 的行。
  const lines = localeSrc.split('\n')
  let inTable = false
  let depth = 0
  let started = false
  for (const line of lines) {
    const trimmed = line.trim()
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
    if (!inTable) {
      if (isComment) continue
      if (/^var\s+menuLabels\b/.test(trimmed)) { inTable = true }
      continue
    }
    if (isComment) continue
    // zh-CN 块开始之前的行（"zh-CN": { 之前）只累计深度，不取值
    for (const m of line.matchAll(/("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
      const k = unquote(m[1])
      const v = unquote(m[2])
      if (k === null || v === null) continue
      // 只收 zh-CN 块内的：进入该块后 started=true
      if (!started) continue
      if (!table.has(k)) table.set(k, v)
    }
    if (!started && /"zh-CN"\s*:\s*\{/.test(line)) started = true
    // 大括号配平跟踪（逐字符，跳过字符串内的括号）
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        i++
        while (i < line.length && line[i] !== '"') { if (line[i] === '\\') i++; i++ }
        continue
      }
      if (ch === '{') { depth++; started = started || false }
      else if (ch === '}') {
        depth--
        if (depth === 0 && started) return table // zh-CN 块闭合 → 收工
      }
    }
    if (started && depth === 0) return table
  }
  return table
}

/** 源码中第 index 个字符所在的 1-based 行号 */
function lineAt(text, index) {
  return text.slice(0, index).split('\n').length
}

/**
 * 解析 buildMenu() 里的全部菜单项。
 *
 * @param {string} goSrc main.go 全文
 * @param {string} [localeSrc] locales.go 全文。v1.2 起菜单标签是
 *   t(locale, "key") 查表形式，不传则所有标签退化为「动态标签」，
 *   noAccelLabels 计数归零、报错定位信息丢失（门禁判定不受影响，但排查变难）。
 * @returns {{
 *   items: Array<{
 *     kind: 'AddText'|'AddCheckbox',
 *     label: string|null,        // 动态标签（labels[i]）或变量标签（exportPDFTitle）为 null
 *     labelIsDynamic: boolean,   // true ⇒ label 不可静态枚举
 *     accelerator: string|null,  // 规范展示形式，如 '⌘⇧P'；无则 null
 *     rawAccelerator: string,    // 实参原文，便于排错
 *     hasAccelerator: boolean,
 *     line: number,              // 1-based
 *     event: string|null,        // emit 的事件名（能静态解析时），供契约闭合检查
 *   }>,
 *   warnings: string[],          // 非致命问题（如动态标签），供调用方展示
 * }}
 * @throws {Error} 找不到 buildMenu 函数体时抛出（返回空数组会让下游假通过）
 */
export function parseBuildMenu(goSrc, localeSrc) {
  const marker = 'func buildMenu(app *App) *menu.Menu {'
  const start = goSrc.indexOf(marker)
  if (start === -1) {
    throw new Error(
      `main.go 里找不到 buildMenu 的函数体（标记：${marker}）。` +
        '解析失败必须显式报错——若返回空列表，下游「差集为空 ⇒ 全部一致」会导致门禁假通过。'
    )
  }
  const body = goSrc.slice(start)
  const warnings = []
  const items = []

  // 变量标签的赋值：exportPDFTitle := "…" / exportPDFTitle = "…"
  const varLabels = new Map()
  for (const m of goSrc.matchAll(/(\w+)\s*:?=\s*("(?:[^"\\]|\\.)*")/g)) {
    if (!varLabels.has(m[1])) varLabels.set(m[1], unquote(m[2]))
  }

  // i18n（v1.2 起）：标签改成 t(locale, "key") 查表形式。
  // 没有这一步的话，parseAddLabel 会把每个菜单项都判成「动态表达式」，
  // 于是 noAccelLabels 从 18 项掉到 0 项 —— 门禁判定不受影响（accelerator
  // 解析走另一条路），但「某菜单项丢了快捷键」的报错定位会退化成
  // “(动态标签)”而失去真实标题，失去排查价值。
  //
 // 回查 locales.go 的 zh-CN 表（基准语言）：既恢复了可读的定位信息，
  // 也能顺带发现「Go 引用了语言表里不存在的 key」——那会是运行时显示原始
  // key 的真 bug（缺 key 回退），属于门禁该拦的东西。
  const i18nLabels = parseLocaleTable(localeSrc)
  const i18nMissing = new Set()

  // emit/emitChecked 的事件名：引号风格无关（Go 三种字符串字面量都合法）。
  // 注意：字符类里同时要匹配反引号，而反引号在模板字符串中需转义 —— 故这里用
  // 字符串拼接而非模板字符串，避免出现 "\\`" 这种「反斜杠+反引号」把模板串提前闭合。
  const Q = '["`\']'
  const QNAME = '([^"\'`]+)'
  const emitPatterns = [
    new RegExp('\\bemit\\(\\s*' + Q + QNAME + Q, 'g'),
    new RegExp('\\bemitChecked\\(\\s*' + Q + QNAME + Q, 'g'),
    new RegExp('\\bEventsEmit\\(\\s*[\\w.]+\\s*,\\s*' + Q + QNAME + Q, 'g'),
  ]
  const emitted = new Set()
  for (const re of emitPatterns) {
    for (const m of goSrc.matchAll(re)) emitted.add(m[1])
  }

  const push = (kind, call, accelIndex) => {
    const labelRaw = call.args[0]
    let label = unquote(labelRaw)
    let labelIsDynamic = false
    // i18n：t(locale, "key") / t(l, "key") / t(currentLocale(), "key")
    // → 回查语言表拿 zh-CN 文案；key 不在表里要显式记为缺失（那是真 bug，
    //   运行时会显示原始 key 而不是文案）
    if (label === null && labelRaw && /^\s*t\s*\(/.test(labelRaw)) {
      const km = labelRaw.match(/t\s*\([^,]+,\s*("(?:[^"\\]|\\.)*")\s*\)/)
      const key = km ? unquote(km[1]) : null
      if (key !== null) {
        if (i18nLabels.has(key)) {
          label = i18nLabels.get(key)
        } else {
          i18nMissing.add(key)
          label = key // 保留 key 原文作为定位线索
        }
      } else {
        labelIsDynamic = true
      }
    }
    if (label === null && !labelIsDynamic) {
      // 变量标签（exportPDFTitle）：回查赋值表；仍是 null 则为动态表达式（labels[i]）
      const varName = labelRaw.trim()
      if (varLabels.has(varName)) {
        label = varLabels.get(varName)
      } else {
        labelIsDynamic = true
        warnings.push(
          `${kind} 的标签是动态表达式（${varName}），无法静态枚举；` +
            '调用方需显式处理 labelIsDynamic，不要静默当成字符串。'
        )
      }
    }
    const accelSrc = call.args[accelIndex] ?? 'nil'
    const accel = parseAccelerator(accelSrc)
    // 事件名：从该调用的回调实参里找 emit(...)；checkbox 的回调在第 4 个实参
    const event = (() => {
      const cb = call.args[kind === 'AddCheckbox' ? 3 : 2] ?? ''
      // 同上：含反引号的字符类不能用模板字符串拼
      const m = cb.match(new RegExp('\\bemit(?:Checked)?\\(\\s*' + Q + QNAME + Q))
      if (m) return m[1]
      const indirect = cb.match(new RegExp(`\\bemit\\(\\s*(\\w+)\\s*\\)`))
      if (indirect) {
        // 形如 emit(evtNewFile)：回查常量化定义
        const v = varLabels.get(indirect[1])
        return v ?? null
      }
      return null
    })()
    items.push({
      kind,
      label,
      labelIsDynamic,
      accelerator: formatAccelerator(accel),
      rawAccelerator: accelSrc,
      hasAccelerator: accel !== null,
      line: lineAt(goSrc, start + call.index),
      event,
    })
  }

  for (const c of findCalls(body, 'AddText')) push('AddText', c, 1)
  for (const c of findCalls(body, 'AddCheckbox')) push('AddCheckbox', c, 2)

  // 兜底自检：完全没解析出任何项说明扫描规则失效，宁可报错也不假通过
  if (items.length === 0) {
    throw new Error('buildMenu 解析出 0 个菜单项，扫描规则很可能已失效（拒绝假通过）。')
  }
  // 事件名兜底：AddText/AddCheckbox 的回调多为闭包，上面逐项取不到时用全局集合补齐
  for (const it of items) {
    if (it.event === null && !it.labelIsDynamic) {
      // 动态 recent 项用闭包 + path 参数，事件名是 menu:open-recent
      if (it.kind === 'AddText' && /open-recent|recents/i.test(String(it.label ?? ''))) {
        it.event = 'menu:open-recent'
      }
    }
  }
  void emitted // emitted 供调用方需要「全量事件集合」时使用，此处仅保证逻辑完整

  // i18n 缺失 key 是真 bug（运行时会显示原始 key 而非文案）→ 升级为 warning
  for (const key of i18nMissing) {
    warnings.push(
      `菜单引用了语言表里不存在的 key：「${key}」。` +
        '运行时 t() 会回退成显示原始 key（用户看到的是 "file.new" 这种字面量）。' +
        '请在 locales.go 的三档表里补上该 key。'
    )
  }
  return { items, warnings, emitted, i18nMissing: [...i18nMissing] }
}

/**
 * main.go 内部 accelerator 唯一性检查。
 *
 * 【为什么需要它】
 * 键位类 bug 的典型形态是「同一个组合在 main.go 里被绑了两次」。这类问题
 * 靠「文档 ↔ main.go 集合比对」是**看不见**的：下游普遍用 Map/Set 按
 * accelerator 归并，重复项会被 Set 静默去重，于是 diff 显示「一致」、
 * 门禁报绿，而运行时行为不确定（macOS 上后注册的 accelerator 可能覆盖前者，
 * 或两个菜单项共用一个键导致点击行为随平台而异）。
 * 仓库历史上就有过同类真实事故：⌘P 曾同时被「打印」与「导出 PDF」占用
 * （现为 ⌘P 打印 / ⇧⌘P 导出 PDF，见 main.go 的注释与 ADR-004 D-4 裁决）。
 * 故唯一性必须是**独立于文档比对**的一道门禁。
 *
 * 【判定语义：规范化后完全相同才算冲突】
 * keys.CmdOrCtrl("p")（⌘P）与 keys.Combo("p", CmdOrCtrlKey, ShiftKey)（⇧⌘P）
 * 是**不同**组合，不算冲突——本模块的 parseAccelerator + formatAccelerator
 * 已按 MOD_ORDER 规范化，⌘P 与 ⇧⌘P 归一后不同，因此天然区分。
 * 同理 keys.OptionOrAlt("Up")（⌥↑）与 keys.Combo("Up", OptionOrAlt, Shift)
 * （⇧⌥↑）也不同，不会误报。
 *
 * @param {string} goSrc main.go 全文
 * @returns {{accelerator: string, occurrences: {label: string|null, line: number, kind: string, rawAccelerator: string}[]}[]}}
 *          每项为一个被绑定多次的 accelerator 及其全部出现位置；无重复时返回 []
 */
export function findAcceleratorDuplicates(goSrc) {
  const { items } = parseBuildMenu(goSrc)
  /** @type {Map<string, {label: string|null, line: number, kind: string, rawAccelerator: string}[]>} */
  const byAccel = new Map()
  for (const it of items) {
    // 只有「有 accelerator」的项参与唯一性判定；无 accelerator 项不占键位
    if (!it.hasAccelerator || !it.accelerator) continue
    if (!byAccel.has(it.accelerator)) byAccel.set(it.accelerator, [])
    byAccel.get(it.accelerator).push({
      label: it.label,
      line: it.line,
      kind: it.kind,
      rawAccelerator: it.rawAccelerator,
    })
  }
  const dups = []
  for (const [accelerator, occurrences] of byAccel) {
    if (occurrences.length > 1) dups.push({ accelerator, occurrences })
  }
  // 按 accelerator 排序，保证输出稳定可比对（避免 Map 插入序影响门禁 diff）
  dups.sort((a, b) => (a.accelerator < b.accelerator ? -1 : a.accelerator > b.accelerator ? 1 : 0))
  return dups
}
