// theme.js 优先级逻辑自检（node 环境，模拟 localStorage / matchMedia / document）
// 覆盖：缺省 system、跟随系统实时变化、手动覆盖停止跟随、恢复跟随、
//       非法偏好忽略、data-theme 永不存 system、监听订阅/退订。
import assert from 'node:assert'

// ---- 环境桩 ----
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

let systemDark = false
const mediaListeners = []
globalThis.window = {
  matchMedia: () => ({
    get matches() { return systemDark },
    addEventListener: (_t, cb) => mediaListeners.push(cb),
    addListener: (cb) => mediaListeners.push(cb),
  }),
}
const htmlEl = { dataset: {} }
globalThis.document = { documentElement: htmlEl }

const theme = await import('./frontend/src/themes/theme.js')

// 模拟 main.js 挂载前的初始化
theme.initTheme()

let fired = []
const unsub = theme.onThemeChange((t) => fired.push(t))

// 1. 缺省偏好 → system → 系统浅色 → light
assert.strictEqual(theme.getPreference(), 'system')
assert.strictEqual(theme.getTheme(), 'light')
assert.strictEqual(htmlEl.dataset.theme, 'light')
console.log('1. 无偏好(缺省system) + 系统浅色        -> data-theme=light, getTheme=light, pref=system  OK')

// 2. 系统切深色（偏好仍为 system）→ 跟随变 dark
systemDark = true
mediaListeners.forEach((cb) => cb())
assert.strictEqual(theme.getTheme(), 'dark')
assert.strictEqual(htmlEl.dataset.theme, 'dark')
assert.strictEqual(localStorage.getItem('inkmark-theme'), null, '跟随系统不写入偏好')
console.log('2. system 偏好下系统切深色              -> data-theme=dark，localStorage 未写入      OK')

// 3. 手动覆盖 paper → 停止跟随
fired = []
theme.setPreference('paper')
assert.strictEqual(theme.getTheme(), 'paper')
assert.strictEqual(htmlEl.dataset.theme, 'paper')
assert.strictEqual(theme.getPreference(), 'paper')
systemDark = false
mediaListeners.forEach((cb) => cb())
assert.strictEqual(htmlEl.dataset.theme, 'paper', '手动覆盖后系统变化不得影响')
assert.strictEqual(fired.length, 1, 'paper 设置时通知 1 次，系统变化不再通知')
console.log('3. setPreference(paper) 后系统切浅色     -> data-theme 仍为 paper（手动覆盖>跟随）    OK')

// 4. setPreference(light/dark) 直落具体值
theme.setPreference('dark')
assert.strictEqual(htmlEl.dataset.theme, 'dark')
console.log('4. setPreference(dark)                  -> data-theme=dark                            OK')

// 5. 恢复 system → 重新跟随
theme.setPreference('system')
systemDark = true
mediaListeners.forEach((cb) => cb())
assert.strictEqual(htmlEl.dataset.theme, 'dark')
assert.strictEqual(theme.getPreference(), 'system')
console.log('5. setPreference(system) 恢复跟随        -> 系统深色下 data-theme=dark                 OK')

// 6. 非法偏好静默忽略
const before = htmlEl.dataset.theme
const ret = theme.setPreference('banana')
assert.strictEqual(htmlEl.dataset.theme, before)
assert.strictEqual(ret, 'system')
console.log('6. setPreference(非法值)                -> 静默忽略，返回当前偏好                      OK')

// 7. onThemeChange 退订后不再通知
unsub()
fired = []
theme.setPreference('light')
assert.strictEqual(fired.length, 0)
console.log('7. onThemeChange 退订                   -> 退订后回调不再触发                         OK')

// 8. getTheme / data-theme 永不为 'system'
assert.notStrictEqual(theme.getTheme(), 'system')
assert.notStrictEqual(htmlEl.dataset.theme, 'system')
console.log('8. data-theme / getTheme 永不存 system   OK')

console.log('\n全部 8 项断言通过')
