import { createRequire } from 'node:module';
import { start } from './server.mjs';
const require = createRequire('/home/user/human-exe/');
const { chromium, devices } = require('playwright');
const SHOT = '/tmp/claude-0/-home-user/f5b14529-fb02-55ca-92e4-f50a2b654f56/scratchpad/smash';
(await import('node:fs')).mkdirSync(SHOT, { recursive: true });
const srv = await start(18910);
const browser = await chromium.launch();
const errors = [];
const base = `${srv.url}?broker=${encodeURIComponent(srv.broker)}`;
async function phone(name) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await p.goto(base);
  return p;
}
const shot = (p, n, full = false) => p.screenshot({ path: `${SHOT}/${n}.png`, fullPage: full });
try {
  const host = await phone('host');
  await host.waitForTimeout(800);
  await shot(host, '01-title');
  await host.fill('input[placeholder="ニックネーム"]', 'ホスト');
  await host.click('text=部屋を作る');
  await host.waitForSelector('.fighter');
  const code = (await host.textContent('.code-chip')).replace('部屋', '').trim();
  console.log('code', code);
  const g1 = await phone('g1');
  await g1.goto(`${base}&room=${code}`);
  await g1.fill('input[placeholder="ニックネーム"]', 'たろう');
  await g1.click('button:text-is("参加")');
  await g1.waitForSelector('.fighter');
  const g2 = await phone('g2');
  await g2.fill('input[placeholder="ニックネーム"]', 'はなこ');
  await g2.fill('input.code', code.toLowerCase());
  await g2.click('button:text-is("参加")');
  await g2.waitForSelector('.fighter');
  // 同じ対決が見えている
  const nm = async (p) => p.$$eval('.f-name', (e) => e.map((x) => x.textContent).join('|'));
  console.log('pair', await nm(host), (await nm(g1)) === (await nm(host)) && (await nm(g2)) === (await nm(host)));
  // 投票
  await g1.click('.fighter.a');
  await g2.click('.fighter.b');
  await host.waitForFunction(() => document.querySelectorAll('.f-votes')[0].textContent.includes('たろう') && document.querySelectorAll('.f-votes')[1].textContent.includes('はなこ'));
  await shot(host, '02-vs-host');
  await shot(g1, '03-vs-guest');
  const before = await nm(host);
  await host.click('.fighter.a');
  await g1.waitForFunction((b) => [...document.querySelectorAll('.f-name')].map((x) => x.textContent).join('|') !== b, before);
  await g1.waitForSelector('.last:has-text("同じ意見 1/2")');
  console.log('judge ok', await g1.textContent('.last'));
  // ホストが30回答える
  for (let i = 0; i < 30; i++) {
    const cur = await nm(host);
    await host.click(i % 3 ? '.fighter.a' : '.fighter.b');
    await host.waitForFunction((b) => [...document.querySelectorAll('.f-name')].map((x) => x.textContent).join('|') !== b, cur);
  }
  await g2.waitForFunction(() => document.querySelector('.meter-text b').textContent === '31');
  console.log('31 judged, guest synced');
  // 1つ戻す
  await host.click('text=1つ戻す');
  await g2.waitForFunction(() => document.querySelector('.meter-text b').textContent === '30');
  // 自分で選ぶ
  await host.click('text=自分で選ぶ');
  await host.fill('.sheet-panel input', 'マリオ');
  await host.click('.pick:has-text("ドクターマリオ")');
  await host.fill('.sheet-panel input', 'そら');
  await shot(host, '04-choose');
  await host.click('.pick:has-text("ソラ")');
  await g1.waitForFunction(() => [...document.querySelectorAll('.f-name')].map((x) => x.textContent).join('|') === 'ドクターマリオ|ソラ');
  console.log('choose ok');
  await host.click('.fighter.b');
  // ランキング
  await g1.click('.tabs button:has-text("ランキング")');
  await g1.waitForSelector('.tier');
  const tiers = await g1.$$eval('.tier h2', (e) => e.map((x) => x.firstChild.textContent));
  console.log('tiers', tiers.join(', '));
  await g1.waitForTimeout(300);
  await shot(g1, '05-rank');
  await shot(g1, '05-rank-full', true);
  // 設定でMiiを外す
  await host.click('.tabs button:has-text("設定")');
  await host.click('text=Miiを外す');
  await g1.waitForFunction(() => document.querySelector('.rank-head b').textContent === '83キャラ');
  await shot(host, '06-settings');
  console.log('exclude ok');
  // メンバー
  await host.click('.tabs button:has-text("メンバー")');
  await shot(host, '07-members');
  // ホスト再読み込み → つづきから
  await host.reload();
  await host.click('text=つづきから');
  await host.waitForSelector('.fighter');
  console.log('resume', await host.textContent('.meter-text b'));
  await g2.click('.tabs button:has-text("対決")');
  await host.click('.fighter.a');
  await g2.waitForFunction(() => document.querySelector('.meter-text b').textContent === '32');
  console.log('after resume synced');
  // 閉じる
  await host.click('.top .linkbtn');
  await host.click('.sheet-panel .btn.danger');
  await g2.waitForSelector('.err:has-text("閉じました")');
  console.log('close ok');
  const g3 = await phone('g3');
  await g3.fill('input[placeholder="ニックネーム"]', 'x');
  await g3.fill('input.code', code);
  await g3.click('button:text-is("参加")');
  await g3.waitForSelector('.err:has-text("見つかりません")', { timeout: 15000 });
  console.log('closed room notfound ok');
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  console.log('errors:', errors);
  await browser.close();
  srv.close();
}
