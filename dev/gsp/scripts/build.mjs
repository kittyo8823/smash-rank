// dist/ に公開用ファイルを作る（index.html と読み取り用の vendor/）
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const out = await build({ entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'iife', minify: true, target: 'es2019', write: false, legalComments: 'none' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(path.join(root, 'src/style.css'), 'utf8');
const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f2efe8">
<title>スマブラ段位スキャナー</title>
<meta name="description" content="スマブラSPの世界戦闘力をカメラで読み取って、全キャラの段位を一目で（非公式ファンツール）">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Zen+Kaku+Gothic+New:wght@500;700&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#141414"/><rect x="10" y="22" width="44" height="20" fill="none" stroke="#ffd400" stroke-width="4"/><text x="32" y="38" font-size="14" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">VIP</text></svg>')}">
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<div id="sheet"></div>
<div id="toasts"></div>
<script src="vendor/tesseract.min.js"></script>
<script>
${js}
</script>
</body>
</html>
`;
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'vendor/core'), { recursive: true });
await mkdir(path.join(dist, 'vendor/lang'), { recursive: true });
await writeFile(path.join(dist, 'index.html'), html);
const nm = path.join(root, 'node_modules');
await cp(path.join(nm, 'tesseract.js/dist/tesseract.min.js'), path.join(dist, 'vendor/tesseract.min.js'));
await cp(path.join(nm, 'tesseract.js/dist/worker.min.js'), path.join(dist, 'vendor/worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) await cp(path.join(nm, 'tesseract.js-core', f), path.join(dist, 'vendor/core', f));
await cp(path.join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), path.join(dist, 'vendor/lang/eng.traineddata.gz'));
await cp(path.join(root, 'border.json'), path.join(dist, 'border.json'));
console.log('dist/ built', (html.length / 1024).toFixed(0) + 'KB html');
