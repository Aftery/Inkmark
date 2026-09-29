# 方案 B「专注单栏」技术架构方案

- Status: Proposed（待评审，本轮只出文档不动代码）
- Date: 2026-09-29
- Owner: architect
- 范围（用户已拍板，不可更改）：视图三态切换（编辑 / 预览 / 双栏）+ 专注模式 + 大纲
- 事实源：`frontend/src/App.vue`（f0f4dbc）、`frontend/src/editor/createEditor.js`、`main.go`、`README.md` 设计要点

---

## 1. 视图状态设计

### 1.1 状态变量与持久化

App.vue 新增单一状态源：

```js
const viewMode = ref('split')   // 'edit' | 'preview' | 'split'
```

- localStorage key：`inkmark-view-mode`（沿用 `inkmark-theme` / `inkmark-split` 惯例，App.vue:261、312）。
- 读取时机：`onMounted` 创建编辑器**之后**再应用持久化值（理由见 1.3 与风险 R3）。
- 写入时机：`setViewMode(m)` 内同步写 `localStorage.setItem('inkmark-view-mode', m)`。
- 专注模式与大纲面板**不持久化**（会话级状态）：专注是「临时进入的心流态」，大纲是「临时查阅」，重启恢复到专注/大纲打开态不符合直觉，且省掉两个 key。

### 1.2 v-show / v-if 策略

三者一律 **v-show，不用 v-if**：

| 元素 | 现状 | 三态下处理 | 理由 |
|---|---|---|---|
| 编辑区 `.editor-pane`（App.vue:337） | 常驻 | `v-show="viewMode !== 'preview'"` | CM6 实例必须存活。v-if 会销毁/重建 EditorView，丢失撤销历史、滚动位、光标，且重建成本高 |
| 分割条 `.divider`（App.vue:345） | 常驻 | `v-show="viewMode === 'split'"` | 非双栏下不可拖拽，隐藏即可 |
| 预览区 `.preview-pane`（App.vue:359） | 常驻 | `v-show="viewMode !== 'edit'"` | 保留 DOM 可保留滚动位置与 v-html 结果，切回零开销 |

宽度样式绑定改为条件生效：

```html
:style="{ width: viewMode === 'split' ? editorWidth + '%' : '100%' }"
```

预览区的 `@scroll="onPreviewScroll"`（App.vue:359）不必加守卫：隐藏元素不产生 scroll 事件，联动函数里的空值守卫（App.vue:159、174）已足够。

### 1.3 CM6 隐藏态的 geometry 处理（必须实现）

CM6 已知坑：容器 `display:none` 期间 DOMRect 全为 0，`coordsAtPos` / `posAtCoords` / scrollDOM 度量全部失真；恢复显示后视口内块会重新测量，但**离屏块的高度缓存仍是 0**，长文档会出现滚动高度错误。

方案采取三道防线：

1. **编辑器永远在可见状态下创建**。`viewMode` 初始值硬编码 `'split'`；`onMounted` 创建编辑器（App.vue:188-195）后，若持久化值不是 split，在 `requestAnimationFrame` 中再应用，并补一次 `editor.requestMeasure()`。这消除最恶劣的「隐藏态冷启动」场景。
2. **每次从隐藏恢复可见**（edit↔preview 互切、任意态切回 split），执行：
   ```js
   function onModeApplied() {
     if (viewMode.value === 'split') {
       nextTick(() => {
         editor?.requestMeasure()   // CM6 重新度量视口
         invalidateAnchors()        // 锚点 y 全部失效（复用 App.vue:94）
       })
     }
   }
   ```
   `nextTick` 保证 Vue 已把 `display` 样式落盘，`requestMeasure` 才能读到真实几何。
3. **所有依赖度量的路径按模式守卫**：`collectEditorAnchors`（App.vue:100，用 `coordsAtPos`）与 `collectPreviewAnchors`（App.vue:121）只在 `viewMode === 'split'` 且两栏可见时才允许收集（收敛进 `getAnchors` 的守卫，App.vue:134）。

---

## 2. 专注模式实现路径

### 2.1 总体：CM6 扩展承载，App.vue 只发命令

淡化逻辑完全收在 `createEditor.js`，对 App.vue 暴露一个 StateEffect：

```js
export const setFocusMode = StateEffect.define<boolean>()
```

App.vue 切换只需 `editor.dispatch({ effects: setFocusMode.of(next) })`，不感知 Decoration 细节。

### 2.2 段落判定与 Decoration 构建

「段落」= 以空行（或文档边界）分隔的连续非空行块。提供 `paragraphRange(doc, pos)`：从光标 `head` 向两侧扫到最近的空行，返回 `[from, to]`。

扩展结构（放进 createEditor.js 的 `extensions` 数组，与现有 updateListener 并列、互不干扰）：

```js
const focusField = StateField.define({          // 只存开关布尔
  create: () => false,
  update: (v, tr) => tr.effects.some(e => e.is(setFocusMode))
            ? tr.effects.find(e => e.is(setFocusMode)).value : v,
})

const focusPlugin = ViewPlugin.fromClass(class {
  decorations
  constructor(view) { this.decorations = this.build(view) }
  update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged
               || u.startState.field(focusField) !== u.state.field(focusField))
              this.decorations = this.build(u.view) }
  build(view) {
    if (!view.state.field(focusField)) return Decoration.none
    const [pFrom, pTo] = paragraphRange(view.state.doc, view.state.selection.main.head)
    const b = new RangeSetBuilder()
    for (const { from, to } of view.visibleRanges)          // 只遍历可见区
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos)
        const active = line.from >= pFrom && line.to <= pTo
        b.add(line.from, line.to,
          Decoration.line({ class: active ? 'cm-focus-active' : 'cm-focus-dim' }))
        pos = line.to + 1
      }
    return b.finish()
  }
}, { decorations: v => v.decorations })
```

- 用 **Decoration.line + line class**（`cm-focus-dim` / `cm-focus-active`），不产生 mark widget，样式走 CSS：

  ```css
  .cm-line { transition: opacity var(--motion-fast) var(--ease-standard); }
  .cm-focus-dim { opacity: 0.32; }
  ```

- **只遍历 `view.visibleRanges`**（视口内行），配合 RangeSetBuilder 保证有序，这是性能关键（见风险 R2）。
- `update()` 触发条件覆盖 docChanged / selectionSet / viewportChanged / 开关切换四种，避免漏更新。
- 注意 `update` 里不能只比 `docChanged`：光标上下键移动只触发 selectionSet。

### 2.3 与现有 updateListener 的共存

现有 updateListener（createEditor.js:59-61）只关心 `docChanged` → `onDocChange`，与 focusField/focusPlugin 无任何共享状态。二者是并列扩展：

- focusField 是 StateField，跟随事务自动更新，不回调外部；
- onDocChange 在 App.vue 侧 nextTick 重建预览锚点（App.vue:72-77），opacity 变化不影响布局，锚点几何不受专注模式干扰（写入矩阵见第 5 节）。

唯一注意点：focus 扩展要插在 `syntaxHighlighting` 之后追加即可，无需重排现有扩展顺序。

---

## 3. 大纲实现路径

### 3.1 标题提取：新建 `frontend/src/editor/outline.js`

从 `editor.state.doc` 纯文本扫描，导出：

```js
export function extractOutline(doc) {
  // 返回 [{ level: 1-6, text: string, pos: number }]，pos 为该行行首偏移
}
```

- 状态机直接移植 `collectEditorAnchors`（App.vue:100-118）的围栏代码块开关逻辑：``` 与 ~~~ 反复翻转、翻转期间 `#` 不算标题。建议把这段开关逻辑原样复制进 outline.js（本文档不改代码，实施时如需让 App.vue 复用同一函数，另开小重构步骤，见第 6 节步骤 5）。
- 与 collectEditorAnchors 的差异：**不需要任何 DOM 度量**（不调 `coordsAtPos`、不读 scrollDOM），只做 `doc.line(i)` 文本扫描。因此**编辑器隐藏时照样可用**——大纲在三个视图态都能工作，这是选「doc 扫描」而非「预览 AST/DOM」的核心理由（README 待办里「从预览 AST 提取」的旧思路在此被替代）。
- 标题文本：去掉行首 `#{1,6}\s` 后 trim 即可，不做行内标记清洗（保留 `**` 等原貌，成本低且不误导）。
- 更新时机：复用 `onDocChange`（App.vue:72），在同一处 nextTick 里同步调用 `outline.value = extractOutline(editor.state.doc)`。典型文档数百行扫描 <1ms，无需防抖；若未来实测大文档卡顿再加 300ms debounce。

### 3.2 组件拆分

| 新文件 | 职责 | 预估行数 |
|---|---|---|
| `frontend/src/editor/outline.js` | extractOutline(doc)：围栏状态机 + 标题行解析 | 约 45 |
| `frontend/src/components/Outline.vue` | 大纲面板：接收 items，按 level 缩进渲染；emit `jump(pos)`；空标题时显示占位文案 | 约 90 |

App.vue 侧集成（约 25 行）：

- `const outline = ref([])`、`const outlineOpen = ref(false)`；
- `onDocChange` 的 nextTick 里更新 outline；
- 面板放置：`.main` 内、侧栏（App.vue:331）之后的 `<aside v-if="outlineOpen" class="outline-pane">`，与文件树并列的独立列；无文件夹时它就是最左列。

### 3.3 点击跳转

按当前视图态分流（Outline.vue 只 emit，逻辑在 App.vue）：

```js
function jumpToHeading(pos, index) {
  if (viewMode.value === 'preview') {
    // 编辑器隐藏，scrollIntoView 无效 → 走预览 DOM：按序号找第 index 个标题
    const hs = previewEl.value?.querySelectorAll(HEADING_SEL)
    if (hs && hs.length === outline.value.length) hs[index].scrollIntoView({ block: 'start' })
    // 数量不等（setext 标题等导致，App.vue:83 已知差异）→ 静默忽略，不做文本模糊匹配
    return
  }
  editor.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 0 }),
  })
  editor.focus()
}
```

- 用 `dispatch({ selection, scrollIntoView: true })`（比手动算 scrollTop 可靠，CM6 自带目标行保证在视口）；`scrollIntoView` effect 二选一即可，推荐后者带 `yMargin: 0` 对齐预览的 `block: 'start'`。
- 若从预览态点击而切回编辑态跳转，须先 `setViewMode('split')`，再走 1.3 的 onModeApplied（requestMeasure 之后）才 dispatch——顺序不能反，否则跳到错误位置。
- `jumpToHeading` 需要 `index` 参数，Outline.vue 渲染时带上序号。

---

## 4. 菜单 / 快捷键扩展

### 4.1 main.go buildMenu 改动（main.go:83-84 视图菜单内追加）

| 菜单项 | 快捷键 | 事件 |
|---|---|---|
| 编辑视图 | ⌘1 | `menu:view-edit` |
| 预览视图 | ⌘2 | `menu:view-preview` |
| 双栏视图 | ⌘3 | `menu:view-split` |
| 专注模式 | ⌘⇧F | `menu:toggle-focus` |
| 大纲 | ⌘B | `menu:toggle-outline` |

Go 代码形态（沿用 emit 闭包，main.go:55-61）：

```go
viewMenu.AddText("编辑视图", keys.CmdOrCtrl("1"), emit("menu:view-edit"))
viewMenu.AddText("预览视图", keys.CmdOrCtrl("2"), emit("menu:view-preview"))
viewMenu.AddText("双栏视图", keys.CmdOrCtrl("3"), emit("menu:view-split"))
viewMenu.AddSeparator()
viewMenu.AddText("专注模式", keys.Combo("f", keys.CmdOrCtrlKey, keys.ShiftKey), emit("menu:toggle-focus"))
viewMenu.AddText("大纲", keys.CmdOrCtrl("b"), emit("menu:toggle-outline"))
```

快捷键选型依据：⌘1/2/3 是三态切换的通用惯例；⌘⇧F 避开 ⌘F（页面内查找习惯位）；⌘B 与主流编辑器「开合侧栏」一致，且 EditMenu Role 未占用。**已知限制**：Wails v2 菜单构建后是静态的，无法给「专注模式/大纲」加动态勾选态（菜单不重建就同步不了前端状态）；接受此限制，用界面反馈（面板出现、段落淡化）代替菜单勾选。

### 4.2 前端接线（App.vue 菜单事件区，App.vue:267-273 处追加）

```js
EventsOn('menu:view-edit',   () => setViewMode('edit'))
EventsOn('menu:view-preview', () => setViewMode('preview'))
EventsOn('menu:view-split',  () => setViewMode('split'))
EventsOn('menu:toggle-focus', toggleFocus)
EventsOn('menu:toggle-outline', () => { outlineOpen.value = !outlineOpen.value; invalidateAnchors() })
```

- `toggleFocus`：`focusOn.value = !focusOn.value; editor.dispatch({ effects: setFocusMode.of(focusOn.value) })`。
- 菜单 accelerator 先于 WebView 消费按键（App.vue:265 注释的既有结论），前端**不再**另挂 keydown，避免双触发。
- 大纲开合改变 `.main` 布局宽度 → 必须同步 `invalidateAnchors()`（与 onDividerMove 的处理同理，App.vue:297）。

---

## 5. 三态行为矩阵

| 关注点 | 编辑态 | 预览态 | 双栏态 |
|---|---|---|---|
| 编辑器可见 | 是（全宽） | 否（display:none） | 是（editorWidth%） |
| 预览可见 | 否 | 是（全宽） | 是 |
| 滚动联动 onEditorScroll/onPreviewScroll | 不触发（对侧隐藏无滚动） | 不触发 | 正常（现有逻辑，App.vue:158-186） |
| 锚点收集 getAnchors | 守卫拒绝（需双栏可见+度量有效） | 守卫拒绝 | 正常收集 |
| 锚点缓存 anchorsDirty | 切入时置 true | 切入时置 true | 切回时置 true + requestMeasure 后由下次滚动惰性重建（App.vue:134 惰性机制不变） |
| 分割条 | 隐藏 | 隐藏 | 显示，拖拽逻辑原样 |
| onDividerMove 失效锚点 | 不可达 | 不可达 | 原样（App.vue:297） |
| resize → invalidateAnchors | 保持（App.vue:198） | 保持 | 保持 |
| 专注模式 Decoration | 生效（唯一主战场） | 不生效但持续持有开关 | 生效 |
| 专注模式对锚点的影响 | 无（opacity 不改布局） | 无 | 无 |
| 大纲面板 | 可开，doc 扫描不受隐藏影响 | 可开，点击走预览 DOM 跳转 | 可开，点击走编辑器 dispatch |
| 大纲开合 | 失效锚点 | 失效锚点 | 失效锚点 + 布局重排 |
| onDocChange → nextTick | 重建锚点标记 + 更新大纲 | 同左（预览隐藏时 v-html 仍更新，见 R1） | 同左 |

结论：现有三个失效点（文档变化 App.vue:76、拖动 App.vue:297、resize App.vue:198）之外，新增两个失效点——**视图态切换**与**大纲面板开合**，都收敛为「置 anchorsDirty + 恢复双栏时 requestMeasure」。

---

## 6. 实施步骤拆解（每步一个 `npm run build` / `wails build` 可验证落点）

| # | 步骤 | 验证标准 | 预估行数 |
|---|---|---|---|
| 1 | App.vue 三态骨架：viewMode ref + localStorage + 模板 v-show + 宽度条件样式 + setViewMode/onModeApplied（requestMeasure + invalidateAnchors） | build 通过；运行时 ⌘1/2/3 之前手动改 localStorage 可切三态，编辑器隐藏后恢复双栏光标/滚动正常 | App.vue 约 85 |
| 2 | main.go 视图菜单三态项 + App.vue EventsOn 接线 | wails build 通过；⌘1/⌘2/⌘3 实际切态 | main.go 约 8、App.vue 约 6 |
| 3 | createEditor.js 专注模式扩展（setFocusMode effect + focusField + focusPlugin + paragraphRange）+ App.vue toggleFocus + CSS 淡化样式 | build 通过；⌘⇧F 进入/退出，光标段落高亮其余淡化，打字/移动光标跟随 | createEditor.js 约 70、App.vue 约 12、CSS 约 10 |
| 4 | editor/outline.js 的 extractOutline + 单元可验（node 脚本喂样例 doc 断言输出） | build 通过；脚本跑通含围栏代码块内 # 的用例 | outline.js 约 45 |
| 5 | Outline.vue 组件 + App.vue 集成（outlineOpen、onDocChange 更新、jumpToHeading 三态分流）+ main.go 大纲菜单项 + outline-pane 样式 + 开合失效锚点 | build 通过；三个视图态下开大纲、点标题均正确跳转；开合后滚动联动不错位 | Outline.vue 约 90、App.vue 约 40、main.go 约 3、CSS 约 25 |
| 6 | 回归收尾：长文档（2000+ 行）三态往返 + 专注模式 + 联动错位检查；README 设计要点与待办勾选更新 | 手工回归清单通过 | 文档改动 |

依赖关系：1 → 2 → 3 可与 4 并行 → 5（依赖 1 与 4）→ 6。总计约 400 行净增。

构建纪律提醒：`npm run build` 会删 `frontend/dist/.gitkeep`，提交前需还原（README 既有坑）；本轮不实施，全部步骤待评审通过后另行执行。

---

## 7. 风险清单

### R1 编辑态隐藏预览：v-html 持续重渲染（中）

`previewHtml` 是 computed（App.vue:22），编辑态下每敲一个字 markdown-it 仍全量渲染，只是结果不可见——大文档打字延迟无谓增加（README 待办已列「渲染防抖」）。本方案**暂不处理**渲染逻辑，只靠 v-show 保留 DOM；若实测卡顿，最小改法是 computed 内按 `viewMode === 'edit'` 返回上次缓存结果。另有次级点：编辑态下预览滚动位置因 DOM 保留而不丢失，切回预览不闪跳。

### R2 专注模式 Decoration 性能（低-中）

每次 selectionSet 都重建 DecorationSet。缓解：line Decoration 本身廉价；只遍历 `visibleRanges`（视口内行，通常 < 100 行）；RangeSetBuilder 有序构建。残余风险：极端长段落（单段上千行）时 paragraphRange 全文扫描 O(n)，但每次按键只扫一次，15ms 内可完成，可接受。禁用路径：focusField 关闭时 build 直接返回 `Decoration.none`，零开销。

### R3 CM6 隐藏容器测量失效（高，已由 1.3 三道防线覆盖）

最高优先级风险。display:none 下创建编辑器 = 离屏块高度缓存全 0，恢复后长文档滚动高度错误且 `coordsAtPos` 失真。防线：创建必可见（持久化模式延后一帧应用）+ 恢复可见必 requestMeasure + 度量路径按双栏态守卫。残余风险：极端场景（隐藏期间字体加载完成导致行高变化）需再补一次度量，步骤 6 回归时专项验证；若仍复现，后备方案是改用「移出视口定位」（`position:absolute; left:-99999px`）代替 display:none 保持几何有效，成本约 +15 行。

### R4 菜单无法显示勾选态（低）

Wails v2 菜单静态，专注/大纲的开合状态无法反映到菜单勾选。接受，用界面反馈代替（见 4.1）。

### R5 预览态大纲跳转的序号错位（低）

编辑器标题行数与预览 DOM 标题数可能不等（setext 下划线标题，App.vue:83 已知）。方案：数量不等时静默忽略预览侧跳转（不做文本模糊匹配，避免错误跳转比不跳更糟）；双栏/编辑态不受影响。

### R6 新 CSS 类与打印样式冲突（极低）

`@media print` 只输出预览区（App.vue:445-448），专注模式的 line class 只挂在编辑器内，无交集；`cm-focus-dim` 的 transition 在打印时也不会被触发。无需处理。

---

## 附：新增 localStorage key 一览

| key | 值域 | 写入点 |
|---|---|---|
| `inkmark-view-mode` | edit / preview / split | setViewMode（App.vue） |

专注模式与大纲开合不持久化（见 1.1 理由）。
