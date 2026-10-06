/**
 * ja-JP.js — 日本語辞書
 * ----------------------------------------------------------------------------
 * 【key 集合必须与 zh-CN.js 完全一致】（AC-05）。基准语言是 zh-CN.js：
 * 同样的 key，不多不少 —— 漏补会让 `npm test` 当场报红。
 * プレースホルダ名（{name}）沿用 zh-CN 的写法：改名会让插值静默失效，
 * 界面上直接露出 `{path}` 这种原文。
 */
export default {
  // ---- 共通ダイアログのボタン / 通知 ----
  'common.close': '閉じる',
  'common.cancel': 'キャンセル',
  'common.confirm': 'OK',
  'common.unknown': '不明',
  'common.loading': '読み込み中…',
  'common.saved': '保存済み',
  'common.saving': '保存中…',
  'common.unsaved': '未保存',
  'common.saveFailed': '保存に失敗しました',
  'common.untitled': '無題',

  // ---- タイトルバー ----
  'doc.title': 'ドキュメント',
  'doc.unsavedMark': ' •',

  // ---- サイドバー（ファイル / アウトライン）----
  'sidebar.label': 'サイドバー',
  'sidebar.tab.files': 'ファイル',
  'sidebar.tab.outline': 'アウトライン',
  'sidebar.empty.hint': 'フォルダを開くと、ここでファイルを一覧できます',
  'sidebar.empty.cta': 'フォルダを開く',

  // ---- 仕切りバー（ドラッグで幅調整）----
  'divider.ariaLabel': 'エディタの幅',
  'divider.title': 'ドラッグで幅を調整、ダブルクリックでリセット、矢印キーで微調整',

  // ---- 集中モードの一度きりの案内 ----
  'focus.toast': '集中モードになりました（Esc で終了）',

  // ---- ステータスバー ----
  'statusbar.lineCol': '{line} 行, {col} 列',
  'statusbar.words': '{count} 文字',
  'statusbar.zoomTitle': 'ズームを切り替え（90 / 100 / 110 / 125%）',

  // ---- ツールバー ----
  'toolbar.label': '書式ツールバー',
  'toolbar.undo': '取り消す',
  'toolbar.redo': 'やり直す',
  'toolbar.bold': '太字',
  'toolbar.italic': '斜体',
  'toolbar.strike': '取り消し線',
  'toolbar.inlineCode': 'インラインコード',
  'toolbar.heading': '見出し',
  'toolbar.quote': '引用',
  'toolbar.bulletList': '箇条書き',
  'toolbar.orderedList': '番号付きリスト',
  'toolbar.taskList': 'タスクリスト',
  'toolbar.link': 'リンク',
  'toolbar.image': '画像',
  'toolbar.codeBlock': 'コードブロック',
  'toolbar.table': '表',
  'toolbar.hr': '区切り線',
  'toolbar.more': 'その他の書式',
  'toolbar.headingMenu': '見出しレベル',
  'toolbar.headingGroup': '見出し',
  'toolbar.heading0': '本文',
  'toolbar.heading1': '見出し 1',
  'toolbar.heading2': '見出し 2',
  'toolbar.heading3': '見出し 3',

  // ---- アウトラインパネル ----
  'outline.label': 'ドキュメントのアウトライン',
  'outline.empty': 'このドキュメントには見出しがありません。# で始められます',

  // ---- 履歴スナップショットパネル ----
  'history.label': 'スナップショット履歴',
  'history.title': 'スナップショット履歴',
  'history.snapshotNow': '今すぐ記録',
  'history.empty.unsaved': 'このドキュメントはまだディスクに保存されていないため、スナップショットはありません',
  'history.empty.loading': '読み込み中…',
  'history.empty.none':
    'スナップショットはまだありません。3 分続けて編集するか、手動で保存するか、「今すぐ記録」を押すと自動生成されます（最大 10 版）。',
  'history.restore': '復元',

  // ---- ファイルツリー ----
  'tree.empty': 'Markdown ファイルがありません',
  'tree.loading': '読み込み中…',
  'tree.emptyDir': '（空のフォルダ）',

  // ---- ショートカット一覧（説明のみ。キー表記は翻訳しない）----
  'shortcuts.new': '新規ファイル',
  'shortcuts.open': 'ファイルを開く / フォルダを開く',
  'shortcuts.save': '保存 / 名前を付けて保存',
  'shortcuts.print': '印刷',
  'shortcuts.exportPdf': 'PDF を書き出す',
  'shortcuts.find': '検索（⌘⌥F で置換）',
  'shortcuts.jumpLine': '行へ移動',
  'shortcuts.moveLine': '行を上 / 下へ移動',
  'shortcuts.dupLine': '行を上に / 下に複製',
  'shortcuts.deleteLine': '現在の行を削除',
  'shortcuts.boldItalic': '太字 / 斜体',
  'shortcuts.insertLink': 'リンクを挿入',
  'shortcuts.viewModes': '編集 / プレビュー / 分割 / 読書',
  'shortcuts.focus': '集中モード（Esc で終了）',
  'shortcuts.outline': 'アウトラインの表示 / 非表示',
  'shortcuts.zoom': '拡大 / 縮小 / リセット',
  'shortcuts.theme': 'テーマを切り替え',
  'shortcuts.settings': '設定',
  'shortcuts.list': 'ショートカット一覧',

  // ---- 入力ダイアログ（行へ移動 / 名前の変更で共用）----
  'dialog.jumpToLine': '行へ移動',
  'dialog.rename': '名前を変更',
  'dialog.linePlaceholder': '1 ~ {total}',

  // ---- ショートカット一覧ダイアログ ----
  'shortcutsDialog.title': 'ショートカット一覧',

  // ---- このアプリについて ----
  'about.title': 'Inkmark について',
  'about.tagline': '静かに書けるクロスプラットフォームの Markdown 執筆ツール。',
  'about.version': 'バージョン {version}',
  'about.repo': 'リポジトリを開く',

  // ---- 設定パネル ----
  'settings.label': '設定',
  'settings.categoryLabel': '設定の分類',
  'settings.cat.appearance': '外観',
  'settings.cat.editor': 'エディタ',
  'settings.theme.label': 'テーマ',
  'settings.theme.desc': '画面の配色',
  'settings.theme.system': 'システムに合わせる',
  'settings.theme.light': 'ライト',
  'settings.theme.dark': 'ダーク',
  'settings.theme.paper': 'ペーパー',
  'settings.fontFamily.label': '本文のフォント',
  'settings.fontFamily.desc': 'エディタとプレビューで共用',
  'settings.fontFamily.system': 'システム',
  'settings.fontFamily.serif': '明朝体',
  'settings.fontFamily.mono': '等幅',
  'settings.fontSize.label': '本文の文字サイズ',
  'settings.fontSize.desc': '左右のペインを同期',
  'settings.lineHeight.label': '行間',
  'settings.lineHeight.desc': '本文の行の高さ',
  'settings.lineHeight.compact': '狭く',
  'settings.lineHeight.standard': '標準',
  'settings.lineHeight.loose': '広く',
  'settings.measure.label': '行の幅',
  'settings.measure.desc': 'プレビューの本文幅',
  'settings.measure.narrow': '狭く',
  'settings.measure.standard': '標準',
  'settings.measure.wide': '広く',
  'settings.locale.label': '言語',
  'settings.locale.desc': '画面の言語',
  'settings.autosave.label': '自動保存',
  'settings.autosave.desc': '入力を止めると自動で保存',
  'settings.autosave.off': 'オフ',
  'settings.autosave.seconds': '{n} 秒',
  'settings.snapshot.label': 'スナップショットの間隔',
  'settings.snapshot.desc': 'オフにすると手動のみ',
  'settings.snapshot.off': 'オフ',
  'settings.snapshot.minutes': '{n} 分',
  'settings.reset': '初期設定に戻す',
  'settings.resetConfirm': '初期設定に戻しますか？',

  // ---- 結果通知 ----
  'toast.imageUnsupported': 'ここでは画像を挿入できません',
  'toast.saveBeforeImage': '画像を挿入する前にドキュメントを保存してください（⌘S）',
  'toast.imageFailed': '画像を挿入できませんでした：{error}',
  'toast.noSelection': '選択されている内容がありません',
  'toast.clipboardWriteFailed': 'クリップボードに書き込めませんでした',
  'toast.clipboardReadFailed': 'クリップボードを読み取れませんでした',
  'toast.clipboardEmpty': 'クリップボードは空です',
  'toast.lineOutOfRange': '行番号が範囲外です（1 ~ {total}）',
  'toast.copiedHtml': 'HTML としてコピーしました',
  'toast.copyFailed': 'コピーに失敗しました',
  'toast.checkUpdateFailed': '更新を確認できませんでした：{error}',
  'toast.newVersion': 'バージョン {version} が利用できます。ダウンロードページを開きます…',
  'toast.alreadyLatest': 'すでに最新です（{version}）',
  'toast.updateUnavailable': '更新を確認できませんでした',
  'toast.syntaxLoaded': '記法のサンプルを読み込みました（⌘S で別保存）',
  'toast.newFile': '新しいファイルを作成しました（⌘S で保存）',
  'toast.saveBeforeRename': '名前を変更する前にドキュメントを保存してください（⌘S）',
  'toast.renameUnsupported': 'ここでは名前を変更できません',
  'toast.renamed': '名前を変更しました',
  'toast.renameFailed': '名前の変更に失敗しました：{error}',
  'toast.autoSaveFailed': '自動保存に失敗しました：{error}',
  'toast.saveFailedWith': '保存に失敗しました：{error}',
  'toast.exportPdfDone': 'PDF を書き出しました：{path}',
  'toast.exportFailed': '書き出しに失敗しました：{error}',
  'toast.snapshotDone': 'スナップショットを作成しました',
  'toast.restored': '{time} の内容に戻しました（⌘Z で取り消し）',
  'toast.restoreFailed': '復元に失敗しました：{error}',
  'toast.unknownError': '不明なエラー',
}