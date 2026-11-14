import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { offlinePlugin } from './offline-plugin.mjs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'serve' && !isPreview ? '/' : (process.env.PAGES_BASE || './'),
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [offlinePlugin()],
}));
