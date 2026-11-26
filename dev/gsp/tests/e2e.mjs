import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const require = createRequire('/home/user/human-exe/');
const { chromium, devices } = require('playwright');
const SHOT = '/tmp/claude-0/-home-user/f5b14529-fb02-55ca-92e4-f50a2b654f56/scratchpad/gsp';
(await import('node:fs')).mkdirSync(SHOT, { recursive: true });
const srv = await serve();
const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
// テレビ画面をカメラで撮っている状況を、キャンバスの映像で再現する
await ctx.addInitScript(() => {
  localStorage.setItem('gspscan.auto', 'false'); // この映像にはアイコンが無いので順番モードで試す
  window.__num = '12,345,678';
  const cv = document.createElement('canvas');
  cv.width = 1280; cv.height = 960;
  const g = cv.getContext('2d');
  let t = 0;
  function draw() {
    t++;
    const gr = g.createLinearGradient(0, 0, 1280, 960);
    gr.addColorStop(0, '#1d3b8a'); gr.addColorStop(1, '#0d1d4a');
    g.fillStyle = gr; g.fillRect(0, 0, 1280, 960);
    g.save();
    g.translate(640, 480); g.rotate(-0.025); g.translate(-640, -480);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(150, 380, 980, 200);
    g.fillStyle = '#ffe9a0'; g.font = 'bold 44px sans-serif'; g.fillText('世界戦闘力', 190, 440);
    g.fillStyle = '#ffffff'; g.font = 'bold 104px sans-serif'; g.shadowColor = '#000'; g.shadowBlur = 6;
    g.textAlign = 'right';
    g.fillText(window.__num, 1170, 545);
    g.textAlign = 'left';
    g.restore();
    // ノイズとモアレっぽい縞
    const img = g.getImageData(0, 0, 1280, 960); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 50 + Math.sin((i / 4 % 1280) * 0.9 + t) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    requestAnimationFrame(draw);
  }
  draw();
  const stream = cv.captureStream(15);
  navigator.mediaDevices.getUserMedia = async () => stream;
});
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = (n, full = false) => p.screenshot({ path: `${SHOT}/${n}.png`, fullPage: full });
try {
  await p.goto(srv.url);
  await p.waitForTimeout(500);
  await shot('01-empty');
  await p.click('text=スキャンを始める');
  await p.click('text=カメラを起動');
  const nums = ['12,345,678', '15,600,123', '9,876,543', '16,300,001', '3,210,987'];
  const t0 = Date.now();
  for (let k = 0; k < nums.length; k++) {
    await p.evaluate((n) => (window.__num = n), nums[k]);
    const before = await p.$eval('.who small', (e) => e.textContent);
    await p.waitForFunction((b) => document.querySelector('.who small')?.textContent !== b, before, { timeout: 60000 });
    if (k === 0) await shot('02-scan');
    console.log('scanned', nums[k], `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  const data = await p.evaluate(() => JSON.parse(localStorage.getItem('gspscan.data')));
  const got = Object.entries(data).map(([id, d]) => `${id}:${d.gsp}`);
  console.log('stored', got.join(' '));
  // 一覧
  await p.click('.tabs button:has-text("段位一覧")');
  await p.waitForSelector('.tierbox');
  await shot('03-list-tier');
  await p.click('.seg button:has-text("強い順")');
  await shot('04-list-gsp');
  await p.click('.tabs button:has-text("設定")');
  await shot('05-settings', true);
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  console.log('errors:', errors);
  await browser.close();
  srv.close();
}
