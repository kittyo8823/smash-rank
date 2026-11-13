// ランキングの中心（画面・通信と独立）
import { CHARS, BY_ID } from './chars.js';

/** 技tier表で比べる技（全キャラ共通の枠）[id, 名前, バッジの略, 分類] */
export const MOVES = [
  ['jab', '弱攻撃', '弱', '地上攻撃'],
  ['dash', 'ダッシュ攻撃', 'DA', '地上攻撃'],
  ['ftilt', '横強', '横強', '強攻撃'],
  ['utilt', '上強', '上強', '強攻撃'],
  ['dtilt', '下強', '下強', '強攻撃'],
  ['fsmash', '横スマ', '横ス', 'スマッシュ'],
  ['usmash', '上スマ', '上ス', 'スマッシュ'],
  ['dsmash', '下スマ', '下ス', 'スマッシュ'],
  ['nair', '空N', '空N', '空中攻撃'],
  ['fair', '空前', '空前', '空中攻撃'],
  ['bair', '空後', '空後', '空中攻撃'],
  ['uair', '空上', '空上', '空中攻撃'],
  ['dair', '空下', '空下', '空中攻撃'],
  ['nb', 'NB（通常必殺ワザ）', 'NB', '必殺ワザ'],
  ['sb', '横B（横必殺ワザ）', '横B', '必殺ワザ'],
  ['ub', '上B（上必殺ワザ）', '上B', '必殺ワザ'],
  ['db', '下B（下必殺ワザ）', '下B', '必殺ワザ'],
  ['grab', 'つかみ', 'つ', 'つかみ・投げ'],
  ['fthrow', '前投げ', '前投', 'つかみ・投げ'],
  ['bthrow', '後投げ', '後投', 'つかみ・投げ'],
  ['uthrow', '上投げ', '上投', 'つかみ・投げ'],
  ['dthrow', '下投げ', '下投', 'つかみ・投げ'],
  ['final', '最後の切りふだ', '切札', 'その他'],
].map(([id, name, mark, group], i) => ({ id, name, mark, group, no: i + 1 }));
export const MOVE_BY_ID = Object.fromEntries(MOVES.map((m) => [m.id, m]));

/** モード：'chars'（キャラtier表） か 'moves:<キャラid>'（そのキャラの技tier表） */
export function itemIds(mode) {
  return mode === 'chars' ? CHARS.map((c) => c.id) : MOVES.map((m) => m.id);
}
export function validMode(mode) {
  if (mode === 'chars') return true;
  const m = /^moves:(.+)$/.exec(String(mode));
  return !!(m && BY_ID[m[1]]);
}
function defaultBoard(mode) {
  return { history: [], excluded: mode === 'chars' ? [] : ['final'], names: {} };
}
/** 今のモードの記録 */
export function board(room) {
  if (!room.boards[room.mode]) room.boards[room.mode] = defaultBoard(room.mode);
  return room.boards[room.mode];
}
/** 古い形（キャラtier表だけ）の保存データを今の形にする */
export function migrate(room) {
  if (!room.boards) {
    room.boards = { chars: { history: room.history || [], excluded: room.excluded || [], names: {} } };
    room.mode = 'chars';
    delete room.history;
    delete room.excluded;
  }
  if (!validMode(room.mode)) room.mode = 'chars';
  return room;
}

export const MAX_PLAYERS = 20;
export const NAME_MAX = 10;
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(rnd = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)];
  return s;
}
export function normalizeCode(s) {
  return String(s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}
export function cleanName(s, max = NAME_MAX) {
  return [...String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, max).join('');
}

export function newRoom(code, host) {
  const room = {
    v: 1,
    code,
    hostId: host.id,
    players: [{ id: host.id, name: host.name }],
    seen: {},
    mode: 'chars',
    // モードごとの記録 { history: [aId, bId, 結果（1=aが強い 0=bが強い 0.5=同じくらい）], excluded, names（技の呼び名） }
    boards: { chars: defaultBoard('chars') },
    pair: null, // {a, b, seq}
    votes: {}, // playerId -> 'a' | 'b' | 'd'
    last: null, // 直前の判定 {a, b, r, seq}
    seq: 0,
    done: false, // ホストが「おわり」にしてランク表を出しているか
  };
  nextPair(room);
  return room;
}

export function addPlayer(room, id, name) {
  const p = room.players.find((x) => x.id === id);
  if (p) {
    p.name = name || p.name;
    return { ok: true };
  }
  if (room.players.length >= MAX_PLAYERS) return { ok: false, err: 'full' };
  room.players.push({ id, name });
  return { ok: true };
}
export function removePlayer(room, id) {
  if (id === room.hostId) return;
  room.players = room.players.filter((p) => p.id !== id);
  delete room.votes[id];
}

export const activeIds = (room) => itemIds(room.mode).filter((id) => !board(room).excluded.includes(id));

/**
 * 強さの推定（ブラッドリー・テリー法）
 * 全キャラに「平均的な相手と1回引き分けた」ことにして、比較が少なくても極端にならないようにする。
 */
export function ratings(history, ids = CHARS.map((c) => c.id)) {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const wins = new Float64Array(n).fill(0.5); // 架空の相手との引き分け分
  const games = Array.from({ length: n }, () => new Map());
  const count = new Int32Array(n);
  for (const [a, b, r] of history) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i == null || j == null || i === j) continue;
    wins[i] += r;
    wins[j] += 1 - r;
    games[i].set(j, (games[i].get(j) || 0) + 1);
    games[j].set(i, (games[i].get(j) || 0));
    count[i]++;
    count[j]++;
  }
  let p = new Float64Array(n).fill(1);
  for (let it = 0; it < 60; it++) {
    const q = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let den = 1 / (p[i] + 1); // 架空の相手（強さ1）
      for (const [j, g] of games[i]) den += g / (p[i] + p[j]);
      q[i] = wins[i] / den;
    }
    // 平均を1にそろえる（幾何平均）
    let lg = 0;
    for (let i = 0; i < n; i++) lg += Math.log(q[i]);
    const m = Math.exp(lg / n);
    for (let i = 0; i < n; i++) q[i] /= m;
    p = q;
  }
  return ids.map((id, i) => ({ id, score: Math.log(p[i]), count: count[i] }));
}

/** 順位表（強い順） */
export function ranking(room) {
  const ids = activeIds(room);
  return ratings(board(room).history, ids)
    .sort((x, y) => y.score - x.score || x.count - y.count || ids.indexOf(x.id) - ids.indexOf(y.id))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 次の2択：比較の少ないキャラと、強さが近いキャラを組ませる */
export function suggestPair(room, rnd = Math.random) {
  const ids = activeIds(room);
  if (ids.length < 2) return null;
  const bd = board(room);
  const rs = ratings(bd.history, ids);
  const done = new Set(bd.history.map(([a, b]) => pairKey(a, b)));
  const min = Math.min(...rs.map((r) => r.count));
  const fewest = rs.filter((r) => r.count <= min + 0);
  const A = fewest[Math.floor(rnd() * fewest.length)];
  let cands = rs.filter((r) => r.id !== A.id && !done.has(pairKey(A.id, r.id)));
  if (!cands.length) cands = rs.filter((r) => r.id !== A.id);
  // 近い強さの上位から少しランダムに。比較の少ない相手を少し優先
  cands.sort((x, y) => Math.abs(x.score - A.score) + x.count * 0.03 - (Math.abs(y.score - A.score) + y.count * 0.03));
  const top = cands.slice(0, Math.min(4, cands.length));
  const B = top[Math.floor(rnd() * top.length)];
  return rnd() < 0.5 ? [A.id, B.id] : [B.id, A.id];
}

function setPair(room, a, b) {
  room.seq += 1;
  room.pair = a && b ? { a, b, seq: room.seq } : null;
  room.votes = {};
}

export function nextPair(room, rnd) {
  const p = suggestPair(room, rnd);
  setPair(room, p && p[0], p && p[1]);
}

export function choosePair(room, a, b) {
  const ids = itemIds(room.mode);
  if (!ids.includes(a) || !ids.includes(b) || a === b) return { ok: false };
  setPair(room, a, b);
  return { ok: true };
}

/** ホストの判定。win: 'a' | 'b' | 'd'（同じくらい） */
export function judge(room, win, rnd) {
  const pr = room.pair;
  if (!pr || !['a', 'b', 'd'].includes(win)) return { ok: false };
  const r = win === 'a' ? 1 : win === 'b' ? 0 : 0.5;
  board(room).history.push([pr.a, pr.b, r]);
  room.last = { a: pr.a, b: pr.b, r, seq: pr.seq, votes: { ...room.votes } };
  nextPair(room, rnd);
  return { ok: true };
}

export function undo(room) {
  const h = board(room).history.pop();
  if (!h) return { ok: false };
  setPair(room, h[0], h[1]);
  room.last = null;
  return { ok: true };
}

export function vote(room, pid, v) {
  if (!room.pair || !['a', 'b', 'd'].includes(v)) return { ok: false };
  if (!room.players.some((p) => p.id === pid)) return { ok: false };
  room.votes[pid] = v;
  return { ok: true };
}

export function setExcluded(room, ids) {
  const all = itemIds(room.mode);
  const B = board(room);
  B.excluded = [...new Set(ids.filter((id) => all.includes(id)))];
  if (all.length - B.excluded.length < 2) B.excluded = B.excluded.slice(0, all.length - 2);
  if (!room.pair || B.excluded.includes(room.pair.a) || B.excluded.includes(room.pair.b)) nextPair(room);
}

/** 技の呼び名を付ける（例：横B →「ファイアボール」） */
export function setNames(room, names) {
  if (room.mode === 'chars') return;
  const out = {};
  for (const [id, v] of Object.entries(names || {})) {
    const n = cleanName(v, 16);
    if (MOVE_BY_ID[id] && n) out[id] = n;
  }
  board(room).names = out;
}

/** キャラtier表 ⇔ 各キャラの技tier表 を切り替える（それぞれの記録は残る） */
export function setMode(room, mode) {
  if (!validMode(mode)) return { ok: false };
  room.mode = mode;
  board(room);
  room.last = null;
  room.done = false;
  nextPair(room);
  return { ok: true };
}

export function setDone(room, v) {
  room.done = !!v;
}

export function resetRanking(room) {
  board(room).history = [];
  room.last = null;
  room.done = false;
  nextPair(room);
}

/** 全員に配る状態 */
export function publicState(room, now = Date.now()) {
  return {
    v: 1,
    code: room.code,
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name, online: p.id === room.hostId || now - (room.seen[p.id] || 0) < 25000 })),
    mode: room.mode,
    boards: room.boards,
    pair: room.pair,
    votes: room.votes,
    last: room.last,
    done: !!room.done,
  };
}
