# ADR-003: PDF 导出——应用内一键直出（离屏 WKWebView 逐页渲染 + PDFKit 合并）

## Status

**Accepted (2026-10-01)** —— team-lead 裁决通过并升格为 Accepted。

复核留痕（team-lead 独立复核，三条核心证据全部成立）：
1. `showsPrintPanel = YES` 硬编码属实 —— `wails/v2@v2.16.0/internal/frontend/desktop/darwin/Application.m:492`。
2. 探针产物实测吻合 —— `/tmp/pdfprobe/PAG_p60.pdf` = 160910 字节 / 15 页 / MediaBox 含 `0 0 595 842`。
3. 版本锚定属实 —— `package.json` 写 `^6.38.0`，实际锁 `@codemirror/view 6.43.13`（state 6.7.6 / language 6.12.4 / lang-markdown 6.5.2 / @lezer/markdown 1.7.2）。

**结论先行：可行。** 已用可运行探针在本机（macOS 12.7.6 / SDK 13.1）端到端验证：
应用内一次调用即可产出**分页 A4、矢量文字、字体内嵌、不弹任何系统对话框**的 PDF。
推荐方案（下称 **路线 A′**）全部构件均已实测通过；**页眉页脚已由 team-lead 裁决为本期 P0 实施项**（见 §Consequences 风险 4），仅「真实 Wails 宿主内集成」一处需在实施期实机确认（见 §未决与后续）。

**修订留痕（v1.3，2026-10-01）**：正文带宽由 **666pt 改为 714pt**（裁决取读法 B——页眉/页脚 24pt 落在 64pt 边距之内、不参与相加）。同步改动：§Decision 端到端流程（`ceil(H/714)`、`rect=(0,i*714,467,714)`、PDF 落页 `(64,64,467,714)`、页眉 PDF y=784 / 页脚 PDF y=56）、§页面几何与页眉页脚、§Consequences（正面「467×714」、风险 4）、§已裁决与待办（新增裁决 4，关闭「§8.4 基线不自洽待复核」）。

## Background

D-3 明确要求：**应用内一键直出 PDF**，用户**拒绝**「走系统打印对话框让用户自己存 PDF」；且需程序化控制**分页**、**页眉页脚**（P0），**目录**（P1，可降级但要单独说明）。

约束基线（已核实）：

| 项 | 事实 | 证据 |
|---|---|---|
| 运行时 | Wails v2.16.0 + Go（go.mod 声明 1.25.0；本机工具链 go1.27.1 darwin/amd64） | `go.mod:5`；`go version` |
| 形态 | 纯本地桌面应用，无后端 / 无 HTTP / 无数据库 / 无认证 | `docs/spec/DECISIONS-phaseC-v1.md:13-16` |
| Go 侧现有能力 | 原生菜单、开/存对话框、读写文件、打印 | `app.go`、`main.go` |
| 图标/Token | 已锁定，见 ADR-001 / ADR-002 | `docs/architecture/ADR-001-icon-strategy.md`、`ADR-002-token-layering.md` |
| 现有 PDF 链路 | `window.print()`（前端）→ Wails `WindowPrint` | `frontend/src/App.vue:452-454`、`main.go:77` |

### 关键查证一：Wails v2.16.0 **不**暴露 PDF 生成能力（非推测）

在本机 Go module 缓存 `~/go/pkg/mod/github.com/wailsapp/wails/v2@v2.16.0/` 逐文件查证：

```bash
WAILS=~/go/pkg/mod/github.com/wailsapp/wails/v2@v2.16.0
grep -rn "WindowPrint" "$WAILS" --include="*.go" --include="*.m" --include="*.h"
grep -rni "pdf" "$WAILS/" --include="*.go"
```

实测输出（节选）：

```
internal/frontend/frontend.go:169:	WindowPrint()
internal/frontend/desktop/darwin/window.go:322:func (w Window) Print() {
internal/frontend/desktop/darwin/window.go:323:	C.WindowPrint(w.context)
internal/frontend/desktop/darwin/frontend.go:376:func (f *Frontend) WindowPrint() { f.mainWindow.Print() }
internal/frontend/desktop/darwin/Application.m:470:void WindowPrint(void *inctx) { ... }
internal/frontend/desktop/windows/frontend.go:468:func (f *Frontend) WindowPrint() { f.ExecJS("window.print();") }
internal/frontend/desktop/linux/frontend.go:432:func (f *Frontend) WindowPrint() { f.ExecJS("window.print();") }
pkg/runtime/window.go:183:func WindowPrint(ctx context.Context)
pkg/assetserver/mimecache.go:31:		".pdf":  "application/pdf",
```

结论：
1. **全模块对 `pdf` 的唯一命中是 MIME 表**（`mimecache.go:31`），即 Wails **没有任何 PDF 生成 API**。
2. 运行时只暴露 `runtime.WindowPrint(ctx)`（`pkg/runtime/window.go:183`）。
3. macOS 实现 `Application.m:470-501` 的原文（关键三行）：

```objc
NSPrintOperation *po = [webView printOperationWithPrintInfo:pInfo];
po.showsPrintPanel = YES;      // <- 恒为 YES，必然弹系统打印面板
po.showsProgressPanel = YES;
```

即 **Wails 的打印通路在设计上就是「弹系统打印对话框」，无参数可关闭**——这正是 D-3 用户明确拒绝的形态。Windows / Linux 直接 `ExecJS("window.print();")`，同样弹浏览器打印对话框。

### 关键查证二：本机 macOS SDK **提供**程序化 PDF 原语

```bash
SDK=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk
grep -rn "createPDFWithConfiguration" "$SDK/System/Library/Frameworks/WebKit.framework/Headers/"
```

实测输出：

```
WKWebView.h:442:- (void)createPDFWithConfiguration:(nullable WKPDFConfiguration *)pdfConfiguration
    completionHandler:(void (^)(NSData * _Nullable pdfDocumentData, NSError * _Nullable error))completionHandler
    NS_REFINED_FOR_SWIFT API_AVAILABLE(macos(11.0), ios(14.0));
WKWebView.h:585:- (NSPrintOperation *)printOperationWithPrintInfo:(NSPrintInfo *)printInfo API_AVAILABLE(macos(11.0));
WKPDFConfiguration.h:33:@interface WKPDFConfiguration : NSObject <NSCopying>
WKPDFConfiguration.h:39:@property (nonatomic) CGRect rect NS_REFINED_FOR_SWIFT;
```

环境：`sw_vers` → macOS 12.7.6；`xcrun --show-sdk-version` → 13.1；`clang --version` → Apple clang 14.0.0。
`createPDFWithConfiguration:` 可用条件 `macos(11.0)`，**本机满足**。

## Decision

**采用路线 A′：Go(cgo/ObjC) 侧新建离屏 `WKWebView` 加载「自包含导出 HTML」→ 逐 A4 页 `createPDFWithConfiguration:` 渲染 → PDFKit `PDFDocument` 合并 → 写入用户所选路径。**

不触碰 Wails 私有内部（不需要拿到宿主 webview 指针），也不使用 `NSPrintOperation`。

### 端到端流程

```
前端                               Go 侧 (darwin)                       系统
─────────────────────────────────────────────────────────────────────────────
button / ⌘P
  → buildHtmlDocument(...)          ExportPDF(html, defaultName)
    （复用 export/exporters.js）  →  runtime.SaveFileDialog(默认 .pdf)
                                     → 选择路径后调用 ObjC bridge
                                       ├─ 建离屏 WKWebView(A4 尺寸边框窗口)
                                       ├─ loadHTMLString(html)
                                       ├─ 等 navigationDidFinish
                                       ├─ evaluateJavaScript(scrollHeight) → H   （H = 467pt 版式下的正文总高，CSS px）
                                       ├─ pages = ceil(H / 714)                   （714 = 正文可用高/版心，见 §页面几何）
                                       ├─ for i in 0..pages-1:
                                       │    createPDFWithConfiguration(
                                       │       rect=(0, i*714, 467, 714)) → NSData
                                       │       【rect 用 Web 页坐标：原点左上，y 向下增长】
                                       ├─ PDFKit：新建 595×842 页，把正文切片置于
                                       │      【PDF 坐标：原点左下】(x=64, y=64, w=467, h=714)，
                                       │      再叠加页眉（基线 距页顶58pt → PDF y=784）与
                                       │      页脚（基线 距页顶786pt → PDF y=56）
                                       ├─ PDFKit 逐页 insertPage → 合并
                                       └─ writeToFile(path)
                                     ← 返回保存路径
```

> **探针与生产几何的关系（勿混淆）**：探针用 `rect` 高 **842**、页 **595×842** 跑通，目的是**证明机制**（rect 切片 + PDFKit 合并可行）。生产几何改用**正文带 714pt**（页眉/页脚 24pt 是**边距内**的可用带宽上限，**不参与相加**），并在合并阶段叠加页眉页脚。二者机制相同，仅带宽与是否叠加不同——**探针的 15 页输出不是最终产品几何**，见下节。
> **注意两套坐标系**（呼应 §11 坑 20）：`createPDFWithConfiguration` 的 `rect` 用 **Web 页坐标（原点左上）**；把切片落到合成页时用 **PDF 坐标（原点左下）**。二者不可混用。

### 页面几何与页眉页脚（对齐设计规格 §8）

> 视觉规格来源：`docs/design/phaseC-visual-spec.md` §8（设计师「颜好看」2026-10-01）。**本节只记与实现强耦合的硬约束**；完整视觉参数以设计规格为准。

**页面几何（分页硬约束，非视觉建议）**：

| 项 | 值 | 说明 |
|---|---|---|
| 页面 | 595 × 842 pt（A4 竖版） | PDF 页尺寸 |
| 页边距 | 上下左右各 **64pt** | |
| 页眉 / 页脚带宽 | **24pt（边距内可用带宽上限）** | **不参与相加**：页眉/页脚绘制在 64pt 边距**之内**，不是正文之外另占的条带 |
| **正文可用宽** | 595 − 64×2 = **467pt** | 导出 HTML 的正文容器必须按此宽度排版 |
| **正文可用高（分页带）** | 842 − 64×2 = **714pt** | **分页引擎以此为一页的正文高度**——`pages = ceil(H / 714)` |
| 正文禁止区 | 正文**不得进入**页眉 / 页脚基线所落的 24pt 带宽 | 避让是硬约束 |

- **实现推算（供实施核对）**：`64(上边距) + 714(正文) + 64(下边距) = 842`。正文盒在 PDF 坐标（原点左下）中的位置为 `(x=64, y=64, w=467, h=714)`（`y=64` 即下边距；上沿 = 64+714 = 778，距页顶 842−778 = 64，与上边距吻合）。
- **已裁决（team-lead，2026-10-01）**：设计规格 §8.4 曾同时给出「页眉基线距**正文上沿** 6pt」与「页眉基线距**页顶**约 58pt」两种读法，此前此处标为「待设计师复核」。**现取读法 B**：**页眉/页脚 24pt 落在 64pt 边距之内，不与正文相加**，正文带 = 714pt。据此几何自洽：正文上沿距页顶 64pt、下沿距页顶 778pt；页眉基线距页顶 58pt（落于上边距内）、页脚基线距页顶 786pt（落于下边距内）。**24pt 仅为「边距内可供页眉使用的带宽上限」，不得重读为参与相加的独立条带。**

**页眉页脚内容与字色（四角色分别映射）**：

| 元素 | 内容 | 字号 | 字重 | 字色 Token |
|---|---|---|---|---|
| 页眉 · 左 | 文档名（**去扩展名**） | 9pt | `--weight-read`(400) | `--muted` |
| 页眉 · 中 | 留空（保留锚点） | — | — | — |
| 页眉 · 右 | 日期 `YYYY-MM-DD`（导出当日） | 9pt | `--weight-read`(400) | `--meta` |
| 页脚 · 右 | `第 X / N 页`（斜杠两侧各一空格） | 9pt | `X`=`--weight-emphasize`(510) / `/ N 页`=`--weight-read`(400) | `X`=`--fg-2` / `/ N 页`=`--muted` |

- **修正先前的技术基线**：我最初写的「页眉页脚统一取 `--muted`」**不准确**——设计规格是**四角色分别映射**（`--muted` / `--meta` / `--fg-2` / `--muted`）。**以设计规格为准**（层级语义：文档名与当前页码为主体信息，日期最弱——「哪一页」比「哪一天」更重要）。
- **字体**：用 `--font-body`（**非** App chrome 的 `--font-ui`）。理由：页眉页脚属**文档本体**，须随主题（纸感主题走衬线），否则衬线正文配无衬线页眉会露出「模板接缝」。
- **不加分隔线**：页眉页脚与正文间不用横线，仅靠留白 + 字号/字色层级区分（延续「无装饰线」设计语言）。
- **每页都出现**（无封面页）；`X`/`N` 为**已分页后**的真实页码（先分页，再逐页叠加）。

**主题映射（钉死，非「跟随」）**：`light → light` 原样；`paper → paper` 原样；**`dark → 强制映射为 light`**。

| 当前主题 | PDF 产物主题 | 理由 |
|---|---|---|
| `light` | `light`（原样） | 白纸黑字，直接输出 |
| `paper` | `paper`（原样） | 纸感前提即「纸面近白 + 衬线 + 宽行距」，为纸质输出而生；强制浅色会废掉该主题在导出场景的全部价值 |
| `dark` | **`light`（强制映射）** | 深色底色是为屏幕对比度服务的，挪到纸上即缺陷（耗墨、反白难读） |

- 故 **PDF 页眉页脚只取 light 列或 paper 列，dark 列在 PDF 场景不可达**。
- 深色模式下导出的 PDF **不是黑的**（白纸黑字）——符合「导出 = 交付到纸 / 存档」的直觉，**无需额外提示 UI**。
- 残留风险：不提供「刻意导出深色 PDF」的出口（v1.1 可选高级选项，不在 MVP）。

### 探针实测（本机可直接复跑，源码已归档）

探针：`docs/architecture/probe/wails-pdf-probe/{main.go,pdfbridge.m,pdfbridge.h}`
（同一份源码亦在 `/tmp/pdfprobe/`）。构建与运行命令：

```bash
cd /tmp/pdfprobe
export PATH=/usr/local/bin:$PATH CGO_ENABLED=1
go mod init pdfprobe && go build -o probe .        # 仅一条 ld 警告：object built for newer macOS (13.0) than linked (12.0)
./probe A 6        # 路线 A：createPDFWithConfiguration（无 rect）
./probe AR1 6      # 路线 A + rect=(0,0,595,842)
./probe AR2 6      # 路线 A + rect=(0,842,595,842)
./probe PAG 12     # 路线 A′：逐页渲染 + PDFKit 合并
./probe PAG 60     # 大文档规模验证
```

**实测结果表（均取自实际运行输出，无一项为推断）：**

| 探针 | 命令 | 实际输出 | 判定 |
|---|---|---|---|
| 离屏 webview 视图树定位 | `./probe A 0` | `FindExistingWebView -> FOUND` | 通过 |
| 路线 A 短文档 | `./probe A 0` | `createPDF OK bytes=15976`；`file` → `PDF document, version 1.3, 1 pages`；MediaBox `0 0 794 1123` | 通过（单页） |
| 路线 A 长文档 | `./probe A 6` | `createPDF OK bytes=21623`；1 页；MediaBox `0 0 779 1378`（内容自然高度，**未分页**） | 通过（单页，内容完整） |
| 路线 A + A4 rect（首页） | `./probe AR1 6` | `rect pdf bytes=20430 rect=(0,0,595,842)`；MediaBox `0 0 595 842` | 通过（精确 A4） |
| 路线 A + A4 rect（次页） | `./probe AR2 6` | `rect pdf bytes=12984 rect=(0,842,595,842)`；MediaBox `0 0 595 842` | 通过（不同内容区） |
| **路线 A′ 端到端** | `./probe PAG 12` | `content height = 2541 px` → `pages = 4` → `merged pageCount=4`；`file` → `4 pages`，每页 `595 842`，41126 字节 | **通过（分页 A4）** |
| 规模与耗时 | `./probe PAG 60` | `content height = 11844 px` → `pages = 15` → `merged pageCount=15`，160910 字节；`time` → 15 页约 **1.11s** | 通过 |

字体核验（`/Font` 对象计数）与中文渲染：路线 A 产物含 27~33 个 `/Font` 引用；探针 HTML 含中文与标点，未报缺字。PDF 为**矢量文字**（非位图截图），可选中、可搜索。

### 被否方案与证据（含反例，避免误导后续）

| 路线 | 做法 | 实测结论 | 证据 |
|---|---|---|---|
| **B0** | `NSPrintOperation`(`NSPrintSaveJob`) + `[op runOperation]`，`showsPrintPanel=NO` | **不可用**：进程不返回并持续膨胀（看门狗 20s 强杀，产物 18MB / 73023 页） | `./probe B0 0` → `exit=137`；`B0_p0.pdf pages=73023` |
| **B1** | 同上，改 `runOperationModalForWindow` | **未产出文件**：调用立即返回，目标路径无文件 | `./probe B1 0` → `rc=0 size=-1` |
| **B2** | B1 + `ActivationPolicyRegular` + `makeKeyAndOrderFront` | **未产出文件** | `./probe B2 0` → `rc=0 size=-1` |
| **B3** | B1 + 真实 `NSApp run` 事件循环 + `sharedPrintInfo`（与 Wails `Application.m:480` 同源） | **未产出文件**：`runOperationModalForWindow returned` 后正常退出，仍无文件 | `./probe B3 0` → `rc=0 size=-1` |
| **C** | 沿用 `window.print()` 并尝试设页眉页脚 / 自动落盘 | **不可行**：`window.print()` 无法预置 `NSPrintInfo`，也无法自动落盘；Wails 的包装 `showsPrintPanel=YES` 硬编码 | `Application.m:492` |
| **D1** | 前端 `html2canvas` + `jsPDF` 类栅格化 | 不采用：位图 PDF，放大模糊、体积大、文字不可选 | 技术特性使然（未实测，因方案定性即不满足「交付级 PDF」） |
| **D2** | 外部二进制（wkhtmltopdf / weasyprint / headless Chrome） | 不采用：本机 `which wkhtmltopdf`/`weasyprint` 均 not found；会引入外部依赖，违背「纯本地零外部依赖」基线 | `which wkhtmltopdf` → not found；`which weasyprint` → not found |

**为何放弃路线 B**：`printOperationWithPrintInfo:`（`WKWebView.h:585`）本身可用，Wails 正是用它（`Application.m:491`），但**「保存到文件」的 disposition 在无宿主打印会话时不生效**——四种变体（阻塞式 / 模态式 / 前台窗口 / 真实事件循环 + `sharedPrintInfo`）无一产出文件，其中 `runOperation` 还出现失控膨胀。该路径**不可靠**，不作为交付依赖。（`chromedp` 路线同理不采用：本机虽有 Google Chrome.app，但**打包分发不可能假设用户装有 Chrome**，且 headless 启动开销巨大。）

## Consequences

### 正面

- **完全满足 D-3 的核心诉求**：应用内一次调用直出 `.pdf`，**全程不弹任何系统对话框**（仅走系统「保存到哪」对话框）。已由 `PAG` 探针端到端实测。
- **真分页**：以 `rect` 精确切正文带（**467 × 714 pt**）逐页渲染，再于 PDFKit 合成 595×842 A4 页并叠加页眉页脚——分页由我们控制，不依赖打印系统。
- **矢量文字 + 字体内嵌**：`createPDFWithConfiguration` 输出的是矢量 PDF（非截图），可选中 / 可搜索 / 可打印无损（`/Font` 引用实测存在）。
- **与现有架构同构**：导出 HTML 复用 `frontend/src/export/exporters.js` 的自包含模板（含三主题内联样式），**PDF 与 HTML 共用同一份样式源**，保证「所见即所得」。
- **零新增 Go 依赖**：合并用系统 `PDFKit`，渲染用系统 `WebKit`，不引入第三方 PDF 库（无供应链面）。
- **不触碰 Wails 私有内部**：自建离屏 webview，不依赖 `FindExistingWebView` 定位宿主（该能力已验证可用，仅作备选）。
- **性能充裕**：15 页约 1.1s（实测），远低于交互可感阈值。

### 负面 / 风险（如实列出）

1. **平台限定 macOS**（高，但符合项目定位）。本方案依赖 AppKit / WebKit / PDFKit，仅 `darwin` 可用；Windows / Linux 需按 build tag 走降级（见 §降级路径）。项目本身以 macOS 为第一形态（Wails darwin + ⌘ 系快捷键 + ADR-001 桌面取向）。
2. **cgo 进入 Go 构建链**（中）。新增 `*_darwin.go`（`import "C"`）+ `*.m` 需 clang/ObjC 工具链。Wails darwin 构建本就使用 cgo，兼容性风险低；探针已证实同一 Go/cgo 工具链可编译链接 `Cocoa + WebKit + PDFKit`。**缓解**：把 cgo 全部收敛到 `export_pdf_darwin.*` 三文件，`go build` 面向非 darwin 时由 `export_pdf_other.go` 顶替，主模块不因缺 ObjC 工具链而失败。
3. **多页产物为「多次渲染 + 合并」**（低）。N 页需 N 次 `createPDFWithConfiguration`；实测 15 页 1.1s，且单次渲染成本随页数线性。**上限保护**：页数硬上限（探针取 500）防超长文档失控。
4. **页眉页脚：本期实施（P0，已由 team-lead 裁决）**。本 phase **必须实现**——理由：用户选「一键直出」的动机是**控制权**，而页眉页脚恰是走系统打印面板时用户能自行勾选的项，若换成更贵的技术路线反而丢掉它，等于「花大钱买更差的结果」。**实现方案已定**：在 PDFKit 合并阶段对每页用 `NSAttributedString` 叠加绘制。**视觉规格已由设计师出具**（`docs/design/phaseC-visual-spec.md` §8），硬约束已并入上文「页面几何与页眉页脚」：正文带 **714pt**、正文宽 **467pt**、四角色字色映射（`--muted`/`--meta`/`--fg-2`/`--muted`）、字体 `--font-body`、`dark → 强制映射 light`。工期约 +0.5~1 天。
5. **目录为 P1**（低）。降级方案：前端用现有 `editor/outline.js` 抽取标题 → 生成「目录页 HTML」作为文档第 1 页，或经 PDFKit `PDFDocument` 的 outline API 生成书签。
6. **测量约定须固化为契约**（中）。分页依赖 `document.documentElement.scrollHeight`（CSS px）与 PDF pt 的 **1:1** 假设——探针已实证成立（rect 单位即 pt）；**该 1:1 已被设计规格 §8.2 独立复用**（其以探针的 `11844px ÷ 842 = 14.07 → 15 页` 反推「1 CSS px = 1 pt」，并据此定 9pt = 正文 0.6×）。**若前端给导出 HTML 加 `zoom`/`transform: scale`，该假设即破**，会导致页数与裁切错位。**硬约束**：导出 HTML 禁止在根元素上使用缩放变换；正文版式宽度按 **467pt** 给定，不得靠缩放凑。
7. **超大文档须显式失败，不得静默**（中）。页数硬上限维持 **500**（约数十万字，远超个人写作工具真实场景；改流式写入会增加复杂度与新失败面，与「MVP 先跑通」冲突）。**硬要求**：超过 500 页时**必须给出明确可读的错误提示并中止导出**，**禁止**静默截断或崩溃（呼应 `generated-code-failure-modes.md §1「沉默逻辑错误」——静默截断用户无从察觉）。

### 降级路径（推荐方案失败时）

| 级别 | 触发条件 | 退化为 | 代价 |
|---|---|---|---|
| L1 | PDFKit 合并在真实宿主中异常 | **单页 `createPDFWithConfiguration`**（探针已验证）：整篇作为一张长页 PDF | 失去 A4 分页与页眉页脚；内容完整、矢量、无对话框 |
| L2 | cgo / ObjC 集成受阻 | 保留现有 `window.print()`（`main.go:77` → `WindowPrint`） | 回到「弹系统打印对话框」（用户已拒绝，仅作技术兜底） |
| L3 | 非 macOS 平台 | **菜单项保持可用、不置灰**，触发 L2（`window.print()`）。菜单文案：darwin 显示「导出 PDF…」，非 darwin 显示「**导出 PDF…（本平台走系统打印）**」（文案直接拼在菜单项标题里，不做 tooltip——原生菜单的 tooltip 支持不可靠） | 非 mac 上无一键直出，但用户仍能出 PDF |

> 注 1：L1 仍是「一键直出、不弹对话框」，只是不分页——它是本 ADR 的**已验证保险**（`./probe A 6`）。
> 注 2：**L3 已由 team-lead 裁决（2026-10-01）**——非 macOS 走 L2 降级、**不置灰**。理由：「能出 PDF」优于「完全不能用」；置灰会让用户以为功能坏了。（若用户在三文档确认时改判，team-lead 会即时通知并回改本条。）

## 已裁决与待办

**已裁决（team-lead，2026-10-01，本条覆盖此前所有指令）：**

| # | 事项 | 裁决 |
|---|---|---|
| 1 | 页眉页脚 | **本期必做（P0）**；实现维持「PDFKit 合并阶段逐页叠加」；视觉规格见设计规格 §8（硬约束已并入上文「页面几何与页眉页脚」） |
| 2 | 非 macOS 平台策略 | **走 L2 降级，不置灰**；菜单文案非 darwin 显示「导出 PDF…（本平台走系统打印）」（见 §降级路径 L3） |
| 3 | 页数上限 | **维持 500**；超限必须**明确报错并中止**，禁止静默截断或崩溃（见 §Consequences 风险 7） |
| 4 | 正文带宽（§8.4 基线） | **已裁决：取读法 B，正文带 714pt**——页眉/页脚 24pt 落在 64pt 边距之内，**不参与相加**。原「§8.4 基线不自洽待复核」就此关闭（见上文「页面几何与页眉页脚」） |

**一致性核对结论（team-lead 2026-10-01 逐项比对设计规格 §8 与技术基线）**：字号 9pt —— 一致；字体用 `--font-body` —— 一致；页脚「第 X / N 页」（斜杠两侧各一空格）—— 一致；字色 —— **有偏差，已按设计规格修正**为四角色分别映射（见上文「页面几何与页眉页脚」与 §Consequences 风险 4）；正文带宽 —— **原 §8.4 两种读法不自洽，已裁决取读法 B（714pt，24pt 在边距内不参与相加）**。

**待办（实施期）：**

- **真实 Wails 宿主内的集成验证**（约 0.5 天）：「离屏 webview + PDFKit」探针已独立跑通；在 Wails 进程内，AppKit 主线程与 Wails 主循环的关系需一次实机确认（预期无冲突：渲染均在主线程串行、不使用打印会话）。
- ~~**页眉页脚视觉规格对齐**~~：**已完成**——设计规格 §8 到位，本 ADR 已按 §8 逐项交叉核对（字号 / 颜色 token / 字体 / 页码文案 / 正文带宽），结论见上方「一致性核对结论」。
- **页数上限与超长文档策略**：探针取 500 页硬上限；实施期确认该上限对目标用户是否足够。

## Related ADRs

- ADR-001（图标方案）：导出 PDF 图标沿用 `printer`（`ADR-001:44`），不新增图标。
- ADR-002（Token 分层）：导出 HTML 的内联样式参照 `exporters.js` 的「自包含模板豁免」（`ADR-002` 组件层禁止裸 hex 之例外）。
- ADR-004（快捷键）：`⌘P` 语义从「打印」改为「一键导出 PDF」，见 `ADR-004-keybinding-map.md`。
