# Inkmark — 跨平台 Markdown 编辑器（Wails + Vue）

技术栈：**Go (Wails v2) + Vue 3 + CodeMirror 6 + markdown-it + highlight.js**

## 已实现能力

| 功能 | 实现 |
|---|---|
| Markdown 编辑 + 语法高亮 | CodeMirror 6（`src/editor/`），写作工具形态：无行号、无整行高亮、正文栈 15px |
| 实时预览 | markdown-it + highlight.js（`src/preview/`），正文限宽居中 |
| **原生菜单栏** | macOS 顶部系统菜单栏；Windows/Linux 窗口内菜单条（`main.go` 的 `buildMenu`，事件发给前端） |
| 快捷键 | ⌘O 打开 / ⌘⇧O 打开文件夹 / ⌘S 保存 / ⌘⇧S 另存为 / ⌘⇧H 导出 HTML / ⌘P 导出 PDF / ⌘⇧L 切换主题 |
| 明暗主题切换 | 单文件 Token（`src/themes/tokens/design-tokens.css`），`data-theme` 切换，localStorage 持久化 |
| 文本导出 | HTML：内联样式模板导出；PDF：走系统打印对话框（`src/export/`） |
| 本地文件管理 | 打开文件 / 打开文件夹，递归懒加载文件树（`app.go` + `src/components/FileTree.vue`） |
| 编辑/预览滚动联动 | 按比例映射 + 互斥锁（`App.vue`），两边内容区留白一致保证映射准确 |
| 分栏宽度可拖 | 编辑/预览之间的分割条可拖动调宽（20%~80%），双击复位，宽度持久化 |

## 目录结构

```
inkmark/
├── main.go              # 入口：窗口配置、原生应用菜单、绑定 App 服务
├── app.go               # 核心服务：文件对话框、读写文件、目录遍历（暴露给前端）
├── wails.json           # Wails 配置（前后端构建命令）
└── frontend/
    ├── src/
    │   ├── App.vue          # 主界面：顶栏（标题+主题）+ 侧栏 + 双栏布局
    │   ├── editor/          # CodeMirror 封装、代码围栏语言识别
    │   ├── preview/         # markdown-it 渲染配置
    │   ├── export/          # HTML 导出模板
    │   ├── themes/          # tokens/design-tokens.css（单文件 Token，含兼容别名层）+ base.css / preview.css
    │   └── components/      # FileTree / TreeNode + icons/（AppIcon.vue + paths.js）
    └── wailsjs/             # Wails 自动生成的 IPC 绑定（勿手改）
```

> **图标与许可**：界面图标几何衍生自 [Lucide](https://github.com/lucide-icons/lucide)（版本 `lucide-static@1.48.0`），
> 采用 **ISC 许可**（其中 `chevron-down` / `chevron-right` / `download` / `moon` / `x` 源自 Feather 项目，为 MIT 许可）。
> 许可全文见 [`frontend/src/components/icons/LICENSE`](frontend/src/components/icons/LICENSE)。
> 所有图标统一经 `frontend/src/components/icons/AppIcon.vue` 渲染，几何数据与语义白名单在 `paths.js`。

## 常用命令

```bash
# 开发（热重载，推荐）
~/go/bin/wails dev

# 生产构建（产物在 build/bin/）
~/go/bin/wails build

# 重新生成前端 IPC 绑定（改了 app.go 的导出方法后）
~/go/bin/wails generate module
```

> 本机网络需镜像：Go 依赖走 `GOPROXY=https://goproxy.cn,direct`，npm 走 `--registry=https://registry.npmmirror.com`，且先 `unset` 环境里的代理变量。

## 设计要点（为什么这么做）

1. **文件安全写入**：`WriteFile` 先写 `.tmp` 再 `rename`，避免写一半崩溃留下半个文件。
2. **文件树懒加载**：`ListDir` 只返回一层，点击目录才展开——千级文件的仓库也不会卡启动。
3. **主题=CSS 变量**：编辑器（CodeMirror theme）、预览排版、代码高亮 token 全部引用同一组变量，切换零成本；预览高亮没用 hljs 官方主题 CSS，而是把 token 色值做成了变量（`--hl-keyword` 等），保证明暗一致。
4. **滚动同步用比例映射 + 互斥锁**。三个坑都会让联动**静默失效**（本项目三个都踩过）：
   - CM6 的 `ViewUpdate` **没有 `scrollChanged` 属性**，监听编辑器滚动必须用原生事件
     `view.scrollDOM.addEventListener('scroll', ...)`；
   - `@scroll` 必须绑在**真正滚动的元素**上（是 `.preview-pane`，不是 `.preview-body`——后者不滚动，且 `scroll` 事件不冒泡）；
   - 编辑器 `.cm-content` 与预览区 `.preview-body` 的**上下留白必须一致**，两边可滚动高度才可比。
   后续可升级为按标题锚点映射（体验更好）。
5. **窗口拖拽用 `--wails-draggable`**：Wails 不读 `-webkit-app-region`（那是 Chromium 的，
   macOS WKWebView 不认）。顶栏设 `--wails-draggable: drag`，交互子元素设 `no-drag`。
6. **操作全在系统菜单栏**：设置 `options.Menu` 会整体替换默认菜单，必须把 `AppMenu` / `EditMenu` / `WindowMenu` 三个 Role 手动拼回来——尤其 EditMenu，丢了它 macOS 下 ⌘C/⌘V 会失效。菜单项只在 Go 侧发事件，业务逻辑统一在前端。
7. **渲染进程零 Node 能力**：前端只能通过生成的 `wailsjs` 绑定调 Go 方法，文件系统攻击面收在 `app.go`。

## 已知待办（骨架之后建议按序做）

- [ ] 预览渲染防抖（当前每次输入同步渲染，大文档会卡）
- [ ] 未保存关闭确认（拦截窗口关闭事件）
- [ ] 图片粘贴/拖拽插入（配合 Go 端存到 assets 目录）
- [ ] 滚动同步升级为标题锚点映射
- [ ] 代码块高亮瘦身：`highlight.js/lib/common` 占了大头（当前 JS 包 1.7MB / gzip 590KB），可换成 `core` + 按需注册
- [ ] 文件树监听外部变更（fsnotify）
- [ ] 大纲视图（从预览 AST 提取标题）

## 关于插件系统（现在不做）

第一版全部功能内置。真有扩展需求时，推荐形态：**渲染进程加载 npm 包形式的插件**（Vue 组件 + markdown-it 插件），Go 端只做插件目录扫描和白名单加载，比做进程隔离沙箱成本低一个数量级。
