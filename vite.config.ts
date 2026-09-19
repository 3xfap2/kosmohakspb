import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // data/ и scenarios/ лежат вне src и читаются как ?raw — разрешаем доступ
  server: { fs: { allow: ['..'] } },
});
