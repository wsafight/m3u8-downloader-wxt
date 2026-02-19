import { defineConfig } from 'wxt';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  srcDir: 'src',
  vite: () => ({
    plugins: [svelte()],

    // 强制使用 Svelte 的 browser 导出入口，
    // 确保 is_browser = typeof window !== 'undefined' 在真实浏览器环境求值
    resolve: {
      conditions: ['browser', 'module', 'import', 'default'],
    },

    // 阻止 Vite 在 Node.js 预构建阶段处理 Svelte，
    // 避免 is_browser 被提前固化为 false
    optimizeDeps: {
      exclude: ['svelte', '@sveltejs/vite-plugin-svelte'],
    },
  }),

  manifest: {
    name: 'M3U8 Stream Downloader',
    description: '高效检测并下载 HLS/M3U8 视频流，支持加密与多清晰度',
    permissions: ['webRequest', 'downloads', 'storage', 'tabs', 'scripting', 'activeTab', 'notifications'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'M3U8 Downloader',
    },
  },
});
