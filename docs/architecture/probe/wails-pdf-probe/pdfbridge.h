// 探针头文件：判断当前 macOS/SDK 是否可用 WKWebView 程序化直出 PDF
#ifndef PDFBRIDGE_H
#define PDFBRIDGE_H

// 路线 A：createPDFWithConfiguration（macOS 11+），单页 PDF
int RenderHTMLToPDF(const char *html, const char *outPath);

// 路线 B：NSPrintOperation + NSPrintSaveJob，分页 A4 直存
// mode 0 = runOperation, 1 = runOperationModalForWindow
int RenderHTMLToPDFPrint(const char *html, const char *outPath, int mode);

// 路线 B3：真实 NSApp 事件循环下的 NSPrintSaveJob
int RenderHTMLToPDFPrintB3(const char *html, const char *outPath);

// 遍历 NSApp 窗口视图树定位 WKWebView（验证 Wails 集成路径），找不到返回 NULL
void *FindExistingWebView(void);

#endif
int RenderHTMLToPDFRect(const char *html, const char *outPath,
                        double x, double y, double w, double h);
int RenderHTMLToPDFPaginated(const char *html, const char *outPath, double pageW, double pageH);
