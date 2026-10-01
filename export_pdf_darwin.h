// Inkmark PDF 导出桥（darwin）：离屏 WKWebView 渲染 + PDFKit/CG 合成。
// 实现细节见 export_pdf_darwin.m，方案依据 docs/architecture/ADR-003-pdf-export.md。
#ifndef EXPORT_PDF_DARWIN_H
#define EXPORT_PDF_DARWIN_H

// 把自包含 HTML 渲染为分页 A4（595x842pt）PDF 并写入 outPath。
// 页眉页脚逐页叠加：左=docTitle、右=dateText；页脚右=「第 X / N 页」；
// 颜色（#RRGGBB / #RRGGBBAA / "r,g,b,a"）与字体族由调用方按主题传入，本桥不硬编码。
//
// 返回 0 成功；非 0 失败，errBuf 内为可读错误（UTF-8，可能为空串）。
int InkmarkRenderPDF(const char *html, const char *outPath,
                     const char *docTitle, const char *dateText,
                     const char *hfLeftColor, const char *hfRightColor,
                     const char *hfPageXColor, const char *hfPageNColor,
                     const char *hfFontFamily,
                     char *errBuf, int errBufLen);

#endif
