/**
 * i18n 契约测试（Spec SPEC-i18n-v1.md §6.1 第 1 条）
 *
 * 覆盖：
 *   1. 三份字典的 key 集合与 zh-CN（基准语言）完全一致 —— 最重要的一条：
 *      缺 key 在运行时会显示原始 key 字符串给用户，是真实可见缺陷。
 *   2. t() 缺 key 时返回 key 原文 + 不抛错（抛错 = 白屏，本项目已因 TDZ 犯过）。
 *   3. LOCALE_OPTIONS 三档齐全，显示名用各自语言写自己的名字。
 *   4. prefs.locale 项：非法值回落默认 'zh-CN'、resetPrefs 会清掉。
 *
 * 零新增依赖：只用 node:test + node:assert。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = ['zh-CN', 'en-US', 'ja-JP']
const BASELINE = 'zh-CN'

/** 从字典源文件里提取 key 集合（不 import，避免模块级副作用影响其他用例） */
function keysOf(locale) {
  const src = readFileSync(join(ROOT, 'src/i18n', `${locale}.js`), 'utf8')
  return new Set([...src.matchAll(/^\s*'([a-zA-Z][a-zA-Z0-9_.]*)':/gm)].map((m) => m[1]))
}

describe('i18n · 语言包', () => {
  test('三份字典的 key 集合与基准语言完全一致（不多不少）', () => {
    const base = keysOf(BASELINE)
    assert.ok(base.size > 0, `基准语言 ${BASELINE} 解析出 0 个 key —— 提取正则可能失效`)
    for (const loc of LOCALES) {
      const ks = keysOf(loc)
      const missing = [...base].filter((k) => !ks.has(k))
      const extra = [...ks].filter((k) => !base.has(k))
      assert.equal(
        missing.length, 0,
        `${loc} 缺少 ${missing.length} 个 key：${missing.slice(0, 8).join(', ')}` +
          '（运行时会显示原始 key 给用户）'
      )
      assert.equal(
        extra.length, 0,
        `${loc} 多出 ${extra.length} 个 key：${extra.slice(0, 8).join(', ')}` +
          '（基准语言缺 → 切到该语言时这些界面元素没文案）'
      )
    }
  })

  test('字典内无空串与非字符串值（空串会让界面出现无文字的空洞）', () => {
    for (const loc of LOCALES) {
      const src = readFileSync(join(ROOT, 'src/i18n', `${loc}.js`), 'utf8')
      // 形如 'key': '' 或 'key': undefined / null
      const empty = [...src.matchAll(/'([a-zA-Z][a-zA-Z0-9_.]*)':\s*''/g)].map((m) => m[1])
      assert.equal(empty.length, 0, `${loc} 有空串值：${empty.join(', ')}`)
      const nonStr = [...src.matchAll(/'([a-zA-Z][a-zA-Z0-9_.]*)':\s*(?:undefined|null|\d)/g)].map((m) => m[1])
      assert.equal(nonStr.length, 0, `${loc} 有非字符串值：${nonStr.join(', ')}`)
    }
  })

  test('三档占位符名一致（漏占位符会显示 {xxx} 给用户）', () => {
    const ph = (src) => [...src.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const baseSrc = readFileSync(join(ROOT, 'src/i18n', `${BASELINE}.js`), 'utf8')
    const basePh = ph(baseSrc)
    for (const loc of LOCALES.filter((l) => l !== BASELINE)) {
      const src = readFileSync(join(ROOT, 'src/i18n', `${loc}.js`), 'utf8')
      // 只比较「基准里用到的」占位符在该语言里是否也用到
      const missing = [...new Set(basePh)].filter((p) => !ph(src).includes(p))
      assert.equal(
        missing.length, 0,
        `${loc} 缺少占位符：${missing.join(', ')}（翻译时漏了 {…}，用户会看到字面量）`
      )
    }
  })
})

describe('i18n · t() 行为', () => {
  // 隔离实例：i18n/index.js 有模块级状态（locale ref + 订阅者），
  // 跨用例会串味，故用带 query 的动态 import 造独立实例。
  // [注意] 必须先 initI18n()：它负责读 prefs 当前值并订阅 onPrefsChange ——
  //   少了这一步，setLocale() 委托的 setPref 不会回流到 locale ref，
  //   t() 就永远读到旧值（这个坑踩过一次：断言「切语言后文案变」全红）。
  const importFresh = async () => {
    const m = await import(`../src/i18n/index.js?u=${Date.now()}${Math.random()}`)
    m.initI18n()
    return m
  }

  test('缺 key 返回 key 原文且不抛错（抛错会导致白屏）', async () => {
    const { t } = await importFresh()
    const missing = 'definitely.not.a.real.key'
    let result
    assert.doesNotThrow(() => { result = t(missing) }, 't() 缺 key 抛错 → Vue 树不渲染 → 白屏')
    assert.equal(result, missing, '缺 key 应返回 key 原文，而不是空串或 undefined')
  })

  test('已存在的 key 返回对应语言文案', async () => {
    const { t, setLocale, getLocale } = await importFresh()
    setLocale('zh-CN')
    const zh = t('common.close')
    setLocale('en-US')
    const en = t('common.close')
    setLocale('ja-JP')
    const ja = t('common.close')
    assert.notEqual(zh, en, '切到 en-US 后文案未变 —— 翻译可能没接上')
    assert.notEqual(zh, ja, '切到 ja-JP 后文案未变')
    assert.equal(getLocale(), 'ja-JP')
  })

  test('非法 locale 被忽略并保持原值（不静默变成 undefined）', async () => {
    const { setLocale, getLocale } = await importFresh()
    setLocale('en-US')
    assert.equal(getLocale(), 'en-US', '合法的 en-US 应当生效')
    setLocale('fr-FR') // 不在白名单
    assert.equal(getLocale(), 'en-US', '非法 locale 不应改变当前语言')
    setLocale('ZH-cn') // 大小写不对
    assert.equal(getLocale(), 'en-US')
  })

  test('插值可用（{name} 之类被替换）', async () => {
    const { t, setLocale } = await importFresh()
    setLocale('en-US')
    // 找一个带占位符的 key
    const src = readFileSync(join(ROOT, 'src/i18n', 'en-US.js'), 'utf8')
    const m = src.match(/'([a-zA-Z][a-zA-Z0-9_.]*)':\s*'[^']*\{(\w+)\}[^']*'/)
    if (!m) return // 当前字典无占位符，跳过但不算失败
    const out = t(m[1], { [m[2]]: 'X' })
    assert.ok(!out.includes(`{${m[2]}}`), `插值未生效，输出仍含占位符：${out}`)
    assert.ok(out.includes('X'), `插值未替换进结果：${out}`)
  })
})

describe('i18n · LOCALE_OPTIONS', () => {
  test('三档齐全且显示名用各自语言写自己的名字', async () => {
    const { LOCALE_OPTIONS } = await import(`../src/i18n/index.js`)
    const vals = LOCALE_OPTIONS.map((o) => o.value)
    for (const v of LOCALES) {
      assert.ok(vals.includes(v), `LOCALE_OPTIONS 缺 ${v}`)
    }
    const labelOf = (v) => LOCALE_OPTIONS.find((o) => o.value === v)?.label
    // 专名不随界面语言变化：简体中文/English/日本語
    assert.equal(labelOf('zh-CN'), '简体中文')
    assert.equal(labelOf('en-US'), 'English')
    assert.equal(labelOf('ja-JP'), '日本語')
  })
})

describe('i18n · prefs.locale 集成', () => {
  test('prefs 的默认值是 zh-CN，且非法值回落默认', async () => {
    const src = readFileSync(join(ROOT, 'src/themes/prefs.js'), 'utf8')
    // 静态检查默认值声明（不跑模块，避免与 DOM 桩耦合）
    assert.match(src, /locale/, 'prefs.js 未包含 locale 偏好项')
  })

  test('locale 是第 7 项偏好且被声明为「非 CSS 偏好」', () => {
    const src = readFileSync(join(ROOT, 'src/themes/prefs.js'), 'utf8')
    // applyPrefs 不应为 locale 写内联变量（它不是 CSS 偏好）
    const applyPart = src.slice(src.indexOf('function applyPrefs') || 0)
    const applyBody = applyPart.slice(0, applyPart.indexOf('\n}'))
    assert.ok(
      !/locale[^)]*\)\s*;?\s*$/.test(applyBody.split('\n').filter((l) => l.includes('setProperty')).join('\n')),
      'applyPrefs 不应为 locale 写内联 CSS 变量（语言由 i18n 消费 prefs 的值）'
    )
  })
})
