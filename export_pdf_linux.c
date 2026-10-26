// export_pdf_linux.c — Linux PDF 导出桥（GTK「打印到文件」，全程无对话框）
//
// 【为什么不再用 window.print()】2026-10-26 真机反馈：点「导出 PDF」弹出的是
// 系统打印对话框（打印机列表 + 副本数 + 打印到 LPR），用户以为点错了功能。
// 根因是 Wails 的 Linux WindowPrint 只执行 window.print()，而 window.print()
// 的定义就是「弹打印对话框」——它从来不是「导出文件」。
//
// 【机制】GTK 的打印后端自带一个虚拟打印机，其名字就是**本地化后的**
// 「Print to File」（zh_CN 下为「打印到文件」）。把它的名字写进 print settings、
// 给出 GTK_PRINT_SETTINGS_OUTPUT_URI，再调 webkit_print_operation_print()
// （与 run_dialog 相对的无对话框版本），WebKit 就会把页面排版后直接写成 PDF。
// 名字必须取 GTK 自己的译文（g_dgettext），硬编码任一语言都会在另一种语言下
// 变成「找不到打印机」。
//
// 【为什么用离屏 WebView 打印传入的 HTML，而不是打印当前窗口】
// 当前窗口里是编辑器 UI，产物取决于 @media print 隐藏规则；而前端已经把
// 「自包含导出 HTML」（与 darwin 同一份模板、同一套主题映射、同一个 467pt
// 版心）作为参数传进来。离屏加载它，产物与平台实现无关，也不会闪一下界面。
//
// 【几何】A4 + 四边 64pt 边距 ⇒ 可打印宽 467pt。WebKit 打印的 CSS px 是
// 96dpi（467pt ≈ 622px），所以前端给 Linux 传的 --export-measure 是 622px
// （见 useDocumentState.exportPdf 的注释）；darwin 的 1px=1pt 假设在这里不成立。

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <libintl.h>
#include <stdlib.h>

// Go 侧回调（export_pdf_linux.go 的 //export）
extern void inkmarkExportPDFDone(const char *path, const char *errMsg);

typedef struct {
    char *html;
    char *path;
    char *base_uri; // 文档目录的 file:// URI（相对路径图片的基准），可为 NULL
    GtkWidget *window;
    WebKitPrintOperation *op;
    guint timeout_id;
    gboolean done;
} ExportJob;

static gboolean job_cleanup(gpointer data) {
    ExportJob *job = data;
    if (job->op) {
        g_object_unref(job->op);
        job->op = NULL;
    }
    if (job->window) {
        gtk_widget_destroy(job->window);
        job->window = NULL;
    }
    g_free(job->html);
    g_free(job->base_uri);
    g_free(job->path);
    g_free(job);
    return G_SOURCE_REMOVE;
}

// job_finish 只执行一次：先通知 Go（同步拷贝字符串），再把销毁推迟到 idle ——
// 在打印信号的栈里直接销毁 WebView 会重入 WebKit 的打印状态机。
static void job_finish(ExportJob *job, const char *err_msg) {
    if (job->done) return;
    job->done = TRUE;
    if (job->timeout_id) {
        g_source_remove(job->timeout_id);
        job->timeout_id = 0;
    }
    inkmarkExportPDFDone(job->path, err_msg);
    g_idle_add(job_cleanup, job);
}

static void on_print_finished(WebKitPrintOperation *op, gpointer data) {
    (void)op;
    job_finish((ExportJob *)data, NULL);
}

static void on_print_failed(WebKitPrintOperation *op, GError *error, gpointer data) {
    (void)op;
    job_finish((ExportJob *)data, error ? error->message : "打印失败");
}

static gboolean on_timeout(gpointer data) {
    ExportJob *job = data;
    job->timeout_id = 0;
    job_finish(job, "导出超时：页面加载或打印未完成");
    return G_SOURCE_REMOVE;
}

static void on_load_changed(WebKitWebView *view, WebKitLoadEvent event, gpointer data) {
    ExportJob *job = data;
    if (event != WEBKIT_LOAD_FINISHED || job->done) return;

    GtkPrintSettings *settings = gtk_print_settings_new();
    gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_PRINTER,
                           g_dgettext("gtk30", "Print to File"));
    gchar *uri = g_filename_to_uri(job->path, NULL, NULL);
    if (uri) {
        gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, uri);
        g_free(uri);
    }
    gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_FILE_FORMAT, "pdf");

    // A4 + 64pt 四边距（与 ADR-003 的页面几何同一组数字）
    GtkPageSetup *setup = gtk_page_setup_new();
    GtkPaperSize *a4 = gtk_paper_size_new(GTK_PAPER_NAME_A4);
    gtk_page_setup_set_paper_size(setup, a4);
    gtk_paper_size_free(a4);
    const double pt_to_mm = 25.4 / 72.0;
    gtk_page_setup_set_top_margin(setup, 64 * pt_to_mm, GTK_UNIT_MM);
    gtk_page_setup_set_bottom_margin(setup, 64 * pt_to_mm, GTK_UNIT_MM);
    gtk_page_setup_set_left_margin(setup, 64 * pt_to_mm, GTK_UNIT_MM);
    gtk_page_setup_set_right_margin(setup, 64 * pt_to_mm, GTK_UNIT_MM);

    job->op = webkit_print_operation_new(view);
    webkit_print_operation_set_print_settings(job->op, settings);
    webkit_print_operation_set_page_setup(job->op, setup);
    g_signal_connect(job->op, "finished", G_CALLBACK(on_print_finished), job);
    g_signal_connect(job->op, "failed", G_CALLBACK(on_print_failed), job);
    webkit_print_operation_print(job->op);

    g_object_unref(settings);
    g_object_unref(setup);
}

static gboolean start_export(gpointer data) {
    ExportJob *job = data;

    job->window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_default_size(GTK_WINDOW(job->window), 622, 900);
    GtkWidget *view = webkit_web_view_new();
    gtk_container_add(GTK_CONTAINER(job->window), view);
    g_signal_connect(view, "load-changed", G_CALLBACK(on_load_changed), job);

    // 不 show：离屏加载即可排版；WebKit 的打印排版按纸张宽度走，与窗口尺寸无关。
    webkit_web_view_load_html(WEBKIT_WEB_VIEW(view), job->html, job->base_uri);

    job->timeout_id = g_timeout_add_seconds(60, on_timeout, job);
    return G_SOURCE_REMOVE;
}

// inkmarkStartExportPDF 由 Go 在任意 goroutine 调用；g_idle_add 保证真正的
// GTK 操作落在主线程（WebKit / GTK 都不是线程安全的）。
void inkmarkStartExportPDF(const char *html, const char *path, const char *base_uri) {
    ExportJob *job = g_new0(ExportJob, 1);
    job->html = g_strdup(html);
    job->path = g_strdup(path);
    job->base_uri = (base_uri && *base_uri) ? g_strdup(base_uri) : NULL;
    g_idle_add(start_export, job);
}
