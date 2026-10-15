// clipboard_darwin.m — 通道③的 AppKit 桥（macOS 专用）
//
// 为什么独立成 .m 文件：cgo 的预处理器把 /* */ 里的代码当 **C** 编译，
// ObjC 的 `[NSPasteboard generalPasteboard]` 语法必须由 clang 的 ObjC 模式编译。
// 写法是在 .go 里 `#include` 本文件的符号（helper.h），把实现放到 .m ——
// 与 scripts/ 下的探针（/tmp/inkmark-cliprobe）验证过的做法一致。

#import <Cocoa/Cocoa.h>
#include <stdlib.h>
#include <string.h>
#include "clipboard_darwin.h"

// 取剪贴板里的第一张图片，PNG 编码后写进 *outLen。
// 返回 malloc 出的缓冲区（调用方 free），无图片时返回 NULL。
// 一律转 PNG：NSPasteboard 上图片的 UTI 五花八门（public.png / public.tiff /
// com.compuserve.gif / com.apple.pict …），统一编码后下游只需处理一种格式。
char *ink_clipboard_image_png(unsigned long *outLen) {
  @autoreleasepool {
    NSPasteboard *pb = [NSPasteboard generalPasteboard];
    NSImage *found = nil;

    // 优先按 UTI 顺序试，避免 TIFF 这类大尺寸图先被解出来
    for (NSString *t in @[ @"public.png", @"public.tiff", @"com.compuserve.gif" ]) {
      NSData *d = [pb dataForType:t];
      if (d.length == 0) continue;
      NSImage *img = [[NSImage alloc] initWithData:d];
      if (img && img.size.width > 0) {
        found = img;
        break;
      }
    }
    // 兜底：遍历全部类型（截图工具 / 第三方应用的 UTI 不在上面清单里）
    if (!found) {
      for (NSString *t in [pb types]) {
        NSData *d = [pb dataForType:t];
        if (d.length == 0) continue;
        NSImage *img = [[NSImage alloc] initWithData:d];
        if (img && img.size.width > 0) {
          found = img;
          break;
        }
      }
    }
    if (!found) {
      *outLen = 0;
      return NULL;
    }

    CGImageRef cg = [found CGImageForProposedRect:NULL context:nil hints:nil];
    if (!cg) {
      *outLen = 0;
      return NULL;
    }
    // 不对 cg 调 CGImageRelease：CGImageForProposedRect 按 CF 命名约定
    // 返回非 owned（autoreleased）引用，释放它属过度释放，高频粘贴会崩。
    NSBitmapImageRep *rep =
        [[NSBitmapImageRep alloc] initWithCGImage:cg];

    NSData *png = rep ? [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] : nil;
    if (!png || png.length == 0) {
      *outLen = 0;
      return NULL;
    }

    void *buf = malloc(png.length);
    if (!buf) {
      *outLen = 0;
      return NULL;
    }
    memcpy(buf, png.bytes, png.length);
    *outLen = (unsigned long)png.length;
    return (char *)buf;
  }
}

// 取剪贴板里的第一个文件路径（复制文件时的 NSFilenamesPboardType / public.file-url）。
// 返回 malloc 出的 C 字符串（调用方 free），无则返回 NULL。
char *ink_clipboard_file_path(void) {
  @autoreleasepool {
    NSPasteboard *pb = [NSPasteboard generalPasteboard];
    NSString *result = nil;

    id names = [pb propertyListForType:@"NSFilenamesPboardType"];
    if ([names isKindOfClass:[NSArray class]] && [names count] > 0) {
      result = [names firstObject];
    }
    if (!result) {
      NSString *u = [pb stringForType:@"public.file-url"];
      if (u.length) {
        NSURL *url = [NSURL URLWithString:u];
        if ([url isFileURL]) result = [url path];
      }
    }
    if (!result) return NULL;
    return strdup([result UTF8String]);
  }
}

// 取剪贴板纯文本（CF_UNICODETEXT / public.utf8-plain-text）。
// 返回 malloc 出的 C 字符串（调用方 free），无则返回 NULL。
char *ink_clipboard_text(void) {
  @autoreleasepool {
    NSPasteboard *pb = [NSPasteboard generalPasteboard];
    NSString *s = [pb stringForType:@"public.utf8-plain-text"];
    if (!s) s = [pb stringForType:@"NSStringPboardType"];
    if (!s) return NULL;
    return strdup([s UTF8String]);
  }
}