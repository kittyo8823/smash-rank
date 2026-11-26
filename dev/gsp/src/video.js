// 動画からまとめて読み取る
// 1回目：動画を再生しながら、数字とアイコンのあたりの見た目が変わったところでキャラの区切りを見つける（軽い処理だけ）
// 2回目：区切りごとに真ん中あたりのコマへ移動して、数字を読み、アイコンでキャラを当てる（重い処理）
import { readVote } from './ocr.js';
import { identify, combine, confident, iconBox } from './icons.js';

export function loadVideo(file) {
  return new Promise((ok, ng) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.src = URL.createObjectURL(file);
    v.onloadeddata = () => ok(v);
    v.onerror = () => ng(new Error('この動画は読み込めませんでした'));
  });
}

export function seek(v, t) {
  return new Promise((ok) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      // 一部のブラウザは seeked の直後だとまだ前のコマのことがあるので1フレーム待つ
      requestAnimationFrame(() => ok());
    };
    v.addEventListener('seeked', done);
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.01));
  });
}

/** 動画の今のコマを画像（canvas）にする */
export function grab(v) {
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  return c;
}

// 見た目の変化を見るための小さな白黒サムネイル
function thumb(src, box, w, h, ctx) {
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  let m = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    m += out[i];
  }
  m /= out.length;
  let sd = 0;
  for (const x of out) sd += (x - m) ** 2;
  sd = Math.sqrt(sd / out.length) + 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - m) / sd;
  return out;
}
const diff = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

/**
 * 1回目：区切りを見つける
 * @param crop 数字の枠（0〜1の割合） num：その中で見つけた数字の位置（ピクセル）
 */
export function findSegments(v, crop, num, onProgress) {
  return new Promise((resolve) => {
    const W = v.videoWidth;
    const H = v.videoHeight;
    const nb = { x: crop.x * W, y: crop.y * H, w: crop.w * W, h: crop.h * H };
    // アイコンは少し広めに（手ぶれでずれても変化をつかめるように）
    const ib0 = iconBox(num, 0, 0, 1.4);
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const frames = []; // { t, n, i }
    const onFrame = (now, meta) => {
      const t = meta && meta.mediaTime != null ? meta.mediaTime : v.currentTime;
      frames.push({ t, n: thumb(v, nb, 48, 12, ctx), i: thumb(v, ib0, 12, 12, ctx) });
      if (onProgress) onProgress(t / v.duration);
      if (!v.ended && !v.paused) schedule();
    };
    const schedule = () => {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
      else requestAnimationFrame(() => onFrame(0, null));
    };
    const finish = () => {
      v.removeEventListener('ended', finish);
      // 1) 前のコマとほとんど同じ見た目が続く「止まっている区間」を集める（手ぶれ程度の変化は同じとみなす）
      const runs = [];
      let run = null;
      for (let k = 0; k < frames.length; k++) {
        const f = frames[k];
        const p = frames[k - 1];
        const still = p && diff(f.n, p.n) < 0.15 && diff(f.i, p.i) < 0.2;
        if (!still) {
          run = { t0: f.t, t1: f.t, count: 1, ref: f };
          runs.push(run);
        } else {
          run.t1 = f.t;
          run.count++;
        }
      }
      // 2) 続けて出てきた区間どうしが同じ見た目なら1つにまとめる（ちょっとした揺れで切れたもの）
      const segs = [];
      for (const r of runs.filter((x) => x.count >= 2)) {
        const last = segs[segs.length - 1];
        if (last && diff(r.ref.n, last.ref.n) < 0.2 && diff(r.ref.i, last.ref.i) < 0.3) {
          last.t1 = r.t1;
          last.count += r.count;
        } else segs.push({ ...r });
      }
      resolve(segs.map(({ t0, t1, count }) => ({ t0, t1, count })));
    };
    v.addEventListener('ended', finish);
    seek(v, 0).then(() => {
      v.playbackRate = 1;
      v.play().then(schedule, () => finish());
    });
  });
}

/**
 * 2回目：区切りごとに数字とキャラを決める
 * 戻り値：[{ id, sure, value, list, t, shot }]
 */
export async function readSegments(v, crop, segs, onProgress) {
  const out = [];
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (onProgress) onProgress(k / segs.length);
    // 切り替わった直後はアイコンがふわっと変わる途中のことがあるので、区切りの後半（表示が落ち着いたところ）を見る
    const d = s.t1 - s.t0;
    const ts = s.count >= 4 ? [s.t0 + d * 0.6, s.t0 + d * 0.95] : [s.t0 + d * 0.75];
    const values = [];
    const lists = [];
    let shot = null;
    for (const t of ts) {
      await seek(v, t);
      const c = grab(v);
      const r = await readVote(c, crop);
      if (r.value) values.push(r.value);
      if (r.bbox) {
        const l = identify(c, r.bbox);
        // まったく似ていないコマ（切り替わりの途中など）は判定に使わない
        if (l[0] && l[0].sim >= 0.6) lists.push(l);
        if (!shot) shot = iconShot(c, r.bbox);
      }
    }
    if (!values.length) continue;
    // 数字は多数決（同じ数が多い方）
    const cnt = new Map();
    for (const x of values) cnt.set(x, (cnt.get(x) || 0) + 1);
    const value = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const list = lists.length ? combine(lists) : [];
    // 2コマとも同じキャラが1番なら、少し基準をゆるめて決める
    const agree = lists.length >= 2 && lists.every((l) => l[0].id === list[0].id);
    const sure = confident(list) || (agree && list[0].sim >= 0.78 && (!list[1] || list[0].sim - list[1].sim >= 0.08));
    out.push({ id: list[0] ? list[0].id : null, sure, value, list: list.slice(0, 5), t: ts[0], shot, frames: s.count });
  }
  if (onProgress) onProgress(1);
  return mergeSame(out);
}

/** 確認画面に出す、そのコマのアイコン部分の小さな画像（スマホの中だけで使う） */
function iconShot(c, num) {
  const b = iconBox(num, 0, 0, 2.2);
  const o = document.createElement('canvas');
  o.width = o.height = 56;
  o.getContext('2d').drawImage(c, b.x, b.y, b.w, b.h, 0, 0, 56, 56);
  return o.toDataURL('image/jpeg', 0.8);
}

/** 同じキャラ・同じ数字が続けて出たり、行ったり来たりしたものはまとめる */
function mergeSame(list) {
  const out = [];
  for (const r of list) {
    const same = out.find((x) => x.value === r.value && (x.id === r.id || (!x.sure && !r.sure)));
    if (same) {
      if (!same.sure && r.sure) Object.assign(same, r);
      continue;
    }
    out.push(r);
  }
  return out;
}
