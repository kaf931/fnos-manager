import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { adaptNoVncBrowser } from './scripts/novnc-compat.js';
export default defineConfig({
  root: 'web',
  resolve: {
    alias: {
      '@novnc/novnc/core/util/logging.js': fileURLToPath(
        new URL('./node_modules/@novnc/novnc/core/util/logging.js', import.meta.url),
      ),
    },
  },
  plugins: [
    {
      name: 'novnc-webview-compat',
      enforce: 'pre',
      transform(source, id) {
        if (id.replaceAll('\\', '/').endsWith('/@novnc/novnc/core/util/browser.js'))
          return { code: adaptNoVncBrowser(source), map: null };
      },
    },
  ],
  esbuild: { jsx: 'automatic' },
  base: '/app/deskicons/',
  build: {
    target: 'es2022',
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;
          if (/\/(?:@codemirror|@lezer|@marijn|codemirror|crelt|style-mod|w3c-keyname)\//.test(id))
            return 'editor-vendor';
          if (id.includes('/@novnc/')) return 'vnc-vendor';
          if (id.includes('/@xterm/')) return 'terminal-vendor';
          if (/\/(marked|dompurify)\//.test(id)) return 'markdown-vendor';
          if (id.includes('/@trimjs/')) return 'fnos-sdk';
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          return 'ui-vendor';
        },
      },
    },
  },
});
