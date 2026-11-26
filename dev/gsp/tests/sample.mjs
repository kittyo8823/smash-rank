// 全キャラを読み取った後の見た目（サンプルの数字）
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
import { CHARS } from '../src/chars.js';
import { DEFAULT_BORDER, borderAt } from '../src/tiers.js';
const require = createRequire('/home/user/human-exe/');
const { chromium, devices } = require('playwright');
const OUT = '/tmp/claude-0/-home-user/f5b14529-fb02-55ca-92e4-f50a2b654f56/scratchpad/gsp';
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const border = borderAt(DEFAULT_BORDER);
const data = {};
// よく使うキャラは高く、あまり使わないキャラは低め（それっぽい散らばり）
CHARS.forEach((c, i) => {
  const r = rnd();
  const ratio = r < 0.08 ? 1.08 + rnd() * 0.02 : r < 0.3 ? 1 + rnd() * 0.07 : r < 0.5 ? 0.85 + rnd() * 0.15 : 0.15 + rnd() * 0.7;
  data[c.id] = { gsp: Math.round(border * ratio), at: Date.now() - Math.floor(rnd() * 3) * 86400e3, border };
});
const srv = await serve(18932);
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'] });
await ctx.addInitScript((d) => {
  localStorage.setItem('gspscan.data', JSON.stringify(d));
  localStorage.setItem('gspscan.tab', '"list"');
  localStorage.setItem('gspscan.view', '"tier"');
}, data);
const p = await ctx.newPage();
await p.goto(srv.url);
await p.waitForSelector('.tierbox');
await p.waitForTimeout(800);
await p.addStyleTag({ content: '.tabs{display:none!important}' });
await p.screenshot({ path: `${OUT}/sample-full.png`, fullPage: true });
await p.click('.seg button:has-text("強い順")');
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/sample-gsp.png` });
await b.close();
srv.close();
console.log('ok');
