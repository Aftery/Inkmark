/**
 * en-US.js — English dictionary
 * ----------------------------------------------------------------------------
 * 【Key set must match zh-CN.js EXACTLY】(AC-05). zh-CN.js is the baseline:
 * same keys, no more, no fewer — `npm test` fails the build otherwise.
 * Placeholder names ({name}) are copied verbatim from zh-CN; renaming one
 * here silently breaks interpolation and leaks a literal "{path}" into the UI.
 */
export default {
  // ---- Shared dialog buttons / feedback ----
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.confirm': 'OK',
  'common.unknown': 'Unknown',
  'common.loading': 'Loading…',
  'common.saved': 'Saved',
  'common.saving': 'Saving…',
  'common.unsaved': 'Unsaved',
  'common.saveFailed': 'Save failed',
  'common.untitled': 'Untitled',

  // ---- Document title bar ----
  'doc.title': 'Document',
  'doc.unsavedMark': ' •',

  // ---- Sidebar (files / outline tabs) ----
  'sidebar.label': 'Sidebar',
  'sidebar.tab.files': 'Files',
  'sidebar.tab.outline': 'Outline',
  'sidebar.empty.hint': 'Open a folder to browse its files here',
  'sidebar.empty.cta': 'Open Folder',

  // ---- Divider (drag to resize) ----
  'divider.ariaLabel': 'Editor width',
  'divider.title': 'Drag to resize, double-click to reset, arrow keys to nudge',

  // ---- Focus mode one-time hint ----
  'focus.toast': 'Focus mode on — press Esc to exit',

  // ---- Status bar ----
  'statusbar.lineCol': 'Ln {line}, Col {col}',
  'statusbar.words': '{count} words',
  'statusbar.zoomTitle': 'Cycle zoom (90 / 100 / 110 / 125%)',

  // ---- Toolbar ----
  'toolbar.label': 'Formatting toolbar',
  'toolbar.undo': 'Undo',
  'toolbar.redo': 'Redo',
  'toolbar.bold': 'Bold',
  'toolbar.italic': 'Italic',
  'toolbar.strike': 'Strikethrough',
  'toolbar.inlineCode': 'Inline code',
  'toolbar.heading': 'Heading',
  'toolbar.quote': 'Quote',
  'toolbar.bulletList': 'Bulleted list',
  'toolbar.orderedList': 'Numbered list',
  'toolbar.taskList': 'Task list',
  'toolbar.link': 'Link',
  'toolbar.image': 'Image',
  'toolbar.codeBlock': 'Code block',
  'toolbar.table': 'Table',
  'toolbar.hr': 'Divider',
  'toolbar.more': 'More formats',
  'toolbar.headingMenu': 'Heading level',
  'toolbar.headingGroup': 'Heading',
  'toolbar.heading0': 'Body text',
  'toolbar.heading1': 'Heading 1',
  'toolbar.heading2': 'Heading 2',
  'toolbar.heading3': 'Heading 3',

  // ---- Outline panel ----
  'outline.label': 'Document outline',
  'outline.empty': 'This document has no headings — start one with #',

  // ---- History panel ----
  'history.label': 'Snapshot history',
  'history.title': 'Snapshot history',
  'history.snapshotNow': 'Snapshot now',
  'history.empty.unsaved': 'This document has never been saved to disk, so there are no snapshots',
  'history.empty.loading': 'Loading…',
  'history.empty.none':
    'No snapshots yet. One is taken after 3 minutes of continuous editing, on manual save, or when you click "Snapshot now". Up to 10 are kept.',
  'history.restore': 'Restore',

  // ---- File tree ----
  'tree.empty': 'No Markdown files',
  'tree.loading': 'Loading…',
  'tree.emptyDir': '(empty folder)',

  // ---- Shortcut cheat sheet (descriptions only; key caps are not translated) ----
  'shortcuts.new': 'New file',
  'shortcuts.open': 'Open file / Open folder',
  'shortcuts.save': 'Save / Save as',
  'shortcuts.print': 'Print',
  'shortcuts.exportPdf': 'Export PDF',
  'shortcuts.find': 'Find (⌘⌥F to replace)',
  'shortcuts.jumpLine': 'Go to line',
  'shortcuts.moveLine': 'Move line up / down',
  'shortcuts.dupLine': 'Duplicate line above / below',
  'shortcuts.deleteLine': 'Delete current line',
  'shortcuts.boldItalic': 'Bold / Italic',
  'shortcuts.insertLink': 'Insert link',
  'shortcuts.viewModes': 'Edit / Preview / Split / Reading',
  'shortcuts.focus': 'Focus mode (Esc to exit)',
  'shortcuts.outline': 'Show / Hide outline',
  'shortcuts.zoom': 'Zoom in / out / reset',
  'shortcuts.theme': 'Switch theme',
  'shortcuts.settings': 'Settings',
  'shortcuts.list': 'Keyboard shortcuts',

  // ---- Input dialog (go-to-line / rename) ----
  'dialog.jumpToLine': 'Go to line',
  'dialog.rename': 'Rename',
  'dialog.linePlaceholder': '1 ~ {total}',

  // ---- Shortcut cheat sheet dialog ----
  'shortcutsDialog.title': 'Keyboard shortcuts',

  // ---- About dialog ----
  'about.title': 'About Inkmark',
  'about.tagline': 'A quiet cross-platform Markdown writing tool.',
  'about.version': 'Version {version}',
  'about.repo': 'Open repository',

  // ---- Settings panel ----
  'settings.label': 'Settings',
  'settings.categoryLabel': 'Settings categories',
  'settings.cat.appearance': 'Appearance',
  'settings.cat.editor': 'Editor',
  'settings.theme.label': 'Theme',
  'settings.theme.desc': 'Interface colours',
  'settings.theme.system': 'Follow system',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.paper': 'Paper',
  'settings.fontFamily.label': 'Body font',
  'settings.fontFamily.desc': 'Shared by editor and preview',
  'settings.fontFamily.system': 'System',
  'settings.fontFamily.serif': 'Serif',
  'settings.fontFamily.mono': 'Monospace',
  'settings.fontSize.label': 'Body size',
  'settings.fontSize.desc': 'Synced across panes',
  'settings.lineHeight.label': 'Line height',
  'settings.lineHeight.desc': 'Body text leading',
  'settings.lineHeight.compact': 'Compact',
  'settings.lineHeight.standard': 'Standard',
  'settings.lineHeight.loose': 'Loose',
  'settings.measure.label': 'Line width',
  'settings.measure.desc': 'Preview body width',
  'settings.measure.narrow': 'Narrow',
  'settings.measure.standard': 'Standard',
  'settings.measure.wide': 'Wide',
  'settings.locale.label': 'Language',
  'settings.locale.desc': 'Interface language',
  'settings.autosave.label': 'Autosave',
  'settings.autosave.desc': 'Saves after you stop typing',
  'settings.autosave.off': 'Off',
  'settings.autosave.seconds': '{n}s',
  'settings.snapshot.label': 'Snapshot interval',
  'settings.snapshot.desc': 'When off, snapshots are manual only',
  'settings.snapshot.off': 'Off',
  'settings.snapshot.minutes': '{n} min',
  'settings.reset': 'Reset to defaults',
  'settings.resetConfirm': 'Reset to defaults?',

  // ---- Result toasts ----
  'toast.imageUnsupported': 'Inserting images is not supported here',
  'toast.saveBeforeImage': 'Save the document (⌘S) before inserting an image',
  'toast.imageFailed': 'Could not insert image: {error}',
  'toast.noSelection': 'Nothing is selected',
  'toast.clipboardWriteFailed': 'Could not write to the clipboard',
  'toast.clipboardReadFailed': 'Could not read the clipboard',
  'toast.clipboardEmpty': 'The clipboard is empty',
  'toast.lineOutOfRange': 'Line number out of range (1 ~ {total})',
  'toast.copiedHtml': 'Copied as HTML',
  'toast.copyFailed': 'Copy failed',
  'toast.checkUpdateFailed': 'Could not check for updates: {error}',
  'toast.newVersion': 'Version {version} available — opening the download page…',
  'toast.alreadyLatest': 'Already up to date ({version})',
  'toast.updateUnavailable': 'Could not check for updates',
  'toast.syntaxLoaded': 'Syntax sample loaded (⌘S to save a copy)',
  'toast.newFile': 'New file created — ⌘S to save it to disk',
  'toast.saveBeforeRename': 'Save the document (⌘S) before renaming',
  'toast.renameUnsupported': 'Renaming is not supported here',
  'toast.renamed': 'Renamed',
  'toast.renameFailed': 'Rename failed: {error}',
  'toast.autoSaveFailed': 'Autosave failed: {error}',
  'toast.saveFailedWith': 'Save failed: {error}',
  'toast.exportPdfDone': 'Exported PDF: {path}',
  'toast.exportFailed': 'Export failed: {error}',
  'toast.snapshotDone': 'Snapshot created',
  'toast.restored': 'Restored to {time} — ⌘Z to undo',
  'toast.restoreFailed': 'Restore failed: {error}',
  'toast.unknownError': 'Unknown error',
}