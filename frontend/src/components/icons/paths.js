/**
 * Inkmark 图标几何数据 + 语义白名单（全项目唯一锁定点）
 * ============================================================================
 * 来源仓库 : https://github.com/lucide-icons/lucide
 * 发布包   : lucide-static@1.48.0  （official static build of Lucide）
 * 拉取地址 : https://unpkg.com/lucide-static@1.48.0/icons/<name>.svg
 * 采集方式 : 逐文件下载后**逐字摘录 `<svg>` 内层标记**，未做任何重绘、缩放或凭记忆重构。
 * 许可     : ISC（部分源自 Feather 的图标为 MIT）—— 见同目录 ./LICENSE
 * 基准网格 : viewBox 0 0 24 24 · fill none
 *            stroke / stroke-width / 端点样式 **不写在数据里**，由 AppIcon.vue 统一注入
 *            （stroke="currentColor"、stroke-width=1.75、linecap/linejoin=round）
 *
 * 注意 · 数据模型（重要）
 *   value 是**完整内层 SVG 标记**，可含多个元素（circle / path / rect …），
 *   不是单条 path 的 d 值。Lucide 中多数图标为多元素结构
 *   （sun = circle + 8×line，file-text = 5×path，printer = 2×path + rect …），
 *   用单路径模型渲染会残缺。
 *
 * 规则：业务组件禁止直接引本文件、禁止内联裸 <svg>，只能通过 AppIcon.vue 渲染。
 * ============================================================================
 */

/** 图标几何库（37 个唯一几何；白名单，未登记的键不允许渲染） */
export const ICONS = {
  'file-text':
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" />',
  'folder-open':
    '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
  save:
    '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /> <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /> <path d="M7 3v4a1 1 0 0 0 1 1h7" />',
  download:
    '<path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" />',
  printer:
    '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /> <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" /> <rect x="6" y="14" width="12" height="8" rx="1" />',
  sun:
    '<circle cx="12" cy="12" r="4" /> <path d="M12 2v2" /> <path d="M12 20v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="m17.66 17.66 1.41 1.41" /> <path d="M2 12h2" /> <path d="M20 12h2" /> <path d="m6.34 17.66-1.41 1.41" /> <path d="m19.07 4.93-1.41 1.41" />',
  moon:
    '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />',
  'panel-left-close':
    '<rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M9 3v18" /> <path d="m16 15-3-3 3-3" />',
  'panel-left-open':
    '<rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M9 3v18" /> <path d="m14 9 3 3-3 3" />',
  'chevron-right': '<path d="m9 18 6-6-6-6" />',
  'chevron-down':  '<path d="m6 9 6 6 6-6" />',
  x: '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',

  // ---- Phase C 新增 24 个（来源 docs/design/phaseC-visual-spec.md 附录 A，逐字摘录）----

  // 顶栏
  'pen-line':
    '<path d="M13 21h8" /> <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />',
  'sun-moon':
    '<path d="M12 2v2" /> <path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715" /> <path d="M16 12a4 4 0 0 0-4-4" /> <path d="m19 5-1.256 1.256" /> <path d="M20 12h2" />',
  monitor:
    '<rect width="20" height="14" x="2" y="3" rx="2" /> <line x1="8" x2="16" y1="21" y2="21" /> <line x1="12" x2="12" y1="17" y2="21" />',
  newspaper:
    '<path d="M15 18h-5" /> <path d="M18 14h-8" /> <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" /> <rect width="8" height="4" x="10" y="6" rx="1" />',

  // 工具条 G1 历史
  'undo-2':
    '<path d="M9 14 4 9l5-5" /> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
  'redo-2':
    '<path d="m15 14 5-5-5-5" /> <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',

  // 工具条 G2 行内
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />',
  italic:
    '<line x1="19" x2="10" y1="4" y2="4" /> <line x1="14" x2="5" y1="20" y2="20" /> <line x1="15" x2="9" y1="4" y2="20" />',
  strikethrough:
    '<path d="M16 4H9a3 3 0 0 0-2.83 4" /> <path d="M14 12a4 4 0 0 1 0 8H6" /> <line x1="4" x2="20" y1="12" y2="12" />',
  code: '<path d="m16 18 6-6-6-6" /> <path d="m8 6-6 6 6 6" />',

  // 工具条 G3 块级 / 列表
  heading: '<path d="M6 12h12" /> <path d="M6 20V4" /> <path d="M18 20V4" />',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /> <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />',
  list:
    '<path d="M3 5h.01" /> <path d="M3 12h.01" /> <path d="M3 19h.01" /> <path d="M8 5h13" /> <path d="M8 12h13" /> <path d="M8 19h13" />',
  'list-ordered':
    '<path d="M11 5h10" /> <path d="M11 12h10" /> <path d="M11 19h10" /> <path d="M4 4h1v5" /> <path d="M4 9h2" /> <path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" />',
  'list-todo':
    '<path d="M13 5h8" /> <path d="M13 12h8" /> <path d="M13 19h8" /> <path d="m3 17 2 2 4-4" /> <rect x="3" y="4" width="6" height="6" rx="1" />',

  // 工具条 G4 插入
  link:
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
  'square-code':
    '<path d="m10 9-3 3 3 3" /> <path d="m14 15 3-3-3-3" /> <rect x="3" y="3" width="18" height="18" rx="2" />',
  table:
    '<path d="M12 3v18" /> <rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M3 9h18" /> <path d="M3 15h18" />',
  minus: '<path d="M5 12h14" />',

  // 工具条 G5 溢出
  ellipsis: '<circle cx="12" cy="12" r="1" /> <circle cx="19" cy="12" r="1" /> <circle cx="5" cy="12" r="1" />',

  // 状态栏保存态
  'circle-check': '<circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" />',
  loader:
    '<path d="M12 2v4" /> <path d="m16.2 7.8 2.9-2.9" /> <path d="M18 12h4" /> <path d="m16.2 16.2 2.9 2.9" /> <path d="M12 18v4" /> <path d="m4.9 19.1 2.9-2.9" /> <path d="M2 12h4" /> <path d="m4.9 4.9 2.9 2.9" />',
  'circle-dot': '<circle cx="12" cy="12" r="1" /> <circle cx="12" cy="12" r="10" />',
}

/**
 * 语义名 → 几何名 白名单（39 个语义 / 37 个唯一几何）
 * 业务侧只允许使用这里的键；AppIcon resolve 失败时渲染空并告警。
 * 注：`chevron` 按方向拆为两个语义，避免「一个语义对应两种图形」的歧义。
 */
export const SEMANTICS = {
  'open-file':        'file-text',        // 顶栏 · 打开文件
  'open-folder':      'folder-open',      // 顶栏 · 打开文件夹
  save:               'save',             // 顶栏 · 保存
  'export-html':      'download',         // 顶栏 · 导出 HTML
  'export-pdf':       'printer',          // 顶栏 · 导出 PDF
  'theme-light':      'sun',              // 顶栏 · 切到亮色
  'theme-dark':       'moon',             // 顶栏 · 切到暗色
  'sidebar-collapse': 'panel-left-close', // 侧栏 · 折叠
  'sidebar-expand':   'panel-left-open',  // 侧栏 · 展开
  file:               'file-text',        // 文件树 · 文件
  folder:             'folder',           // 文件树 · 文件夹（收起）
  'folder-open':      'folder-open',      // 文件树 · 文件夹（展开）
  'chevron-right':    'chevron-right',    // 文件树 · 目录收起
  'chevron-down':     'chevron-down',     // 文件树 · 目录展开
  close:              'x',                // 浮层 · 关闭

  // ---- Phase C 新增语义（名称取自 docs/design/phaseC-visual-spec.md §2.2/§2.5/§3.3）----

  'brand-mark':    'pen-line',   // 顶栏左 · 品牌笔迹（非交互，aria-hidden）
  'theme-toggle':  'sun-moon',   // 顶栏右 · 主题切换触发（下拉菜单）
  'theme-system':  'monitor',    // 主题菜单项 · 跟随系统
  'theme-paper':   'newspaper',  // 主题菜单项 · 纸感（theme-light/dark 复用既有 sun/moon）

  'format-undo':   'undo-2',       // 工具条 G1 · 撤销
  'format-redo':   'redo-2',       // 工具条 G1 · 重做
  'format-bold':   'bold',         // 工具条 G2 · 加粗（⌘⇧B）
  'format-italic': 'italic',       // 工具条 G2 · 斜体
  'format-strike': 'strikethrough',// 工具条 G2 · 删除线
  'format-code':   'code',         // 工具条 G2 · 行内码（与代码块图标不可混用）
  'format-heading':'heading',      // 工具条 G3 · 标题（下拉）
  'format-quote':  'quote',        // 工具条 G3 · 引用
  'format-ul':     'list',         // 工具条 G3 · 无序列表
  'format-ol':     'list-ordered', // 工具条 G3 · 有序列表
  'format-task':   'list-todo',    // 工具条 G3 · 任务列表
  'format-link':   'link',         // 工具条 G4 · 链接
  'format-image':  'image',        // 工具条 G4 · 图片
  'format-codeblock':'square-code',// 工具条 G4 · 围栏代码块（与行内码图标不可混用）
  'format-table':  'table',        // 工具条 G4 · 表格
  'format-hr':     'minus',        // 工具条 G4 · 分隔线
  more:            'ellipsis',     // 工具条 G5 · 更多（溢出菜单触发）

  'save-ok':       'circle-check', // 状态栏 · 已保存
  'save-saving':   'loader',       // 状态栏 · 保存中（CSS 旋转）
  'save-dirty':    'circle-dot',   // 状态栏 · 未保存
}

/** 解析语义名或几何名 → 内层标记；未命中返回 ''（由 AppIcon 兜底） */
export function resolveIcon(name) {
  if (Object.prototype.hasOwnProperty.call(SEMANTICS, name)) {
    return ICONS[SEMANTICS[name]] ?? ''
  }
  if (Object.prototype.hasOwnProperty.call(ICONS, name)) {
    return ICONS[name]
  }
  return ''
}
