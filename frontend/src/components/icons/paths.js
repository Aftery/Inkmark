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

/** 图标几何库（13 个唯一几何；白名单，未登记的键不允许渲染） */
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
}

/**
 * 语义名 → 几何名 白名单（15 个语义 / 13 个唯一几何）
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
