// Inkmark PDF 导出桥（darwin）—— ADR-003 路线 A′ 实现：
//   离屏 WKWebView 加载自包含 HTML
//   -> evaluateJavaScript 取 scrollHeight（CSS px，与 PDF pt 1:1，禁止前端缩放）
//   -> pages = ceil(H / 714)（正文分页带 714pt，已裁决读法 B：页眉/页脚 24pt 在 64pt
//      边距之内，不参与相加）
//   -> 逐页 createPDFWithConfiguration(rect=(0, i*714, 467, 714))（Web 页坐标，原点左上）
//   -> CGPDFContext 合成 595x842 页：正文切片平移落 (64, 64)（PDF 坐标，原点左下，
//      坑 20：两套坐标系必须显式换算），再用 Core Text 叠加页眉页脚（页眉基线
//      PDF y=784，页脚基线 PDF y=56，字号恒 9pt）——页眉页脚烧进文件而非
//      PDFPage 子类运行时叠加（后者不随 writeToFile 持久化）。
//   页数硬上限 500，超限显式报错并中止，禁止静默截断。

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <CoreText/CoreText.h>
#import "export_pdf_darwin_text.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "export_pdf_darwin.h"

// 页面几何（ADR-003 已裁决，勿改）
static const double kPageW = 595.0;
static const double kPageH = 842.0;
static const double kMargin = 64.0;
static const double kContentW = 467.0;
static const double kBand = 714.0;
static const int kMaxPages = 500;
static const double kHeaderBaselineY = 784.0; // 距页顶 58pt
static const double kFooterBaselineY = 56.0;  // 距页顶 786pt

@interface InkNavDelegate : NSObject <WKNavigationDelegate>
@property (assign) volatile BOOL finished;
@property (assign) volatile BOOL failed;
@end

@implementation InkNavDelegate
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation { self.finished = YES; }
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error { self.failed = YES; self.finished = YES; }
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { self.failed = YES; self.finished = YES; }
@end

static void SetErr(char *buf, int len, NSString *msg) {
    if (!buf || len <= 0) return;
    const char *utf8 = msg.UTF8String;
    snprintf(buf, (size_t)len, "%s", utf8 ? utf8 : "");
}

static void PumpRunLoop(NSTimeInterval seconds) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while ([deadline timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                 beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
}

static void WaitFor(volatile BOOL *flag, NSTimeInterval timeout, BOOL *timedOut) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:timeout];
    while (!*flag && [deadline timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                 beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    *timedOut = !*flag;
}

static int RenderPDFInner(const char *html, const char *outPath,
                          const char *docTitle, const char *dateText,
                          const char *hfLeftColor, const char *hfRightColor,
                          const char *hfPageXColor, const char *hfPageNColor,
                          const char *hfFontFamily,
                          char *errBuf, int errBufLen) {
    @autoreleasepool {
        (void)[NSApplication sharedApplication];

        NSRect frame = NSMakeRect(0, 0, kContentW, kBand);
        WKWebView *webView = [[WKWebView alloc] initWithFrame:frame
                                                configuration:[[WKWebViewConfiguration alloc] init]];
        InkNavDelegate *nav = [[InkNavDelegate alloc] init];
        webView.navigationDelegate = nav;

        NSWindow *win = [[NSWindow alloc] initWithContentRect:frame
                                                    styleMask:NSWindowStyleMaskBorderless
                                                      backing:NSBackingStoreBuffered
                                                        defer:NO];
        win.contentView = webView;

        [webView loadHTMLString:[NSString stringWithUTF8String:html] baseURL:nil];
        BOOL timedOut = NO;
        // 导航完成轮询（delegate 属性为 volatile BOOL，只读访问）
        NSDate *navDeadline = [NSDate dateWithTimeIntervalSinceNow:20.0];
        while (!nav.finished && [navDeadline timeIntervalSinceNow] > 0) {
            [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                     beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        }
        if (!nav.finished) { SetErr(errBuf, errBufLen, @"加载导出内容超时"); return 2; }
        if (nav.failed) { SetErr(errBuf, errBufLen, @"导出内容加载失败"); return 2; }

        __block double contentH = 0;
        __block BOOL gotH = NO;
        [webView evaluateJavaScript:@"document.documentElement.scrollHeight"
                  completionHandler:^(id r, NSError *e) {
            if ([r respondsToSelector:@selector(doubleValue)]) contentH = [r doubleValue];
            gotH = YES;
        }];
        WaitFor(&gotH, 10.0, &timedOut);
        if (!gotH) { SetErr(errBuf, errBufLen, @"获取内容高度超时"); return 2; }

        int pages = (int)ceil(contentH / kBand);
        if (pages < 1) pages = 1;
        if (pages > kMaxPages) {
            SetErr(errBuf, errBufLen,
                   [NSString stringWithFormat:@"文档过长：共 %d 页，超过单次导出上限 %d 页，已中止导出",
                       pages, kMaxPages]);
            return 3;
        }

        NSString *title = docTitle ? [NSString stringWithUTF8String:docTitle] : @"";
        NSString *date = dateText ? [NSString stringWithUTF8String:dateText] : @"";
        NSString *fontSpec = hfFontFamily ? [NSString stringWithUTF8String:hfFontFamily] : @"";
        CGColorRef cLeft = InkmarkCreateColorFromSpec(hfLeftColor ? @(hfLeftColor) : @"");
        CGColorRef cRight = InkmarkCreateColorFromSpec(hfRightColor ? @(hfRightColor) : @"");
        CGColorRef cPageX = InkmarkCreateColorFromSpec(hfPageXColor ? @(hfPageXColor) : @"");
        CGColorRef cPageN = InkmarkCreateColorFromSpec(hfPageNColor ? @(hfPageNColor) : @"");
        CTFontRef hfFont = InkmarkCreateFontFromFamily(fontSpec);

        CGRect mediaBox = CGRectMake(0, 0, kPageW, kPageH);
        CFMutableDataRef dataOut = CFDataCreateMutable(NULL, 0);
        CGDataConsumerRef consumer = CGDataConsumerCreateWithCFData(dataOut);
        CGContextRef outCtx = CGPDFContextCreate(consumer, &mediaBox, NULL);
        int rc = 0;

        if (!outCtx) {
            SetErr(errBuf, errBufLen, @"无法创建 PDF 输出上下文");
            rc = 4;
        }

        for (int i = 0; rc == 0 && i < pages; i++) {
            __block NSData *pageData = nil;
            __block BOOL done = NO;
            __block NSString *pageErr = nil;
            WKPDFConfiguration *pcfg = [[WKPDFConfiguration alloc] init];
            // Web 页坐标（原点左上，y 向下增长）：第 i 页取 y ∈ [i*714, (i+1)*714)
            pcfg.rect = CGRectMake(0, (double)i * kBand, kContentW, kBand);
            [webView createPDFWithConfiguration:pcfg
                              completionHandler:^(NSData *d, NSError *e) {
                if (d) pageData = [d retain];
                if (e) pageErr = [e.localizedDescription copy];
                done = YES;
            }];
            WaitFor(&done, 15.0, &timedOut);
            if (!pageData) {
                SetErr(errBuf, errBufLen,
                       pageErr ? [NSString stringWithFormat:@"渲染第 %d 页失败：%@", i + 1, pageErr]
                               : [NSString stringWithFormat:@"渲染第 %d 页超时", i + 1]);
                rc = 4;
                break;
            }

            CGDataProviderRef prov = CGDataProviderCreateWithCFData((__bridge CFDataRef)pageData);
            CGPDFDocumentRef srcDoc = CGPDFDocumentCreateWithProvider(prov);
            CGPDFPageRef srcPage = CGPDFDocumentGetPage(srcDoc, 1);
            if (!srcPage) {
                SetErr(errBuf, errBufLen,
                       [NSString stringWithFormat:@"第 %d 页切片解析失败", i + 1]);
                CGPDFDocumentRelease(srcDoc);
                CGDataProviderRelease(prov);
                rc = 4;
                break;
            }

            CGContextBeginPage(outCtx, &mediaBox);
            // 正文落页：PDF 坐标（原点左下）。切片 mediabox (0,0,467,714) 按 1:1
            // 平移到 (64, 64)（DrawPDFPage 不做自动 fit，需自行定位）
            CGContextSaveGState(outCtx);
            CGContextTranslateCTM(outCtx, kMargin, kMargin);
            CGContextDrawPDFPage(outCtx, srcPage);
            CGContextRestoreGState(outCtx);

            // 页眉页脚：基线为 PDF y 坐标（原点左下），与上方切片坐标系一致
            InkmarkDrawTextLine(outCtx, title, hfFont, cLeft, kMargin, kHeaderBaselineY, 0);
            InkmarkDrawTextLine(outCtx, date, hfFont, cRight, 0, kHeaderBaselineY, kPageW - kMargin);
            InkmarkDrawFooterPageNumber(outCtx, i + 1, pages, hfFont, cPageX, cPageN,
                                 kPageW - kMargin, kFooterBaselineY);
            CGContextEndPage(outCtx);

            CGPDFDocumentRelease(srcDoc);
            CGDataProviderRelease(prov);
            [pageData release]; // 非 ARC：完成回调中的 retain 必须配对释放
        }

        if (rc == 0) {
            CGContextRelease(outCtx);
            CGDataConsumerRelease(consumer);
            NSData *outData = CFBridgingRelease(dataOut);
            if (![outData writeToFile:[NSString stringWithUTF8String:outPath] atomically:YES]) {
                SetErr(errBuf, errBufLen, @"PDF 写盘失败（路径不可写或磁盘已满）");
                rc = 5;
            }
        } else {
            CGContextRelease(outCtx);
            CGDataConsumerRelease(consumer);
            CFRelease(dataOut);
        }

        CGColorRelease(cLeft); CGColorRelease(cRight);
        CGColorRelease(cPageX); CGColorRelease(cPageN);
        CFRelease(hfFont);
        [webView release];
        [nav release];
        [win release];
        return rc;
    }
}

// 主线程渲染任务：经 performSelectorOnMainThread（runloop 事件，而非主队列
// block）调度。渲染函数内部以嵌套 runloop 等待 WebKit 回调——只有当渲染函数
// 作为主线程"顶层"事件执行时，嵌套泵送才能收到 WebKit 回调（探针验证过的模式）；
// 若经 dispatch_sync/dispatch_async 进主队列 block，主队列排空不可重入，
// 回调永远不送达，必然加载超时（实测）。
@interface InkRenderJob : NSObject
@property (copy) NSString *html;
@property (copy) NSString *outPath;
@property (copy) NSString *title;
@property (copy) NSString *date;
@property (copy) NSString *leftColor;
@property (copy) NSString *rightColor;
@property (copy) NSString *pageXColor;
@property (copy) NSString *pageNColor;
@property (copy) NSString *fontFamily;
@property (assign) char *errBuf;
@property (assign) int errBufLen;
@property (assign) int rc;
@property (assign) BOOL finished;
@property (retain) NSCondition *cond;
- (void)run;
@end

@implementation InkRenderJob
- (void)run {
    self.rc = RenderPDFInner(self.html.UTF8String, self.outPath.UTF8String,
                             self.title.UTF8String, self.date.UTF8String,
                             self.leftColor.UTF8String, self.rightColor.UTF8String,
                             self.pageXColor.UTF8String, self.pageNColor.UTF8String,
                             self.fontFamily.UTF8String, self.errBuf, self.errBufLen);
    [self.cond lock];
    self.finished = YES;
    [self.cond signal];
    [self.cond unlock];
}
@end

// Wails 绑定方法在后台 goroutine 执行，而 WKWebView / AppKit 必须主线程操作：
// 非主线程时经 performSelectorOnMainThread 调度到主线程执行（见 InkRenderJob 注释），
// 本线程用条件变量同步等待结果。
int InkmarkRenderPDF(const char *html, const char *outPath,
                     const char *docTitle, const char *dateText,
                     const char *hfLeftColor, const char *hfRightColor,
                     const char *hfPageXColor, const char *hfPageNColor,
                     const char *hfFontFamily,
                     char *errBuf, int errBufLen) {
    if ([NSThread isMainThread]) {
        return RenderPDFInner(html, outPath, docTitle, dateText, hfLeftColor,
                              hfRightColor, hfPageXColor, hfPageNColor,
                              hfFontFamily, errBuf, errBufLen);
    }
    InkRenderJob *job = [[InkRenderJob alloc] init];
    job.html = @(html ?: "");
    job.outPath = @(outPath ?: "");
    job.title = @(docTitle ?: "");
    job.date = @(dateText ?: "");
    job.leftColor = @(hfLeftColor ?: "");
    job.rightColor = @(hfRightColor ?: "");
    job.pageXColor = @(hfPageXColor ?: "");
    job.pageNColor = @(hfPageNColor ?: "");
    job.fontFamily = @(hfFontFamily ?: "");
    job.errBuf = errBuf;
    job.errBufLen = errBufLen;
    job.cond = [[NSCondition alloc] init];

    [job performSelectorOnMainThread:@selector(run) withObject:nil waitUntilDone:NO];

    [job.cond lock];
    while (!job.finished) {
        [job.cond wait];
    }
    [job.cond unlock];
    int rc = job.rc;
    [job release];
    return rc;
}
