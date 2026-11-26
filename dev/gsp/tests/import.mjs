import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
const require = createRequire('/home/user/human-exe/');
const { chromium, devices } = require('playwright');
const DIR = '/tmp/claude-0/-home-user/f5b14529-fb02-55ca-92e4-f50a2b654f56/scratchpad/gsp';
const srv = await serve(18931);
const browser = await chromium.launch();
// Switchのスクショ風の画像（1280x720）を作る：時刻やほかの数字も混ぜる
const mk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const nums = ['14,812,345', '7,654,321', '16,001,234'];
const files = [];
for (let i = 0; i < nums.length; i++) {
  await mk.setContent(`<body style="margin:0;width:1280px;height:720px;background:linear-gradient(135deg,#3a1d6e,#0d1033);font-family:sans-serif;color:#fff;position:relative">
  <div style="position:absolute;left:40px;top:30px;font-size:28px">オンライン ・ 12:34 ・ ルール: 1on1 3ストック 7分</div>
  <div style="position:absolute;left:760px;top:420px;width:460px;height:200px;background:rgba(0,0,0,.35);border-radius:16px"></div>
  <div style="position:absolute;left:790px;top:440px;font-size:30px;color:#ffe9a0">世界戦闘力</div>
  <div style="position:absolute;left:790px;top:490px;font-size:72px;font-weight:bold">${nums[i]}</div>
  <div style="position:absolute;left:40px;top:640px;font-size:24px">プレイヤー 2 / 4</div></body>`);
  const f = `${DIR}/shot${i}.png`;
  await mk.screenshot({ path: f });
  files.push(f);
}
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
try {
  await p.goto(srv.url);
  await p.click('.tabs button:has-text("スキャン")');
  await p.setInputFiles('.btn.file input', files);
  await p.waitForSelector('text=読み取り結果を確認', { timeout: 90000 });
  const vals = await p.$$eval('.imp input', (e) => e.map((x) => x.value));
  console.log('read', vals.join(' | '), 'expected', nums.join(' | '));
  await p.screenshot({ path: `${DIR}/06-import.png` });
  await p.click('.sheet-panel .btn.primary');
  const data = await p.evaluate(() => JSON.parse(localStorage.getItem('gspscan.data')));
  console.log('stored', JSON.stringify(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.gsp]))));
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  console.log('errors', errors);
  await browser.close();
  srv.close();
}
