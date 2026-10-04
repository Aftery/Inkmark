/**
 * prefs.test.mjs — 用户排版/编辑器偏好的行为回归网（QA 独占）
 * ---------------------------------------------------------------------------
 * 被测对象：frontend/src/themes/prefs.js（零依赖 ESM，用户偏好唯一真源）
 * 契约来源：docs/spec/SPEC-engineering-baseline-v1.md §4.1（9 组要点）+ §6 AC-01/AC-02
 *
 * 【测试纪律】
 *  1. **import 真实模块**，不复制实现逻辑到测试里。所有期望值要么来自
 *     Spec/源码里已声明的契约常量（PREFS_DEFAULTS / PREF_OPTIONS），
 *     要么是 Spec §4.1 表格里写明的字面量 —— 绝不"跑一遍实现拿它的输出当期望"
 *     （那是同义测试，绿灯零信息量）。
 *  2. **每个用例用带 query 的动态 import** 拿独立模块实例，因为 prefs.js 有模块级
 *     可变状态（memoryStore / useMemory / listeners），静态 import 会跨用例串味。
 *  3. 断言打在**调用序列**上（stub 记录的 calls），而不只是最终 store 态 ——
 *     "顺序错了"和"压根没调"是两类 bug，只看 store 态会漏掉前者。
 */

import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  installEnv,
  importFresh,
  opsFor,
  setKeys,
  removedKeys,
  STORAGE_KEY,
  MANAGED_VARS,
  FORBIDDEN_VARS,
} from './helpers/dom-stub.js'

// [注意] 必须是绝对 URL：importFresh 在 helpers/dom-stub.js 里执行动态 import，
// 传相对字符串会相对 helpers/ 解析（→ tests/src/themes/prefs.js，不存在）。
const PREFS = new URL('../src/themes/prefs.js', import.meta.url)

/** 装好 stub 再 import 真实模块 —— 顺序要求见 tests/README.md */
async function loadPrefs(opts = {}, tag = 'default') {
  const env = installEnv(opts)
  const mod = await importFresh(PREFS, tag)
  return { ...mod, env }
}

// ===========================================================================
describe('组 1 · 默认态：出厂默认落到内联变量的形态', () => {
  test('默认态必须 remove --font-body-user（system 档交还主题决定，不写内联字体）', async () => {
    const { initPrefs, env } = await loadPrefs({}, 'default-state')
    initPrefs()
    const ops = opsFor(env.calls, '--font-body-user')
    assert.equal(ops.length, 1, '应当恰好一次 --font-body-user 操作')
    assert.equal(ops[0].op, 'remove', '默认 system 档走 removeProperty，不得写死字栈')
  })

  test('默认态 --text-base 与 --text-md 必须都被 set 且值相等（C2 不变量）', async () => {
    const { initPrefs, env, PREFS_DEFAULTS } = await loadPrefs({}, 'default-size')
    initPrefs()
    const base = opsFor(env.calls, '--text-base')
    const md = opsFor(env.calls, '--text-md')
    assert.equal(base.length, 1, '--text-base 应被 set 一次')
    assert.equal(md.length, 1, '--text-md 应被 set 一次')
    assert.equal(base[0].op, 'set')
    assert.equal(md[0].op, 'set')
    assert.equal(
      base[0].value,
      md[0].value,
      'C2：编辑区与预览区字号必须同值，否则左右两栏文字错位'
    )
    // 期望值来自源码里的默认档位换算表，不来自本次运行结果
    assert.equal(PREFS_DEFAULTS.fontSize, 15)
    assert.equal(base[0].value, '0.9375rem', '15px = 0.9375rem（1rem=16px 基准）')
  })

  test('默认态 --leading-* / --preview-measure / --reading-measure 走 remove（交还主题）', async () => {
    const { initPrefs, env } = await loadPrefs({}, 'default-leading')
    initPrefs()
    for (const key of [
      '--leading-body',
      '--leading-reading',
      '--preview-measure',
      '--reading-measure',
    ]) {
      const ops = opsFor(env.calls, key)
      assert.equal(ops.length, 1, `${key} 应恰好被操作一次`)
      assert.equal(
        ops[0].op,
        'remove',
        `${key}：standard 档必须 removeProperty，否则通用默认值会压掉 paper 主题的刻意调校`
      )
    }
  })

  test('默认态只有字号两个变量留在 store，其余 5 个受管变量必须被 remove', async () => {
    const { initPrefs, env } = await loadPrefs({}, 'default-clean')
    initPrefs()
    // 注意：--text-base / --text-md 在默认态是 **set** 而非 remove ——
    // 默认字号 15px 是一个真实取值，必须落成内联（编辑区/预览区都要读到它），
    // 否则首帧字号会掉回样式表的值而抖动。所以「默认态 store 为空」是错的期望。
    assert.deepEqual(
      [...env.store.keys()].sort(),
      ['--text-base', '--text-md'],
      `默认态应恰好只留字号两个变量，实际: ${[...env.store.keys()]}`
    )
    for (const v of ['--font-body-user', '--leading-body', '--leading-reading', '--preview-measure', '--reading-measure']) {
      assert.equal(env.store.has(v), false, `${v} 在默认态应被 remove，不应残留内联值`)
    }
  })
})

// ===========================================================================
describe('组 2 · 核心不变量：--font-body 与 --zoom-scale 全流程零触碰（AC-02）', () => {
  test('initPrefs → 全部 6 档字号 → 全部字体/行距/行宽组合 → resetPrefs 全序列，两变量零触碰', async () => {
    const { initPrefs, setPref, resetPrefs, env, PREF_OPTIONS, PREFS_DEFAULTS } = await loadPrefs(
      {},
      'invariant-full'
    )

    // 走一遍穷举操作序列：每个偏好项的每个合法取值都写一遍
    initPrefs()
    for (const value of PREF_OPTIONS.fontSize) setPref('fontSize', value)
    for (const value of PREF_OPTIONS.fontFamily) setPref('fontFamily', value)
    for (const value of PREF_OPTIONS.lineHeight) setPref('lineHeight', value)
    for (const value of PREF_OPTIONS.measure) setPref('measure', value)
    setPref('autosave', PREF_OPTIONS.autosave[0])
    setPref('snapshot', PREFS_DEFAULTS.snapshot)
    resetPrefs()

    // 断言打在**完整调用序列**上：不是"最终没被设置"，而是"一次都没被碰过"
    for (const forbidden of FORBIDDEN_VARS) {
      const touched = opsFor(env.calls, forbidden)
      assert.deepEqual(
        touched,
        [],
        `${forbidden} 被触碰了: ${JSON.stringify(touched)}（--font-body 属主题/chrome，` +
          `--zoom-scale 与基础字号正交，两者都不属于用户偏好管辖范围）`
      )
      assert.equal(
        env.store.has(forbidden),
        false,
        `${forbidden} 不应出现在最终 store 里`
      )
    }
  })

  test('受管变量面恰为 7 个，且不含 --font-body / --zoom-scale', async () => {
    const { initPrefs, setPref, env } = await loadPrefs({}, 'invariant-surface')
    initPrefs()
    setPref('fontFamily', 'serif')
    setPref('fontSize', 20)
    setPref('lineHeight', 'loose')
    setPref('measure', 'wide')

    const touched = new Set([...setKeys(env.calls), ...removedKeys(env.calls)])
    for (const v of FORBIDDEN_VARS) {
      assert.equal(touched.has(v), false, `${v} 不该出现在受管变量面里`)
    }
    // 被碰过的受管变量应当是 MANAGED_VARS 的子集（不多不少）
    for (const key of touched) {
      assert.ok(
        MANAGED_VARS.includes(key),
        `出现预期外的变量 ${key}， MANAGED_VARS=${JSON.stringify(MANAGED_VARS)}`
      )
    }
  })

  test('正文字体走 --font-body-user（文档作用域）而不是 --font-body', async () => {
    const { setPref, env } = await loadPrefs({}, 'invariant-userfont')
    setPref('fontFamily', 'serif')
    const userOps = opsFor(env.calls, '--font-body-user')
    assert.equal(userOps.length, 1)
    assert.equal(userOps[0].op, 'set', 'serif 档必须写内联字栈到 --font-body-user')
    assert.ok(
      userOps[0].value.includes('Georgia'),
      `serif 字栈应含 Georgia，实际: ${userOps[0].value}`
    )
    assert.equal(opsFor(env.calls, '--font-body').length, 0, '绝不能写 --font-body')
  })
})

// ===========================================================================
describe('组 3 · 字号 6 档换算，且两变量恒等', () => {
  // 期望值直接来自 Spec §4.1 表格「12/14/15/16/18/20px → 0.75/0.875/0.9375/1/1.125/1.25rem」
  const SIX_TIERS = [
    [12, '0.75rem'],
    [14, '0.875rem'],
    [15, '0.9375rem'],
    [16, '1rem'],
    [18, '1.125rem'],
    [20, '1.25rem'],
  ]

  for (const [px, rem] of SIX_TIERS) {
    test(`fontSize: ${px}px 必须换算为 ${rem}，且 --text-base 与 --text-md 同值`, async () => {
      const { setPref, env } = await loadPrefs({}, `size-${px}`)
      setPref('fontSize', px)

      const base = opsFor(env.calls, '--text-base').at(-1)
      const md = opsFor(env.calls, '--text-md').at(-1)
      assert.equal(base.value, rem, `${px}px 应换算为 ${rem}`)
      assert.equal(md.value, rem, `${px}px 应换算为 ${rem}`)
      assert.equal(base.value, md.value, 'C2：两变量必须恒等')
      assert.equal(env.store.get('--text-base'), rem)
      assert.equal(env.store.get('--text-md'), rem)
    })
  }

  test('字号 6 档恰好覆盖 PREF_OPTIONS.fontSize 的全部合法取值', async () => {
    const { PREF_OPTIONS } = await loadPrefs({}, 'size-coverage')
    assert.deepEqual(
      [...PREF_OPTIONS.fontSize].sort((a, b) => a - b),
      SIX_TIERS.map(([px]) => px),
      'PREF_OPTIONS 的字号档位与 Spec §4.1 的 6 档必须一致'
    )
  })

  test('连续切换字号时 --text-base/--text-md 每次都成对出现（无中间态错位）', async () => {
    const { setPref, env } = await loadPrefs({}, 'size-sequence')
    for (const [px] of SIX_TIERS) setPref('fontSize', px)

    const baseOps = opsFor(env.calls, '--text-base')
    const mdOps = opsFor(env.calls, '--text-md')
    assert.equal(baseOps.length, SIX_TIERS.length, '每次切换都要写 --text-base')
    assert.equal(mdOps.length, SIX_TIERS.length, '每次切换都要写 --text-md')
    for (let i = 0; i < baseOps.length; i++) {
      assert.equal(
        baseOps[i].value,
        mdOps[i].value,
        `第 ${i + 1} 次切换时两变量不等，会造成左右两栏错位`
      )
    }
  })
})

// ===========================================================================
describe('组 4 · 行距：compact/loose 成对 set，standard 成对 remove', () => {
  test('lineHeight: compact 必须同时写 --leading-body 与 --leading-reading', async () => {
    const { setPref, env } = await loadPrefs({}, 'lh-compact')
    setPref('lineHeight', 'compact')
    const body = opsFor(env.calls, '--leading-body')
    const reading = opsFor(env.calls, '--leading-reading')
    assert.equal(body.length, 1)
    assert.equal(reading.length, 1)
    assert.equal(body[0].op, 'set')
    assert.equal(reading[0].op, 'set', '阅读态行距必须与正文一起改，否则两栏行距不一致')
    assert.equal(body[0].value, '1.5', 'compact = 1.5')
    assert.equal(body[0].value, reading[0].value, '两档行距必须同值')
  })

  test('lineHeight: loose 必须同时写 --leading-body 与 --leading-reading', async () => {
    const { setPref, env } = await loadPrefs({}, 'lh-loose')
    setPref('lineHeight', 'loose')
    const body = opsFor(env.calls, '--leading-body')
    const reading = opsFor(env.calls, '--leading-reading')
    assert.equal(body[0].op, 'set')
    assert.equal(reading[0].op, 'set')
    assert.equal(body[0].value, '1.9', 'loose = 1.9')
    assert.equal(body[0].value, reading[0].value)
  })

  test('lineHeight: 回 standard 必须把两者同时 remove（交还 paper 主题的 1.8/1.85）', async () => {
    const { setPref, env } = await loadPrefs({}, 'lh-standard')
    setPref('lineHeight', 'loose')
    const mark = env.calls.length
    setPref('lineHeight', 'standard')

    const tail = env.calls.slice(mark)
    const body = tail.filter((c) => c.key === '--leading-body')
    const reading = tail.filter((c) => c.key === '--leading-reading')
    assert.equal(body.length, 1)
    assert.equal(reading.length, 1)
    assert.equal(body[0].op, 'remove', 'standard 必须 removeProperty，不能写 1.7 压掉主题值')
    assert.equal(reading[0].op, 'remove', 'standard 必须 removeProperty')
  })

  test('standard 档不得把 1.7 写进内联（源码注释明写 1.7 仅作基准值文档）', async () => {
    const { setPref, env } = await loadPrefs({}, 'lh-no-17')
    setPref('lineHeight', 'standard')
    for (const c of env.calls) {
      if (c.op === 'set' && c.key.startsWith('--leading-')) {
        assert.notEqual(c.value, '1.7', 'standard 档不应写内联 1.7')
      }
    }
  })
})

// ===========================================================================
describe('组 5 · 行宽：--reading-measure 恒比 --preview-measure 宽 4rem', () => {
  test('measure: narrow → preview 40rem / reading 44rem（差 4rem）', async () => {
    const { setPref, env } = await loadPrefs({}, 'ms-narrow')
    setPref('measure', 'narrow')
    const preview = opsFor(env.calls, '--preview-measure').at(-1)
    const reading = opsFor(env.calls, '--reading-measure').at(-1)
    assert.equal(preview.value, '40rem')
    assert.equal(reading.value, '44rem')
    assert.equal(toRem(reading.value) - toRem(preview.value), 4, '阅读态必须恒比常规宽 4rem')
  })

  test('measure: wide → preview 54rem / reading 58rem（差 4rem）', async () => {
    const { setPref, env } = await loadPrefs({}, 'ms-wide')
    setPref('measure', 'wide')
    const preview = opsFor(env.calls, '--preview-measure').at(-1)
    const reading = opsFor(env.calls, '--reading-measure').at(-1)
    assert.equal(preview.value, '54rem')
    assert.equal(reading.value, '58rem')
    assert.equal(toRem(reading.value) - toRem(preview.value), 4)
  })

  test('measure: 回 standard → 两者同时 remove（paper 自带更窄的 reading 行宽）', async () => {
    const { setPref, env } = await loadPrefs({}, 'ms-standard')
    setPref('measure', 'wide')
    const mark = env.calls.length
    setPref('measure', 'standard')
    const tail = env.calls.slice(mark)
    const preview = tail.filter((c) => c.key === '--preview-measure')
    const reading = tail.filter((c) => c.key === '--reading-measure')
    assert.equal(preview.length, 1)
    assert.equal(reading.length, 1)
    assert.equal(preview[0].op, 'remove')
    assert.equal(reading[0].op, 'remove')
  })

  test('narrow/wide 两档的 +4rem 关系都必须成立（防止只改了一张表）', async () => {
    for (const tier of ['narrow', 'wide']) {
      const { setPref, env } = await loadPrefs({}, `ms-rel-${tier}`)
      setPref('measure', tier)
      const p = toRem(env.store.get('--preview-measure'))
      const r = toRem(env.store.get('--reading-measure'))
      assert.equal(r - p, 4, `${tier} 档的 +4rem 关系被破坏`)
    }
  })
})

// ===========================================================================
describe('组 6 · 字体：system 走 remove，serif/mono 走 set 且不碰 --font-body', () => {
  test('fontFamily: system 必须 remove --font-body-user', async () => {
    const { setPref, env } = await loadPrefs({}, 'ff-system')
    setPref('fontFamily', 'system')
    const ops = opsFor(env.calls, '--font-body-user')
    assert.equal(ops.at(-1).op, 'remove', 'system 档交还主题决定，正文回退 --font-body')
  })

  test('fontFamily: serif 必须 set --font-body-user 且含衬线字栈', async () => {
    const { setPref, env } = await loadPrefs({}, 'ff-serif')
    setPref('fontFamily', 'serif')
    const ops = opsFor(env.calls, '--font-body-user')
    assert.equal(ops.at(-1).op, 'set')
    assert.ok(ops.at(-1).value.includes('Georgia'), 'serif 字栈首选项应为 Georgia')
    assert.ok(ops.at(-1).value.includes('Songti SC'), 'serif 字栈应含中文衬线回退')
  })

  test('fontFamily: mono 必须 set --font-body-user 且含等宽字栈', async () => {
    const { setPref, env } = await loadPrefs({}, 'ff-mono')
    setPref('fontFamily', 'mono')
    const ops = opsFor(env.calls, '--font-body-user')
    assert.equal(ops.at(-1).op, 'set')
    assert.ok(ops.at(-1).value.includes('SF Mono'), 'mono 字栈首选项应为 SF Mono')
    assert.ok(ops.at(-1).value.includes('monospace'), 'mono 字栈必须以 monospace 收尾')
  })

  test('三个字体档位都不得写 --font-body（chrome 与主题衬线外壳靠它）', async () => {
    for (const family of ['system', 'serif', 'mono']) {
      const { setPref, env } = await loadPrefs({}, `ff-nofontbody-${family}`)
      setPref('fontFamily', family)
      assert.equal(
        opsFor(env.calls, '--font-body').length,
        0,
        `${family} 档触碰了 --font-body，会污染工具条/侧栏/弹层`
      )
    }
  })

  test('回 system 档必须把 --font-body-user 从 store 里抹掉', async () => {
    const { setPref, env } = await loadPrefs({}, 'ff-back-to-system')
    setPref('fontFamily', 'mono')
    assert.ok(env.store.has('--font-body-user'), '前置条件：mono 已写入内联')
    setPref('fontFamily', 'system')
    assert.equal(
      env.store.has('--font-body-user'),
      false,
      '回 system 后不应残留内联字栈'
    )
  })
})

// ===========================================================================
describe('组 7 · 恢复默认：7 个受管变量全部清空 + localStorage 被清', () => {
  test('resetPrefs 后 7 个受管变量全部不在 store 内', async () => {
    const { setPref, resetPrefs, env } = await loadPrefs({}, 'reset-clean')
    // 先写满内联：serif + 20px + loose + wide 全部是非默认档
    setPref('fontFamily', 'serif')
    setPref('fontSize', 20)
    setPref('lineHeight', 'loose')
    setPref('measure', 'wide')
    assert.ok(env.store.size >= 6, `前置条件：应有多个内联变量，实际 ${env.store.size}`)

    resetPrefs()
    for (const v of MANAGED_VARS) {
      assert.equal(env.store.has(v), false, `resetPrefs 后 ${v} 仍残留在 store 里`)
    }
    assert.equal(env.store.size, 0, `受管变量应全部清空，残留: ${[...env.store.keys()]}`)
  })

  test('resetPrefs 必须对 7 个受管变量逐个 removeProperty', async () => {
    const { setPref, resetPrefs, env } = await loadPrefs({}, 'reset-remove-calls')
    setPref('fontFamily', 'serif')
    const mark = env.calls.length
    resetPrefs()
    const tail = env.calls.slice(mark)

    for (const v of MANAGED_VARS) {
      const ops = tail.filter((c) => c.key === v)
      assert.equal(ops.length, 1, `resetPrefs 应对 ${v} 恰好 remove 一次`)
      assert.equal(ops[0].op, 'remove', `${v} 必须走 removeProperty（回主题默认），不得写值`)
    }
    assert.equal(tail.length, MANAGED_VARS.length, 'resetPrefs 不应触碰受管面之外的变量')
  })

  test('resetPrefs 必须清除 localStorage 的 inkmark-prefs key', async () => {
    const { setPref, resetPrefs, env } = await loadPrefs({}, 'reset-storage')
    setPref('fontSize', 18)
    assert.ok(
      env.storageStore.has(STORAGE_KEY),
      `前置条件：setPref 应已写入 ${STORAGE_KEY}`
    )
    resetPrefs()
    assert.equal(
      env.storageStore.has(STORAGE_KEY),
      false,
      `resetPrefs 后 ${STORAGE_KEY} 仍留在 localStorage`
    )
  })

  test('resetPrefs 后 getPrefs 回到出厂默认值', async () => {
    const { setPref, resetPrefs, getPrefs, PREFS_DEFAULTS } = await loadPrefs({}, 'reset-getprefs')
    setPref('fontSize', 20)
    setPref('fontFamily', 'mono')
    assert.notDeepEqual(getPrefs(), PREFS_DEFAULTS, '前置条件：此时应与默认不同')
    resetPrefs()
    assert.deepEqual(getPrefs(), PREFS_DEFAULTS, 'resetPrefs 后必须回到出厂默认')
  })
})

// ===========================================================================
describe('组 8 · 对抗性：非法值 / 存储不可用 / 坏 JSON 全部不抛错', () => {
  test('fontSize: 9999 非法值必须被忽略且不抛错（返回当前值）', async () => {
    const { setPref, getPref, env, PREFS_DEFAULTS } = await loadPrefs({}, 'adv-size')
    assert.doesNotThrow(() => setPref('fontSize', 9999), '非法字号不得抛错')
    assert.equal(getPref('fontSize'), PREFS_DEFAULTS.fontSize, '非法值不得改变当前偏好')
  })

  test("lineHeight: 'huge' 非法值必须被忽略且不抛错", async () => {
    const { setPref, getPref, env } = await loadPrefs({}, 'adv-lh')
    assert.doesNotThrow(() => setPref('lineHeight', 'huge'))
    assert.equal(getPref('lineHeight'), 'standard')
  })

  test('measure: null 非法值必须被忽略且不抛错', async () => {
    const { setPref, getPref, env } = await loadPrefs({}, 'adv-ms')
    assert.doesNotThrow(() => setPref('measure', null))
    assert.equal(getPref('measure'), 'standard')
  })

  test('未知的偏好 key 不得抛错也不得写入内联', async () => {
    const { setPref, env } = await loadPrefs({}, 'adv-unknown-key')
    assert.doesNotThrow(() => setPref('nonexistentKey', 'whatever'))
    assert.equal(env.calls.length, 0, '未知 key 不应产生任何 CSS 变量写入')
  })

  test('非法值不得污染 localStorage（不得把坏值持久化）', async () => {
    const { setPref, env } = await loadPrefs({}, 'adv-no-persist')
    setPref('fontSize', 9999)
    const sets = env.storageOps.filter((o) => o.op === 'set')
    assert.equal(sets.length, 0, '非法值不应触发任何 localStorage 写入')
  })

  test('localStorage.setItem 抛错（配额满）→ 内存兜底本次会话仍生效', async () => {
    const { setPref, getPref, applyPrefs, env } = await loadPrefs(
      { throwOnSet: true },
      'adv-storage-throw'
    )
    assert.doesNotThrow(() => setPref('fontSize', 20), '存储不可用不得抛错阻断 UI')

    // 内存兜底：偏好本身生效
    assert.equal(getPref('fontSize'), 20, '存储不可用时本次会话的选择仍应生效')

    // 且落到了内联样式上（选择即时生效，不只是内存里的数字）
    assert.equal(env.store.get('--text-base'), '1.25rem', '20px 应已落到内联 --text-base')
    assert.equal(env.store.get('--text-md'), '1.25rem')
    // 但没有持久化
    assert.equal(env.storageStore.has(STORAGE_KEY), false, '抛错时不应有持久化结果')
  })

  test('localStorage.getItem 抛错 → getPrefs 回默认且不抛错', async () => {
    const { getPrefs, env, PREFS_DEFAULTS } = await loadPrefs(
      { throwOnGet: true },
      'adv-get-throw'
    )
    assert.doesNotThrow(() => getPrefs(), '存储不可用时读偏好不得抛错')
    assert.deepEqual(getPrefs(), PREFS_DEFAULTS, '读不到存储时应回落出厂默认')
  })

  test('localStorage 内容为坏 JSON → 不抛错且回落默认', async () => {
    const { getPrefs, initPrefs, env, PREFS_DEFAULTS } = await loadPrefs(
      { seed: '{"坏数据' },
      'adv-bad-json'
    )
    assert.doesNotThrow(() => getPrefs(), '坏 JSON 不得抛错')
    assert.deepEqual(getPrefs(), PREFS_DEFAULTS, '坏 JSON 应完整回落出厂默认')
    assert.doesNotThrow(() => initPrefs(), '坏 JSON 下初始化不得抛错')
    // 同「默认态」：字号两变量落内联，其余 5 个受管变量被 remove
    assert.deepEqual(
      [...env.store.keys()].sort(),
      ['--text-base', '--text-md'],
      `坏 JSON 下应按默认态处理，实际: ${[...env.store.keys()]}`
    )
  })

  test('localStorage 内容为合法 JSON 但值非法 → 逐项校验，合法项保留、非法项回落', async () => {
    // 逐项校验（而非整体丢弃）是 prefs.js 的契约：合法项不该被坏邻居连累
    const seed = JSON.stringify({ fontSize: 18, lineHeight: 'huge', measure: null })
    const { getPrefs } = await loadPrefs({ seed }, 'adv-partial-json')
    const prefs = getPrefs()
    assert.equal(prefs.fontSize, 18, '合法项应被保留')
    assert.equal(prefs.lineHeight, 'standard', '非法项应回落默认')
    assert.equal(prefs.measure, 'standard', '非法项应回落默认')
  })

  test('localStorage 内容为非对象（数组/字符串/数字）→ 不得抛错', async () => {
    for (const seed of ['[1,2,3]', '"hello"', '42', 'null']) {
      const { getPrefs, PREFS_DEFAULTS } = await loadPrefs({ seed }, `adv-nonobj-${seed}`)
      assert.doesNotThrow(() => getPrefs(), `种子 ${seed} 不得抛错`)
      assert.deepEqual(getPrefs(), PREFS_DEFAULTS, `种子 ${seed} 应回落默认`)
    }
  })

  test('无 DOM 环境（document 未定义）调用 applyPrefs 不得抛错（SSR/测试安全）', async () => {
    const { applyPrefs, initPrefs } = await loadPrefs({}, 'adv-nodom')
    delete globalThis.document
    assert.doesNotThrow(() => applyPrefs(), '无 document 时 applyPrefs 应静默返回')
    assert.doesNotThrow(() => initPrefs(), '无 document 时 initPrefs 应静默返回')
  })
})

// ===========================================================================
describe('组 9 · 订阅：onPrefsChange 在写入与重置时触发', () => {
  test('setPref 后 onPrefsChange 必须被调用，且收到完整偏好对象', async () => {
    const { setPref, onPrefsChange } = await loadPrefs({}, 'sub-set')
    const seen = []
    const off = onPrefsChange((p) => seen.push(p))

    setPref('fontSize', 20)

    assert.equal(seen.length, 1, 'setPref 必须触发一次订阅回调')
    assert.equal(seen[0].fontSize, 20, '回调应收到变更后的完整偏好')
    // 完整对象 = 含全部 6 项，不只是被改的那一项
    for (const key of [
      'fontFamily',
      'fontSize',
      'lineHeight',
      'measure',
      'autosave',
      'snapshot',
    ]) {
      assert.ok(key in seen[0], `回调对象应包含 ${key}`)
    }
    off()
  })

  test('resetPrefs 也必须触发订阅', async () => {
    const { setPref, resetPrefs, onPrefsChange, PREFS_DEFAULTS } = await loadPrefs({}, 'sub-reset')
    const seen = []
    const off = onPrefsChange((p) => seen.push(p))

    setPref('fontSize', 20)
    resetPrefs()

    assert.equal(seen.length, 2, 'setPref + resetPrefs 应各触发一次')
    assert.deepEqual(
      seen.at(-1),
      PREFS_DEFAULTS,
      'resetPrefs 后的回调应带回出厂默认'
    )
    off()
  })

  test('取消订阅后不再收到回调', async () => {
    const { setPref, onPrefsChange } = await loadPrefs({}, 'sub-off')
    const seen = []
    const off = onPrefsChange((p) => seen.push(p))
    setPref('fontSize', 18)
    const afterFirst = seen.length
    off()
    setPref('fontSize', 20)
    assert.equal(seen.length, afterFirst, 'off() 之后不应再收到回调')
  })

  test('单个监听器抛错不得阻断其他监听器与偏好生效', async () => {
    const { setPref, onPrefsChange, getPref, env } = await loadPrefs({}, 'sub-throw')
    const seen = []
    onPrefsChange(() => {
      throw new Error('listener boom')
    })
    const off = onPrefsChange((p) => seen.push(p))

    assert.doesNotThrow(() => setPref('fontSize', 20), '监听器异常不得冒泡阻断 setPref')
    assert.equal(seen.length, 1, '后注册的监听器仍应被调用')
    assert.equal(getPref('fontSize'), 20, '偏好仍应生效')
    assert.equal(env.store.get('--text-base'), '1.25rem', '内联样式仍应落地')
    off()
  })

  test('onPrefsChange 传入非函数必须安全返回 no-op（不得抛错）', async () => {
    const { onPrefsChange } = await loadPrefs({}, 'sub-nonfn')
    let off
    assert.doesNotThrow(() => {
      off = onPrefsChange(null)
    })
    assert.equal(typeof off, 'function', '应返回可调用的取消函数')
    assert.doesNotThrow(() => off(), 'no-op 取消函数应可安全调用')
  })
})

// ===========================================================================
describe('组 10 · 持久化契约：写单个 JSON 对象 + 逐项校验来源一致', () => {
  test('setPref 必须把完整偏好写进 inkmark-prefs 这一个 key', async () => {
    const { setPref, env, PREFS_DEFAULTS } = await loadPrefs({}, 'persist-single-key')
    setPref('fontSize', 16)
    const sets = env.storageOps.filter((o) => o.op === 'set')
    assert.equal(sets.length, 1, '一次写入')
    assert.equal(sets[0].key, STORAGE_KEY, `必须写到 ${STORAGE_KEY} 这一个 key`)
    const written = JSON.parse(sets[0].value)
    assert.deepEqual(
      Object.keys(written).sort(),
      Object.keys(PREFS_DEFAULTS).sort(),
      '存储的必须是完整偏好对象，不是增量'
    )
  })

  test('setPref 返回值等于写入值（便于 UI 回显）', async () => {
    const { setPref } = await loadPrefs({}, 'persist-return')
    assert.equal(setPref('lineHeight', 'loose'), 'loose')
    assert.equal(setPref('autosave', 2000), 2000)
  })

  test('getPref 读取单项与 getPrefs 读取全量必须一致', async () => {
    const { setPref, getPref, getPrefs } = await loadPrefs({}, 'persist-consistency')
    setPref('measure', 'narrow')
    setPref('snapshot', 600000)
    const all = getPrefs()
    assert.equal(getPref('measure'), all.measure)
    assert.equal(getPref('snapshot'), all.snapshot)
  })
})

// ---------------------------------------------------------------------------
/** '40rem' -> 40，用于断言 +4rem 这类数值关系（期望值写死，不依赖实现） */
function toRem(v) {
  assert.ok(typeof v === 'string' && v.endsWith('rem'), `期望 rem 值，实际: ${v}`)
  return Number.parseFloat(v)
}
