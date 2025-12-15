import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
);
const externalDependencies = Array.from(
  new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]),
);

const external = (id) => {
  if (builtinModules.includes(id)) {
    return true;
  }

  if (id.startsWith('node:')) {
    return true;
  }

  if (externalDependencies.includes(id)) {
    return true;
  }

  if (externalDependencies.some((dependency) => id.startsWith(`${dependency}/`))) {
    return true;
  }

  return false;
};

const jsConfig = {
  input: path.join(packageDir, 'src/index.ts'),
  output: {
    dir: path.join(packageDir, 'dist'),
    format: 'esm',
    sourcemap: true,
    entryFileNames: '[name].js',
    chunkFileNames: '[name].js',
  },
  external,
  plugins: [
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    typescript({
      tsconfig: path.join(packageDir, 'tsconfig.json'),
      compilerOptions: {
        declaration: false,
        declarationMap: false,
        composite: false,
      },
    }),
  ],
};

const dtsConfig = {
  input: path.join(packageDir, 'src/index.ts'),
  output: {
    dir: path.join(packageDir, 'dist'),
    format: 'esm',
    entryFileNames: '[name].d.ts',
  },
  plugins: [
    dts({
      tsconfig: path.join(packageDir, 'tsconfig.json'),
    }),
  ],
};

export default [jsConfig, dtsConfig];
