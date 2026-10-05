package main

// version 是应用版本的【单一真源】。
//
// 由构建时注入覆盖：wails build -ldflags "-X main.version=<tag>"（发布 workflow
// 从 git tag 派生，如 v0.2.0 → 0.2.0）；不注入时回落 dev 值，供本地开发使用。
//
// 禁止在前端另写一份版本号（frontend/package.json 的 version 不参与运行时）——
// 「关于」面板与「检查更新」比对都以本值为准，前端经 App.Version() 读取。
var version = "0.1.0-dev"

// Version 暴露给前端：关于面板展示 + 检查更新的本地比对基准。
func (a *App) Version() string {
	return version
}
