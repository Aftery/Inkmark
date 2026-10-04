# Inkmark 回归测试网

> 契约来源：`docs/spec/SPEC-engineering-baseline-v1.md` §4（测试网清单）、§6（AC-01~AC-03）
> 维护者：QA。`tests/` 与 `frontend/package.json` 由 QA 独占，其他角色请勿改动。

## 一句话规则

**改了 `frontend/src/themes/prefs.js` 或 `main.go` 的菜单事件，必须先跑 `npm test` 并全绿再提交。**

```bash
cd frontend && npm test
```

不需要 `npm install`（零新增依赖），不需要构建，不依赖网络。

---

## 目录结构

```
frontend/tests/
├── README.md               ← 本文件
├── helpers/
│   └── dom-stub.js         记录型 DOM / localStorage stub（QA 独占）
├── prefs.test.mjs          行为测试：用户排版/编辑器偏好（Spec §4.1 的 10 组）
└── contracts.test.mjs      静态契约：5 项「错了不报错」检查（Spec §4.2）
```

## 为什么用 `node:test` 而不是 vitest

Spec §3.1 已裁决。要点：`prefs.js` 是零依赖 ESM，可被 Node 直接 import；
本机 npm 需走镜像且历史有网络不稳记录，零依赖是最稳的选择。
需要的 DOM 行为用手写 stub 即可 —— 比 jsdom 更快，且断言更硬
（断言的是**真实调用序列**，不是"渲染结果看起来对不对"）。

---

## [注意] 写新测试时必须遵守的两条顺序要求

### 1. 先装 stub，再动态 import 被测模块

```js
import { installEnv, importFresh } from './helpers/dom-stub.js'

const PREFS = new URL('../src/themes/prefs.js', import.meta.url)  // 必须是绝对 URL

async function load() {
  const env = installEnv()          // ① 先装 document / localStorage stub
  const mod = await importFresh(PREFS, 'tag')   // ② 再 import
  return { ...mod, env }
}
```

**为什么必须这样**

- `prefs.js` 的所有 `localStorage` / `document` 访问都在**函数体内**（顶层安全），
  且有 `typeof document === 'undefined'` 守卫。但它有**模块级可变状态**：
  `memoryStore` / `useMemory` / `listeners`。
- 若用**静态 import**，ESM 缓存会让所有用例共享同一个模块实例 ——
  对抗性用例一旦把 `useMemory` 置为 `true`，后续所有用例都被污染，
  测试之间互相串味，结果不可信。
- `importFresh(specifier, tag)` 通过给 URL 加 `?fresh=<tag>-<n>` 造出一个
  **全新的隔离模块实例**。已实测：`?fresh=a` 与 `?fresh=b` 是两个独立实例。

**为什么 specifier 必须是绝对 URL**：`importFresh` 的实现位于
`helpers/dom-stub.js`，动态 import 在**那个文件**里执行，传相对字符串会
相对 `helpers/` 解析（变成 `tests/src/themes/prefs.js`，不存在）→
`ERR_MODULE_NOT_FOUND`。用 `new URL('../src/...', import.meta.url)` 锁定基准目录。

### 2. 期望值必须来自契约，不能来自实现

所有期望值只能来自以下三类，**绝不能"跑一遍实现拿它的输出当期望"**：

1. Spec / 源码里已声明的契约常量（`PREFS_DEFAULTS`、`PREF_OPTIONS`）
2. Spec §4.1 表格里的字面量（如 `15px → 0.9375rem`）
3. 领域不变量（如 `--reading-measure` 恒比 `--preview-measure` 宽 `4rem`）

否则就是"同义测试"—— 绿灯零信息量，实现改了期望值跟着改，永远测不出问题。

同理，`contracts.test.mjs` 里的每条扫描规则都配了一条**扫描器自检**
（例如"main.go 确实发出了 60+ 事件"），防止正则写坏导致差集为空、假通过。

---

## 契约检查抓的是什么（Spec §4.2）

这 5 条全是**错了不报错、只表现为主题被吞掉**的类型，人工 review 只能抓到
"刚好这轮改到的地方"：

| 检查 | 静默失效形态 |
|------|--------------|
| 菜单事件双向闭合 | Go 加了菜单项但前端没注册 → 点菜单没反应，**零报错** |
| `⌘P` 唯一性 | 两处同键 → 行为不确定，且不崩 |
| 打印样式存在性 | 遮罩没关 → 打印出一坨黑色遮罩，用户才骂 |
| 源码零 emoji（P0-1） | 视觉质量降级；P0 零容忍 |
| 行数门禁 | 文件膨胀 → 迟早失控（`App.vue` 已 1368 行就是证据） |

### 白名单（改动时务必同步维护）

两处白名单都**要求写明理由**，且各有一条"理由不能是空字符串"的守卫测试：

- `contracts.test.mjs` 的 `FRONTEND_ONLY_EVENT_WHITELIST`
  前端注册但 Go 侧不 `emit` 的事件（当前：`fs:changed`，由 Wails runtime 派发）
- `contracts.test.mjs` 的 `LINE_EXEMPTIONS`
  行数豁免（当前：`App.vue` 1368 / `createEditor.js` 387 / `commands.js` 341）

新增豁免前先问：这是**已知既有债**（→ 登记 + 写理由），还是**本可以拆干净**
（→ 拆，别进白名单）。豁免不是永久的，`App.vue` 拆完后必须下调阈值。

---

## [注意] 两个环境坑（已踩，勿重蹈）

### 坑 1：`node --test tests/` 在本机跑不起来

Spec §4.3 写的 `"test": "node --test tests/"` **在 Node v22.22.2 上会失败**：

```
Error: Cannot find module '/Users/.../frontend/tests'
```

传目录参数给 `--test` 会被当成模块路径去找。已实测三种写法：
`tests/` / `tests` / `./tests/` 全部失败。
所以 `package.json` 里实际用的是：

```json
"test": "node --test \"tests/**/*.test.mjs\""
```

**加新测试文件时请沿用这个 glob**（或直接放进 `tests/` 顶层，名字以 `.test.mjs` 结尾）。

### 坑 2：emoji 门禁脚本在 macOS 上是假绿灯

`scripts/p0-check-emoji.sh` 用的是 GNU grep 扩展语法 `\x{1F300}-\x{1F9FF}`，
但 macOS 自带 grep 是 BSD/toybox（本机 `toybox 0.8.13`），**不支持 `\x{}`**，
会报 `bad regex: invalid character range` 并 exit 2。
而脚本第 13-16 行写了 `2>/dev/null`（吞报错）+ `|| true`（吞退出码），
于是 `$HITS` 恒为空 → **永远打印"通过"**。

已实测复现：往目录里写真实 `U+1F600`，脚本仍输出"通过" exit 0。

`contracts.test.mjs` 里的 emoji 检查**从该脚本读取同一份 PATTERN**，
翻译成 JS RegExp（`\x{H}` → `\u{H}`，`u` flag 语义等价）后执行 ——
单一真源仍是那个 shell 脚本，但绕开了 BSD grep 的限制，检查真的会跑。

> 所以：**别信 `scripts/p0-check-emoji.sh` 的绿灯，信 `npm test` 的。**
> 该脚本的修复归属见 Spec 变更流程（`scripts/` 不在 QA 的 `tests/` 独占范围内）。

### 坑 3：shell grep 在本仓 UTF-8 文件上会静默无输出

Spec §8 已记录。`contracts.test.mjs` 全程只用 `node:fs` 读文件 + JS RegExp 匹配，
不使用 shell grep。

---

## 零 emoji（P0-1）也适用于本目录

`contracts.test.mjs` 有一条用例扫描 `tests/` 自身的源码。
写测试注释时**不要用**警告三角、对勾、勾选、火箭一类的符号 ——
它们都命中 P0-1 码点区间（`U+26A0`、`U+2705`、`U+2714`、`U+1F680` 等，
完整清单见 `scripts/p0-check-emoji.sh` 的 PATTERN）。
本文件里的 `[注意]` `[通过]` `[对勾]` 就是被这条用例逼出来的替代写法。

> 注意：P0-1 的扫描范围是源码（`.vue/.js/.ts/.jsx/.tsx/.html/.mjs`），
> `.md` 不在其内。但本文档也不直接写这些符号，避免"文档里能写、代码里不能写"
> 这种口径不一致 —— 统一用文字描述。
