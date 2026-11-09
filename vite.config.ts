import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { webManagementPlugin } from './scripts/web-management'

export default defineConfig({
  plugins: [vue(), webManagementPlugin()], base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/release/**', '**/output/**', '**/.runtime/**', '**/dist-electron/**'] } }
})
