/**
 * tab-session.test.mjs — 会话注册表的身份与幂等（P1）
 * ============================================================================
 * 被测对象：`composables/useEditorSession.js` 的注册表部分（sessions / activeId /
 * mru / findByPath / createSession / removeSession / setActivePath）。
 *
 * 【为什么这些判据必须机检 —— 全是「错了不报错」型】
 *   ① **id 复用**：关掉 t2 后再开新标签又拿到 t2，会让「已关标签的旧引用」复活
 *      （closedStack 恢复、MRU 落点、Go 侧 u: 命名空间的映射键全部指向错对象）。
 *      界面上完全看不出来，直到某天恢复出来一个内容不对的标签。
 *   ② **同路径幂等落在错误的层**：架构方案 §5.1 把幂等放在 `openTab` 层
 *      （`findByPath` 命中即复用），**不是** `createSession` 里。若有人把幂等
 *      塞进 createSession，「新建空白文档」与「打开同一个文件两次」会同时被
 *      吞掉一个 —— 而两条路径在 UI 上要求的行为正好相反。
 *   ③ **activeSession 变 null**：MD-08 的硬不变式。一旦为 null，`filePath` /
 *      `title` / `markdown` 全部退化，而退化值都是「空」，界面看起来只是
 *      「文档变空了」——与「用户真的新建了空文档」不可区分。
 *
 * 【只测注册表，不碰 view】本文件不创建 EditorView（Node 无 DOM）。切标签的
 * 时序在 tab-activate.test.mjs 里用真 EditorState + 视图替身驱动。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shallowRef } from 'vue'
import { useEditorSession } from '../src/composables/useEditorSession.js'
import { stripComments } from './helpers/lexer.mjs'

// Node 里没有 rAF（activateSession 步骤 9 的滚动恢复要用）。本文件不切标签，
// 但模块顶层统一 stub，避免将来加用例时踩空。
globalThis.requestAnimationFrame ??= (fn) => fn()

// 组件外调用 composable 时，Vue 会对 onMounted / onBeforeUnmount 各 warn 一次。
// 本文件只测 setup 期的注册表逻辑，生命周期钩子本就不会执行 —— 精确过滤这两条，
// 其余警告照常输出（不整体静音：那会让真正的 Vue 警告也被吞掉）。
const realWarn = console.warn.bind(console)
console.warn = (msg, ...rest) => {
  if (typeof msg === 'string' && /is called when there is no active component instance/.test(msg)) return
  realWarn(msg, ...rest)
}

function makeSession() {
  return useEditorSession({
    editorRef: shallowRef(null),
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
}

describe('会话注册表 · 初始状态', () => {
  test('初始恒有一个会话，且它就是激活会话（activeSession 不为 null）', () => {
    const s = makeSession()
    assert.equal(s.sessions.value.length, 1, '初始应恰好一个会话')
    assert.ok(s.activeSession.value, 'activeSession 不得为 null（MD-08 硬不变式）')
    assert.equal(s.activeSession.value.id, s.activeId.value)
    assert.equal(s.activeSession.value.path, '', '初始会话是未落盘文档')
    assert.equal(s.activeSession.value.dirty, false, '初始不应是脏的')
  })

  test('初始会话带着一份真 EditorState（撤销栈 / 装饰字段随它走）', () => {
    const s = makeSession()
    const st = s.activeSession.value.state
    assert.ok(st && typeof st.doc.toString === 'function', 'state 必须是 EditorState')
    assert.ok(st.doc.length > 0, '初始内容是示例文档（现状首屏行为，不得改成空白）')
  })
})

describe('会话注册表 · 身份', () => {
  test('id 单调递增，且删掉后**不复用**', () => {
    const s = makeSession()
    const first = s.activeSession.value.id
    const a = s.createSession({ path: '/a.md', content: 'A' })
    const b = s.createSession({ path: '/b.md', content: 'B' })
    assert.deepEqual([first, a.id, b.id], ['t1', 't2', 't3'], 'id 应形如 t1/t2/t3 递增')

    assert.equal(s.removeSession(b.id), true)
    const c = s.createSession({ path: '/c.md', content: 'C' })
    assert.equal(c.id, 't4', '删掉的 t3 不得被复用（复用会让旧引用复活）')
    assert.ok(![first, a.id, b.id].includes(c.id))
  })

  test('findByPath 命中即返回同一对象；空路径与未知路径都返回 null', () => {
    const s = makeSession()
    const a = s.createSession({ path: '/docs/a.md', content: 'A' })
    assert.equal(s.findByPath('/docs/a.md'), a, '同路径必须返回**同一个** session 对象')
    assert.equal(s.findByPath('/docs/none.md'), null)
    // 空路径返回 null 而不是「那个未落盘会话」：未落盘文档没有身份，
    // 若把它当命中，第二个「新建」会被误判成「已打开」而吞掉。
    assert.equal(s.findByPath(''), null)
  })

  test('createSession 两次同 path 产生两条（幂等是 openTab 层的职责，不在这里）', () => {
    const s = makeSession()
    const a1 = s.createSession({ path: '/x.md', content: '1' })
    const a2 = s.createSession({ path: '/x.md', content: '2' })
    assert.notEqual(a1.id, a2.id, 'createSession 不得自作主张去重')
    assert.equal(s.sessions.value.filter((x) => x.path === '/x.md').length, 2)
  })
})

describe('会话注册表 · 移除与不变式', () => {
  test('移除激活会话后 activeSession 仍不为 null（关掉最后一个 → 自动补一份空文档）', () => {
    const s = makeSession()
    const only = s.activeSession.value
    assert.equal(s.removeSession(only.id), true)
    assert.equal(s.sessions.value.length, 1, '关掉最后一个标签应回到「一个空文档」，不是零标签')
    assert.ok(s.activeSession.value, 'activeSession 仍不得为 null')
    assert.notEqual(s.activeSession.value.id, only.id, '补回来的必须是**新**会话，不是被删的那个')
    assert.equal(s.activeSession.value.path, '')
    assert.equal(s.activeSession.value.state.doc.toString(), '', '补回来的应是空文档')
  })

  test('移除后台会话不动激活标签（MD-15：不把用户从正在编辑的文档里拽走）', () => {
    const s = makeSession()
    const a = s.createSession({ path: '/a.md', content: 'A' })
    const b = s.createSession({ path: '/b.md', content: 'B' })
    s.activeId.value = a.id
    assert.equal(s.removeSession(b.id), true)
    assert.equal(s.activeId.value, a.id, '关后台标签不应改变激活标签')
    assert.equal(s.sessions.value.length, 2) // t1 + a
  })

  test('removeSession 对不存在的 id 返回 false，且不破坏注册表', () => {
    const s = makeSession()
    const before = s.sessions.value.length
    assert.equal(s.removeSession('t999'), false)
    assert.equal(s.sessions.value.length, before)
  })

  test('mru 同步：移除的 id 不再留在 MRU 里', () => {
    const s = makeSession()
    const a = s.createSession({ path: '/a.md', content: 'A' })
    assert.ok(s.mru.value.includes(a.id), '新建的会话应进 MRU')
    s.removeSession(a.id)
    assert.ok(!s.mru.value.includes(a.id), '移除后 MRU 必须同步摘掉（否则落点会指向不存在的标签）')
  })
})

describe('会话注册表 · 路径写入唯一入口', () => {
  test('setActivePath 同时更新 path 与 title', () => {
    const s = makeSession()
    s.setActivePath('/Users/nobody/笔记/草稿.md')
    assert.equal(s.filePath.value, '/Users/nobody/笔记/草稿.md', 'filePath 是 path 的派生值')
    assert.equal(s.title.value, '草稿.md', 'title 必须跟着路径走')
    assert.equal(s.activeSession.value.title, '草稿.md', '会话上的 title 字段也要同步（标签栏读它）')
  })

  test('setActivePath("") 让标题退回「未命名」', () => {
    const s = makeSession()
    s.setActivePath('/a.md')
    s.setActivePath('')
    assert.equal(s.filePath.value, '')
    assert.equal(s.title.value, s.activeSession.value.title)
    assert.ok(s.title.value.length > 0, '未落盘时标题必须有兜底文案，不能是空串')
  })

  test('filePath 是只读派生值：改会话的 path 后 filePath 自动跟随（无第二个写入者）', () => {
    const s = makeSession()
    s.setActivePath('/one.md')
    assert.equal(s.filePath.value, '/one.md')
    // 直接改会话字段也必须生效 —— 说明 filePath 确实是 computed，不是另一份拷贝
    s.activeSession.value.path = '/two.md'
    assert.equal(s.filePath.value, '/two.md')
  })

  test('Windows 反斜杠路径也能取到文件名（两种分隔符都要认）', () => {
    const s = makeSession()
    s.setActivePath('C:\\Users\\nobody\\文档\\笔记.md')
    assert.equal(s.title.value, '笔记.md', '只按 / 切会把整条路径当文件名显示')
  })
})

// ===========================================================================
// 标签栏装配契约（静态源码断言）
// ===========================================================================
/**
 * 【为什么要守这一条】组件写好了但没挂上去，是「点了没反应、且不报错」的
 * 最典型形态 —— 本仓为此立过规矩（typora-chrome.test.mjs 的第 3 条）。
 * 具体风险：`<TabBar>` 若被谁顺手删掉，注册表测试和切标签测试**全都还是绿的**
 * （它们直测 composable，不经过模板），而用户看到的标签栏整条消失。
 *
 * 依赖全部已由别的用例守住：`.tab-bar` 打印隐藏 → 契约 3 的 chrome 清单
 * （`contracts.test.mjs` 的 ['tab-bar','statusbar','history-panel']）；
 * 脏点颜色 → 只用 token，且 App.vue 无硬编码色值。
 */
describe('标签栏 · 装配契约', () => {
  const APP = stripComments(readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8'))
  const TAB_BAR = stripComments(
    readFileSync(new URL('../src/components/TabBar.vue', import.meta.url), 'utf8'),
  )

  test('App.vue 真的 import 并渲染了 TabBar，且传了 sessions / activeId / select', () => {
    assert.match(
      APP, /import TabBar from '\.\/components\/TabBar\.vue'/,
      'App.vue 没有 import TabBar —— 组件存在但没接上',
    )
    assert.match(APP, /<TabBar\b[^>]*:sessions="sessions"/, 'TabBar 没拿到 sessions（标签栏会是空的）')
    assert.match(APP, /<TabBar\b[^>]*:active-id="activeId"/, 'TabBar 没拿到 activeId（无法高亮当前标签）')
    assert.match(
      APP, /<TabBar\b[^>]*@select="[^"]*activateSession"/,
      'TabBar 的 select 没接到 activateSession —— 点标签不会有任何反应，且不报错',
    )
  })

  test('TabBar 声明了 select 事件，脏点带非颜色信号（data-state + role=img + aria-label）', () => {
    assert.match(TAB_BAR, /defineEmits\(\['select'\]\)/, 'TabBar 未声明 select 事件')
    assert.match(TAB_BAR, /data-state=/, '缺 data-state：状态只剩颜色一条信道（WCAG 1.4.1）')
    assert.match(TAB_BAR, /role="img"/, '脏点缺 role=img，aria-label 不会被读屏播报')
    assert.match(TAB_BAR, /:aria-label="t\('common\.unsaved'\)"/, '脏点的 aria-label 必须走 i18n')
  })
})
