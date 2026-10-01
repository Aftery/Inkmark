// 页眉页脚绘制辅助实现——见 export_pdf_darwin_text.h。
#import "export_pdf_darwin_text.h"
#import <AppKit/AppKit.h>

CGColorRef InkmarkCreateColorFromSpec(NSString *spec) {
    CGFloat r = 0, g = 0, b = 0, a = 1;
    NSString *s = [spec stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    if (s.length > 1 && [s hasPrefix:@"#"] && (s.length == 7 || s.length == 9)) {
        unsigned int v = 0;
        NSScanner *scanner = [NSScanner scannerWithString:[s substringFromIndex:1]];
        if ([scanner scanHexInt:&v]) {
            if (s.length == 7) {
                r = ((v >> 16) & 0xFF) / 255.0;
                g = ((v >> 8) & 0xFF) / 255.0;
                b = (v & 0xFF) / 255.0;
            } else {
                r = ((v >> 24) & 0xFF) / 255.0;
                g = ((v >> 16) & 0xFF) / 255.0;
                b = ((v >> 8) & 0xFF) / 255.0;
                a = (v & 0xFF) / 255.0;
            }
        }
    } else if (s.length) {
        NSArray *parts = [s componentsSeparatedByString:@","];
        if (parts.count >= 3) {
            r = [parts[0] floatValue]; g = [parts[1] floatValue]; b = [parts[2] floatValue];
            if (parts.count >= 4) a = [parts[3] floatValue];
        }
    }
    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGFloat comps[4] = {r, g, b, a};
    CGColorRef color = CGColorCreate(cs, comps);
    CFRelease(cs);
    return color;
}

CTFontRef InkmarkCreateFontFromFamily(NSString *fontFamily) {
    NSFont *font = nil;
    for (NSString *raw in [fontFamily componentsSeparatedByString:@","]) {
        NSString *name = [raw stringByTrimmingCharactersInSet:
            [NSCharacterSet whitespaceAndNewlineCharacterSet]];
        name = [name stringByReplacingOccurrencesOfString:@"'" withString:@""];
        name = [name stringByReplacingOccurrencesOfString:@"\"" withString:@""];
        if (name.length == 0 || [name hasPrefix:@"-"]) continue;
        if ([name isEqualToString:@"system-ui"] || [name isEqualToString:@"sans-serif"] ||
            [name isEqualToString:@"serif"] || [name isEqualToString:@"monospace"]) {
            continue;
        }
        NSFont *f = [NSFont fontWithName:name size:InkmarkHFFontSize];
        if (f) { font = f; break; }
    }
    if (!font) font = [NSFont systemFontOfSize:InkmarkHFFontSize];
    return (CTFontRef)CFBridgingRetain(font);
}

void InkmarkDrawTextLine(CGContextRef ctx, NSString *text, CTFontRef font,
                         CGColorRef color, double x, double y, double rightEdge) {
    if (text.length == 0 || !font || !color) return;
    NSDictionary *attrs = @{
        (__bridge id)kCTFontAttributeName : (__bridge id)font,
        (__bridge id)kCTForegroundColorAttributeName : (__bridge id)color,
    };
    CFAttributedStringRef as = CFAttributedStringCreate(
        NULL, (__bridge CFStringRef)text, (__bridge CFDictionaryRef)attrs);
    if (!as) return;
    CTLineRef line = CTLineCreateWithAttributedString(as);
    if (line) {
        if (rightEdge > x) {
            double w = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
            x = rightEdge - w;
        }
        CGContextSetTextPosition(ctx, x, y);
        CTLineDraw(line, ctx);
        CFRelease(line);
    }
    CFRelease(as);
}

void InkmarkDrawFooterPageNumber(CGContextRef ctx, int pageIdx, int pageCount,
                                 CTFontRef font, CGColorRef xColor, CGColorRef nColor,
                                 double rightEdge, double y) {
    if (!font || !xColor || !nColor) return;
    NSString *prefix = @"第 ";
    NSString *xStr = [NSString stringWithFormat:@"%d", pageIdx];
    NSString *rest = [NSString stringWithFormat:@" / %d 页", pageCount];
    NSString *full = [prefix stringByAppendingString:xStr];
    full = [full stringByAppendingString:rest];

    NSDictionary *baseAttrs = @{
        (__bridge id)kCTFontAttributeName : (__bridge id)font,
        (__bridge id)kCTForegroundColorAttributeName : (__bridge id)nColor,
    };
    NSDictionary *xAttrs = @{
        (__bridge id)kCTFontAttributeName : (__bridge id)font,
        (__bridge id)kCTForegroundColorAttributeName : (__bridge id)xColor,
    };
    CFMutableAttributedStringRef as =
        CFAttributedStringCreateMutable(NULL, (CFIndex)full.length);
    if (!as) return;
    CFAttributedStringReplaceString(as, CFRangeMake(0, 0), (__bridge CFStringRef)full);
    CFAttributedStringSetAttributes(as, CFRangeMake(0, (CFIndex)full.length),
                                    (__bridge CFDictionaryRef)baseAttrs, false);
    CFAttributedStringSetAttributes(as,
        CFRangeMake((CFIndex)prefix.length, (CFIndex)xStr.length),
        (__bridge CFDictionaryRef)xAttrs, false);

    CTLineRef line = CTLineCreateWithAttributedString(as);
    if (line) {
        double w = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
        CGContextSetTextPosition(ctx, rightEdge - w, y);
        CTLineDraw(line, ctx);
        CFRelease(line);
    }
    CFRelease(as);
}
