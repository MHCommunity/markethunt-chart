import { copyFile, mkdir } from 'node:fs/promises';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { defineConfig } from 'rollup';

const D3_WARNING = /Circular dependency.*d3-interpolate/

// Copy the resvg wasm binary next to the bundle so the external import resolves.
const copyWasm = () => ({
  name: 'copy-wasm',
  async writeBundle() {
    await mkdir('dist', { recursive: true });
    await copyFile('node_modules/@resvg/resvg-wasm/index_bg.wasm', 'dist/resvg.wasm');
  },
});

const config = defineConfig({
  input: 'src/index.js',
  output: {
    file: 'dist/index.mjs',
    format: 'esm',
  },
  plugins: [
    nodeResolve(),
    copyWasm(),
  ],
  external: [/.+\.wasm$/i, /.+\.ttf$/i],
  onwarn: function(warning) {
    if (D3_WARNING.test(warning.message)) {
      return;
    }
    console.warn(warning.message);
  },
});

export default config;
