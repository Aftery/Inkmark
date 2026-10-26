/**
 * asset-url.test.mjs — 文档相对图片路径改写的契约（2026-10-15 新增）
 * ---------------------------------------------------------------------------
 * 被测对象：frontend/src/editor/assetUrl.js（resolveAssetSrc / setDocPath）
 *           + preview/markdown.js 的 image 规则 + editor/wysiwyg.js 的 ImageWidget
 *
 * 为什么必须机检：这条链路的所有失败都是「图片不显示但不报错」—— 编辑器 onError
 * 降级成碎图占位、预览渲染出 404 的 <img>，两处都静默。缺陷本体是「webview 的
 * origin 是构建产物目录，文档相对路径解析不到磁盘文件」，改写口径（/doc-assets/
 * 前缀、改写范围、导出不改写）在这里钉住。
 *
 * 前缀的 Go 一头在 docassets_test.go（docAssetsPrefix 常量逐字比对，见最末一条）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { setDocPath, resolveAssetSrc } from '../src/editor/assetUrl.js'
import { createRenderer, render } from '../src/preview/markdown.js'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('resolveAssetSrc · 改写口径', () => {
  test('未落盘文档不改写（没有可解析的根，保持与改写前一致）', () => {
    setDocPath('')
    assert.equal(resolveAssetSrc('assets/x.png'), 'assets/x.png')
  })

  test('落盘后：文档相对路径 → /doc-assets/ 前缀（./ 前缀与中文/空格逐段编码）', () => {
    setDocPath('/Users/aftery/Desktop/笔记.md')
    assert.equal(resolveAssetSrc('assets/img-1.png'), '/doc-assets/assets/img-1.png')
    assert.equal(resolveAssetSrc('./assets/img-1.png'), '/doc-assets/assets/img-1.png')
    assert.equal(
      resolveAssetSrc('截图 说明.png'),
      '/doc-assets/%E6%88%AA%E5%9B%BE%20%E8%AF%B4%E6%98%8E.png'
    )
  })

  test('外部源一律原样：data:/blob:/https?:/wails:/origin 绝对路径', () => {
    setDocPath('/Users/aftery/Desktop/笔记.md')
    assert.equal(resolveAssetSrc('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
    assert.equal(resolveAssetSrc('blob:https://x/y'), 'blob:https://x/y')
    assert.equal(resolveAssetSrc('https://example.com/a.png'), 'https://example.com/a.png')
    assert.equal(resolveAssetSrc('wails://wails.localhost/a.png'), 'wails://wails.localhost/a.png')
    assert.equal(resolveAssetSrc('/abs.png'), '/abs.png')
  })

  test('空 src 原样返回（markdown-it 侧已另判，此处防御）', () => {
    setDocPath('/Users/aftery/Desktop/笔记.md')
    assert.equal(resolveAssetSrc(''), '')
    assert.equal(resolveAssetSrc(undefined), undefined)
  })
})

describe('preview image 规则 · 预览改写 / 导出保真', () => {
  const md = createRenderer()

  test('resolveAssets:true：预览面的 <img src> 指向 /doc-assets/', () => {
    const html = render(md, '![](assets/img-1.png)\n', { resolveAssets: true })
    assert.match(html, /<img src="\/doc-assets\/assets\/img-1.png"/)
  })

  test('默认分支不改写：导出 HTML 与文档同级，磁盘相对路径本来就是对的', () => {
    const html = render(md, '![](assets/img-1.png)\n')
    assert.match(html, /<img src="assets\/img-1.png"/)
    assert.ok(!html.includes('/doc-assets/'), '导出面不许出现 wails 内部 URL')
  })

  test('开关逐次渲染生效，不残留（先改写后默认，第二条必须干净）', () => {
    const a = render(md, '![](assets/x.png)\n', { resolveAssets: true })
    assert.match(a, /src="\/doc-assets\//)
    const b = render(md, '![](assets/x.png)\n')
    assert.ok(!b.includes('/doc-assets/'))
  })
})

describe('改写口径的唯一性（两处消费方不许各写一份）', () => {
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

  test('wysiwyg 的 ImageWidget 走 resolveAssetSrc，不得自己拼 src', () => {
    // 【锚点随实现搬迁】ImageWidget 于 2026-10-25 从 editor/wysiwyg.js 抽到
    // editor/imageWidget.js（wysiwyg.js 顶到 300 有效代码行红线，图片与行内
    // 文本渲染无耦合）。wysiwyg.js 仍 re-export 它，故消费方导入路径不变，
    // 但**源码文本**在新文件里，断言改读新文件。断言强度未变。
    const code = stripComments(readFileSync(join(HERE, '../src/editor/imageWidget.js'), 'utf8'))
    assert.ok(
      code.includes('resolveAssetSrc(this.src)'),
      'ImageWidget.toDOM 必须经 assetUrl.resolveAssetSrc 改写'
    )
    assert.ok(
      !/img\.src\s*=\s*this\.src/.test(code),
      'ImageWidget 不许直接用未改写的 src（会 404 成碎图占位）'
    )
  })

  test('预览与 Go 的前缀一字不差（/doc-assets/ 两头各守一份）', () => {
    const go = readFileSync(join(HERE, '../../docassets.go'), 'utf8')
    const m = go.match(/docAssetsPrefix = "([^"]+)"/)
    assert.ok(m, 'docassets.go 里找不到 docAssetsPrefix 常量')
    assert.equal(m[1], '/doc-assets/')
    const fe = readFileSync(join(HERE, '../src/editor/assetUrl.js'), 'utf8')
    assert.ok(fe.includes("'/doc-assets/'"), 'assetUrl.js 必须用同一前缀')
  })
})
