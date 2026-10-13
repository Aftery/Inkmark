/**
 * watcher-wiring.test.mjs — fs:changed 文件树外部变更监听的前端接线
 * ---------------------------------------------------------------------------
 * 被测对象：frontend/src/composables/useFileOps.js
 *   - shouldReloadTree（纯函数守卫，导出）
 *   - useFileOps() 内的 fs:changed 订阅与 treeSignal 自增
 * 契约来源：watcher.go watchLoop —— runtime.EventsEmit(a.ctx, "fs:changed", root)
 *
 * 【为什么这必须是机检 —— 它错了完全不报错】
 *   Go 侧发 "fs:changed"、前端听 "fs:changedX"（或反过来）：两边各自静默，
 *   文件树对外部变更零反应 —— 没有报错、没有日志、没有视觉异常。
 *   本仓最恨的「假绿灯」正是这一族（「匹配到注释里的代码」同类），所以除了
 *   行为测试，还必须有**跨文件逐字比对**，让单侧改名立刻红。
 *
 * 【行为测试优先，不走正则模拟订阅】
 *   接线测试不拿源码正则「假装调用」订阅，而是 stub window.runtime.EventsOn
 *   捕获真实回调，经 useFileOps() 真实调用后驱动 —— 守卫语义（匹配 / 不匹配
 *   / 空串 / 切目录后旧事件失效）全部打在真实代码上。
 *   纯函数 shouldReloadTree 直接 import 真实模块，不在测试里复制实现。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'
import { useFileOps, shouldReloadTree } from '../src/composables/useFileOps.js'

const HERE = dirname(fileURLToPath(import.meta.url)) // frontend/tests
const REPO = join(HERE, '..', '..') // 仓库根
const USE_FILE_OPS = join(REPO, 'frontend/src/composables/useFileOps.js')
const WATCHER_GO = join(REPO, 'watcher.go')

// ===========================================================================
// 1. 纯函数守卫：shouldReloadTree 的输入语义
// ===========================================================================
describe('shouldReloadTree · 守卫语义', () => {
  test('payload 与 folderPath 是非空且逐字相同 → true（唯一放行路径）', () => {
    assert.equal(shouldReloadTree('/Users/me/notes', '/Users/me/notes'), true)
  })

  test('payload 是别的目录 → false（守卫存在的全部意义：别处的变更不刷这棵树）', () => {
    assert.equal(shouldReloadTree('/Users/me/other', '/Users/me/notes'), false)
    // 大小写敏感：同严格相等语义，不做任何归一化
    assert.equal(shouldReloadTree('/users/me/notes', '/Users/me/notes'), false)
  })

  test('尾部斜杠差异 → false（语义：严格相等；理由见 useFileOps.js 注释——同源字符串不可能出现斜杠差异）', () => {
    assert.equal(shouldReloadTree('/Users/me/notes/', '/Users/me/notes'), false)
    assert.equal(shouldReloadTree('/Users/me/notes', '/Users/me/notes/'), false)
  })

  test('空串组合全部 → false（WatchDir("") 是停机态；未开文件夹无所谓重载）', () => {
    assert.equal(shouldReloadTree('', ''), false)
    assert.equal(shouldReloadTree('', '/Users/me/notes'), false)
    assert.equal(shouldReloadTree('/Users/me/notes', ''), false)
  })

  test('非字符串输入 → false（Go 侧契约漂移的防御：宁可漏刷，不可错刷）', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      assert.equal(shouldReloadTree(bad, '/Users/me/notes'), false, `payload=${JSON.stringify(bad)}`)
      assert.equal(shouldReloadTree('/Users/me/notes', bad), false, `folderPath=${JSON.stringify(bad)}`)
    }
  })
})

// ===========================================================================
// 2. 行为测试：经真实 useFileOps() 驱动订阅
// ===========================================================================

/** 最小 deps：本组只测 treeSignal 接线，编辑器/文档/会话依赖全部 no-op 化 */
function stubDeps(overrides = {}) {
  return {
    getEditor: () => null,
    replaceDocument() {},
    syncAfterDocReplace() {},
    filePath: ref(''),
    folderPath: ref(''),
    title: ref(''),
    sidebarOpen: ref(false),
    sidebarTab: ref('files'),
    docState: { switchFile: async () => {}, resetSession() {} },
    showToast() {},
    askInput: async () => null,
    ReadFile: async () => '',
    OpenFileDialog: async () => '',
    OpenDirectoryDialog: async () => '',
    ...overrides,
  }
}

/**
 * 挂载一次 useFileOps 并捕获 EventsOn 订阅。
 * 刻意不装 window.go —— WatchDir 那行的可选链兜底正是要在这个形态下不炸。
 *
 * installRuntime 决定往 globalThis.window 装什么形态：
 *   'full'        → { runtime: { EventsOn } }   Wails 环境（默认）
 *   'no-runtime'  → {}                          vite dev：有 window、无 runtime
 *   'no-eventson' → { runtime: {} }             runtime 在但 EventsOn 缺失
 *
 * 【为什么形态必须作为入参、不能在用例里先设 globalThis.window】
 * 本文件早先的写法是「用例里先 `globalThis.window = {}`，再调 mountOps」——
 * 而 mountOps 无条件重设 window，前置条件被瞬间覆盖：**缺失 runtime 的路径
 * 从未真正进入**，两条预览用例形同虚设（把源码里的可选链整条删掉，它们依然
 * 2 pass / 0 fail）。这是本仓记过多次的「因为错误的原因而通过」，故把形态
 * 提为显式参数，让「不抛错」这个断言真的依赖被测代码的可选链。
 * @returns {{ops: object, subscriptions: Array<{name: string, cb: Function}>, folderPath: import('vue').Ref<string>}}
 */
function mountOps({ folder = '', installRuntime = 'full' } = {}) {
  const subscriptions = []
  if (installRuntime === 'full') {
    globalThis.window = {
      runtime: { EventsOn: (name, cb) => subscriptions.push({ name, cb }) },
    }
  } else if (installRuntime === 'no-runtime') {
    globalThis.window = {}
  } else if (installRuntime === 'no-eventson') {
    globalThis.window = { runtime: {} }
  } else {
    throw new Error(`未知 installRuntime 形态: ${installRuntime}`)
  }
  const deps = stubDeps({ folderPath: ref(folder) })
  const ops = useFileOps(deps)
  return { ops, subscriptions, folderPath: deps.folderPath }
}

describe('useFileOps · fs:changed 订阅（行为）', () => {
  test('setup 时恰好订阅一次 fs:changed，treeSignal 初值为 0', () => {
    const { ops, subscriptions } = mountOps({ folder: '/Users/me/notes' })
    assert.equal(subscriptions.length, 1, '应恰好注册一个事件订阅')
    assert.equal(subscriptions[0].name, 'fs:changed')
    assert.equal(ops.treeSignal.value, 0, '未开文件夹前信号应为 0')
  })

  test('payload 匹配当前文件夹 → treeSignal 递增；重复事件重复递增（不做合并，FileTree 靠数值变化重载）', () => {
    const { ops, subscriptions } = mountOps({ folder: '/Users/me/notes' })
    const onChanged = subscriptions[0].cb
    onChanged('/Users/me/notes')
    assert.equal(ops.treeSignal.value, 1)
    onChanged('/Users/me/notes')
    assert.equal(ops.treeSignal.value, 2, '第二次相同事件必须再次递增，否则 FileTree 的 watch 收不到变化')
  })

  test('payload 是别的目录 → treeSignal 不变（旧监听在途事件 / 将来多监听的第一道防线）', () => {
    const { ops, subscriptions } = mountOps({ folder: '/Users/me/notes' })
    subscriptions[0].cb('/Users/me/other')
    assert.equal(ops.treeSignal.value, 0)
  })

  test('payload 空串、或当前没有文件夹 → treeSignal 不变', () => {
    const withFolder = mountOps({ folder: '/Users/me/notes' })
    withFolder.subscriptions[0].cb('')
    assert.equal(withFolder.ops.treeSignal.value, 0, '空 payload 不得触发重载')

    const noFolder = mountOps({ folder: '' })
    noFolder.subscriptions[0].cb('/Users/me/notes')
    assert.equal(noFolder.ops.treeSignal.value, 0, '没开文件夹时不得触发重载')
  })

  test('切换文件夹后守卫跟随新值：旧目录事件失效、新目录事件生效', () => {
    const { ops, subscriptions, folderPath } = mountOps({ folder: '/Users/me/old' })
    const onChanged = subscriptions[0].cb
    onChanged('/Users/me/old')
    assert.equal(ops.treeSignal.value, 1)

    folderPath.value = '/Users/me/new' // 等价于 openFolder 换目录
    onChanged('/Users/me/old')
    assert.equal(ops.treeSignal.value, 1, '旧目录的迟到事件不得再刷这棵树')
    onChanged('/Users/me/new')
    assert.equal(ops.treeSignal.value, 2, '新目录的事件必须能刷')
  })

  test('浏览器预览：window.runtime 缺失 → 不抛错且静默不订阅（可选链第一级兜底）', () => {
    // 形态由 mountOps 入参决定：绝不能在外面临时设 globalThis.window（会被覆盖，
    // 那条旧写法正是「前置条件被覆盖、用例形同虚设」的假绿灯）。
    let mounted
    assert.doesNotThrow(() => {
      mounted = mountOps({ folder: '/Users/me/notes', installRuntime: 'no-runtime' })
    })
    assert.equal(mounted.subscriptions.length, 0, '没有 Wails runtime 时不该有任何订阅')
    assert.equal(mounted.ops.treeSignal.value, 0)
  })

  test('浏览器预览：window.runtime 存在但 EventsOn 缺失 → 不抛错且静默不订阅（可选链第二级兜底）', () => {
    let mounted
    assert.doesNotThrow(() => {
      mounted = mountOps({ folder: '/Users/me/notes', installRuntime: 'no-eventson' })
    })
    assert.equal(mounted.subscriptions.length, 0, 'EventsOn 缺失时不该有任何订阅')
    assert.equal(mounted.ops.treeSignal.value, 0)
  })
})

// ===========================================================================
// 3. 契约测试：事件名两侧逐字一致（防单侧改名静默失效）
// ===========================================================================
/**
 * 从 Go 源码提取 runtime.EventsEmit(...) 的事件名。
 * 不猜调用形态（ctx 变量名可能变），只取参数里第一个字符串字面量。
 */
function goEmitNames(src) {
  const names = []
  const callRe = /EventsEmit\(([^)]*)\)/g
  let m
  while ((m = callRe.exec(src)) !== null) {
    const q = m[1].match(/"([^"]+)"/)
    if (q) names.push(q[1])
  }
  return names.sort()
}

/** 从前端源码提取 window.runtime?.EventsOn?.('name' 订阅的事件名 */
function frontendSubscribeNames(src) {
  const names = []
  const re = /window\.runtime\?\.EventsOn\?\.\(\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(src)) !== null) names.push(m[1])
  return names.sort()
}

describe('契约 · fs:changed 事件名两侧逐字一致', () => {
  const goSrc = readFileSync(WATCHER_GO, 'utf8')
  const feSrc = readFileSync(USE_FILE_OPS, 'utf8')
  const goNames = goEmitNames(goSrc)
  const feNames = frontendSubscribeNames(feSrc)

  test('两侧都至少有一个事件（防止提取正则失效导致的假通过）', () => {
    assert.ok(goNames.length > 0, 'watcher.go 里没提取到 EventsEmit 事件名 —— 要么真没了，要么调用形态变了')
    assert.ok(feNames.length > 0, 'useFileOps.js 里没提取到 EventsOn 订阅 —— 要么真没了，要么订阅形态变了')
  })

  test('前端订阅集合与 Go 发出集合逐字相等（单侧改名立刻红）', () => {
    assert.deepEqual(
      feNames,
      goNames,
      '事件名两侧不一致 —— 这正是「改了单侧、两边静默、文件树永不刷新」的失效形态。\n' +
        `Go 发出: ${JSON.stringify(goNames)}\n前端订阅: ${JSON.stringify(feNames)}\n` +
        '若是有意改名，两侧必须同时改；本测试就是逼这次改名发生在同一个提交里。'
    )
  })
})
