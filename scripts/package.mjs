// 把构建好的插件打成 zip，用于 GitHub Release 和手动安装。先运行 pnpm build。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}apps/extension/dist`;
if (!existsSync(`${dist}/manifest.json`)) throw new Error('找不到 apps/extension/dist，请先运行 pnpm build');

// 版本号以 manifest.json 为准
const { version } = JSON.parse(readFileSync(`${dist}/manifest.json`, 'utf8'));
const outDir = `${root}release`;
const out = `${outDir}/translate-by-ai-v${version}.zip`;

mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.', '-x', '.DS_Store', '*.map'], { cwd: dist, stdio: 'inherit' });
console.log(`打包完成：${out.slice(root.length)}`);
