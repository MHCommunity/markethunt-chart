import { nodeResolve } from '@rollup/plugin-node-resolve';
import { defineConfig } from 'rollup';
import copy from 'rollup-plugin-copy';
import { readFileSync } from 'fs';

const config = defineConfig({
  input: 'src/index.js',
  output: {
    file: 'dist/index.mjs',
    format: 'esm',
  },
  plugins: [
    nodeResolve(),
    copy({
      targets: [
        {
          src: 'node_modules/svg2png-wasm/svg2png_wasm_bg.wasm',
          dest: 'dist',
        },
        {
          src: 'src/Roboto-Thin.ttf',
          dest: 'dist',
        },
      ],
    }),
  ],
  external: [/.+\.wasm$/i, /.+\.ttf$/i],
});

export default config;
