import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 部署在 GitHub Pages 子路径下：https://weihong0506.github.io/TransactionRecord/
// 如果改用 Cloudflare Pages / Vercel（根路径），把 BASE 改成 '/' 即可。
const BASE = '/TransactionRecord/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: '记账本',
        short_name: '记账本',
        description: '离线优先的个人记账工具，数据只存在你自己的设备上',
        lang: 'zh-CN',
        // 三处路径必须和 base 对齐，否则加到主屏幕后会白屏
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f9f9f7',
        // 必须和 index.html 的 theme-color、以及 --plane 背景一致，
        // 否则安卓上状态栏会是另一个颜色，顶上多出一条色带
        theme_color: '#f9f9f7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 应用本体全部预缓存，断网也能完整打开
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // pdf.js 有 400KB+（worker 更是 2MB+），只有导入对账单时才用得上。
        // 预缓存它会让安装体积翻倍，所以改成首次用到时再下载并长期缓存——
        // 用过一次之后，离线也能继续导入。
        globIgnores: ['**/pdf*.js', '**/pdf*.mjs'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/pdf.*\.(?:js|mjs)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdfjs',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 180 },
            },
          },
        ],
        navigateFallback: BASE + 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
