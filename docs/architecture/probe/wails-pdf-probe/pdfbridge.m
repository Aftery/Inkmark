#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <PDFKit/PDFKit.h>
#include <math.h>
#import <Foundation/Foundation.h>
#include <stdio.h>
#include "pdfbridge.h"

@interface ProbeNavDelegate : NSObject <WKNavigationDelegate>
@property (assign) volatile BOOL finished;
@property (assign) volatile BOOL failed;
@end

// B3 用：在真实 NSApp 事件循环里跑打印操作
@interface PrintCtl : NSObject
@property (retain) WKWebView *webView;
@property (retain) NSWindow *win;
@property (copy) NSString *path;
@property (assign) int outcome;   // -1 未跑, 0 成功, 3 失败
@end

@implementation PrintCtl
- (void)doPrint {
    // 与 Wails Application.m:480 一致：sharedPrintInfo 才携带有效 print session
    NSPrintInfo *pi = [[NSPrintInfo sharedPrintInfo] copy];
    [pi setPaperSize:NSMakeSize(595, 842)];
    [pi setOrientation:NSPaperOrientationPortrait];
    [pi setTopMargin:48]; [pi setBottomMargin:48];
    [pi setLeftMargin:48]; [pi setRightMargin:48];
    [pi setHorizontallyCentered:YES]; [pi setVerticallyCentered:NO];

    NSMutableDictionary *d = [pi dictionary];
    [d setObject:NSPrintSaveJob forKey:NSPrintJobDisposition];
    [d setObject:[NSURL fileURLWithPath:self.path] forKey:NSPrintJobSavingURL];

    NSPrintOperation *op = [self.webView printOperationWithPrintInfo:pi];
    op.showsPrintPanel = NO;
    op.showsProgressPanel = NO;

    [op runOperationModalForWindow:self.win delegate:nil didRunSelector:nil contextInfo:NULL];
    fprintf(stderr, "[probe] B3 runOperationModalForWindow returned\n");
    self.outcome = 0;
    [NSApp stop:nil];
    NSEvent *e = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
                                    location:NSMakePoint(0, 0)
                               modifierFlags:0
                                   timestamp:0
                                windowNumber:0
                                     context:nil
                                     subtype:0
                                       data1:0
                                       data2:0];
    [NSApp postEvent:e atStart:YES];
}
@end

@implementation ProbeNavDelegate
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation { self.finished = YES; }
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error { self.failed = YES; self.finished = YES; }
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { self.failed = YES; self.finished = YES; }
@end

static WKWebView *FindWebViewInView(NSView *v) {
    if (v == nil) return nil;
    if ([v isKindOfClass:[WKWebView class]]) return (WKWebView *)v;
    for (NSView *sub in v.subviews) {
        WKWebView *found = FindWebViewInView(sub);
        if (found) return found;
    }
    return nil;
}

void *FindExistingWebView(void) {
    @autoreleasepool {
        for (NSWindow *w in [NSApplication sharedApplication].windows) {
            WKWebView *v = FindWebViewInView(w.contentView);
            if (v) return (__bridge void *)v;
        }
        for (NSWindow *w in [NSApplication sharedApplication].orderedWindows) {
            WKWebView *v = FindWebViewInView(w.contentView);
            if (v) return (__bridge void *)v;
        }
    }
    return NULL;
}

static int BuildLoadedWebView(const char *html, NSWindow **outWin, WKWebView **outWebView, ProbeNavDelegate **outNav) {
    (void)[NSApplication sharedApplication];

    NSRect frame = NSMakeRect(0, 0, 794, 1123);
    WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
    WKWebView *webView = [[WKWebView alloc] initWithFrame:frame configuration:cfg];
    ProbeNavDelegate *nav = [[ProbeNavDelegate alloc] init];
    webView.navigationDelegate = nav;

    NSWindow *win = [[NSWindow alloc]
        initWithContentRect:frame
                  styleMask:NSWindowStyleMaskBorderless
                    backing:NSBackingStoreBuffered
                      defer:NO];
    win.contentView = webView;

    [webView loadHTMLString:[NSString stringWithUTF8String:html] baseURL:nil];

    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:20.0];
    while (!nav.finished && [deadline timeIntervalSinceNow] > 0) {
        [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                 beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    if (!nav.finished || nav.failed) return 2;

    *outWin = win;
    *outWebView = webView;
    *outNav = nav;
    return 0;
}

// 路线 A：createPDFWithConfiguration（macOS 11+），产出「单页」PDF
int RenderHTMLToPDF(const char *html, const char *outPath) {
    @autoreleasepool {
        NSWindow *win = nil; WKWebView *webView = nil; ProbeNavDelegate *nav = nil;
        int rc = BuildLoadedWebView(html, &win, &webView, &nav);
        if (rc != 0) { fprintf(stderr, "[probe] nav failed\n"); return rc; }

        void *found = FindExistingWebView();
        fprintf(stderr, "[probe] FindExistingWebView -> %s\n", found ? "FOUND" : "NULL");

        if (@available(macOS 11.0, *)) {
            __block NSData *pdfData = nil;
            __block BOOL done = NO;
            __block NSString *errMsg = nil;
            WKPDFConfiguration *pdfCfg = [[WKPDFConfiguration alloc] init];
            [webView createPDFWithConfiguration:pdfCfg
                              completionHandler:^(NSData *d, NSError *e) {
                if (d) pdfData = [d retain];
                if (e) errMsg = [e.localizedDescription copy];
                done = YES;
            }];
            NSDate *deadline2 = [NSDate dateWithTimeIntervalSinceNow:20.0];
            while (!done && [deadline2 timeIntervalSinceNow] > 0) {
                [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                         beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
            }
            if (!done || errMsg || !pdfData) {
                fprintf(stderr, "[probe] createPDF failed: %s\n", errMsg ? errMsg.UTF8String : "(nil)");
                return 3;
            }
            fprintf(stderr, "[probe] createPDF OK bytes=%lu\n", (unsigned long)pdfData.length);
            BOOL ok = [pdfData writeToFile:[NSString stringWithUTF8String:outPath] atomically:YES];
            return ok ? 0 : 4;
        }
        return 5;
    }
}

// 路线 B：NSPrintOperation + NSPrintSaveJob，分页 A4，直接落盘（不弹面板）
// mode: 0 = runOperation，1 = runOperationModalForWindow，2 = 可见窗口 + activation + modal
int RenderHTMLToPDFPrint(const char *html, const char *outPath, int mode) {
    @autoreleasepool {
        NSWindow *win = nil; WKWebView *webView = nil; ProbeNavDelegate *nav = nil;
        int rc = BuildLoadedWebView(html, &win, &webView, &nav);
        if (rc != 0) { fprintf(stderr, "[probe] nav failed\n"); return rc; }

        if (@available(macOS 11.0, *)) {
            if (mode == 2) {
                // 提供与 Wails 运行时相近的条件：普通 app 激活策略 + 生效窗口
                [[NSApplication sharedApplication] setActivationPolicy:NSApplicationActivationPolicyRegular];
                [win makeKeyAndOrderFront:nil];
                [[NSApplication sharedApplication] activateIgnoringOtherApps:YES];
            }

            NSPrintInfo *pi = [[NSPrintInfo alloc] init];
            [pi setPaperSize:NSMakeSize(595, 842)];
            [pi setOrientation:NSPaperOrientationPortrait];
            [pi setTopMargin:48]; [pi setBottomMargin:48];
            [pi setLeftMargin:48]; [pi setRightMargin:48];
            [pi setHorizontallyCentered:YES]; [pi setVerticallyCentered:NO];

            NSString *path = [NSString stringWithUTF8String:outPath];
            NSMutableDictionary *d = [pi dictionary];
            [d setObject:NSPrintSaveJob forKey:NSPrintJobDisposition];
            [d setObject:[NSURL fileURLWithPath:path] forKey:NSPrintJobSavingURL];

            NSPrintOperation *op = [webView printOperationWithPrintInfo:pi];
            op.showsPrintPanel = NO;
            op.showsProgressPanel = NO;

            fprintf(stderr, "[probe] B mode=%d dispatch\n", mode);
            if (mode == 1 || mode == 2) {
                [op runOperationModalForWindow:win delegate:nil didRunSelector:nil contextInfo:NULL];
            } else {
                [op runOperation];
            }
            fprintf(stderr, "[probe] B mode=%d done\n", mode);
            if (mode == 2) { [win orderOut:nil]; }
            return 0;
        }
        return 5;
    }
}

// 路线 B3：在真实 NSApp 事件循环里执行 NSPrintSaveJob（与 Wails 运行时条件一致）
int RenderHTMLToPDFPrintB3(const char *html, const char *outPath) {
    @autoreleasepool {
        NSWindow *win = nil; WKWebView *webView = nil; ProbeNavDelegate *nav = nil;
        int rc = BuildLoadedWebView(html, &win, &webView, &nav);
        if (rc != 0) { fprintf(stderr, "[probe] nav failed\n"); return rc; }

        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [win orderFront:nil];

        PrintCtl *ctl = [[PrintCtl alloc] init];
        ctl.webView = webView;
        ctl.win = win;
        ctl.path = [NSString stringWithUTF8String:outPath];
        ctl.outcome = -1;

        [ctl performSelector:@selector(doPrint) withObject:nil afterDelay:0.3];
        fprintf(stderr, "[probe] B3 entering NSApp run loop\n");
        [app run];
        fprintf(stderr, "[probe] B3 exited run loop outcome=%d\n", ctl.outcome);
        [win orderOut:nil];
        return ctl.outcome;
    }
}

// 路线 A + 显式 rect：验证能否产出「指定尺寸的单页」（用于逐页渲染 A4）
int RenderHTMLToPDFRect(const char *html, const char *outPath,
                        double x, double y, double w, double h) {
    @autoreleasepool {
        NSWindow *win = nil; WKWebView *webView = nil; ProbeNavDelegate *nav = nil;
        int rc = BuildLoadedWebView(html, &win, &webView, &nav);
        if (rc != 0) return rc;
        if (@available(macOS 11.0, *)) {
            __block NSData *pdfData = nil;
            __block BOOL done = NO;
            WKPDFConfiguration *cfg = [[WKPDFConfiguration alloc] init];
            cfg.rect = CGRectMake(x, y, w, h);
            [webView createPDFWithConfiguration:cfg completionHandler:^(NSData *d, NSError *e) {
                if (d) pdfData = [d retain];
                if (e) fprintf(stderr, "[probe] rect pdf err: %s\n", e.localizedDescription.UTF8String);
                done = YES;
            }];
            NSDate *dl = [NSDate dateWithTimeIntervalSinceNow:20.0];
            while (!done && [dl timeIntervalSinceNow] > 0) {
                [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                         beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
            }
            if (!pdfData) return 3;
            fprintf(stderr, "[probe] rect pdf bytes=%lu rect=(%.0f,%.0f,%.0f,%.0f)\n",
                    (unsigned long)pdfData.length, x, y, w, h);
            return [pdfData writeToFile:[NSString stringWithUTF8String:outPath] atomically:YES] ? 0 : 4;
        }
        return 5;
    }
}

// 端到端：离屏渲染 HTML -> 逐页 createPDFWithConfiguration(rect) -> PDFKit 合并 -> 落盘
int RenderHTMLToPDFPaginated(const char *html, const char *outPath,
                             double pageW, double pageH) {
    @autoreleasepool {
        NSWindow *win = nil; WKWebView *webView = nil; ProbeNavDelegate *nav = nil;
        int rc = BuildLoadedWebView(html, &win, &webView, &nav);
        if (rc != 0) { fprintf(stderr, "[probe] nav failed\n"); return rc; }

        // 取内容真实高度（CSS px，与 PDF pt 1:1）
        __block double contentH = 0;
        __block BOOL gotH = NO;
        [webView evaluateJavaScript:@"document.documentElement.scrollHeight"
                 completionHandler:^(id r, NSError *e) {
            if ([r respondsToSelector:@selector(doubleValue)]) contentH = [r doubleValue];
            gotH = YES;
        }];
        NSDate *dl0 = [NSDate dateWithTimeIntervalSinceNow:10.0];
        while (!gotH && [dl0 timeIntervalSinceNow] > 0) {
            [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                     beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        }
        fprintf(stderr, "[probe] content height = %.0f px\n", contentH);

        int pages = (int)ceil(contentH / pageH);
        if (pages < 1) pages = 1;
        if (pages > 500) pages = 500; // 防御性上限
        fprintf(stderr, "[probe] pages = %d\n", pages);

        PDFDocument *merged = [[PDFDocument alloc] init];
        for (int i = 0; i < pages; i++) {
            __block NSData *pageData = nil;
            __block BOOL done = NO;
            WKPDFConfiguration *cfg = [[WKPDFConfiguration alloc] init];
            cfg.rect = CGRectMake(0, (double)i * pageH, pageW, pageH);
            [webView createPDFWithConfiguration:cfg completionHandler:^(NSData *d, NSError *e) {
                if (d) pageData = [d retain];
                if (e) fprintf(stderr, "[probe] page %d err: %s\n", i, e.localizedDescription.UTF8String);
                done = YES;
            }];
            NSDate *dl = [NSDate dateWithTimeIntervalSinceNow:15.0];
            while (!done && [dl timeIntervalSinceNow] > 0) {
                [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                         beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
            }
            if (!pageData) { fprintf(stderr, "[probe] page %d nil\n", i); return 3; }
            PDFDocument *part = [[PDFDocument alloc] initWithData:pageData];
            if (part.pageCount < 1) { fprintf(stderr, "[probe] page %d no page\n", i); return 3; }
            [merged insertPage:[part pageAtIndex:0] atIndex:[merged pageCount]];
        }
        fprintf(stderr, "[probe] merged pageCount=%lu\n", (unsigned long)merged.pageCount);
        return [merged writeToFile:[NSString stringWithUTF8String:outPath]] ? 0 : 4;
    }
}
