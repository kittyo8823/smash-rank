// クマメイトツールの「現在のVIPボーダー推定値」を読んで border.json に書く（GitHub Actions で1日1回）
import { writeFile } from 'node:fs/promises';

const res = await fetch('https://kumamate.net/vip/', { headers: { 'user-agent': 'smash-gsp-scanner (daily border fetch, GitHub Actions)' } });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const html = await res.text();
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const m = /現在のVIPボーダー推定値\s*([\d,]{8,12})/.exec(text);
if (!m) throw new Error('border not found');
const border = Number(m[1].replace(/,/g, ''));
if (!(border > 1000000 && border < 100000000)) throw new Error(`odd value ${border}`);
const out = { border, at: new Date().toISOString(), source: 'kumamate.net/vip' };
await writeFile(process.argv[2] || 'border.json', JSON.stringify(out, null, 2) + '\n');
console.log(out);
