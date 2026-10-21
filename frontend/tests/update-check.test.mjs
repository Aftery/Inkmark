/**
 * update-check.test.mjs — 「检查更新」的可用性契约
 * ---------------------------------------------------------------------------
 * 【这个文件为什么存在：功能是"写了但用户看不到"】
 * 实现（Go 侧 HTTP + semver 比较、前端三类分支）早就完整，但点按钮**看不到任何
 * 反馈**，观感就是"检查更新不能用"。根因不是网络也不是代码逻辑，而是两条：
 *
 *   ① 结果只走全局 toast，而 toast 的 z-index(1300) **低于**弹层遮罩(1400) ——
 *      从「关于」弹层里触发的提示被自己的遮罩压在下面。
 *   ② 失败文案取 Go 的 Note（中文硬编码），English / 日本語 用户看到中文，
 *      与 SPEC-i18n-v1「用户可见文案一律走 t()」冲突。
 *
 * 故这里守三件事：结果必须**就地可见**、文案必须**按 reason 走字典**、
 * 三语 key 必须齐（漏一个就是某语种露出中文或 key 原文）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const aboutSrc = read('src/components/AboutDialog.vue')
const shellCss = read('src/themes/app-shell.css')

/** 从 CSS 里取某选择器的 z-index 数值 */
function zIndexOf(css, selector) {
  const i = css.indexOf(selector)
  assert.ok(i >= 0, `样式表里找不到 ${selector}（判据锚点缺失，结论不可采信）`)
  const block = css.slice(i, css.indexOf('}', i))
  const m = /z-index:\s*(\d+)/.exec(block)
  assert.ok(m, `${selector} 没有 z-index 声明`)
  return Number(m[1])
}

describe('检查更新 · 结果必须就地可见（而不是被自己弹层的遮罩压住）', () => {
  test('前提核实：toast 层级确实低于弹层遮罩（这就是"点了没反应"的根因）', () => {
    const toast = zIndexOf(shellCss, '.focus-toast {')
    const mask = zIndexOf(shellCss, '.dialog-mask {')
    assert.ok(
      toast < mask,
      `前提变了：toast(${toast}) 不再低于遮罩(${mask})，` +
        '本文件的用例与 AboutDialog 的就地反馈注释需要一起复核',
    )
  })

  test('关于弹层必须把结果渲染在弹层内（不能只靠全局 toast）', () => {
    // 判据：模板里存在绑定到 status 的就地反馈节点，且有 role=status 供读屏
    assert.match(aboutSrc, /v-if="status"/, '缺少就地结果节点')
    assert.match(aboutSrc, /role="status"/, '就地结果必须带 role="status"（读屏要能读到）')
    assert.match(aboutSrc, /class="about-status"/, '就地结果必须有样式类')
    // 位置要在动作按钮之前 —— 否则会被按钮行推到弹层边缘外
    const statusPos = aboutSrc.indexOf('class="about-status"')
    const actionsPos = aboutSrc.indexOf('class="dialog-actions"')
    assert.ok(statusPos > 0 && actionsPos > 0, '两处锚点都必须存在')
    assert.ok(statusPos < actionsPos, '结果行必须在按钮行之前（视觉上紧跟版本信息）')
  })

  test('检查中要禁用按钮（防连点并发发起多个 5s 超时请求）', () => {
    assert.match(aboutSrc, /:disabled="checking"/, '按钮缺少 checking 禁用绑定')
    assert.match(aboutSrc, /checking\.value = true/, '缺少进入检查态的赋值')
    assert.match(aboutSrc, /checking\.value = false/, '缺少退出检查态的复位')
  })
})

describe('检查更新 · 文案必须走 i18n（不能把 Go 侧中文 Note 直接显示）', () => {
  test('失败分支按 reason 选字典 key，未知 reason 才退回 note', () => {
    // 5 个稳定 reason 代码必须都在前端映射里（漏一个就等于漏一种语言的提示）
    for (const reason of ['no_release', 'network', 'server', 'parse', 'version']) {
      assert.ok(
        aboutSrc.includes(`${reason}:`),
        `AboutDialog 未映射 reason「${reason}」—— 该情形会退回中文 note`,
      )
    }
    assert.match(aboutSrc, /reasonText\(info\.reason\)/, '失败分支必须优先用 reason 选文案')
    assert.match(
      aboutSrc,
      /localized \|\| info\.note \|\|/,
      '未知 reason 时应退回 note / 通用文案，而不是显示空白',
    )
  })

  test('成功两态（update / latest）也必须走 t()', () => {
    assert.match(aboutSrc, /t\('toast\.newVersion'/, '发现新版本必须走字典')
    assert.match(aboutSrc, /t\('toast\.alreadyLatest'/, '已是最新必须走字典')
  })

  test('三语字典必须同 key 集（含新增的 reason 文案与"检查中"）', async () => {
    const locales = ['zh-CN', 'en-US', 'ja-JP']
    const dicts = {}
    for (const loc of locales) {
      const mod = await import(`../src/i18n/${loc}.js`)
      dicts[loc] = mod.default
    }
    const required = [
      'about.checkUpdate', 'about.checking',
      'toast.checkUpdateFailed', 'toast.newVersion', 'toast.alreadyLatest',
      'toast.updateUnavailable', 'toast.updateNoRelease', 'toast.updateNetwork',
      'toast.updateServer', 'toast.updateParse', 'toast.updateBadVersion',
    ]
    for (const key of required) {
      for (const loc of locales) {
        assert.ok(
          typeof dicts[loc][key] === 'string' && dicts[loc][key].length > 0,
          `${loc} 缺文案 ${key}`,
        )
      }
    }
    // 三语 key 集合必须完全一致（多/少都算漂移，由既有 i18n.test 守总集；
    // 这里只固定本轮新增的这组，防止只补了一两种语言）
    for (const loc of ['en-US', 'ja-JP']) {
      const missing = Object.keys(dicts['zh-CN']).filter((k) => !(k in dicts[loc]))
      assert.deepEqual(missing, [], `${loc} 相对 zh-CN 缺 key：${missing.join(', ')}`)
    }
  })
})

describe('检查更新 · Go 侧契约（reason 代码 + 诚实降级）', () => {
  const goSrc = read('../app.go')

  test('UpdateInfo 必须带稳定 reason 字段（界面本地化靠它，不靠中文 note）', () => {
    assert.match(goSrc, /Reason\s+string\s+`json:"reason"`/, 'UpdateInfo 缺 reason 字段')
  })

  test('每条**失败**路径都要写 reason（漏一条就会退回中文 note）', () => {
    // 只数 status="error" 的路径：成功两态（update / latest）有 Note 但不需要
    // reason，把它们算进来会让判据变成「永远对不上」的假规则。
    const blocks = goSrc.split('info.Note = ').slice(1)
    // 失败 Note 有两种写法：字面量 "无法检查更新：…" 与 fmt.Sprintf("无法检查更新：… %d")
    const isFailure = (b) => b.startsWith('"无法检查更新') || b.startsWith('fmt.Sprintf("无法检查更新')
    const failures = blocks.filter(isFailure)
    const successes = blocks.filter((b) => !isFailure(b))
    const reasonWrites = goSrc.match(/info\.Reason = /g) || []
    assert.ok(failures.length > 0, '判据失效：没找到任何失败 Note')
    assert.equal(
      reasonWrites.length,
      failures.length,
      `失败 Note 与 Reason 必须一一对应（失败 ${failures.length} / Reason ${reasonWrites.length}）`,
    )
    // 成功两态（update / latest）有 Note 但不需要 reason —— 也确认它们没被误塞
    assert.equal(successes.length, 2, '成功态应有两条（update / latest）')
  })

  test('仓库无 Release（404）必须走 no_release，且绝不谎报「已是最新」', () => {
    assert.match(goSrc, /StatusNotFound[\s\S]{0,200}no_release/, '404 分支必须是 no_release')
    // 三态里只有 200 且比出版本差才允许 latest —— 这条守「查不到 ≠ 已是最新」
    assert.match(goSrc, /info\.Status = "latest"/, '缺少 latest 分支')
    const latestIdx = goSrc.indexOf('info.Status = "latest"')
    const compareIdx = goSrc.indexOf('compareSemver(lat, cur) > 0')
    assert.ok(
      compareIdx > 0 && compareIdx < latestIdx,
      '"latest" 必须出现在 semver 比较之后（否则会把"查不到"当"已是最新"）',
    )
  })
})
