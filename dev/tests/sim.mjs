import * as R from '../src/rank.js';
import { CHARS } from '../src/chars.js';
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const truth = CHARS.map((c) => c.id).sort(() => rnd() - 0.5);
const pos = new Map(truth.map((id, i) => [id, i]));
const room = R.newRoom('X', { id: 'h', name: 'h' });
for (let n = 1; n <= 500; n++) {
  const { a, b } = room.pair;
  R.judge(room, pos.get(a) < pos.get(b) ? 'a' : 'b', rnd);
  if ([50, 100, 150, 200, 300, 400, 500].includes(n)) {
    const rk = R.ranking(room);
    let d2 = 0; rk.forEach((r, i) => (d2 += (pos.get(r.id) - i) ** 2));
    const N = rk.length, rho = 1 - (6 * d2) / (N * (N * N - 1));
    const top10 = rk.slice(0, 10).filter((r) => pos.get(r.id) < 10).length;
    const within10 = rk.filter((r, i) => Math.floor(i / 10) === Math.floor(pos.get(r.id) / 10)).length;
    console.log(n, 'rho', rho.toFixed(3), 'top10 hit', top10, 'same-10-group', within10, '/', N);
  }
}
