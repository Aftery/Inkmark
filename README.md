# Inkmark — 跨平台 Markdown 编辑器（Wails + Vue）

技术栈：**Go (Wails v2) + Vue 3 + CodeMirror 6 + markdown-it + highlight.js**

## 已实现能力

| 功能 | 实现 |
|---|---|
| Markdown 编辑 + 语法高亮 | CodeMirror 6（`src/editor/`） |
| 实时预览 | markdown-it + highlight.js（`src/preview/`） |
| 明暗主题切换 | 一套 CSS 变量两套值，`data-theme` 切换，localStorage 持久化（`src/themes/`） |
| 文本导出 | HTML：内联样式模板导出；PDF：走系统打印对话框（`src/export/`） |
| 本地文件管理 | 打开文件 / 打开文件夹，递归懒加载文件树（`app.go` + `src/components/FileTree.vue`） |
| 编辑/预览滚动联动 | 按比例映射 + 互斥锁（`App.vue`） |

## 目录结构

```
inkmark/
├── main.go              # 入口：窗口配置、绑定 App 服务
├── app.go               # 核心服务：文件对话框、读写文件、目录遍历（暴露给前端）
├── wails.json           # Wails 配置（前后端构建命令）
└── frontend/
    ├── src/
    │   ├── App.vue          # 主界面：工具栏 + 侧栏 + 双栏布局
    │   ├── editor/          # CodeMirror 封装、代码围栏语言识别
    │   ├── preview/         # markdown-it 渲染配置
    │   ├── export/          # HTML 导出模板
    │   ├── themes/          # CSS 变量主题 + 排版/高亮配色
    │   └── components/      # FileTree / TreeNode（递归懒加载）
    └── wailsjs/             # Wails 自动生成的 IPC 绑定（勿手改）
```

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
4. **滚动同步用比例映射**：带互斥锁防循环。后续可升级为按标题锚点映射（体验更好）。
5. **渲染进程零 Node 能力**：前端只能通过生成的 `wailsjs` 绑定调 Go 方法，文件系统攻击面收在 `app.go`。

## 已知待办（骨架之后建议按序做）

- [ ] 预览渲染防抖（当前每次输入同步渲染，大文档会卡）
- [ ] 未保存关闭确认（拦截窗口关闭事件）
- [ ] 图片粘贴/拖拽插入（配合 Go 端存到 assets 目录）
- [ ] 滚动同步升级为标题锚点映射
- [ ] 代码块高亮瘦身：`highlight.js/lib/common` 占了大头，可换成 `core` + 按需注册
- [ ] 文件树监听外部变更（fsnotify）
- [ ] 大纲视图（从预览 AST 提取标题）

## 关于插件系统（现在不做）

第一版全部功能内置。真有扩展需求时，推荐形态：**渲染进程加载 npm 包形式的插件**（Vue 组件 + markdown-it 插件），Go 端只做插件目录扫描和白名单加载，比做进程隔离沙箱成本低一个数量级。
