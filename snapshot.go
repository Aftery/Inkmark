package main

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// 历史快照存储（phaseC-architecture.md §5）。
//
// 与自动保存（800ms 防抖、覆盖原文件）完全解耦：本文件只提供"写一份"能力，
// 触发时机（低频计时 / 破坏性事件前 / 手动）由前端控制。
//
// 存储布局：os.UserConfigDir()/Inkmark/snapshots/<docKey>/snapshot-<unix毫秒>.md
// 文件名保证字典序 = 时间序（固定前缀 + 定宽毫秒时间戳）。

const (
	snapshotMaxCount = 10                 // 最多保留 10 份（AC-15：写第 11 份淘汰最旧）
	snapshotMaxBytes = 10 << 20           // 单份内容上限 10MB，超出拒绝写入
	snapshotPrefix   = "snapshot-"        // 快照文件名前缀
	snapshotExt      = ".md"              // 快照文件名后缀（内容即 Markdown 原文）
)

// snapshotsBaseDir 供测试注入临时目录；为空时用 os.UserConfigDir()/Inkmark/snapshots
var snapshotsBaseDir string

// SnapshotMeta 快照元数据（CreatedAt 为 Unix 毫秒，取自文件名时间戳；
// ContentHash 为 sha1(content) hex 前 16 位，SnapshotList 时现算）
type SnapshotMeta struct {
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	CreatedAt   int64  `json:"createdAt"`
	ContentHash string `json:"contentHash"`
}

var snapshotNameRe = regexp.MustCompile(`^[0-9A-Za-z._-]+$`)

// docKeyOf 是 docKey 的唯一派生实现（快照层内部使用，不跨绑定边界）：
//
//	docKey = hex(sha1(filepath.Clean(absPath)))[:16]
//
// 绑定层只收 absPath，前端不实现 sha1 / 路径规则（防止两端各算一份导致
// "写入目录 A、读取目录 B" 的沉默不一致）。派生结果只含 [0-9a-f]，
// 目录名侧天然无路径穿越风险。
func docKeyOf(absPath string) string {
	sum := sha1.Sum([]byte(filepath.Clean(absPath)))
	return hex.EncodeToString(sum[:])[:16]
}

// snapshotRoot 返回快照根目录。
func snapshotRoot() (string, error) {
	if snapshotsBaseDir != "" {
		return snapshotsBaseDir, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("无法定位用户配置目录: %w", err)
	}
	return filepath.Join(base, "Inkmark", "snapshots"), nil
}

// validateSnapshotName 校验前端传入的快照名（防路径穿越的唯一用户可控片段）：
// 仅允许 [0-9A-Za-z._-]，且禁止 ".."、"//"、"\\"。
func validateSnapshotName(name string) error {
	if name == "" {
		return errors.New("快照名不能为空")
	}
	if !snapshotNameRe.MatchString(name) ||
		strings.Contains(name, "..") ||
		strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("非法的快照名: %q", name)
	}
	return nil
}

// snapshotDirFor 返回某文档的快照目录并确保存在。
//
// absPath 行为约定：为空（含纯空白）返回错误；不校验文件在磁盘上是否存在
// ——docKey 由路径字符串派生，允许对"刚创建尚未落盘"的文档写快照。
func snapshotDirFor(absPath string) (string, error) {
	if strings.TrimSpace(absPath) == "" {
		return "", errors.New("文档路径不能为空")
	}
	root, err := snapshotRoot()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, docKeyOf(absPath))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("无法创建快照目录: %w", err)
	}
	return dir, nil
}

// contentHashOf 计算 sha1 hex 前 16 位（契约：快照内容指纹）。
func contentHashOf(data []byte) string {
	sum := sha1.Sum(data)
	return hex.EncodeToString(sum[:])[:16]
}

// SnapshotWrite 为某文档写一份快照并做 10 版轮转（AC-15）。
// 去重：新内容与最新一份快照内容相同（contentHash 相等）时跳过写入、返回 nil，
// 避免内容未变也轮转掉旧版本。写入采用"临时文件 + rename"原子落盘。
func (a *App) SnapshotWrite(absPath string, content string) error {
	if len(content) > snapshotMaxBytes {
		return fmt.Errorf("快照内容超过 %dMB 上限，已拒绝写入", snapshotMaxBytes>>20)
	}
	dir, err := snapshotDirFor(absPath)
	if err != nil {
		return err
	}

	// 与最新一份（CreatedAt 降序第一）比对内容指纹，相同则跳过
	metas, listErr := listSnapshotsIn(dir)
	if listErr == nil && len(metas) > 0 &&
		metas[0].ContentHash == contentHashOf([]byte(content)) {
		return nil
	}

	// 文件名 snapshot-<unix毫秒>.md；同一毫秒内连续写入时顺延时间戳，保证不互相覆盖
	ts := time.Now().UnixMilli()
	var name string
	var target string
	for i := 0; ; i++ {
		name = fmt.Sprintf("%s%d%s", snapshotPrefix, ts+int64(i), snapshotExt)
		target = filepath.Join(dir, name)
		if _, err := os.Stat(target); os.IsNotExist(err) {
			break
		}
	}

	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		return fmt.Errorf("写入快照失败: %w", err)
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("快照落盘失败: %w", err)
	}
	return rotateSnapshots(dir)
}

// SnapshotList 列出某文档的快照（按时间倒序，最多即存储上限 10）。
// 目录不存在视为无快照，返回空切片而非错误。
func (a *App) SnapshotList(absPath string) ([]SnapshotMeta, error) {
	if strings.TrimSpace(absPath) == "" {
		return nil, errors.New("文档路径不能为空")
	}
	root, err := snapshotRoot()
	if err != nil {
		return nil, err
	}
	return listSnapshotsIn(filepath.Join(root, docKeyOf(absPath)))
}

// SnapshotRead 读取某快照内容。name 必须来自 SnapshotList，禁止路径穿越。
func (a *App) SnapshotRead(absPath, name string) (string, error) {
	if strings.TrimSpace(absPath) == "" {
		return "", errors.New("文档路径不能为空")
	}
	if err := validateSnapshotName(name); err != nil {
		return "", err
	}
	root, err := snapshotRoot()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, docKeyOf(absPath))
	path := filepath.Join(dir, name)
	// 双保险：拼装结果必须仍落在该文档的快照目录内
	if !strings.HasPrefix(path, dir+string(os.PathSeparator)) {
		return "", fmt.Errorf("非法的快照名: %q", name)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("读取快照失败: %w", err)
	}
	if len(data) > snapshotMaxBytes {
		return "", errors.New("快照内容超过大小上限，拒绝返回")
	}
	return string(data), nil
}

// SnapshotDocKey 把 absPath 映射为 docKey 回传前端，仅供 UI 分组 / 调试对齐。
// 写入/读取路径的必要参数仍是 absPath 本身（各方法内部派生）。
func (a *App) SnapshotDocKey(absPath string) (string, error) {
	if strings.TrimSpace(absPath) == "" {
		return "", errors.New("文档路径不能为空")
	}
	return docKeyOf(absPath), nil
}

// listSnapshotsIn 读取目录内全部快照元数据，按 Ts 降序。
func listSnapshotsIn(dir string) ([]SnapshotMeta, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []SnapshotMeta{}, nil
		}
		return nil, fmt.Errorf("读取快照目录失败: %w", err)
	}
	metas := make([]SnapshotMeta, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() ||
			!strings.HasPrefix(name, snapshotPrefix) ||
			!strings.HasSuffix(name, snapshotExt) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		ts := parseSnapshotTs(name)
		if ts == 0 {
			ts = info.ModTime().UnixMilli()
		}
		// contentHash 现算（10 个小文件逐个 sha1，成本可忽略）
		var hash string
		if data, err := os.ReadFile(filepath.Join(dir, name)); err == nil {
			hash = contentHashOf(data)
		}
		metas = append(metas, SnapshotMeta{
			Name: name, Size: info.Size(), CreatedAt: ts, ContentHash: hash,
		})
	}
	sort.Slice(metas, func(i, j int) bool { return metas[i].CreatedAt > metas[j].CreatedAt })
	return metas, nil
}

// parseSnapshotTs 从 snapshot-<unix毫秒>.md 解析时间戳，解析失败返回 0。
func parseSnapshotTs(name string) int64 {
	body := strings.TrimSuffix(strings.TrimPrefix(name, snapshotPrefix), snapshotExt)
	ts, err := strconv.ParseInt(body, 10, 64)
	if err != nil {
		return 0
	}
	return ts
}

// rotateSnapshots 快照数超过上限时淘汰最旧（CreatedAt 升序的头部），直到剩 10 份。
func rotateSnapshots(dir string) error {
	metas, err := listSnapshotsIn(dir)
	if err != nil {
		return err
	}
	if len(metas) <= snapshotMaxCount {
		return nil
	}
	for _, m := range metas[snapshotMaxCount:] {
		if err := os.Remove(filepath.Join(dir, m.Name)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("淘汰旧快照失败: %w", err)
		}
	}
	return nil
}
