/**
 * prefs.js — Inkmark 用户排版 / 编辑器偏好唯一真源
 * ----------------------------------------------------------------------------
 * 设计契约见 docs/design/settings-panel-spec.md §4（C1 铁律）：
 *
 *  - 持久化 key `inkmark-prefs`，存**一个 JSON 对象**，逐项校验；缺失 / 非法项
 *    一律回落默认值（fail safe），存储不可用（隐私模式 / 配额满）不抛错。
 *  - 应用方式【必须】写 document.documentElement 的**内联样式**，绝不写样式表 ——
 *    `[data-theme="paper"]` 用属性选择器覆写了 --font-body / --leading-* /
 *    --reading-measure，样式表写法会被 paper 主题静默压掉（C1，血泪教训）。
 *  - 正文字体走**文档作用域**变量 --font-body-user（R4）：只影响编辑区 / 预览区正文，
 *    chrome（工具条 / 侧栏 / 弹层）与主题衬线外壳仍读 --font-body，不被用户字体偏好污染。
 *  - 字号【必须】成对同改 --text-base（编辑区）与 --text-md（预览区），
 *    两者不等会导致左右两栏文字错位（C2 不变量）。
 *  - 绝不碰 --zoom-scale：视图缩放走独立变量，与基础字号正交叠加（C3）。
 *
 * 本模块不依赖 Vue，可在 main.js 挂载前同步初始化（首帧前落好内联变量，避免跳变），
 * 与 theme.js 的防闪烁约定一致。
 */

const STORAGE_KEY = 'inkmark-prefs'

/** 出厂默认值（唯一真源，getPrefs / resetPrefs 均以此为基准） */
export const PREFS_DEFAULTS = {
  fontFamily: 'system', // system | serif | mono
  fontSize: 15, // 12 | 14 | 15 | 16 | 18 | 20（px 数值）
  lineHeight: 'standard', // compact | standard | loose
  measure: 'standard', // narrow | standard | wide
  autosave: 800, // 0(关) | 800 | 2000 | 5000（ms）
  snapshot: 180000, // 0(关) | 180000 | 600000 | 1800000（ms）
}

/** 每项的合法取值白名单（校验 + 面板控件的取值来源） */
export const PREF_OPTIONS = {
  fontFamily: ['system', 'serif', 'mono'],
  fontSize: [12, 14, 15, 16, 18, 20],
  lineHeight: ['compact', 'standard', 'loose'],
  measure: ['narrow', 'standard', 'wide'],
  autosave: [0, 800, 2000, 5000],
  snapshot: [0, 180000, 600000, 1800000],
}

/**
 * 正文字体字栈（**文档作用域**，写 --font-body-user）。
 * system 走 removeProperty → 正文回退 --font-body（token / paper 主题的衬线栈照常生效）。
 */
const FONT_STACKS = {
  serif: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", serif',
  mono: '"SF Mono", "JetBrains Mono", Menlo, monospace',
}

/** 字号 px → rem（1rem = 16px 基准）；键为 PREFS_DEFAULTS.fontSize 的取值 */
const FONT_SIZE_REM = {
  12: '0.75rem',
  14: '0.875rem',
  15: '0.9375rem',
  16: '1rem',
  18: '1.125rem',
  20: '1.25rem',
}

/**
 * 行距档位（同时写 --leading-body 与 --leading-reading）。
 * 注：standard 档 = 交还主题决定（applyPrefs 走 removeProperty，不落内联），
 * 此处的 '1.7' 仅作基准值文档，实际不写入；只有 compact / loose 会写内联。
 */
const LEADING = { compact: '1.5', standard: '1.7', loose: '1.9' }

/**
 * 预览行宽档位；--reading-measure 恒比 --preview-measure 宽 4rem（沿用项目既有关系）。
 * 注：standard 档 = 交还主题决定（applyPrefs 走 removeProperty，paper 自带更窄行宽）；
 * 只有 narrow / wide 会写内联。
 */
const PREVIEW_MEASURE = { narrow: '40rem', standard: '46rem', wide: '54rem' }
const READING_MEASURE = { narrow: '44rem', standard: '50rem', wide: '58rem' }

/** 内联样式需要管理的 CSS 变量名（resetPrefs 逐项 clear）。
 *  字体走 --font-body-user（文档作用域），不碰 --font-body（chrome 与主题衬线外壳靠它） */
const MANAGED_VARS = [
  '--font-body-user',
  '--text-base',
  '--text-md',
  '--leading-body',
  '--leading-reading',
  '--preview-measure',
  '--reading-measure',
]

/** 变更监听器集合（回调收到完整偏好对象） */
const listeners = new Set()

/**
 * 内存兜底存储：localStorage 不可用（隐私模式 / 配额满 / 非浏览器环境）时，
 * 本次会话的偏好仍写这里 —— 保证「选择即时生效」，只是不跨进程持久化。
 * 存储可用时它被忽略（以 localStorage 为准）。
 */
let memoryStore = { ...PREFS_DEFAULTS }
let useMemory = false

function isValid(key, value) {
  const opts = PREF_OPTIONS[key]
  return Array.isArray(opts) && opts.includes(value)
}

/** 读原始存储对象；解析失败 / 类型不对回落内存兜底（fail safe） */
function readStore() {
  if (useMemory) return memoryStore
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return memoryStore
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : memoryStore
  } catch {
    useMemory = true // 存储不可用：切换到内存兜底，后续读写都走内存
    return memoryStore
  }
}

/** 当前完整偏好（默认值打底 + 存储中的合法项覆盖） */
export function getPrefs() {
  const stored = readStore()
  const out = { ...PREFS_DEFAULTS }
  for (const key of Object.keys(PREFS_DEFAULTS)) {
    if (isValid(key, stored[key])) out[key] = stored[key]
  }
  return out
}

/** 读单项偏好 */
export function getPref(key) {
  return getPrefs()[key]
}

function notify() {
  const prefs = getPrefs()
  listeners.forEach((cb) => {
    try {
      cb(prefs)
    } catch (e) {
      // 单个监听器异常不得阻断其他监听器与偏好生效
      console.error('[prefs] onPrefsChange 回调异常', e)
    }
  })
}

/**
 * 应用全部偏好：写 <html> 内联 CSS 变量（内联优先级高于任何选择器，C1）。
 * 可在无 DOM 环境（测试 / SSR）安全调用。
 */
export function applyPrefs() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const p = getPrefs()

  // 正文字体（**文档作用域**，R4）：写 --font-body-user，**不写 --font-body**。
  // 编辑区 / 预览区正文用 var(--font-body-user, var(--font-body)) 读取，故只有正文受影响；
  // 工具条 / 侧栏 / 状态栏 / 弹层等 chrome 仍走 --font-body —— paper 主题的衬线外壳得以保留。
  // system 档 = 交还主题决定：removeProperty('--font-body-user') → 正文回退 --font-body。
  if (p.fontFamily === 'system') root.style.removeProperty('--font-body-user')
  else root.style.setProperty('--font-body-user', FONT_STACKS[p.fontFamily])

  // 字号：C2 不变量 —— 编辑区 --text-base 与预览区 --text-md 必须成对同改
  const size = FONT_SIZE_REM[p.fontSize]
  root.style.setProperty('--text-base', size)
  root.style.setProperty('--text-md', size)

  // 行距：「标准」档 = 交还主题决定（removeProperty，避免通用默认值 1.7 压掉
  // paper 主题刻意调校的衬线行距 1.8/1.85）；「紧凑 / 宽松」= 用户显式覆盖，写内联。
  if (p.lineHeight === 'standard') {
    root.style.removeProperty('--leading-body')
    root.style.removeProperty('--leading-reading')
  } else {
    root.style.setProperty('--leading-body', LEADING[p.lineHeight])
    root.style.setProperty('--leading-reading', LEADING[p.lineHeight])
  }

  // 行宽：「标准」档 = 交还主题决定（paper 自带更窄的 --reading-measure:48rem）；
  // 「窄 / 宽」= 用户显式覆盖（阅读态恒比常规宽 4rem，保持项目既有关系）。
  if (p.measure === 'standard') {
    root.style.removeProperty('--preview-measure')
    root.style.removeProperty('--reading-measure')
  } else {
    root.style.setProperty('--preview-measure', PREVIEW_MEASURE[p.measure])
    root.style.setProperty('--reading-measure', READING_MEASURE[p.measure])
  }

  // 注意：绝不触碰 --zoom-scale（C3 正交，视图缩放独立于基础字号）
}

/**
 * 设置单项偏好并立即落地。key / value 非法时静默忽略（返回当前值）。
 */
export function setPref(key, value) {
  if (!(key in PREFS_DEFAULTS) || !isValid(key, value)) return getPref(key)
  const next = getPrefs()
  next[key] = value
  memoryStore = next // 先落内存，保证存储不可用时本次选择也即时生效
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存储不可用：内存兜底已生效（不持久化），不抛错阻断 UI
    useMemory = true
  }
  applyPrefs()
  notify()
  return value
}

/**
 * 恢复出厂默认：逐项 removeProperty（回到 token / 主题默认）+ 清 localStorage。
 * 不写样式表，因此不会与 paper 主题的属性选择器打架。
 */
export function resetPrefs() {
  if (typeof document !== 'undefined') {
    const style = document.documentElement.style
    MANAGED_VARS.forEach((v) => style.removeProperty(v))
  }
  memoryStore = { ...PREFS_DEFAULTS }
  try {
    localStorage.removeItem(STORAGE_KEY)
    useMemory = false
  } catch {
    // 存储不可用：内存兜底已回到默认，忽略即可
    useMemory = true
  }
  notify()
}

/** 订阅偏好变化；返回取消订阅函数。回调参数为完整偏好对象 */
export function onPrefsChange(cb) {
  if (typeof cb !== 'function') return () => {}
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * 初始化：把用户偏好落到 <html> 内联变量。
 * 必须在 Vue mount 之前调用（首帧前落好变量，避免排版跳变）。
 */
export function initPrefs() {
  applyPrefs()
}
