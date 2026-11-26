// 世界戦闘力の横に出るキャラアイコンで、どのキャラかを当てる。
// アプリに入っているのはアイコンの絵ではなく、12×12マスまで縮めて明るさをそろえた「特徴」の数字だけ。
import { BY_ID } from './chars.js';
import PROTOS from './icon-protos.json';
// キャラごとの「ほかのキャラのアイコンにどれくらい似てしまうか」（平均, ばらつき）。色の薄いアイコンは何にでも似やすいので、その分を差し引いて比べる
import STATS from './icon-stats.json';

export const GRID = 12;

/** 数字の位置（元画像のピクセル）から、左にあるアイコンの範囲を出す */
export function iconBox(num, dx = 0, dy = 0, ds = 1) {
  const h = num.y1 - num.y0;
  // 数字は右寄せなので、アイコンは数字の「右端」からだいたい決まった距離にある（ずれは identify で探す）
  const cx = num.x1 - 11.6 * h + dx * h;
  const cy = (num.y0 + num.y1) / 2 - 0.2 * h + dy * h;
  const s = 2.6 * h * 0.8 * ds; // 白い枠や背景を避けて真ん中の8割だけ使う
  return { x: cx - s / 2, y: cy - s / 2, w: s, h: s };
}

let c48 = null;
let c12 = null;
/** 画像の一部 → 正規化した特徴ベクトル（長さ GRID*GRID*3、大きさ1） */
export function iconVector(src, box) {
  c48 = c48 || Object.assign(document.createElement('canvas'), { width: 48, height: 48 });
  c12 = c12 || Object.assign(document.createElement('canvas'), { width: GRID, height: GRID });
  const g48 = c48.getContext('2d', { willReadFrequently: true });
  g48.imageSmoothingQuality = 'high';
  g48.clearRect(0, 0, 48, 48);
  g48.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, 48, 48);
  const g = c12.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.clearRect(0, 0, GRID, GRID);
  g.drawImage(c48, 0, 0, 48, 48, 0, 0, GRID, GRID);
  const d = g.getImageData(0, 0, GRID, GRID).data;
  const n = GRID * GRID;
  const v = new Float32Array(n * 3);
  for (let ch = 0; ch < 3; ch++) {
    let m = 0;
    for (let i = 0; i < n; i++) m += d[i * 4 + ch];
    m /= n;
    let sd = 0;
    for (let i = 0; i < n; i++) sd += (d[i * 4 + ch] - m) ** 2;
    sd = Math.sqrt(sd / n) + 1e-3;
    for (let i = 0; i < n; i++) v[i * 3 + ch] = (d[i * 4 + ch] - m) / sd;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

// 保存してある特徴（int8 を base64 にしたもの）を読み込む
const decoded = Object.entries(PROTOS).map(([id, b64]) => {
  const bin = atob(b64);
  const v = new Float32Array(bin.length);
  let norm = 0;
  for (let i = 0; i < bin.length; i++) {
    const x = ((bin.charCodeAt(i) + 128) & 255) - 128;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return { id, v };
});
export const KNOWN = new Set(decoded.map((p) => p.id));

/**
 * どのキャラかを当てる。位置と大きさを少しずつ変えて比べて、一番似ているものを採用。
 * 戻り値：似ている順の [{ id, sim }]
 */
export function identify(src, num, narrow = false) {
  const best = new Map();
  // 数字の読み取り位置の誤差やカメラの傾きがあるので、位置と大きさを少しずつ変えて探す（narrow：位置がほぼ分かっているときは狭く・速く）
  const DX = narrow ? [-0.5, -0.25, 0, 0.25, 0.5] : [-1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5];
  const DY = narrow ? [-0.25, 0, 0.25] : [-0.5, -0.25, 0, 0.25, 0.5];
  const DS = narrow ? [0.95, 1.05] : [0.9, 1, 1.1];
  for (const dx of DX)
    for (const dy of DY)
      for (const ds of DS) {
      const v = iconVector(src, iconBox(num, dx, dy, ds));
      for (const p of decoded) {
        let s = 0;
        for (let i = 0; i < v.length; i++) s += v[i] * p.v[i];
        if (s > (best.get(p.id) ?? -9)) best.set(p.id, s);
      }
      }
  return [...best.entries()]
    .map(([id, sim]) => {
      const st = STATS[id] || [0.5, 0.15];
      return { id, sim, z: (sim - st[0]) / st[1] };
    })
    .sort((a, b) => b.z - a.z);
}

/** 自信を持って決められるか */
export function confident(list) {
  if (!list.length) return false;
  const [a, b] = list;
  // 「ほかのキャラより飛びぬけて似ている」ときだけ決める（学習に使った224コマで、間違い0になる基準）
  return a.z >= 3 && (!b || a.z - b.z >= 1) && a.sim >= 0.7;
}

export const nameOf = (id) => (BY_ID[id] ? BY_ID[id].name : id);

/** 何コマか分の判定をまとめる（キャラごとに似ている度を平均） */
export function combine(lists) {
  const sum = new Map();
  for (const l of lists) for (const { id, sim, z } of l) {
    const o = sum.get(id) || { sim: 0, z: 0 };
    o.sim += sim;
    o.z += z;
    sum.set(id, o);
  }
  return [...sum.entries()].map(([id, o]) => ({ id, sim: o.sim / lists.length, z: o.z / lists.length })).sort((a, b) => b.z - a.z);
}
