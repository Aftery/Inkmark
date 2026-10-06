/**
 * zh-CN.js — 简体中文字典（**基准语言，key 集合最全**）
 * ----------------------------------------------------------------------------
 * 契约见 docs/spec/SPEC-i18n-v1.md §2.1/§2.2。
 *
 * 【为什么是基准语言】key 完整性测试以本文件的 key 集合为准（AC-05）：
 * en-US.js / ja-JP.js 必须与这里**完全一致**（不多、不少不少）。
 * 新增文案时的顺序永远是：先在这里加 key → 再补另外两份 → 最后跑测试。
 * 漏补会被 `npm test` 当场报红，而不是等某个语种的界面出现空洞才发现。
 *
 * 【key 命名】'区域.字段'，区域对应 UI 区块（与组件一一对应），不按句子拆。
 * 不按句子拆的理由：同一句话在不同上下文常需不同措辞，硬绑成一句会让后续
 * 措辞调整变成改key（等于重翻译全站）。
 *
 * 【占位符】`{name}` 形式，由 t(key, params) 做串替换（见 index.js）。
 * 占位符名字**跨三种语言必须一致**（en-US / ja-JP 照抄），
 * 否则插值会静默失效、露出 `{path}` 这种原文。
 *
 * 注意·本文件只放**面向用户的 UI 文案**。以下三类不进字典：
 *   - 代码注释（解释「为什么」，译了反而不可读，见 Spec §7 坑 3）
 *   - 用户内容（Markdown 文档正文、文件名、目录名）
 *   - 导出模板文案（exporters.js，Spec §1 明确留待后续）
 */
export default {
  // ---- 通用弹层按钮 / 反馈 ----
  'common.close': '关闭',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.unknown': '未知',
  'common.loading': '加载中…',
  'common.saved': '已保存',
  'common.saving': '保存中…',
  'common.unsaved': '未保存',
  'common.saveFailed': '保存失败',
  'common.untitled': '未命名',

  // ---- 文档标题栏（App.vue 顶栏）----
  'doc.title': '文档',
  'doc.unsaved': '未保存的更改',
  'doc.unsavedMark': ' •',

  // ---- 侧栏（App.vue：文件 / 大纲双tab）----
  'sidebar.label': '侧栏',
  'sidebar.tab.files': '文件',
  'sidebar.tab.outline': '大纲',
  'sidebar.empty.hint': '打开一个文件夹，在侧栏浏览文件',
  'sidebar.empty.cta': '打开文件夹',

  // ---- 分隔条（拖动调宽）----
  'divider.ariaLabel': '编辑区宽度',
  'divider.title': '拖动调整宽度，双击复位，方向键微调',

  // ---- 专注模式一次性提示 ----
  'focus.toast': '已进入专注模式，Esc 退出',

  // ---- 状态栏 ----
  'statusbar.lineCol': '行 {line}, 列 {col}',
  'statusbar.words': '{count} 字',
  'statusbar.zoomTitle': '切换缩放（90 / 100 / 110 / 125%）',

  // ---- 工具条 ----
  'toolbar.label': '格式化工具条',
  'toolbar.undo': '撤销',
  'toolbar.redo': '重做',
  'toolbar.bold': '加粗',
  'toolbar.italic': '斜体',
  'toolbar.strike': '删除线',
  'toolbar.inlineCode': '行内代码',
  'toolbar.heading': '标题',
  'toolbar.quote': '引用',
  'toolbar.bulletList': '无序列表',
  'toolbar.orderedList': '有序列表',
  'toolbar.taskList': '任务列表',
  'toolbar.link': '链接',
  'toolbar.image': '图片',
  'toolbar.codeBlock': '代码块',
  'toolbar.table': '表格',
  'toolbar.hr': '分隔线',
  'toolbar.more': '更多格式',
  'toolbar.headingMenu': '标题级别',
  'toolbar.headingGroup': '标题',
  'toolbar.heading0': '正文',
  'toolbar.heading1': '标题 1',
  'toolbar.heading2': '标题 2',
  'toolbar.heading3': '标题 3',

  // ---- 大纲面板 ----
  'outline.label': '文档大纲',
  'outline.empty': '当前文档没有标题，用 # 开始一节',

  // ---- 历史快照面板 ----
  'history.label': '历史快照',
  'history.title': '历史快照',
  'history.snapshotNow': '立即快照',
  'history.empty.unsaved': '当前文档尚未保存到磁盘，暂无快照',
  'history.empty.loading': '读取中…',
  'history.empty.none':
    '还没有快照。持续编辑 3 分钟、手动保存或点「立即快照」后会自动生成，最多保留 10 版。',
  'history.restore': '恢复',

  // ---- 文件树 ----
  'tree.empty': '没有 Markdown 文件',
  'tree.loading': '加载中…',
  'tree.emptyDir': '（空目录）',

  // ---- 快捷键速查（仅描述列；键位串不译，见 Spec §7 坑 4）----
  'shortcuts.new': '新建文件',
  'shortcuts.open': '打开文件 / 打开文件夹',
  'shortcuts.save': '保存 / 另存为',
  'shortcuts.print': '打印',
  'shortcuts.exportPdf': '导出 PDF',
  'shortcuts.find': '查找（⌘⌥F 查找替换）',
  'shortcuts.jumpLine': '跳转到行',
  'shortcuts.moveLine': '上移 / 下移行',
  'shortcuts.dupLine': '在上方 / 下方复制当前行',
  'shortcuts.deleteLine': '删除当前行',
  'shortcuts.boldItalic': '加粗 / 斜体',
  'shortcuts.insertLink': '插入链接',
  'shortcuts.viewModes': '编辑 / 预览 / 双栏 / 阅读',
  'shortcuts.focus': '专注模式（Esc 退出）',
  'shortcuts.outline': '显示 / 隐藏大纲',
  'shortcuts.zoom': '放大 / 缩小 / 重置缩放',
  'shortcuts.theme': '切换主题',
  'shortcuts.settings': '设置',
  'shortcuts.list': '快捷键速查',

  // ---- 输入对话框（跳转到行 / 重命名共用）----
  'dialog.jumpToLine': '跳转到行',
  'dialog.rename': '重命名',
  'dialog.linePlaceholder': '1 ~ {total}',

  // ---- 快捷键速查弹层 ----
  'shortcutsDialog.title': '快捷键速查',

  // ---- 关于弹层 ----
  'about.title': '关于 Inkmark',
  'about.tagline': '一个安静的跨平台 Markdown 写作工具。',
  'about.version': '版本 {version}',
  'about.checkUpdate': '检查更新',
  'about.repo': '打开仓库',

  // ---- 设置面板 ----
  'settings.label': '设置',
  'settings.categoryLabel': '设置分类',
  'settings.cat.appearance': '外观',
  'settings.cat.editor': '编辑器',
  'settings.theme.label': '主题',
  'settings.theme.desc': '界面配色',
  'settings.theme.system': '跟随系统',
  'settings.theme.light': '浅色',
  'settings.theme.dark': '深色',
  'settings.theme.paper': '纸感',
  'settings.fontFamily.label': '正文字体',
  'settings.fontFamily.desc': '编辑与预览共用',
  'settings.fontFamily.system': '系统',
  'settings.fontFamily.serif': '衬线',
  'settings.fontFamily.mono': '等宽',
  'settings.fontSize.label': '正文字号',
  'settings.fontSize.desc': '两栏同步',
  'settings.lineHeight.label': '行距',
  'settings.lineHeight.desc': '正文行高',
  'settings.lineHeight.compact': '紧凑',
  'settings.lineHeight.standard': '标准',
  'settings.lineHeight.loose': '宽松',
  'settings.measure.label': '行宽',
  'settings.measure.desc': '预览正文宽度',
  'settings.measure.narrow': '窄',
  'settings.measure.standard': '标准',
  'settings.measure.wide': '宽',
  'settings.locale.label': '语言',
  'settings.locale.desc': '界面语言',
  'settings.autosave.label': '自动保存',
  'settings.autosave.desc': '停手后自动落盘',
  'settings.autosave.off': '关',
  'settings.autosave.seconds': '{n} 秒',
  'settings.snapshot.label': '快照间隔',
  'settings.snapshot.desc': '关后仅手动快照',
  'settings.snapshot.off': '关',
  'settings.snapshot.minutes': '{n} 分钟',
  'settings.reset': '恢复默认',
  'settings.resetConfirm': '确认恢复默认？',

  // ---- 操作结果toast ----
  'toast.imageUnsupported': '当前环境不支持插入图片',
  'toast.saveBeforeImage': '请先保存文档（⌘S）再插入图片',
  'toast.imageFailed': '插入图片失败：{error}',
  'toast.noSelection': '没有选中的内容',
  'toast.clipboardWriteFailed': '写入剪贴板失败',
  'toast.clipboardReadFailed': '读取剪贴板失败',
  'toast.clipboardEmpty': '剪贴板为空',
  'toast.lineOutOfRange': '行号超出范围（1 ~ {total}）',
  'toast.copiedHtml': '已复制为 HTML',
  'toast.copyFailed': '复制失败',
  'toast.checkUpdateFailed': '无法检查更新：{error}',
  'toast.newVersion': '发现新版本 {version}，正在打开下载页…',
  'toast.alreadyLatest': '已是最新版本（{version}）',
  'toast.updateUnavailable': '无法检查更新',
  'toast.syntaxLoaded': '已载入语法示例（⌘S 可另存）',
  'toast.newFile': '已新建文件，⌘S 保存到磁盘',
  'toast.saveBeforeRename': '请先保存文档（⌘S）再重命名',
  'toast.renameUnsupported': '当前环境不支持重命名',
  'toast.renamed': '已重命名',
  'toast.renameFailed': '重命名失败：{error}',
  'toast.autoSaveFailed': '自动保存失败：{error}',
  'toast.saveFailedWith': '保存失败：{error}',
  'toast.exportPdfDone': '已导出 PDF：{path}',
  'toast.exportFailed': '导出失败：{error}',
  'toast.snapshotDone': '已生成快照',
  'toast.restored': '已恢复到 {time}，可 ⌘Z 撤销',
  'toast.restoreFailed': '恢复失败：{error}',
  'toast.unknownError': '未知错误',
  'task.done': '已完成任务',
  'task.unchecked': '未完成任务',
  // ---- 自绘标题栏（TitleBar.vue）----
  'titlebar.file': '文件',
  'titlebar.help': '帮助',
  'titlebar.untitled': '未命名',
  'titlebar.new': '新建',
  'titlebar.open': '打开…',
  'titlebar.save': '保存',
  'titlebar.save-as': '另存为…',
  'titlebar.print': '打印…',
  'titlebar.shortcuts': '快捷键速查',
  'titlebar.edit': '编辑',
  'titlebar.format': '格式',
  'titlebar.view': '视图',
  'titlebar.window': '窗口',
  'titlebar.about': '关于 Inkmark',
  'titlebar.minimize': '最小化',
  'titlebar.zoom': '缩放窗口',
  'titlebar.close': '关闭',
  // ---- 斜杠命令面板（SlashCommand.vue）----
  'slash.code': '代码块',
  'slash.table': '表格',
  'slash.todo': '待办列表',
  'slash.quote': '引用',
  'slash.empty': '无匹配命令',

  // ---- 菜单项（自 useShortcuts.js 命令表引用；文案沿用原 Go 侧 locales.go）----
  'menu.openFolder': '打开文件夹…',
  'menu.rename': '重命名…',
  'menu.exportHtml': '导出 HTML…',
  'menu.exportPdf': '导出 PDF…',
  'menu.undo': '撤销',
  'menu.redo': '重做',
  'menu.cut': '剪切',
  'menu.copy': '拷贝',
  'menu.paste': '粘贴',
  'menu.selectAll': '全选',
  'menu.find': '查找…',
  'menu.findReplace': '查找并替换…',
  'menu.jumpLine': '跳转到行…',
  'menu.moveLineUp': '上移行',
  'menu.moveLineDown': '下移行',
  'menu.dupLine': '重复当前行',
  'menu.deleteLine': '删除当前行',
  'menu.copyAsHtml': '复制选区为 HTML',
  'menu.bold': '加粗',
  'menu.italic': '斜体',
  'menu.strike': '删除线',
  'menu.inlineCode': '行内代码',
  'menu.link': '链接',
  'menu.h1': '标题一',
  'menu.h2': '标题二',
  'menu.h3': '标题三',
  'menu.bulletList': '无序列表',
  'menu.orderedList': '有序列表',
  'menu.todoList': '任务列表',
  'menu.quote': '引用块',
  'menu.codeBlock': '代码块',
  'menu.insertImage': '图片…',
  'menu.insertTable': '表格',
  'menu.insertHr': '分割线',
  'menu.insertToc': '目录',
  'menu.clearFormat': '清除格式',
  'menu.focus': '专注模式',
  'menu.outline': '显示/隐藏大纲',
  'menu.zoomIn': '放大',
  'menu.zoomOut': '缩小',
  'menu.zoomReset': '重置缩放',
  'menu.theme': '切换主题',
  'menu.typewriter': '打字机模式',
  'menu.alwaysOnTop': '窗口置顶',
  'menu.minimize': '最小化',
  'menu.zoom': '缩放',
  'menu.settings': '设置…',
  'help.syntax': 'Markdown 语法示例',
}
