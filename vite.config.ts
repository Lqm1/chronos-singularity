import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
  const singleFile = mode === 'singlefile';
  return {
    base: './',
    plugins: singleFile ? [viteSingleFile()] : [],
    build: {
      outDir: singleFile ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
    },
    test: {
      environment: 'node',
    },
  };
});
