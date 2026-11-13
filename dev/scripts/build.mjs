// dist/index.html（1ファイル）を作る
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({ entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'iife', minify: true, target: 'es2019', write: false, legalComments: 'none' });
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const js = esc(out.outputFiles[0].text);
const mqtt = esc(await readFile(path.join(root, 'node_modules/mqtt/dist/mqtt.min.js'), 'utf8'));
const css = await readFile(path.join(root, 'src/style.css'), 'utf8');
const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f2efe8">
<title>スマブラtier表</title>
<meta name="description" content="スマブラSPの全キャラを「どっちが強い？」で比べてランキングを作る非公式ファンツール">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Zen+Kaku+Gothic+New:wght@500;700&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#141414"/><path d="M10 50 L26 10 H54 L38 50 Z" fill="#e5262b"/><text x="32" y="42" font-size="26" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">1</text></svg>')}">
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<div id="sheet"></div>
<div id="toasts"></div>
<script>
${mqtt}
</script>
<script>
${js}
</script>
</body>
</html>
`;
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + 'KB');
