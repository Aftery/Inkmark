/**
 * typora-chrome.test.mjs — chrome 极简化（task B）的回归测试网
 * ============================================================================
 * 被守护的四件事（每条都对应一个「错了不报错」的真实风险）：
 *
 *  1. **状态栏默认隐藏，但关键反馈不会消失** —— 默认隐藏本身是产品裁决；
 *     风险在「隐藏得太干净」：保存失败 / 表格未渲染提示若也一起隐藏，
 *     就退化成「静默失败」，正是本仓反复吃过亏的形态。故把
 *     shouldSurfaceStatus 的真值表逐项钉死（它是纯函数，直测真实实现）。
 *
 *  2. **隐藏必须可逆**（找回入口不能消失）—— 状态栏的显隐开关存 localStorage，
 *     默认 false；口径错误（如默认 true、或 key 拼错）会让「Typora 式无状态栏」
 *     悄悄失效，而界面看起来完全正常。故对「默认值 / 读取白名单 / 存储不可用
 *     的降级」逐条直测真实模块。
 *
 *  3. **侧栏默认收起，且收起动作不是死接线** —— App.vue 有 ≤150 行铁律，
 *     不可能给收起按钮加 @close 接线。若按钮 emit 一个没人听的事件，
 *     表现为「点了没反应且不报错」（本仓明令禁止的形态）。故断言它走
 *     命令总线（emitCommand('view.outline')），与 ⌘B 同一条路径。
 *
 *  4. **契约面不许回退** —— role=status、t('statusbar.tableHint')、@media print
 *     隐藏、菜单分组名 titlebar.{file,edit,format,view,window,help} 三语齐备、
 *     三语字典 key 集合一致。这些是既有门禁的锚点，改动它们会连带打红别的测试。
 *
 * 写法约定（与仓内既有测试一致）：.vue 无法在 node 里编译，故对组件做
 * **源码契约断言**（先剥注释再匹配，避免「注释里写了词」造成假通过 ——
 * 这是本仓记录过的假绿灯形态）；纯逻辑模块（useChrome.js）**真实 import** 直测。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripComments } from './helpers/lexer.mjs'
import { installLocalStorageStub } from './helpers/dom-stub.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
const code = (p) => stripComments(read(p))

const LOCALES = ['zh-CN', 'en-US', 'ja-JP']

/** 带 query 的动态 import：造独立模块实例（useChrome 有模块级 ref） */
let seq = 0
async function freshChrome() {
  const url = new URL('../src/composables/useChrome.js', import.meta.url)
  url.searchParams.set('fresh', `chrome-${++seq}`)
  return import(url.href)
}

/**
 * 装 localStorage stub 后 import useChrome，返回模块 + stub 句柄。
 * @param {object} [opts] 见 helpers/dom-stub.js 的 installLocalStorageStub
 * @param {Record<string,string>} [seed] 额外预置的 key（stub 只支持单 key 种子）
 */
async function loadChrome(opts = {}, seed = {}) {
  const storage = installLocalStorageStub(opts)
  for (const [k, v] of Object.entries(seed)) storage.store.set(k, v)
  const mod = await freshChrome()
  return { ...mod, storage }
}

// ===========================================================================
// 1. 显隐开关的持久化语义（真实模块，不走源码正则）
// ===========================================================================
describe('chrome 开关 · 状态栏默认不显示（Typora 式）', () => {
  test('无存储 → 默认隐藏（这是产品裁决，不得被悄悄改成常显）', async () => {
    const { statusbarPinned } = await loadChrome()
    assert.equal(
      statusbarPinned.value, false,
      '状态栏默认必须是隐藏的。若改成 true，「Typora 式只有正文」即刻失效，' +
        '而界面看起来毫无异常 —— 没有任何自动化会因此报错。'
    )
  })

  test('存 "1" → 常显（用户的选择跨会话保持）', async () => {
    const { statusbarPinned, STATUSBAR_KEY } = await loadChrome({}, { 'inkmark-statusbar': '1' })
    assert.equal(STATUSBAR_KEY, 'inkmark-statusbar')
    assert.equal(statusbarPinned.value, true, `key=${STATUSBAR_KEY} 存 "1" 应读回常显`)
  })

  test('存 "0" / 垃圾值 → 回落隐藏（fail safe，不得抛错）', async () => {
    for (const raw of ['0', '', 'true', 'yes', '2']) {
      const { statusbarPinned } = await loadChrome({}, { 'inkmark-statusbar': raw })
      assert.equal(statusbarPinned.value, false, `存储值 ${JSON.stringify(raw)} 应回落隐藏`)
    }
  })

  test('setStatusbarPinned 同时改 ref 与存储（两处不同步 = 刷新后偏好丢失）', async () => {
    const { setStatusbarPinned, statusbarPinned, storage, STATUSBAR_KEY } = await loadChrome()
    setStatusbarPinned(true)
    assert.equal(statusbarPinned.value, true)
    assert.equal(storage.store.get(STATUSBAR_KEY), '1', '未写入 localStorage → 重启后回到默认隐藏')
    setStatusbarPinned(false)
    assert.equal(statusbarPinned.value, false)
    assert.equal(storage.store.get(STATUSBAR_KEY), '0', '关闭档也要落盘，否则无法区分「用户关的」与「从没设过」')
  })

  test('toggleStatusbarPinned 往返回到原点（标题栏按钮与状态栏按钮共用它）', async () => {
    const { toggleStatusbarPinned, statusbarPinned } = await loadChrome()
    assert.equal(statusbarPinned.value, false)
    toggleStatusbarPinned()
    assert.equal(statusbarPinned.value, true)
    toggleStatusbarPinned()
    assert.equal(statusbarPinned.value, false)
  })

  test('setStatusbarPinned 传非布尔值 → 归一成布尔（不把 "0"/undefined 存成真值）', async () => {
    const { setStatusbarPinned, statusbarPinned } = await loadChrome()
    setStatusbarPinned('yes')
    assert.equal(statusbarPinned.value, true)
    setStatusbarPinned(0)
    assert.equal(statusbarPinned.value, false, '0 是假值，必须落成 false 而不是保留字符串')
  })

  test('localStorage.getItem 抛错（隐私模式）→ 默认隐藏且不抛（抛了就白屏）', async () => {
    let mod
    await assert.doesNotReject(async () => {
      // 模块初始化期就会读存储：这里抛错若未兜底，整个 setup 中断 → 白屏
      mod = await loadChrome({ throwOnGet: true })
    }, 'useChrome 在存储被禁用时抛错 → 界面白屏（本仓 TDZ/白屏事故同族）')
    assert.equal(mod.statusbarPinned.value, false)
  })

  test('localStorage.setItem 抛错（配额满）→ 本次会话仍生效，只是不持久化', async () => {
    const { setStatusbarPinned, statusbarPinned } = await loadChrome({ throwOnSet: true })
    assert.doesNotThrow(() => setStatusbarPinned(true), '写存储失败不得冒泡到 UI')
    assert.equal(statusbarPinned.value, true, '存储不可用时本次会话仍应生效（降级而非摆烂）')
  })
})

// ===========================================================================
// 2. 关键反馈必须浮现（隐藏的边界在哪）—— 纯函数真值表
// ===========================================================================
describe('chrome 开关 · shouldSurfaceStatus 真值表（隐藏不得吞掉反馈）', () => {
  test('保存失败 → 必须浮现（只读目录等场景的唯一明示）', async () => {
    const { shouldSurfaceStatus } = await loadChrome()
    assert.equal(
      shouldSurfaceStatus({ saveState: 'error' }), true,
      '保存失败时状态栏若仍隐藏，用户完全看不到「写不进去」—— 这是静默失败'
    )
  })

  test('表格未渲染提示 → 必须浮现（且与保存态无关）', async () => {
    const { shouldSurfaceStatus } = await loadChrome()
    for (const saveState of ['saved', 'saving', 'unsaved', 'error']) {
      assert.equal(
        shouldSurfaceStatus({ saveState, hasHint: true }), true,
        `saveState=${saveState} 时有表格提示仍须浮现（提示语义是「常驻到改对为止」）`
      )
    }
  })

  test('saved / unsaved / saving → 不浮现（常态不打扰，这才是 Typora 式）', async () => {
    const { shouldSurfaceStatus } = await loadChrome()
    for (const saveState of ['saved', 'unsaved', 'saving']) {
      assert.equal(
        shouldSurfaceStatus({ saveState }), false,
        `saveState=${saveState} 不该让状态栏常驻浮现：` +
          'saved 是常态；unsaved 由标题栏脏圆点承担（重复表达 = 噪声）；' +
          'saving 的短往返由 StatusBar 的延迟计时器处理（见 SAVING_SURFACE_DELAY_MS）'
      )
    }
  })

  test('空参 / 未知状态 → 不浮现（不得因 undefined 而误判成 error）', async () => {
    const { shouldSurfaceStatus } = await loadChrome()
    assert.equal(shouldSurfaceStatus(), false)
    assert.equal(shouldSurfaceStatus({}), false)
    assert.equal(shouldSurfaceStatus({ saveState: 'wat', hasHint: false }), false)
  })

  test('两个时长常量自洽（浮现要看得见，又不能把快速保存变成噪声）', async () => {
    const { STATUS_HOLD_MS, SAVING_SURFACE_DELAY_MS } = await loadChrome()
    assert.ok(Number.isFinite(STATUS_HOLD_MS) && STATUS_HOLD_MS >= 600,
      `STATUS_HOLD_MS=${STATUS_HOLD_MS} 太短：一次反馈停留不到 0.6s，肉眼抓不到（等于没做）`)
    assert.ok(Number.isFinite(SAVING_SURFACE_DELAY_MS) && SAVING_SURFACE_DELAY_MS > 0,
      'SAVING_SURFACE_DELAY_MS 必须是正的延迟，否则每次保存都闪一条状态栏（纯噪声）')
    assert.ok(SAVING_SURFACE_DELAY_MS < STATUS_HOLD_MS,
      '保存浮现的延迟必须小于最小停留时间，否则浮现刚出现就被收走（顺序反了）')
  })
})

// ===========================================================================
// 3. StatusBar.vue 源码契约：默认隐藏 + 既有无障碍/i18n 锚点不回退
// ===========================================================================
describe('StatusBar.vue · 默认隐藏与既有契约', () => {
  test('显隐真源走 useChrome，不得自己造第二套 localStorage key', () => {
    const src = code('components/StatusBar.vue')
    assert.match(src, /statusbarPinned/, 'StatusBar 未消费 statusbarPinned —— 开关将无法生效')
    assert.match(src, /shouldSurfaceStatus/, 'StatusBar 未用 shouldSurfaceStatus —— 关键反馈判据会散落成两份')
    assert.ok(
      !/localStorage\s*\.\s*(getItem|setItem)/.test(src),
      'StatusBar 里直接用了 localStorage：显隐偏好必须只经 composables/useChrome.js 一处读写' +
        '（两处读写同一 key 会在不同步时表现为「开关点了但没记住」）'
    )
  })

  test('收起用 display:none（不是 opacity/visibility）—— 才真把 26px 还给正文', () => {
    const src = code('components/StatusBar.vue')
    const m = src.match(/\.statusbar\.is-veiled\s*\{([^}]*)\}/)
    assert.ok(m, '找不到 .statusbar.is-veiled 规则 —— 默认隐藏的落地样式缺失')
    assert.match(m[1], /display:\s*none/, '收起必须是 display:none：opacity/visibility 仍占 26px 高度')
  })

  test('role="status" 至少两处（保存态 + 表格提示），无障碍语义不得因瘦身丢失', () => {
    const src = read('components/StatusBar.vue')
    const hits = src.match(/role="status"/g) || []
    assert.ok(hits.length >= 2, `role="status" 只剩 ${hits.length} 处：保存态与表格提示都要能被告知读屏器`)
  })

  test("表格提示仍走 t('statusbar.tableHint') 且保留 .sb-hint（table-hint.test.mjs:168 的锚点）", () => {
    const src = read('components/StatusBar.vue')
    assert.match(src, /t\(\s*'statusbar\.tableHint'/, "必须用 t('statusbar.tableHint')，硬编码会切不了语言")
    assert.match(src, /class="sb-hint"/, '缺少 .sb-hint 元素 —— 检测逻辑再对，用户也看不见')
  })

  test('行列 / 字数只在「常显」档出现（临时浮现不铺一排常驻数字）', () => {
    const src = read('components/StatusBar.vue')
    assert.match(src, /v-if="statusbarPinned"/, '行列与字数应受 statusbarPinned 控制')
    // 反证：这两个 key 仍然存在（不是删掉了功能，而是挪进了条件分支）
    assert.match(src, /t\('statusbar\.lineCol'/, 'statusbar.lineCol 文案被删掉了')
    assert.match(src, /t\('statusbar\.words'/, 'statusbar.words 文案被删掉了')
  })

  test('本组件有自己的一份 @media print 隐藏（scoped 打不到父组件的第二道）', () => {
    const src = read('components/StatusBar.vue')
    const printBlocks = [...src.matchAll(/@media\s+print\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1])
    assert.ok(printBlocks.length >= 1, 'StatusBar 缺少 @media print 块（打印会带出状态栏）')
    assert.ok(
      printBlocks.some((b) => /display:\s*none/.test(b)),
      'StatusBar 的 @media print 里必须有 display:none'
    )
  })

  test('档位按钮有 aria-pressed 与本地化 title（可发现 + 无障碍）', () => {
    const src = read('components/StatusBar.vue')
    assert.match(src, /:aria-pressed="statusbarPinned"/, '档位按钮缺 aria-pressed，读屏器听不出当前档位')
    assert.match(src, /t\(statusbarPinned\s*\?/, '档位按钮的文案必须走 t()（会随语言切换）')
  })
})

// ===========================================================================
// 4. TitleBar.vue：两个 chrome 入口（默认隐藏的能力必须可找回）
// ===========================================================================
describe('TitleBar.vue · chrome 找回入口', () => {
  const src = code('components/TitleBar.vue')

  test('有状态栏开关（消费 useChrome），这是「隐藏态」下唯一可见的找回路径', () => {
    assert.match(src, /from '\.\.\/composables\/useChrome\.js'/,
      '标题栏必须从 useChrome 取开关状态，才能与状态栏内按钮保持同档位')
    // 【为什么必须断言「调用点」而不是「出现过这个名字」】
    // 变异自证实测：只匹配符号名时，把 `if (item.local) toggleStatusbarPinned()`
    // 整行删掉，本用例**仍然通过** —— 因为 import 语句里也有这个名字。
    // 那就是一条永绿的假用例：菜单项还在，点了却什么都不发生（且不报错）。
    // 故分别钉住「菜单项点击时的就地切换」与「档位回显」两个调用点。
    assert.match(
      src, /if\s*\(item\.local\)\s*toggleStatusbarPinned\(\)/,
      'chrome 菜单项的点击分支没调用 toggleStatusbarPinned() —— 开关点了没反应（假绿灯用例抓不到的形态）'
    )
    assert.match(
      src, /t\(statusbarPinned\.value\s*\?\s*'statusbar\.always'\s*:\s*'statusbar\.auto'\)/,
      '菜单项没有回显当前档位（用户点完看不出是「常显」还是「按需」）'
    )
  })

  test('侧栏入口复用既有命令 view.outline（不新增语义重叠的命令）', () => {
    assert.match(src, /view\.outline/, '侧栏按钮应触发既有命令 view.outline（⌘B 的同一条处理器）')
    assert.match(src, /emit\('command'/, '侧栏按钮必须经 emit("command") 走 App.vue 既有的命令接线')
  })

  test('chrome 开关是「视图」分组末尾的一行，不新建分组（菜单结构仍由命令表派生）', () => {
    const m = src.match(/props\.groups\.map\(([\s\S]*?)\n\s*\)\s*\)/)
    assert.ok(m, '找不到 menuGroups 的派生逻辑 —— 菜单结构来源可能被改成了组件自拼')
    assert.match(m[1], /g\.id === 'view'/, 'chrome 开关必须附到「视图」分组（用户直觉位置），而不是新建分组')
    assert.match(m[1], /\.\.\.g\.items/, '必须保留原有命令项（append，不能替换掉视图分组里的命令）')
  })

  test('菜单分组名仍用 t(`titlebar.${g.id}`) 模板串（lead 的命令面板复用这 6 个 key）', () => {
    assert.match(src, /t\(`titlebar\.\$\{g\.id\}`\)/, '分组名渲染方式被改动了 —— 命令面板按同一 key 取组名')
    for (const g of ['file', 'edit', 'format', 'view', 'window', 'help']) {
      for (const loc of LOCALES) {
        const dict = read(`i18n/${loc}.js`)
        assert.ok(
          dict.includes(`'titlebar.${g}':`),
          `${loc}.js 缺 titlebar.${g} —— 标题栏菜单会显示 key 原文，命令面板分组标题同时失真`
        )
      }
    }
  })

  test('新增的可点元素必须声明 no-drag（否则无边框平台点不中/拖窗口失灵）', () => {
    // 用未剥注释的原文：白名单本身写在注释里（说明「为什么只能落在叶子元素上」），
    // 剥掉注释就再也定位不到那块 CSS 的起点。
    const styleStart = read('components/TitleBar.vue').indexOf('--wails-draggable 白名单')
    assert.ok(styleStart > 0, '找不到 no-drag 白名单注释块')
    const tail = read('components/TitleBar.vue').slice(styleStart)
    assert.match(tail, /\.tb-icon-btn,/, '.tb-icon-btn 未进 no-drag 白名单：Linux/Windows 下点击会被拖拽区吞掉')
    assert.match(tail, /\.tb-item,/, '.tb-item 未进 no-drag 白名单')
  })

  test('文件名是视觉主角（--fg + 强调字重），菜单退成背景（--muted）', () => {
    const titleRule = src.match(/\.tb-title\s*\{([^}]*)\}/)
    assert.ok(titleRule, '找不到 .tb-title 规则')
    assert.match(titleRule[1], /color:\s*var\(--fg\)/, '文件名应为 --fg（全条唯一焦点）')
    assert.match(titleRule[1], /font-weight:\s*var\(--weight-emphasize\)/, '文件名应加强调字重')
    const barRule = src.match(/\.titlebar\s*\{([^}]*)\}/)
    assert.ok(barRule, '找不到 .titlebar 规则')
    assert.match(barRule[1], /color:\s*var\(--muted\)/, '标题栏基色应为 --muted（菜单退成背景）')
    assert.match(barRule[1], /border-bottom:\s*1px solid var\(--border-soft\)/,
      '底边应为发丝线 --border-soft（原来的 --border 是一条明显的分界）')
  })

  test('标题栏高度从 --titlebar-height 派生（token 仍是唯一真源）', () => {
    assert.match(src, /--tb-h:\s*calc\(var\(--titlebar-height\)/,
      '高度应写成 calc(var(--titlebar-height) - …)：写死像素会让 token 变成摆设')
  })
})

// ===========================================================================
// 5. Sidebar：默认收起 + 收起动作不是死接线
// ===========================================================================
describe('Sidebar.vue · 默认收起与收起入口', () => {
  test('可见性真源 sidebarOpen 初值必须是 false（首屏纯写作面）', () => {
    const ws = code('composables/useWorkspace.js')
    assert.match(ws, /const\s+sidebarOpen\s*=\s*ref\(false\)/,
      'sidebarOpen 初值不是 false —— 首屏会带一条侧栏，与 Typora 式「只有正文」相悖')
  })

  test('收起按钮走命令总线 emitCommand(view.outline)，不是 emit 一个没人听的 close', () => {
    const src = code('components/Sidebar.vue')
    assert.match(src, /emitCommand\('view\.outline'\)/,
      '收起必须触发既有命令：App.vue 不可能为按钮加 @close 接线（150 行铁律），' +
        'emit 一个无人监听的事件 = 点了没反应且不报错')
    assert.ok(
      !/emit\('close'/.test(src),
      'Sidebar 仍在 emit("close")：App.vue 没有该监听，属静默死接线'
    )
    assert.ok(
      !/defineEmits\(\[[^\]]*'close'/.test(src),
      "defineEmits 里还声明着无人监听的 'close' 事件"
    )
  })

  test('双 tab（文件 / 大纲）与三语 key 保留', () => {
    const src = read('components/Sidebar.vue')
    for (const k of ['sidebar.tab.files', 'sidebar.tab.outline']) {
      assert.match(src, new RegExp(`t\\('${k.replace('.', '\\.')}'`), `Sidebar 缺少 ${k}`)
      for (const loc of LOCALES) {
        assert.ok(read(`i18n/${loc}.js`).includes(`'${k}':`), `${loc}.js 缺 ${k}`)
      }
    }
  })

  test('收起按钮有本地化无障碍名（图标按钮不能只有图标）', () => {
    const src = read('components/Sidebar.vue')
    assert.match(src, /:aria-label="t\('sidebar\.collapse'\)"/, '收起按钮缺 aria-label')
  })
})

// ===========================================================================
// 6. i18n：本轮新增 key 三语齐备（漏一档 = 该语言显示 key 原文）
// ===========================================================================
describe('i18n · chrome 开关文案三语齐备', () => {
  const NEW_KEYS = [
    'statusbar.menu', 'statusbar.pin', 'statusbar.unpin',
    'statusbar.always', 'statusbar.auto', 'sidebar.collapse',
  ]

  test('三份字典都含全部新增 key', () => {
    for (const loc of LOCALES) {
      const dict = read(`i18n/${loc}.js`)
      for (const k of NEW_KEYS) {
        assert.ok(dict.includes(`'${k}':`), `${loc}.js 缺 ${k}（该语言下会显示 key 原文）`)
      }
    }
  })

  test('新增 key 的值都不是空串（空串会让界面出现无文字的空洞按钮）', () => {
    for (const loc of LOCALES) {
      const dict = read(`i18n/${loc}.js`)
      for (const k of NEW_KEYS) {
        const m = dict.match(new RegExp(`'${k.replace('.', '\\.')}':\\s*'([^']*)'`))
        assert.ok(m, `${loc}.js 的 ${k} 解析失败（形态可能被改动）`)
        assert.ok(m[1].trim().length > 0, `${loc}.js 的 ${k} 是空串`)
      }
    }
  })

  test('useChrome 的持久化 key 不被写进字典（它是存储标识，不是文案）', () => {
    for (const loc of LOCALES) {
      assert.ok(
        !read(`i18n/${loc}.js`).includes('inkmark-statusbar'),
        `${loc}.js 里出现了 inkmark-statusbar —— 存储 key 不是界面文案，不应进字典`
      )
    }
  })
})

// ===========================================================================
// 7. 本任务「零 App.vue 改动」的架构约束（组件自决，不吃新 prop）
// ===========================================================================
describe('架构 · chrome 显隐不得转向 App.vue 索要新 prop', () => {
  test('StatusBar 的 props 仍只有既有 5 项（不新增 pinned/visible 之类）', () => {
    const src = read('components/StatusBar.vue')
    const m = src.match(/defineProps\(\{([\s\S]*?)\n\}\)/)
    assert.ok(m, '找不到 defineProps')
    const keys = [...m[1].matchAll(/^\s{2}(\w+):/gm)].map((x) => x[1]).sort()
    assert.deepEqual(
      keys, ['col', 'line', 'status', 'words', 'zoom'],
      'StatusBar 新增了 prop —— App.vue 是 ≤150 行纯装配层（contracts.test.mjs:920 铁律），' +
        '组件必须自己决定显隐（走 composables/useChrome.js 的模块级单例），不接受父子接线'
    )
  })

  test('TitleBar 的 props 仍只有 filename / isDirty / groups', () => {
    const src = read('components/TitleBar.vue')
    const m = src.match(/defineProps\(\{([\s\S]*?)\n\}\)/)
    assert.ok(m, '找不到 defineProps')
    const keys = [...m[1].matchAll(/^\s{2}(\w+):/gm)].map((x) => x[1]).sort()
    assert.deepEqual(
      keys, ['filename', 'groups', 'isDirty'],
      'TitleBar 新增了 prop —— 同上：App.vue 不为 chrome 开关买单'
    )
  })

  test('App.vue 里不得出现 useChrome 相关接线（本任务确实零改动装配层）', () => {
    const app = code('App.vue')
    for (const token of ['statusbarPinned', 'useChrome', 'toggleStatusbar']) {
      assert.ok(
        !app.includes(token),
        `App.vue 出现了 ${token} —— 本任务的实现约束是「组件内部自决」，` +
          '装配层每加一行都在挤压 150 行铁律的余量'
      )
    }
  })
})
