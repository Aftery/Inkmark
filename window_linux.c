// window_linux.c — Linux 窗口装饰收口（KWin Wayland 双标题栏的修复）
//
// 【缺陷】2026-10-26 真机：窗口上方有两层标题栏 —— KDE 画的原生标题栏
// （Inkmark + 最小化/最大化/关闭）和前端自绘标题栏（菜单 + 文档名 + 同一组
// 按钮），看起来像「有两个最小化按钮」。
//
// 【根因】GTK3 在 Wayland 下用 `gtk_window_set_decorated(FALSE)` 只是「自己不画
// CSD」，并不会告诉 KWin「不要服务端装饰」；KWin 对没有 CSD 的 xdg_toplevel
// 默认补一层服务端标题栏（已用最小 GTK 程序复现：decorated=false 仍然有
// KDE 标题栏）。而只要 GTK 处于 CSD 模式（哪怕标题栏是一个 0 高的空盒子），
// KWin 就完全不加装饰 —— 同样已用最小程序验证。
//
// 【修法】给主窗口装一个 0 高的空 GtkBox 作为 titlebar：GTK 进入 CSD 模式，
// KWin 不再叠服务端标题栏，而空盒子本身不可见 —— 视觉上仍是「纯净无边框」，
// 窗口按钮继续由 TitleBar.vue 自绘。X11 上本来就是 MOTIF hints 无装饰，这条
// 改动无副作用（只是 GTK 换了一种「不画」的方式）。

#include <gtk/gtk.h>

static gboolean apply_csd(gpointer data) {
    (void)data;
    GList *tops = gtk_window_list_toplevels();
    for (GList *l = tops; l != NULL; l = l->next) {
        if (!GTK_IS_WINDOW(l->data)) continue;
        GtkWindow *win = GTK_WINDOW(l->data);
        // 只认主窗口：标题由 main.go 的 options.App.Title 设定
        if (g_strcmp0(gtk_window_get_title(win), "Inkmark") != 0) continue;

        GtkWidget *bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
        gtk_widget_set_size_request(bar, -1, 0);
        gtk_window_set_titlebar(win, bar); // 窗口接管所有权
        gtk_widget_show(bar);
        break;
    }
    g_list_free(tops);
    return G_SOURCE_REMOVE;
}

// inkmarkApplyCSD 由 Go 在 OnStartup 调用；g_idle_add 保证落在 GTK 主线程
// （OnStartup 本身跑在普通 goroutine 里，GTK 调用必须回主线程）。
void inkmarkApplyCSD(void) {
    g_idle_add(apply_csd, NULL);
}
