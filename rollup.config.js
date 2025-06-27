import { nodeResolve } from '@rollup/plugin-node-resolve';
import { defineConfig } from 'rollup';
import copy from 'rollup-plugin-copy';

const D3_WARNING = /Circular dependency.*d3-interpolate/
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
        }
      ],
    }),
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
