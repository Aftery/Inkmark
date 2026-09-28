import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // wails dev 模式下把 /wails 的 IPC websocket 代理到 vite（可选，骨架先不配）
})
