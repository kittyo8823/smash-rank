// 実機の写真（テレビを撮ったもの）をカメラ映像として流して、いちばん上の数字を読めるか
import { createRequire } from 'node:module';
import { readFileSync, copyFileSync } from 'node:fs';
import { serve } from './serve.mjs';
const require = createRequire('/home/user/human-exe/');
const { chromium, devices } = require('playwright');
const OUT = '/tmp/claude-0/-home-user/f5b14529-fb02-55ca-92e4-f50a2b654f56/scratchpad/gsp';
copyFileSync(new URL('./fixture-bayo.jpg', import.meta.url), new URL('../dist/fixture-bayo.jpg', import.meta.url));
const srv = await serve(18934);
const b = await chromium.launch();
const results = [];
// 手ぶれ・ずれ：数字の中心をガイドの中心からずらす量と、拡大率
for (const [dx, dy, scale, rot] of [[0, 0, 1.8, 0], [-60, 20, 1.6, 0.02], [-40, -15, 2.0, -0.03], [0, 30, 1.7, 0.01], [140, 0, 1.9, 0]]) {
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(([dx, dy, scale, rot]) => {
    localStorage.setItem('gspscan.auto', 'false');
    const img = new Image();
    img.src = '/fixture-bayo.jpg';
    const cv = document.createElement('canvas');
    cv.width = 1280; cv.height = 960;
    const g = cv.getContext('2d');
    const draw = () => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 1280, 960);
      if (img.complete) {
        g.save();
        g.translate(1171 - 140 * scale + dx, 475 + dy); g.rotate(rot); g.scale(scale, scale); g.translate(-1805, -985);
        g.drawImage(img, 0, 0);
        g.restore();
        const d = g.getImageData(0, 0, 1280, 960); const a = d.data;
        for (let i = 0; i < a.length; i += 4) { const n = (Math.random() - 0.5) * 24; a[i] += n; a[i + 1] += n; a[i + 2] += n; }
        g.putImageData(d, 0, 0);
      }
      setTimeout(draw, 80);
    };
    draw();
    const stream = cv.captureStream(12);
    navigator.mediaDevices.getUserMedia = async () => stream;
  }, [dx, dy, scale, rot]);
  const p = await ctx.newPage();
  await p.goto(srv.url);
  await p.click('.tabs button:has-text("スキャン")');
  await p.click('text=カメラを起動');
  const t0 = Date.now();
  try {
    await p.waitForFunction(() => localStorage.getItem('gspscan.data') && Object.keys(JSON.parse(localStorage.getItem('gspscan.data'))).length > 0, null, { timeout: 45000 });
    const d = await p.evaluate(() => JSON.parse(localStorage.getItem('gspscan.data')));
    results.push(`${[dx, dy, scale, rot].join(',')} → ${Object.values(d)[0].gsp} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch {
    results.push(`${[dx, dy, scale, rot].join(',')} → 読めず（登録なし）`);
  }
  if (dx === 0 && dy === 0) await p.screenshot({ path: `${OUT}/08-real-scan.png` });
  await ctx.close();
}
console.log(results.join('\n'));
await b.close();
srv.close();
