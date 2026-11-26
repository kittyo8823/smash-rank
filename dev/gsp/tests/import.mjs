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
  <div style="position:absolute;left:640px;top:440px;width:600px;height:250px;background:#dfe4ea;color:#2b2f3a;border-radius:10px">
   <div style="position:absolute;left:20px;top:22px;font-size:26px;font-weight:bold">世界戦闘力</div><div style="position:absolute;right:24px;top:14px;font-size:44px;font-weight:bold">${nums[i]}</div>
   <div style="position:absolute;left:20px;top:100px;font-size:22px">No.1 世界戦闘力</div><div style="position:absolute;right:24px;top:92px;font-size:44px;font-weight:bold">16,888,${String(100 + i).padStart(3, '0')}</div>
   <div style="position:absolute;left:20px;top:180px;font-size:22px">総合世界戦闘力</div><div style="position:absolute;right:24px;top:172px;font-size:44px;font-weight:bold">13,944,731</div></div>
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
  await p.setInputFiles('input[accept="image/*"]', files);
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
