// TDZ 静态顺序守卫 —— 白屏事故（2026-10-05）的防回归网（Spec §2.1 / AC-02）
//
// 断言：App.vue 里每个 useXxx({...}) 调用注入的标识符，声明行号必须早于调用行号。
// const/let 声明晚于调用 -> setup 期命中暂时性死区 -> ReferenceError -> 白屏。
//
// 变异自证一律在内存里改字符串，绝不写真文件（并发纪律：一时刻只允许一个人写仓库）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkTdz } from './helpers/tdz-guard.mjs'

const APP_URL = new URL('../src/App.vue', import.meta.url)
const SOURCE = readFileSync(APP_URL, 'utf8')

/** 把 useDialog() 那行挪到 useFileOps({...}) 之后 —— 复现白屏事故的原始顺序。 */
function moveUseDialogAfterFileOps(source) {
  const lines = source.split('\n')
  const dlg = lines.findIndex((l) => /=\s*useDialog\(\)/.test(l))
  assert.ok(dlg > -1, '找不到 useDialog() 声明行，变异脚本失效')
  const removed = lines.splice(dlg, 1)[0]
  // 锚点必须跳过注释行：源码里「顺序契约」那段注释提到了 useFileOps({...})，
  // 用 indexOf 会命中注释（真实调用点排在其后），把 DEV 块插到注释里 ——
  // 变异随即「造不出隐患」，守卫自然抓不到红，测试报的是假绿。
  // 本仓已因「匹配到注释里的代码」栽过 6 次（Spec §7 坑 4），这里显式排除。
  const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l)
  const start = lines.findIndex((l) => !isComment(l) && l.includes('useFileOps({'))
  const end = lines.findIndex((l, i) => i > start && l.trim() === '})')
  assert.ok(start > -1 && end > start, '定位 useFileOps({...}) 范围失败，变异脚本失效')
  lines.splice(end + 1, 0, removed)
  return lines.join('\n')
}

/** 把 askInput 注入改成惰性包装（Spec §1.2 的修法 B）。 */
function lazyWrapAskInput(source) {
  // 必须**全部**替换：第五轮起 askInput 被注入到两处（useFileOps 的行首、
  // useCommands 的行中），只改第一处会留下另一处立即读取，断言会以
  // 「仍被当立即读取」失败 —— 而那不是守卫坏了，是变异没做全
  // （与变异脚本锚点失效同一类坑）。故用词边界匹配 + g 标志，不依赖行首。
  const out = source.replace(/(^|[\s,{])askInput,(?=\s)/gm, '$1askInput: (...a) => askInput(...a),')
  assert.notEqual(out, source, 'askInput 注入点没被替换到，变异脚本失效')
  assert.equal(
    (source.match(/(^|[\s,{])askInput,(?=\s)/gm) || []).length,
    (out.match(/askInput: \(\.\.\.a\)/g) || []).length,
    'askInput 注入点数与替换数不一致，变异只做了一半'
  )
  return out
}

/**
 * 把「引用了 openFile/openTreeFile 的那个 `if (import.meta.env.DEV) {...}` 调试块」
 * 挪到 useFileOps({...}) 之前。
 *
 * [2026-10-06 修正] 原实现用「第一个 DEV 块」定位。单栏重构后 App.vue 里有
 * **两个** DEV 块：onMounted 内那个只暴露 editor/markdown/filePath（不含 openFile），
 * 真正会踩 TDZ 的是模块级的 window.__inkmarkOps 那个。抓错块 → 变异造不出隐患
 * → 守卫抓不到红 → 测试报「守卫漏报」，而真相是变异脚本没造出它该造的东西。
 * 故改为按**块内容**定位（块内出现 openFile 即为目标的）。
 */
function moveDevBlockBeforeFileOps(source) {
  const lines = source.split('\n')
  const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l)
  // 收集所有 DEV 块的 [start, end]，选出内容里含 openFile 的那个
  let target = null
  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i]) || !lines[i].includes('if (import.meta.env.DEV)')) continue
    let depth = 0
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === '{') depth++; else if (ch === '}') depth-- }
      if (depth === 0 && j > i) {
        const body = lines.slice(i, j + 1).join('\n')
        // 单行形态（if (...) 后面直接跟一句）也要覆盖
        if (body.includes('openFile') || lines[i].includes('openFile')) target = { start: i, end: j }
        break
      }
    }
  }
  assert.ok(target, '找不到含 openFile 的 DEV 调试块，变异脚本失效')
  const block = lines.slice(target.start, target.end + 1)
  const rest = lines.slice(0, target.start).concat(lines.slice(target.end + 1))
  const at = rest.findIndex((l) => !isComment(l) && l.includes('= useFileOps({'))
  assert.ok(at > -1, '定位 useFileOps({...}) 失败，变异脚本失效')
  return rest.slice(0, at).concat(block, rest.slice(at)).join('\n')
}

test('真实 App.vue：useXxx 注入顺序全部合法（守卫本体）', (t) => {
  const r = checkTdz(SOURCE, { file: 'App.vue' })
  // 先质疑解析器：确认真的解析到了调用与注入，而不是「零结果」蒙混过关。
  const names = r.calls.map((c) => c.name)
  // [2026-10-06 第五轮] 随 App.vue 瘦身为装配层，装配的 composable 全集换了一批：
  // 文档状态改叫 useDocumentState（曾用 useDocumentPersistence）、
  // 图片落盘独立成 useFileAssets、命令注册面独立成 useCommands，
  // 另新增 useEditorSession / useWorkspace / useToast。
  // 断言名跟着改，否则删掉某个调用后这条会因「找不到该调用」报红——
  // 但那报错与「注入顺序是否合法」毫无关系（正是本文件记录过的
  // 「加一行 import 就把测试打红」那类噪声）。
  for (const want of ['usePrefs', 'useToast', 'useWorkspace', 'useOutline', 'useEditorSession',
    'useFileAssets', 'useDocumentState', 'useDialog', 'useFileOps', 'useCommands', 'useShortcutsHelp']) {
    assert.ok(names.includes(want), `没解析到 ${want} 调用，解析器可能坏了：${names}`)
  }
  const fileOps = r.calls.find((c) => c.name === 'useFileOps')
  assert.ok(fileOps.injections.length >= 10, `useFileOps 只解析到 ${fileOps.injections.length} 个注入，可疑`)
  assert.ok(r.injections.some((i) => i.name === 'askInput'), '没抓到 askInput 注入，守卫形同虚设')
  assert.ok(r.injections.length >= 15, `全文件只解析到 ${r.injections.length} 个立即读取注入，可疑`)
  if (r.violations.length) t.diagnostic(r.violations.map((v) => v.message).join('\n'))
  assert.deepEqual(r.violations, [], 'App.vue 存在声明晚于调用的注入（TDZ / 白屏风险）')
})

test('惰性包装豁免：惰性注入不进立即读取清单（同调用内的立即注入仍要被抓到）', () => {
  const r = checkTdz(SOURCE, { file: 'App.vue' })
  // [2026-10-06 第五轮] 编辑器实例改为 shallowRef 槽（editorRef）后，
  // 惰性包装的形态有两处：useFileAssets 的 `getFilePath: () => filePath.value`
  // 与 useEditorSession 的 `onImageFile: (file) => assets.saveImageFile(file)`。
  // checkTdz 只把 **immediate** 注入收进 injections（见 helpers/tdz-guard.mjs
  // 第 187 行的 kind 过滤），所以「豁免生效」表现为「它不在清单里」。
  // 每条都配一条**反证**（同一次调用的立即注入必须仍在清单里），
  // 否则「整次调用没被解析到」也会让断言假通过 —— 这正是本仓吃过两次的形态。
  const assetsCall = r.calls.find((c) => c.name === 'useFileAssets')
  assert.ok(assetsCall, '没解析到 useFileAssets 调用，解析器可能坏了')
  assert.ok(
    !r.injections.some((i) => i.useName === 'useFileAssets' && i.key === 'getFilePath'),
    '惰性包装的 getFilePath 被误判为立即读取'
  )
  assert.ok(
    r.injections.some((i) => i.useName === 'useFileAssets' && i.name === 'showToast'),
    'useFileAssets 的立即读取注入没被抓到 —— 上一条断言可能是假通过'
  )
  assert.ok(
    !r.injections.some((i) => i.useName === 'useEditorSession' && i.key === 'onImageFile'),
    '带参箭头 onImageFile 应视为惰性，却被当成立即读取'
  )
})

test('function 声明豁免：提升让其声明虽在后也不报红', () => {
  const r = checkTdz(SOURCE, { file: 'App.vue' })
  // onDocChange 是函数声明，声明在 useEditorSession 调用之后，但被其注入
  const rec = r.injections.find((i) => i.name === 'onDocChange')
  assert.ok(rec, '没解析到 onDocChange 注入')
  assert.equal(rec.declKind, 'function')
  // 动态定位调用点，不写死行号：写死会在任何人往 App.vue 顶部加一行 import
  // 时把测试打红，而它红的原因与「函数声明是否正确豁免」毫无关系
  // （本项目已因此踩过：加一行 import → 160 变 161 → 只能靠合并 import 顶回去）。
  const fileOpsCall = SOURCE.indexOf('useEditorSession(')
  const realCallLine = SOURCE.slice(0, fileOpsCall).split('\n').length
  assert.equal(rec.callLine, realCallLine,
    `callLine 应等于 useEditorSession( 的真实行号 ${realCallLine}；` +
    '若不一致说明解析器定位错了，那才是真问题')
  assert.ok(rec.declLine > rec.callLine, '该用例应覆盖「声明在后」的场景，否则豁免没被检验')
  assert.ok(!r.violations.some((v) => v.name === 'onDocChange'), '函数声明豁免失效，误报了')
  // refreshOutline 同理（注入给同一个 composable 的 onOutlineRefresh）
  const outlineHook = r.injections.find((i) => i.name === 'refreshOutline')
  assert.ok(outlineHook, '没解析到 refreshOutline 注入')
  assert.equal(outlineHook.declKind, 'function')
})

test('变异自证（红）：useDialog 挪到 useFileOps 之后，必须指名 askInput 与两处行号', (t) => {
  const mutated = moveUseDialogAfterFileOps(SOURCE)
  const r = checkTdz(mutated, { file: 'App.vue' })
  const v = r.violations.find((x) => x.name === 'askInput')
  if (!v) t.diagnostic('变异后未见 askInput 违规，守卫漏报')
  assert.ok(v, '把 useDialog 挪到调用之后，守卫必须报红（否则防不住 2026-10-05 的白屏）')
  assert.equal(v.kind, 'tdz')
  assert.ok(v.declLine > v.callLine, `声明行 ${v.declLine} 应晚于调用行 ${v.callLine}`)
  assert.match(v.message, /askInput/, '报错文案必须点名标识符 askInput')
  assert.ok(v.message.includes(String(v.declLine)), '报错文案必须含声明行号')
  assert.ok(v.message.includes(String(v.callLine)), '报错文案必须含调用行号')
  assert.match(v.message, /暂时性死区/, '文案必须点明 const 暂时性死区')
  assert.match(v.message, /白屏/, '文案必须点明后果是启动白屏')
})

test('变异自证（绿）：askInput 改惰性包装后必须转绿', () => {
  const greened = lazyWrapAskInput(SOURCE)
  const r = checkTdz(greened, { file: 'App.vue' })
  assert.ok(!r.injections.some((i) => i.key === 'askInput'), '惰性包装后 askInput 仍被当立即读取')
  assert.deepEqual(r.violations, [], '惰性包装是 Spec §1.2 认可的修法，不应报红')
})

test('合成用例：找不到声明必须报红且文案含「来源不明」', () => {
  const src = '<script setup>\nconst x = useFoo({ mystery, getEditor: () => later })\n</script>'
  const r = checkTdz(src, { file: 'x.vue' })
  const v = r.violations.find((x) => x.name === 'mystery')
  assert.ok(v, '找不到声明的注入必须报红')
  assert.equal(v.kind, 'unknown')
  assert.match(v.message, /来源不明/)
  // 同一调用的惰性包装不应连带报红
  assert.ok(!r.violations.some((x) => x.name === 'later'))
})

test('合成用例：惰性包装指向后声明的 const 仍视为安全', () => {
  const src = '<script setup>\nconst x = useFoo({ getLate: () => late })\nconst late = 1\n</script>'
  const r = checkTdz(src, { file: 'x.vue' })
  assert.deepEqual(r.violations, [])
})

// ===========================================================================
// 第三类 TDZ：被 composable 在**初始化期**读掉的惰性 getter
// ===========================================================================

/**
 * 单栏重构引入的第三种白屏形态（2026-10-06 真实事故）。
 *
 * 形态：`const prefs = usePrefs(() => editor)` 看着是惰性的（传的是箭头函数），
 * 但 usePrefs 在**模块首次初始化时**会立刻调用一次该 getter 去恢复缩放档位 ——
 * 此时 App.vue 的 `let editor` 若声明在后面，就命中 TDZ：
 *   ReferenceError: Cannot access 'editor' before initialization → 白屏。
 *
 * 为什么已有的守卫抓不到（这才是它值得单独立一条的理由）：
 *   checkTdz 的「惰性包装豁免」把 `() => editor` 判为安全 —— 这条规则本身是对的
 *   （箭头函数确实延后求值），但它默认「惰性 = 永不求值」。当某个 composable
 *   在构造期就调用 getter 时，豁免反而成了盲区。
 *   实测当时 dist 构建通过、104 条测试全绿，只有真渲染冒烟
 *   （scripts/smoke/render-check.mjs）报出白屏。
 *
 * 本守卫的判据：**顶层 let/const 的声明行必须早于任何把它作为实参传入的
 * composable 调用**。这是「构造期可能求值」这一事实的直接表达，
 * 不依赖对具体 composable 实现的了解。
 */

/** App.vue 顶层 `useXxx(` 调用的行号集合 */
function composableCallLines(src) {
  const out = new Set()
  const lines = src.split('\n')
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return
    const m = l.match(/\buse[A-Z]\w*\s*\(/)
    if (m) out.add(i + 1)
  })
  return out
}

/** App.vue 顶层 `let/const NAME` 的声明行 */
function topLevelDeclLines(src) {
  const map = new Map()
  const lines = src.split('\n')
  lines.forEach((l, i) => {
    if (/^\s/.test(l)) return // 只看顶层
    const m = l.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/)
    if (m && !map.has(m[1])) map.set(m[1], i + 1)
  })
  return map
}

test('传入 composable 的惰性 getter，其被闭包捕获的变量必须已声明（第三类 TDZ）', () => {
  const calls = composableCallLines(SOURCE)
  const decls = topLevelDeclLines(SOURCE)
  const lines = SOURCE.split('\n')

  const violations = []
  for (const callLine of [...calls].sort((a, b) => a - b)) {
    // 该调用行所在语句（可能跨行取到下一个顶层语句结束）
    const stmt = lines[callLine - 1]
    // 找出这一行里所有 `() => NAME` 形态的惰性 getter
    for (const m of stmt.matchAll(/\(\s*\)\s*=>\s*([A-Za-z_$][\w$]*)/g)) {
      const name = m[1]
      const declLine = decls.get(name)
      if (declLine === undefined) continue // 非顶层声明（import 的函数等）
      if (declLine < callLine) continue
      violations.push(
        `${name}：声明在第 ${declLine} 行，却出现在第 ${callLine} 行的 composable 调用里` +
        `（\`${stmt.trim().slice(0, 60)}\`）`
      )
    }
  }
  assert.deepEqual(
    violations, [],
    '以下变量声明晚于把它传入 composable 的调用 —— composable 可能在初始化期就调用该 getter，' +
      'setup 期会命中暂时性死区导致白屏（2026-10-06 真实事故）。\n  ' + violations.join('\n  ') +
      '\n修法：把声明上移到调用之前。'
  )
})

test('指针用例：usePrefs 必须暴露 syncZoomToEditor（缩放恢复不得依赖初始化期求值）', () => {
  // syncZoomToEditor 是「编辑器就绪后补一次缩放」的显式入口。
  // 若将来有人把缩放恢复改回 applyZoom 在构造期读 getter，本用例会先提醒。
  const prefsSrc = readFileSync(
    new URL('../src/composables/usePrefs.js', import.meta.url), 'utf8'
  )
  assert.ok(
    /export function usePrefs/.test(prefsSrc) && /syncZoomToEditor/.test(prefsSrc),
    'usePrefs 不再暴露 syncZoomToEditor —— 请确认缩放恢复不会在初始化期读 editor'
  )
})

// ===========================================================================
// 通用 TDZ（第二处真实事故 openFile 的类别，含 if 块内的对象/数组字面量）
// ===========================================================================

test('通用读取点：DEV 调试块里的 openFile/openTreeFile 被识别（当前顺序合法）', () => {
  const r = checkTdz(SOURCE, { file: 'App.vue' })
  const names = r.readSites.map((s) => s.name)
  assert.ok(
    names.includes('openFile') && names.includes('openTreeFile'),
    `通用读取点没识别到 openFile/openTreeFile，解析器可疑：${JSON.stringify(names)}`
  )
  assert.deepEqual(r.violations, [], 'App.vue 存在通用 TDZ 违规（声明晚于立即读取点）')
})

test('变异自证（红·通用）：DEV 块挪到 useFileOps 之前必须指名 openFile/openTreeFile 与两处行号', (t) => {
  const mutated = moveDevBlockBeforeFileOps(SOURCE)
  const r = checkTdz(mutated, { file: 'App.vue' })
  const names = r.violations.map((v) => v.name)
  if (!names.includes('openFile')) t.diagnostic('变异后未报 openFile，通用守卫漏报：' + JSON.stringify(names))
  assert.ok(names.includes('openFile'), '通用守卫必须抓到 openFile 的 TDZ（第二处白屏事故）')
  assert.ok(names.includes('openTreeFile'), '通用守卫必须抓到 openTreeFile 的 TDZ')
  const v = r.violations.find((x) => x.name === 'openFile')
  assert.equal(v.kind, 'tdz-generic')
  assert.ok(v.declLine > v.callLine, `声明行 ${v.declLine} 应晚于读取行 ${v.callLine}`)
  assert.match(v.message, /openFile/)
  assert.ok(v.message.includes(String(v.declLine)), '文案必须含声明行号')
  assert.ok(v.message.includes(String(v.callLine)), '文案必须含读取点行号')
})

test('合成用例（通用）：对象字面量立即读取后声明的 const 必须报红', () => {
  const src = '<script setup>\nconst cfg = { value: later }\nconst later = 1\n</script>'
  const r = checkTdz(src, { file: 'x.vue' })
  const v = r.violations.find((x) => x.name === 'later')
  assert.ok(v, '对象字面量立即读取后声明 const 必须报红')
  assert.equal(v.kind, 'tdz-generic')
})

test('合成用例（通用）：getter / 箭头体内的读取视为惰性、不报红', () => {
  const src = [
    '<script setup>',
    'const cfg = { get value() { return later }, lazy: () => later }',
    'const later = 1',
    '</script>',
  ].join('\n')
  const r = checkTdz(src, { file: 'x.vue' })
  assert.deepEqual(r.violations, [])
})
