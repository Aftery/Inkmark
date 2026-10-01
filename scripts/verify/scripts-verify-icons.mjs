// 图标采集核验：把 docs/design/phaseC-visual-spec.md 附录 A 的 verbatim 内层标记
// 与 frontend/src/components/icons/paths.js 的 ICONS 登记值逐字比对（归一空白），
// 并统计每个图标的元素数。零输出差异 = 逐字一致。
import { readFileSync } from 'node:fs'

const spec = readFileSync(
  new URL('./docs/design/phaseC-visual-spec.md', import.meta.url),
  'utf8'
)
const pathsSrc = readFileSync(
  new URL('./frontend/src/components/icons/paths.js', import.meta.url),
  'utf8'
)

// 从附录 A 代码块提取 "name: '...'" 条目
const appendixBlock = spec.split('## 附录 A')[1].split('```js')[1].split('```')[0]
const appendix = {}
for (const m of appendixBlock.matchAll(/'([a-z0-9-]+)':\s*'((?:[^'\\]|\\.)*)'/g)) {
  appendix[m[1]] = m[2]
}

// 从 paths.js 提取 ICONS 对象条目（同名键，值单引号字符串）
const iconsBlock = pathsSrc.split('export const ICONS = {')[1].split('\n}')[0]
const registered = {}
for (const m of iconsBlock.matchAll(/'?([a-z0-9-]+)'?:\s*\n?\s*'((?:[^'\\]|\\.)*)'/g)) {
  registered[m[1]] = m[2]
}

const EXPECT = ['pen-line','sun-moon','monitor','newspaper','bold','italic','strikethrough','code','heading','quote','list','list-ordered','list-todo','link','image','square-code','table','minus','undo-2','redo-2','ellipsis','circle-check','loader','circle-dot']

const norm = (s) => s.replace(/\s+/g, ' ').trim()

let pass = 0, fail = 0
console.log('图标'.padEnd(14), '元素数  附录A vs paths.js')
for (const name of EXPECT) {
  const a = appendix[name]
  const r = registered[name]
  if (a === undefined) { console.log(`${name.padEnd(14)} ✗ 附录A 中不存在`); fail++; continue }
  if (r === undefined) { console.log(`${name.padEnd(14)} ✗ paths.js 未登记`); fail++; continue }
  const same = norm(a) === norm(r)
  const elemCount = (r.match(/<(path|circle|rect|line)\b/g) || []).length
  console.log(`${name.padEnd(14)} ${String(elemCount).padStart(3)}     ${same ? 'OK 逐字一致' : 'FAIL 不一致'}`)
  if (!same) {
    fail++
    console.log('   附录A :', norm(a))
    console.log('   paths :', norm(r))
  } else pass++
}

// 复用项不重复登记检查
for (const reuse of ['sun', 'moon', 'panel-left-close', 'panel-left-open', 'x']) {
  const count = [...iconsBlock.matchAll(new RegExp(`\\b'?(?:${reuse})'?:`, 'g'))].length
  console.log(`复用项 ${reuse}: ICONS 登记次数 = ${count > 0 ? count : '(既有，未重复)'}`)
}

console.log(`\n结果: ${pass}/${EXPECT.length} 逐字一致, ${fail} 失败`)
process.exit(fail ? 1 : 0)
