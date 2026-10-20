#ifndef INK_CLIPBOARD_DARWIN_H
#define INK_CLIPBOARD_DARWIN_H

// 通道③的 AppKit 桥（实现见 clipboard_darwin.m）。
// 两者都返回 malloc 出的内存，调用方负责 free；无内容时返回 NULL。
char *ink_clipboard_image_png(unsigned long *outLen);
char *ink_clipboard_file_path(void);

#endif