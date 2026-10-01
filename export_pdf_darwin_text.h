// 页眉页脚绘制辅助（Core Text）。颜色与字体族由前端按当前主题解析后传入，
// 本文件不硬编码任何 UI 颜色；仅含解析失败的容错兜底。
#ifndef EXPORT_PDF_DARWIN_TEXT_H
#define EXPORT_PDF_DARWIN_TEXT_H

#import <Foundation/Foundation.h>
#import <CoreText/CoreText.h>

// 页眉页脚字号恒 9pt（设计规格：正文 15pt 的 0.6 倍，绝对值不引入比例换算）
static const CGFloat InkmarkHFFontSize = 9.0;

// 解析 "#RRGGBB" / "#RRGGBBAA" / "r,g,b[,a]"（0-1 浮点）为 CGColor；
// 解析失败回退不透明黑。调用方负责 CGColorRelease。
CGColorRef InkmarkCreateColorFromSpec(NSString *spec);

// 按字体族候选列表（逗号分隔）取第一个系统可解析的具名字体，9pt；
// 通用族（system-ui/serif 等）跳过，均不可用或未提供时回退系统字体。
// 调用方负责 CFRelease。
CTFontRef InkmarkCreateFontFromFamily(NSString *fontFamily);

// 绘制单行文本：rightEdge > x 时按右缘对齐（右对齐），否则以 x 为左缘；
// y 为 PDF 坐标（原点左下）基线。
void InkmarkDrawTextLine(CGContextRef ctx, NSString *text, CTFontRef font,
                         CGColorRef color, double x, double y, double rightEdge);

// 页脚右缘「第 X / N 页」（斜杠两侧各一空格）：X 用 xColor，其余用 nColor。
void InkmarkDrawFooterPageNumber(CGContextRef ctx, int pageIdx, int pageCount,
                                 CTFontRef font, CGColorRef xColor, CGColorRef nColor,
                                 double rightEdge, double y);

#endif
