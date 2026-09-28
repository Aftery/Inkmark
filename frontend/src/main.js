import { createApp } from 'vue'
import App from './App.vue'
import './themes/base.css'

// 启动前恢复上次主题，避免闪白
const saved = localStorage.getItem('inkmark-theme')
if (saved) document.documentElement.dataset.theme = saved

createApp(App).mount('#app')
