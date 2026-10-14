import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = fileURLToPath(new URL('.', import.meta.url));
const outdir = `${root}dist`;
const watch = process.argv.includes('--watch');

/** 每次构建都把 static/（manifest、html、css）拷到 dist */
const copyStatic = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) await cp(`${root}static`, outdir, { recursive: true });
    });
  },
};

await rm(outdir, { recursive: true, force: true });

const ctx = await esbuild.context({
  absWorkingDir: root,
  entryPoints: {
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
    options: 'src/options/index.ts',
  },
  outdir,
  bundle: true,
  // content script 和经典 service worker 都不能是 ES module
  format: 'iife',
  target: 'chrome120',
  charset: 'utf8',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  plugins: [copyStatic],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
