import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' + HashRouter => works on GitHub Pages under any repo name.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Heavy image / PDF tests can exceed the 5 s default when the whole suite runs in parallel.
    testTimeout: 30000,
  },
} as any);
