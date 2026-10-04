/**
 * dom-stub.js — 记录型 DOM / localStorage stub（QA 独占）
 * ---------------------------------------------------------------------------
 * 契约来源：docs/spec/SPEC-engineering-baseline-v1.md §3.2
 *
 * 为什么用 stub 而不是 jsdom（Spec §3.1 选型理由 3）：
 *   prefs.js 只经由 `document.documentElement.style.setProperty/removeProperty`
 *   写 CSS 变量，**不查询 DOM 结构、不读布局**。所以我们不需要一个浏览器，
 *   只需要一个能「把每一次调用记下来」的对象 —— 断言因此更硬：
 *   断言的是**真实调用序列**（含顺序、含重复），而不是「渲染结果看起来对不对」。
 *
 * 两个 stub 的能力：
 *   1. document  —— 记录 setProperty/removeProperty 的完整调用序列 {op, key, value}
 *   2. localStorage —— 除记录外，支持**注入抛错**（模拟隐私模式 / 配额满 / 禁用 cookie），
 *      用于验证 prefs.js 的内存兜底路径。
 *
 * [注意] 安装顺序（重要，tests/README.md 有同款说明）：
 *   prefs.js 虽然在**函数体内**才访问 localStorage / document（顶层安全），
 *   但它有**模块级可变状态**（memoryStore / useMemory / listeners）。
 *   因此正确用法是：先 installDomStub()，再 `await import('../src/themes/prefs.js?v=N')`，
 *   用**带 query 的动态 import** 造一个全新的隔离模块实例，避免跨用例串味。
 */

/** prefs.js 用的持久化 key —— 与 prefs.js 的 STORAGE_KEY 保持一致（复制自源头，非猜测） */
export const STORAGE_KEY = 'inkmark-prefs'

/** prefs.js 受管的 7 个 CSS 变量（与 prefs.js MANAGED_VARS 一致，用于断言受管面） */
export const MANAGED_VARS = [
  '--font-body-user',
  '--text-base',
  '--text-md',
  '--leading-body',
  '--leading-reading',
  '--preview-measure',
  '--reading-measure',
]

/** 核心不变量：这两个变量任何情况下都不许被 prefs.js 触碰（AC-02） */
export const FORBIDDEN_VARS = ['--font-body', '--zoom-scale']

/**
 * 安装记录型 document stub。
 * @returns {{calls: Array<{op:'set'|'remove', key:string, value?:string}>, store: Map<string,string>, reset: () => void}}
 */
export function installDomStub() {
  /** @type {Array<{op:'set'|'remove', key:string, value?:string}>} 完整调用序列（含重复调用，顺序即证据） */
  const calls = []
  /** @type {Map<string,string>} 变量最终态（set 写入、remove 抹除） */
  const store = new Map()

  globalThis.document = {
    documentElement: {
      dataset: {},
      style: {
        setProperty: (k, v) => {
          calls.push({ op: 'set', key: k, value: v })
          store.set(k, v)
        },
        removeProperty: (k) => {
          calls.push({ op: 'remove', key: k })
          store.delete(k)
        },
      },
    },
  }

  return {
    calls,
    store,
    reset: () => {
      calls.length = 0
      store.clear()
    },
  }
}

/**
 * 安装可注入抛错的 localStorage stub。
 * @param {object} [opts]
 * @param {boolean} [opts.throwOnGet=false]    getItem 抛错（模拟存储被完全禁用）
 * @param {boolean} [opts.throwOnSet=false]    setItem 抛错（模拟配额满 —— 最常见的真实场景）
 * @param {boolean} [opts.throwOnRemove=false] removeItem 抛错
 * @param {string}  [opts.seed]                 预置到 STORAGE_KEY 的**原始字符串**（用于喂坏 JSON）
 * @returns {{store: Map<string,string>, ops: Array<{op:string,key:string,value?:string}>,
 *            setThrowOn: (which:'get'|'set'|'remove', on:boolean) => void,
 *            reset: () => void}}
 */
export function installLocalStorageStub(opts = {}) {
  const { throwOnGet = false, throwOnSet = false, throwOnRemove = false, seed } = opts

  /** @type {Map<string,string>} */
  const store = new Map()
  if (seed !== undefined) store.set(STORAGE_KEY, seed)

  /** @type {Array<{op:string, key:string, value?:string}>} 读写操作序列（用于断言「持久化到哪个 key」） */
  const ops = []

  const flags = { get: throwOnGet, set: throwOnSet, remove: throwOnRemove }

  globalThis.localStorage = {
    getItem(k) {
      ops.push({ op: 'get', key: k })
      if (flags.get) throw new Error('simulated localStorage.getItem failure')
      const v = store.get(k)
      return v === undefined ? null : v
    },
    setItem(k, v) {
      ops.push({ op: 'set', key: k, value: v })
      if (flags.set) throw new Error('simulated localStorage.setItem failure (quota exceeded)')
      store.set(k, v)
    },
    removeItem(k) {
      ops.push({ op: 'remove', key: k })
      if (flags.remove) throw new Error('simulated localStorage.removeItem failure')
      store.delete(k)
    },
    clear() {
      ops.push({ op: 'clear' })
      store.clear()
    },
  }

  return {
    store,
    ops,
    /** 运行中切换抛错开关（模拟「用户先正常用，后来 incognito 生效」） */
    setThrowOn: (which, on) => {
      flags[which] = on
    },
    reset: () => {
      store.clear()
      ops.length = 0
      flags.get = throwOnGet
      flags.set = throwOnSet
      flags.remove = throwOnRemove
    },
  }
}

/** 一次性装齐 document + localStorage，返回合并后的句柄 */
export function installEnv(opts = {}) {
  const dom = installDomStub()
  const storage = installLocalStorageStub(opts)
  return {
    calls: dom.calls,
    store: dom.store,
    storageOps: storage.ops,
    storageStore: storage.store,
    setThrowOn: storage.setThrowOn,
    reset: () => {
      dom.reset()
      storage.reset()
    },
  }
}

/** 卸载 stub（还原为 undefined），供极端场景或测试收尾使用 */
export function uninstallEnv() {
  delete globalThis.document
  delete globalThis.localStorage
}

/**
 * 带 query 的动态 import —— 造一个**全新的隔离模块实例**。
 *
 * 为什么必须这么做：prefs.js 有模块级可变状态（memoryStore / useMemory / listeners）。
 * 静态 import 会被 ESM 缓存成单例，对抗性用例一旦把 useMemory 置为 true，
 * 后续所有用例都会被污染 —— 这正是「同义测试反模式」的温床。
 * 实测：`await import('...prefs.js?fresh=a')` 与 `?fresh=b` 是两个独立实例。
 *
 * [注意] specifier 必须是**绝对 URL**（`new URL('../src/themes/prefs.js', import.meta.url)`）。
 * 因为本函数在 helpers/dom-stub.js 里，相对路径会相对 **helpers/** 解析而不是调用方，
 * 直接传字符串会 ERR_MODULE_NOT_FOUND。
 *
 * @param {string|URL} specifier 目标模块的绝对 URL
 * @param {string|number} tag 本次用例的唯一标签
 */
let seq = 0
export async function importFresh(specifier, tag) {
  const url = new URL(specifier)
  url.searchParams.set('fresh', `${tag}-${++seq}`)
  return import(url.href)
}

/** 从 calls 里筛出某变量的全部操作（顺序敏感，用于「成对 set/remove」类断言） */
export function opsFor(calls, key) {
  return calls.filter((c) => c.key === key)
}

/** 从 calls 里筛出全部被 set 过的 key */
export function setKeys(calls) {
  return [...new Set(calls.filter((c) => c.op === 'set').map((c) => c.key))]
}

/** 从 calls 里筛出全部被 remove 过的 key */
export function removedKeys(calls) {
  return [...new Set(calls.filter((c) => c.op === 'remove').map((c) => c.key))]
}
