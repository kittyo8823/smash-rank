import assert from 'node:assert/strict';
import * as R from '../src/rank.js';
import { CHARS } from '../src/chars.js';
assert.equal(CHARS.length, 86);
assert.equal(new Set(CHARS.map((c) => c.id)).size, 86);
assert.ok(CHARS.some((c) => c.name === 'Mii 射撃タイプ'));
const r = R.newRoom('ABCDEF', { id: 'h', name: 'H' });
assert.ok(r.pair && r.pair.a !== r.pair.b);
R.addPlayer(r, 'g', 'G');
assert.ok(R.vote(r, 'g', 'a').ok);
assert.ok(!R.vote(r, 'zz', 'a').ok);
const { a, b } = r.pair;
R.judge(r, 'a');
assert.deepEqual(r.history[0], [a, b, 1]);
assert.equal(r.last.votes.g, 'a');
assert.deepEqual(r.votes, {}, 'votes reset');
const rk = R.ranking(r);
assert.ok(rk.findIndex((x) => x.id === a) < rk.findIndex((x) => x.id === b));
assert.equal(rk[0].id, a);
R.undo(r);
assert.equal(r.history.length, 0); assert.equal(r.pair.a, a);
assert.ok(R.choosePair(r, 'mario', 'sora').ok);
assert.ok(!R.choosePair(r, 'mario', 'mario').ok);
R.judge(r, 'd');
assert.deepEqual(r.history[0], ['mario', 'sora', 0.5]);
R.setExcluded(r, ['miibrawler', 'miisword', 'miigunner', 'bogus']);
assert.equal(R.activeChars(r).length, 83);
assert.equal(R.ranking(r).length, 83);
for (let i = 0; i < 50; i++) { assert.ok(!r.excluded.includes(r.pair.a) && !r.excluded.includes(r.pair.b)); R.judge(r, 'b'); }
// 推移律：A>B, B>C なら A>B>C
const t = R.newRoom('X', { id: 'h', name: 'h' });
for (const [x, y] of [['mario', 'luigi'], ['luigi', 'peach'], ['mario', 'luigi'], ['luigi', 'peach']]) { R.choosePair(t, x, y); R.judge(t, 'a'); }
const order = R.ranking(t).map((x) => x.id);
assert.ok(order.indexOf('mario') < order.indexOf('luigi') && order.indexOf('luigi') < order.indexOf('peach'));
assert.equal(order.at(-1), 'peach');
R.resetRanking(t); assert.equal(t.history.length, 0);
assert.equal(R.normalizeCode('ａｂ１２-cd'), 'AB12CD');
console.log('rank tests ok');
