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
// ---------- 手ぶれ追跡 ----------
// 数字の左にある「世界戦闘力」の文字は、どのキャラでも同じ見た目なので、これを目印に画面のずれを測る
const TS = 0.5; // 追跡は半分の大きさで計算（速さのため）
function grayRegion(src, x, y, w, h, ctx) {
  const W = Math.max(1, Math.round(w * TS));
  const H = Math.max(1, Math.round(h * TS));
  ctx.canvas.width = W;
  ctx.canvas.height = H;
  ctx.drawImage(src, x, y, w, h, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  return { g, W, H };
}
export function makeTracker(src, num) {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const h = num.y1 - num.y0;
  const my = (num.y0 + num.y1) / 2;
  // 「世界戦闘力」の文字と、その上（一番上の段だけは上に何もない）まで含めて、下の「No.1」の段と取り違えないようにする
  const box = { x: num.x1 - 21 * h, y: my - 3.2 * h, w: 7.5 * h, h: 4.5 * h };
  const t = grayRegion(src, box.x, box.y, box.w, box.h, ctx);
  let m = 0;
  for (const x of t.g) m += x;
  m /= t.g.length;
  let sd = 0;
  for (const x of t.g) sd += (x - m) ** 2;
  sd = Math.sqrt(sd / t.g.length) + 1e-3;
  const tn = t.g.map((x) => (x - m) / sd);
  const R = Math.round(3 * h); // 探す範囲（元の大きさで、文字の高さの3倍まで）
  return {
    ctx,
    box,
    tn,
    tw: t.W,
    th: t.H,
    R,
    /** 今のコマで、最初のコマからどれだけずれたか {dx, dy, score} */
    locate(frame, prev = { dx: 0, dy: 0 }) {
      const sx = box.x + prev.dx - R;
      const sy = box.y + prev.dy - R;
      const area = grayRegion(frame, sx, sy, box.w + 2 * R, box.h + 2 * R, ctx);
      const step = 2;
      let best = { s: -2, x: 0, y: 0 };
      const search = (x0, x1, y0, y1, st) => {
        for (let oy = y0; oy <= y1; oy += st)
          for (let ox = x0; ox <= x1; ox += st) {
            if (ox < 0 || oy < 0 || ox + this.tw > area.W || oy + this.th > area.H) continue;
            let m2 = 0;
            for (let y = 0; y < this.th; y += 2) for (let x = 0; x < this.tw; x += 2) m2 += area.g[(oy + y) * area.W + ox + x];
            const n = Math.ceil(this.th / 2) * Math.ceil(this.tw / 2);
            m2 /= n;
            let sd2 = 0;
            let c = 0;
            for (let y = 0; y < this.th; y += 2)
              for (let x = 0; x < this.tw; x += 2) {
                const v = area.g[(oy + y) * area.W + ox + x] - m2;
                sd2 += v * v;
                c += v * this.tn[y * this.tw + x];
              }
            const sc = c / (Math.sqrt(sd2) * Math.sqrt(n) + 1e-3);
            if (sc > best.s) best = { s: sc, x: ox, y: oy };
          }
      };
      search(0, area.W - this.tw, 0, area.H - this.th, step);
      const c0 = best;
      search(c0.x - step, c0.x + step, c0.y - step, c0.y + step, 1);
      const r = Math.round(R * TS);
      return { dx: prev.dx + (best.x - r) / TS, dy: prev.dy + (best.y - r) / TS, score: best.s };
    },
  };
}
const shiftCrop = (crop, off, W, H) => ({ x: crop.x + off.dx / W, y: crop.y + off.dy / H, w: crop.w, h: crop.h });
const shiftBox = (b, off) => ({ x: b.x + off.dx, y: b.y + off.dy, w: b.w, h: b.h });

const diff = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

/**
 * 1回目：区切りを見つける
 * @param crop 数字の枠（0〜1の割合） num：その中で見つけた数字の位置（ピクセル）
 */
export function findSegments(v, crop, num, onProgress, tracker = null) {
  return new Promise((resolve) => {
    const W = v.videoWidth;
    const H = v.videoHeight;
    const nb = { x: crop.x * W, y: crop.y * H, w: crop.w * W, h: crop.h * H };
    // アイコンは少し広めに（手ぶれでずれても変化をつかめるように）
    const ib0 = iconBox(num, 0, 0, 1.4);
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const frames = []; // { t, n, i, off }
    let off = { dx: 0, dy: 0 };
    let k = 0;
    const onFrame = (now, meta) => {
      const t = meta && meta.mediaTime != null ? meta.mediaTime : v.currentTime;
      // 何コマかに1回、手ぶれのずれを測り直す
      if (tracker && k++ % 2 === 0) {
        const r = tracker.locate(v, off);
        if (r.score > 0.5) off = { dx: r.dx, dy: r.dy };
      }
      frames.push({ t, n: thumb(v, shiftBox(nb, off), 48, 12, ctx), i: thumb(v, shiftBox(ib0, off), 12, 12, ctx), off: { ...off } });
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
        const still = p && diff(f.n, p.n) < 0.2 && diff(f.i, p.i) < 0.25;
        if (!still) {
          run = { t0: f.t, t1: f.t, count: 1, ref: f, off: f.off };
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
      resolve(segs.map(({ t0, t1, count, off }) => ({ t0, t1, count, off })));
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
export async function readSegments(v, crop, segs, onProgress, tracker = null) {
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
      let cr = crop;
      let tracked = false;
      if (tracker) {
        const o = tracker.locate(c, s.off || { dx: 0, dy: 0 });
        if (o.score > 0.45) {
          cr = shiftCrop(crop, o, c.width, c.height);
          tracked = true;
        } else if (s.off) cr = shiftCrop(crop, s.off, c.width, c.height);
      }
      // 追いかけた位置で読む → だめなら（キャラに自信がない・読めない）合わせた位置そのままでも読んで、良い方を使う
      const tryRead = async (cc, narrow) => {
        const rr = await readVote(c, cc);
        const l = rr.bbox ? identify(c, rr.bbox, narrow) : [];
        return { r: rr, l };
      };
      let a = await tryRead(cr, tracked);
      if (cr !== crop && (!a.r.value || !confident(a.l))) {
        const b = await tryRead(crop, false);
        if (b.r.value && (!a.r.value || (b.l[0] && (!a.l[0] || b.l[0].z > a.l[0].z)))) a = b;
      }
      const r = a.r;
      if (r.value) values.push(r.value);
      if (r.bbox) {
        const l = a.l;
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
    const sure = confident(list) || (agree && list[0].z >= 2.5 && (!list[1] || list[0].z - list[1].z >= 0.8) && list[0].sim >= 0.7);
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
