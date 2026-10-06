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
  const start = lines.findIndex((l) => l.includes('useFileOps({'))
  const end = lines.findIndex((l, i) => i > start && l.trim() === '})')
  assert.ok(start > -1 && end > start, '定位 useFileOps({...}) 范围失败，变异脚本失效')
  lines.splice(end + 1, 0, removed)
  return lines.join('\n')
}

/** 把 askInput 注入改成惰性包装（Spec §1.2 的修法 B）。 */
function lazyWrapAskInput(source) {
  const out = source.replace(
    /\n(\s*)askInput,/,
    '\n$1askInput: (...a) => askInput(...a),'
  )
  assert.notEqual(out, source, 'askInput 注入点没被替换到，变异脚本失效')
  return out
}

/** 把整个 `if (import.meta.env.DEV) {...}` 调试块挪到 useFileOps({...}) 之前。 */
function moveDevBlockBeforeFileOps(source) {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l.includes('if (import.meta.env.DEV) {'))
  assert.ok(start > -1, '找不到 DEV 调试块，变异脚本失效')
  let depth = 0
  let end = -1
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth-- }
    if (depth === 0 && i > start) { end = i; break }
  }
  assert.ok(end > start, '定位 DEV 块范围失败，变异脚本失效')
  const block = lines.slice(start, end + 1)
  const rest = lines.slice(0, start).concat(lines.slice(end + 1))
  const target = rest.findIndex((l) => l.includes('= useFileOps({'))
  assert.ok(target > -1, '定位 useFileOps({...}) 失败，变异脚本失效')
  return rest.slice(0, target).concat(block, rest.slice(target)).join('\n')
}

test('真实 App.vue：useXxx 注入顺序全部合法（守卫本体）', (t) => {
  const r = checkTdz(SOURCE, { file: 'App.vue' })
  // 先质疑解析器：确认真的解析到了调用与注入，而不是「零结果」蒙混过关
  const names = r.calls.map((c) => c.name)
  for (const want of ['useDocumentPersistence', 'useOutlineSync', 'useDialog', 'useFileOps', 'useShortcutsHelp']) {
    assert.ok(names.includes(want), `没解析到 ${want} 调用，解析器可能坏了：${names}`)
  }
  const fileOps = r.calls.find((c) => c.name === 'useFileOps')
  assert.ok(fileOps.injections.length >= 10, `useFileOps 只解析到 ${fileOps.injections.length} 个注入，可疑`)
  assert.ok(r.injections.some((i) => i.name === 'askInput'), '没抓到 askInput 注入，守卫形同虚设')
  assert.ok(r.injections.length >= 15, `全文件只解析到 ${r.injections.length} 个立即读取注入，可疑`)
  if (r.violations.length) t.diagnostic(r.violations.map((v) => v.message).join('\n'))
  assert.deepEqual(r.violations, [], 'App.vue 存在声明晚于调用的注入（TDZ / 白屏风险）')
})

test('惰性包装豁免：getEditor: () => editor 不参与判定、不误报', () => {
  const r = checkTdz(SOURCE, { file: 'App.vue' })
  const fileOps = r.calls.find((c) => c.name === 'useFileOps')
  // getEditor 在源里是 `getEditor: () => editor`，应被识别为 lazy 并排除出立即读取清单
  const lazy = fileOps.injections.find((i) => i.key === 'getEditor')
  assert.ok(lazy, '没解析到 getEditor 注入')
  assert.equal(lazy.kind, 'lazy', 'getEditor 应被识别为惰性包装')
  assert.ok(!r.injections.some((i) => i.key === 'getEditor'), 'getEditor 被误判为立即读取')
  assert.ok(!r.injections.some((i) => i.name === 'editor'), 'editor 被误判为注入依赖')
})

test('function 声明豁免：提升让其声明虽在后也不报红', () => {
  const r = checkTdz(SOURCE, { file: 'App.vue' })
  // syncAfterDocReplace 是函数声明，声明在后面，但被前面的 useDocumentPersistence 注入
  const rec = r.injections.find((i) => i.name === 'syncAfterDocReplace')
  assert.ok(rec, '没解析到 syncAfterDocReplace 注入')
  assert.equal(rec.declKind, 'function')
  // 动态定位调用点，不写死行号：写死会在任何人往 App.vue 顶部加一行 import
  // 时把测试打红，而它红的原因与「函数声明是否正确豁免」毫无关系
  // （本项目已因此踩过：加一行 import → 160 变 161 → 只能靠合并 import 顶回去）。
  const fileOpsCall = SOURCE.indexOf('useDocumentPersistence(')
  const realCallLine = SOURCE.slice(0, fileOpsCall).split('\n').length
  assert.equal(rec.callLine, realCallLine,
    `callLine 应等于 useDocumentPersistence( 的真实行号 ${realCallLine}；` +
    '若不一致说明解析器定位错了，那才是真问题')
  assert.ok(rec.declLine > rec.callLine, '该用例应覆盖「声明在后」的场景，否则豁免没被检验')
  assert.ok(!r.violations.some((v) => v.name === 'syncAfterDocReplace'), '函数声明豁免失效，误报了')
  // showToast 同理（函数声明注入给 useDocumentPersistence）
  const toast = r.injections.find((i) => i.name === 'showToast')
  assert.equal(toast.declKind, 'function')
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

// ---- 通用 TDZ（第二处真实事故 openFile 的类别，含 if 块内的对象/数组字面量） ----

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
