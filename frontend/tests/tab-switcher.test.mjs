/**
 * tab-switcher.test.mjs — 标签切换 + Tab Switcher 浮层（P4）
 * ============================================================================
 * 被测对象：
 *   - `useCommands` 注册的 `view.prevTab` / `view.nextTab`（真走命令总线，
 *     不是直调内部函数 —— 这样「命令登记了但没处理」也会被这条用例抓到）；
 *   - `useShortcuts` 的方向键归一与命令表登记；
 *   - `TabSwitcher.vue` 的装配契约（静态）。
 *
 * 【AC-74 的核心判据：为什么必须「连按两下」才算数】
 * 快照语义的失效形态是「每次按都重取实时 MRU」。只按一下时，快照与实时重算的
 * 结果**完全相同**（都是同一时刻的 MRU），判据零区分力。按第二下时两者才分叉：
 *   - 快照：列表不变（用户看到的顺序稳定）
 *   - 实时重算：第一下已把目标推到 MRU 头部，第二下的列表整体位移
 * 故判据只能是「两下之间的列表**逐项相等**」，且同时断言 activeId 真的变了两次
 * （否则「什么都没发生」也能让列表相等 —— 那是假绿）。
 *
 * 【切换顺序 = 显示序，不是 MRU 序】
 * 这是 P4 的明确口径（`⌘⌥←/→` = 标签栏上的上/下一个），而 MC-10 的快照只用于
 * **浮层排序**：移动按位置、浮层按最近使用。故本文件同时钉死「折返」行为 ——
 * 若有人把切换改成 MRU 序，「从最后一个按下一个应回到第一个」会立刻报红。
 */
import { describe, test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref, shallowRef } from 'vue'
import { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { useEditorSession } from '../src/composables/useEditorSession.js'
import { useDocumentState } from '../src/composables/useDocumentState.js'
import { useCommands } from '../src/composables/useCommands.js'
import { emitCommand, accelFromEvent, getCommand, tabSwitcher } from '../src/composables/useShortcuts.js'
import { stripComments } from './helpers/lexer.mjs'

globalThis.requestAnimationFrame ??= (fn) => fn()

const realWarn = console.warn.bind(console)
console.warn = (msg, ...rest) => {
  // Vue 的「无组件实例」提示 + 命令总线的「重复注册」提示（每个用例都新建一个
  // useCommands 实例，模块级 handlers 会被后者覆盖 —— 这是测试形态，不是缺陷）
  if (typeof msg === 'string' && /is called when there is no active component instance|命令重复注册/.test(msg)) return
  realWarn(msg, ...rest)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const live = []
afterEach(() => {
  for (const app of live) {
    for (const s of app.session.sessions.value) {
      clearTimeout(s.saveTimer)
      s.saveTimer = null
    }
    app.cmds.tabs.closedStack.value = []
  }
  live.length = 0
  // 模块级浮层状态必须复原，否则下一条用例会「一开局就开着」
  tabSwitcher.open.value = false
  tabSwitcher.ids.value = []
})

function makeApp() {
  globalThis.window = {
    runtime: {},
    go: {
      main: {
        App: {
          WriteFile: async () => {},
          SnapshotWrite: async () => {},
          SaveFileDialog: async () => '',
          SetDirty: () => {},
          ClipboardGet: async () => '',
          ClipboardSet: async () => {},
          Version: async () => '0.0.0',
        },
      },
    },
  }
  const editorRef = shallowRef(null)
  const session = useEditorSession({
    editorRef,
    onDocChange: () => {},
    onImageFile: () => {},
    onClipboardImage: () => {},
    typewriterOn: shallowRef(false),
    onOutlineRefresh: () => {},
    onEditorReady: () => {},
    zoom: shallowRef(100),
    focusOn: shallowRef(false),
    invalidateOutline: () => {},
  })
  const docState = useDocumentState({
    getEditor: () => editorRef.value,
    getActiveSession: session.getActiveSession,
    getSessions: () => session.sessions.value,
    setActivePath: session.setActivePath,
    renderedHtml: { value: '' },
    theme: { value: 'light' },
    notify: () => {},
    onDocReplaced: session.syncAfterDocReplace,
  })
  session.bindDocState(docState)

  const view = {
    state: session.getActiveSession().state,
    composing: false,
    scrollDOM: { scrollTop: 0 },
    setState(next) { this.state = next },
    dispatch(spec) {
      const tr = spec instanceof Transaction ? spec : this.state.update(spec)
      this.state = tr.state
      const update = {
        view, state: tr.state, startState: tr.startState, transactions: [tr],
        docChanged: tr.docChanged, selectionSet: tr.selection !== undefined,
      }
      for (const fn of tr.state.facet(EditorView.updateListener)) fn(update)
      return tr
    },
    focus() {},
  }
  editorRef.value = view

  const cmds = useCommands({
    getEditor: () => view,
    session,
    docState,
    fileOps: { newFile: () => {}, openFile: () => {}, openFolder: () => {}, renameFile: () => {}, loadDocument: () => {} },
    workspace: {
      sidebarOpen: ref(false), sidebarTab: ref('files'), focusOn: ref(false),
      toggleFocus: () => {}, toggleTypewriter: () => {}, toggleAlwaysOnTop: () => {},
    },
    prefs: { changeZoom: () => {}, resetZoom: () => {}, cycleTheme: () => {} },
    outlineSync: { scheduleOutlineSync: () => {}, invalidateMeasure: () => {}, jumpToHeading: () => {} },
    help: { showShortcuts: ref(false), rows: ref([]) },
    dialog: ref({ show: false }),
    closeDialog: () => {},
    askInput: async () => null,
    notify: () => {},
    slashRef: ref(null),
    getClipboardImage: async () => null,
    hasClipboardImage: async () => false,
    canSaveImage: () => false,
  })
  cmds.registerCommands()
  const app = { session, docState, cmds, view, editorRef }
  live.push(app)
  return app
}

/** 建 3 个标签，并让 activeId 停在第一个（显示序 = [t1, A, B, C]） */
function seed(ctx) {
  const a = ctx.session.createSession({ path: '/a.md', content: 'A' })
  const b = ctx.session.createSession({ path: '/b.md', content: 'B' })
  const c = ctx.session.createSession({ path: '/c.md', content: 'C' })
  return { a, b, c }
}

/** 触发命令后等激活真正落定（activateSession 是异步的） */
async function press(id) {
  emitCommand(id)
  for (let i = 0; i < 20; i++) await sleep(0)
}

describe('Tab Switcher · 快照语义（MD-10 / AC-74）', () => {
  test('连按两下 ⌘⌥→：浮层列表逐项相等（快照），且 activeId 真的变了两次', async () => {
    const ctx = makeApp()
    const { a, b } = seed(ctx)
    const start = ctx.session.activeId.value

    await press('view.nextTab')
    assert.equal(tabSwitcher.open.value, true, '按 ⌘⌥→ 必须让浮层出现')
    const snapshot1 = tabSwitcher.ids.value.slice()
    const after1 = ctx.session.activeId.value
    assert.notEqual(after1, start, '第一下就必须真的切了标签（否则下面的「列表相等」是假绿）')
    assert.equal(after1, a.id, '显示序的下一个 = A')

    await press('view.nextTab')
    const snapshot2 = tabSwitcher.ids.value.slice()
    const after2 = ctx.session.activeId.value
    assert.equal(after2, b.id, '第二下再往后一个 = B')
    assert.deepEqual(
      snapshot2, snapshot1,
      '两下之间的浮层列表变了 —— 说明每次按键都重取了实时 MRU。' +
        '那样用户会看到列表在跳，且「下一个」的参照系自相矛盾（MD-10 要求按下瞬间取一次快照）',
    )
  })

  test('快照取的是**按下之前**的 MRU（不是按完之后的）', async () => {
    const ctx = makeApp()
    const { a, b, c } = seed(ctx)
    const mruBefore = ctx.session.mru.value.slice()
    assert.deepEqual(mruBefore.slice(0, 3), [c.id, b.id, a.id], '前提：MRU 最近创建的在前')

    await press('view.nextTab')
    assert.deepEqual(
      tabSwitcher.ids.value.slice(0, 3),
      [c.id, b.id, a.id],
      '快照必须是激活**之前**的 MRU。若取成了之后，第一项会变成刚切过去的那个（列表自我位移）',
    )
  })

  test('浮层 200ms 后自动收起（松手就熄，不会永久卡在屏幕上）', async () => {
    const ctx = makeApp()
    seed(ctx)
    await press('view.nextTab')
    assert.equal(tabSwitcher.open.value, true)
    await sleep(280)
    assert.equal(tabSwitcher.open.value, false, '浮层没有收起 —— 会一直挡着编辑器')
    assert.deepEqual(tabSwitcher.ids.value, [], '收起时必须把快照一起丢弃（否则下一次会误读旧列表）')
  })
})

describe('标签切换 · 显示序与折返', () => {
  test('next 从最后一个折返到第一个，prev 反向同理', async () => {
    const ctx = makeApp()
    const { c } = seed(ctx)
    await ctx.session.activateSession(c) // 停在显示序最后一个
    assert.equal(ctx.session.activeId.value, c.id)

    await press('view.nextTab')
    assert.equal(ctx.session.activeId.value, 't1', '最后一个按「下一个」应折返到第一个')

    await press('view.prevTab')
    assert.equal(ctx.session.activeId.value, c.id, '第一个按「上一个」应折返到最后一个')
  })

  test('只有 1 个标签时不切换、也不弹浮层（空转不得产生可见噪声）', async () => {
    const ctx = makeApp()
    const only = ctx.session.activeId.value
    await press('view.nextTab')
    assert.equal(ctx.session.activeId.value, only)
    assert.equal(tabSwitcher.open.value, false, '只有一个标签时不该闪过一个只有一项的浮层')
  })
})

describe('标签切换 · 键位真源与登记', () => {
  test('方向键被归一成命令表里的写法（否则按了没反应，且不报错）', () => {
    const mk = (key, extra = {}) => ({
      key, metaKey: true, altKey: true, shiftKey: false, ctrlKey: false, ...extra,
    })
    assert.equal(accelFromEvent(mk('ArrowRight')), '⌘⌥→')
    assert.equal(accelFromEvent(mk('ArrowLeft')), '⌘⌥←')
  })

  test('5 条命令都在命令表里，键位与 MD-02 的裁决一致（关闭标签**不许**是 ⌘W）', () => {
    const expect = {
      'file.newTab': '⌘T',
      'file.closeTab': '⌘⌥W',
      'file.reopenClosedTab': '⌘⇧T',
      'view.prevTab': '⌘⌥←',
      'view.nextTab': '⌘⌥→',
    }
    for (const [id, accel] of Object.entries(expect)) {
      const cmd = getCommand(id)
      assert.ok(cmd, `命令表里没有 ${id}`)
      assert.equal(cmd.accel, accel, `${id} 的键位不是 ${accel}`)
      assert.ok(cmd.descKey, `${id} 没有 descKey —— 不会进应用内速查表（AC-63）`)
      assert.ok(cmd.labelKey, `${id} 没有 labelKey —— 菜单项会显示空文案`)
    }
  })
})

describe('Tab Switcher · 组件装配契约', () => {
  const SWITCHER = stripComments(
    readFileSync(new URL('../src/components/TabSwitcher.vue', import.meta.url), 'utf8'),
  )
  const TAB_BAR = stripComments(
    readFileSync(new URL('../src/components/TabBar.vue', import.meta.url), 'utf8'),
  )

  test('TabBar 真的渲染了 TabSwitcher 并传了 open / rows / activeId', () => {
    assert.match(TAB_BAR, /import TabSwitcher from '\.\/TabSwitcher\.vue'/, '没 import TabSwitcher')
    assert.match(TAB_BAR, /<TabSwitcher\b/, '没渲染 TabSwitcher —— 浮层永远不会出现')
    for (const prop of [':open=', ':rows=', ':active-id=']) {
      assert.ok(TAB_BAR.includes(prop), `TabSwitcher 缺 ${prop}`)
    }
  })

  test('浮层是纯展示：不吃点击、不重复播报（pointer-events + aria-hidden）', () => {
    assert.match(SWITCHER, /pointer-events: none/, '浮层会吃掉下一次点击')
    assert.match(SWITCHER, /aria-hidden="true"/, '同一件事会被读屏播两遍（tab 的 aria-selected 已播过）')
    assert.doesNotMatch(SWITCHER, /defineEmits\(/, '浮层不该有事件出口（它是纯展示，切换由命令层驱动）')
  })
})
