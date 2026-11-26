// 数字の読み取り（Tesseract.js をスマホの中で動かす。画像はどこにも送らない）
/* global Tesseract */
import { pickGsp } from './tiers.js';

let workerP = null;

export function getWorker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: new URL('vendor/worker.min.js', location.href).href,
        corePath: new URL('vendor/core/', location.href).href,
        langPath: new URL('vendor/lang/', location.href).href,
        gzip: true,
        logger: (m) => onProgress && onProgress(m),
      });
      await w.setParameters({ tessedit_char_whitelist: '0123456789,.' });
      return w;
    })().catch((e) => {
      workerP = null;
      throw e;
    });
  }
  return workerP;
}

/**
 * 画像の一部を切り出して、文字が読みやすいように白黒にする
 * @param src video / img / canvas
 * @param crop {x, y, w, h} 0〜1 の割合（省略で全体）
 */
export function prepare(src, crop = null, targetH = 96, binarize = true, adaptive = false) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const c = crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(c.x * sw);
  const sy = Math.round(c.y * sh);
  const cw = Math.max(1, Math.round(c.w * sw));
  const ch = Math.max(1, Math.round(c.h * sh));
  // 切り出し部分は高さ targetH に、全体なら横 1600 まで
  const scale = crop ? Math.min(4, targetH / ch) : Math.min(1, 1600 / cw);
  const W = Math.max(1, Math.round(cw * scale));
  const H = Math.max(1, Math.round(ch * scale));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  // まわりとの差で白黒にするときは、ノイズやモアレを先に少しぼかしておく
  if (adaptive) g.filter = `blur(${Math.max(0.6, H / 70).toFixed(2)}px)`;
  g.drawImage(src, sx, sy, cw, ch, 0, 0, W, H);
  g.filter = 'none';
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  // 明るさ（実機の写真で試して、ふつうの輝度がいちばん正確だった）
  const lum = new Uint8ClampedArray(W * H);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    lum[j] = v;
    hist[lum[j]]++;
  }
  if (!binarize) {
    for (let i = 0, j = 0; i < d.length; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = lum[j];
    g.putImageData(img, 0, 0);
    cv.map = { ox: sx, oy: sy, s: scale, pad: 0 };
    return cv;
  }
  // 大津の二値化
  const total = W * H;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let th = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      th = i;
    }
  }
  if (adaptive) {
    // まわりの平均との差で白黒を決める（明るさのムラや枠の端の暗い部分に強い）
    const r = Math.max(4, Math.round(H / 3));
    const ii = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rs = 0;
      for (let x = 0; x < W; x++) {
        rs += lum[y * W + x];
        ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + rs;
      }
    }
    const mean = (x, y) => {
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1);
      return (ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    };
    let darkText = 0;
    for (let j = 0; j < lum.length; j++) if (lum[j] <= th) darkText++;
    const textIsDark = darkText < total / 2;
    for (let y = 0, j = 0; y < H; y++)
      for (let x = 0; x < W; x++, j++) {
        const m = mean(x, y);
        const diff = Math.max(m * 0.12, 22);
        const on = textIsDark ? lum[j] < m - diff : lum[j] > m + diff;
        const v = on ? 0 : 255;
        d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = v;
        d[j * 4 + 3] = 255;
      }
  } else {
  // 文字が少ない側（多くは明るい文字）を黒、背景を白にする
  let bright = 0;
  for (let j = 0; j < lum.length; j++) if (lum[j] > th) bright++;
  const textIsBright = bright < total / 2;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const on = textIsBright ? lum[j] > th : lum[j] <= th;
    const v = on ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  }
  g.putImageData(img, 0, 0);
  // 周りに余白を足す（Tesseract は端に接した文字が苦手）
  const pad = Math.round(H * 0.25);
  const out = document.createElement('canvas');
  out.width = W + pad * 2;
  out.height = H + pad * 2;
  const o = out.getContext('2d');
  o.fillStyle = '#fff';
  o.fillRect(0, 0, out.width, out.height);
  o.drawImage(cv, pad, pad);
  out.pad = pad;
  // 切り出した画像の座標 → 元画像の座標に戻すための情報
  out.map = { ox: sx, oy: sy, s: scale, pad };
  return out;
}

/** 1行（ガイド枠の中）を読む */
export async function readLine(canvas) {
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: '7' });
  const { data } = await w.recognize(canvas);
  return { value: pickGsp(data.text), text: data.text.trim(), conf: data.confidence, bbox: inkBox(canvas) || numberBox(data, canvas.map) };
}

/**
 * 白黒にした画像から、数字の文字のかたまりの位置を直接さがす（文字認識の箱は余計なものを含みやすいので）。
 * 一番太い横の帯 → その中で一番インクの多い横のかたまり
 */
function inkBox(cv) {
  const map = cv.map;
  if (!map || !map.pad) return null;
  const W = cv.width;
  const H = cv.height;
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const dark = (x, y) => d[(y * W + x) * 4] < 128;
  const rows = new Array(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dark(x, y)) rows[y]++;
  const minRow = Math.max(2, W * 0.02);
  let best = null;
  for (let y = 0; y < H; ) {
    if (rows[y] < minRow) {
      y++;
      continue;
    }
    let y1 = y;
    let ink = 0;
    while (y1 < H && rows[y1] >= minRow) ink += rows[y1++];
    if (!best || ink > best.ink) best = { y0: y, y1, ink };
    y = y1;
  }
  if (!best || best.y1 - best.y0 < 6) return null;
  const bh = best.y1 - best.y0;
  const cols = new Array(W).fill(0);
  for (let x = 0; x < W; x++) for (let y = best.y0; y < best.y1; y++) if (dark(x, y)) cols[x]++;
  // 隙間が文字の高さの0.6倍より広いところで区切って、一番インクの多いかたまりを数字とみなす
  const groups = [];
  let cur = null;
  let gap = 0;
  for (let x = 0; x < W; x++) {
    if (cols[x] > 0) {
      if (!cur || gap > bh * 0.6) {
        cur = { x0: x, x1: x, ink: 0 };
        groups.push(cur);
      }
      cur.x1 = x;
      cur.ink += cols[x];
      gap = 0;
    } else gap++;
  }
  // 文字らしいかたまり：横長で、中がスカスカ（べったり塗られた背景の板などは除く）
  const pad = map.pad;
  const texty = groups.filter((x) => {
    const w = x.x1 - x.x0 + 1;
    const fill = x.ink / (w * bh);
    // 切り出した範囲の左右の端にくっついているものは、背景の板や枠の一部（数字ではない）
    const touches = x.x0 <= pad + 1 || x.x1 >= W - pad - 2;
    return !touches && w >= bh * 3 && w <= bh * 14 && fill < 0.6;
  });
  if (!texty.length) return null;
  texty.sort((a, b) => b.ink - a.ink);
  const g = texty[0];
  // 数字のかたまりの中だけで、上下の範囲を測り直す（枠の線などの横一直線の行は文字ではないので除く）
  const gw = g.x1 - g.x0 + 1;
  let ry0 = -1;
  let ry1 = -1;
  let runBest = null;
  for (let y = Math.max(0, best.y0 - 2); y <= Math.min(H - 1, best.y1 + 1); y++) {
    let c = 0;
    for (let x = g.x0; x <= g.x1; x++) if (dark(x, y)) c++;
    const text = c > 0 && c < gw * 0.85;
    if (text) {
      if (ry0 < 0) ry0 = y;
      ry1 = y + 1;
    }
    if ((!text || y === Math.min(H - 1, best.y1 + 1)) && ry0 >= 0) {
      if (!runBest || ry1 - ry0 > runBest[1] - runBest[0]) runBest = [ry0, ry1];
      ry0 = -1;
    }
  }
  const [ty0, ty1] = runBest && runBest[1] - runBest[0] >= 6 ? runBest : [best.y0, best.y1];
  const to = (px, o) => o + (px - map.pad) / map.s;
  return { x0: to(g.x0, map.ox), y0: to(ty0, map.oy), x1: to(g.x1 + 1, map.ox), y1: to(ty1, map.oy) };
}

/** 数字の単語が元画像のどこにあったか（アイコンの位置を出すのに使う） */
function numberBox(data, map) {
  if (!map) return null;
  const all = (data.words || []).filter((x) => (x.text.match(/\d/g) || []).length >= 2);
  if (!all.length) return null;
  all.sort((a, b) => (b.text.match(/\d/g) || []).length - (a.text.match(/\d/g) || []).length);
  const main = all[0];
  const hh = (x) => x.bbox.y1 - x.bbox.y0;
  const mid = (x) => (x.bbox.y0 + x.bbox.y1) / 2;
  // 高さと縦位置は「一番数字の多い単語」で決める（ゴミの混じった大きな箱に引っぱられないように）
  const H = hh(main);
  const ws = all.filter((x) => Math.abs(mid(x) - mid(main)) < H * 0.6 && hh(x) > H * 0.7 && hh(x) < H * 1.3);
  const to = (px, o) => o + (px - map.pad) / map.s;
  return {
    x0: to(Math.min(...ws.map((x) => x.bbox.x0)), map.ox),
    y0: to(main.bbox.y0, map.oy),
    x1: to(Math.max(...ws.map((x) => x.bbox.x1)), map.ox),
    y1: to(main.bbox.y1, map.oy),
  };
}

/** 画像全体から探す（スクショの読み込み用） */
export async function readAnywhere(canvas) {
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: '11' });
  const { data } = await w.recognize(canvas);
  // 世界戦闘力らしい数字（12,345,678 の形）を位置つきで集めて、一番上のものを選ぶ
  // （画面右下には「そのキャラ / No.1 / 総合」の3つが縦に並ぶので、一番上がそのキャラの数字）
  const found = [];
  for (const l of data.lines || []) {
    const v = pickGsp(l.text);
    if (v && v >= 100000 && /\d[,.]\s?\d{3}[,.]\s?\d{3}/.test(l.text.replace(/\s/g, ''))) found.push({ v, y: l.bbox.y0, x: l.bbox.x0, line: l });
  }
  if (!found.length) return { value: pickGsp(data.text), text: data.text.trim(), count: 0, bbox: null };
  found.sort((a, b) => a.y - b.y);
  return { value: found[0].v, text: data.text.trim(), count: found.length, bbox: numberBox({ words: found[0].line.words || [] }, canvas.map) };
}

/**
 * 枠の中にある数字のうち「一番上」のものを読む。
 * スマブラの画面では右下に「そのキャラの世界戦闘力 / No.1の世界戦闘力 / 総合世界戦闘力」が縦に並ぶので、一番上がほしい数字。
 * 1) 枠全体をざっと読んで数字の行の位置を見つける → 2) 一番上の行だけを切り出して正確に読み直す
 */
export async function readTopNumber(src, crop) {
  const w = await getWorker();
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const c = crop || { x: 0, y: 0, w: 1, h: 1 };
  const boxH = c.h * sh;
  const overview = prepare(src, c, Math.min(800, Math.max(300, boxH)));
  await w.setParameters({ tessedit_pageseg_mode: '6' });
  const { data } = await w.recognize(overview);
  const lines = (data.lines || [])
    .map((l) => {
      // 行の中で数字を含む単語だけの範囲（ラベルや記号を除いて、数字にぴったり合わせる）
      const ws = (l.words || []).filter((x) => /\d/.test(x.text));
      const bbox = ws.length
        ? { x0: Math.min(...ws.map((x) => x.bbox.x0)), y0: Math.min(...ws.map((x) => x.bbox.y0)), x1: Math.max(...ws.map((x) => x.bbox.x1)), y1: Math.max(...ws.map((x) => x.bbox.y1)) }
        : l.bbox;
      return { text: l.text, bbox, digits: (l.text.match(/\d/g) || []).length };
    })
    .filter((l) => l.digits >= 5)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  // 数字の行が2つ以上見えていないと「一番上」か分からないので読まない（No.1の数字を取り違えないため）
  if (lines.length < 2) return { value: null, text: data.text.trim(), lines: lines.length, needAll: true };
  const top = lines[0];
  // overview の座標 → 元画像の割合に戻す（prepare は周りに余白 pad を足している）
  const pad = overview.pad || 0;
  const innerW = overview.width - pad * 2;
  const innerH = overview.height - pad * 2;
  const fx = (px) => c.x + ((px - pad) / innerW) * c.w;
  const fy = (py) => c.y + ((py - pad) / innerH) * c.h;
  const lh = top.bbox.y1 - top.bbox.y0;
  const x0 = fx(top.bbox.x0 - lh * 0.6);
  const x1 = fx(top.bbox.x1 + lh * 0.6);
  const y0 = fy(top.bbox.y0 - lh * 0.35);
  const y1 = fy(top.bbox.y1 + lh * 0.35);
  const tight = { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(1, x1) - Math.max(0, x0), h: Math.min(1, y1) - Math.max(0, y0) };
  const again = await readLine(prepare(src, tight, 64));
  const first = pickGsp(top.text);
  // 2回の読みが食い違ったら、確かでないので登録しない
  const value = again.value && first ? (again.value === first ? first : null) : again.value || first;
  return { value, text: again.text || top.text, lines: lines.length, tight, again: again.value, first };
}

/**
 * 枠の中の1行の数字を、作り方を変えた何枚かの画像で読んで多数決する。
 * テレビを撮った写真では1桁だけ読み間違えることがあるので、2つ以上が一致したときだけ採用する。
 */
export async function readVote(src, crop) {
  const variants = [
    [64, true],
    [56, true],
    [80, true],
    [64, false],
  ];
  const counts = new Map();
  const seen = [];
  const boxes = new Map();
  for (const [hh, adaptive] of variants) {
    const r = await readLine(prepare(src, crop, hh, true, adaptive));
    seen.push(r.value);
    if (r.value) counts.set(r.value, (counts.get(r.value) || 0) + 1);
    if (r.value && r.bbox && !boxes.has(r.value)) boxes.set(r.value, r.bbox);
    // 先に2票そろったら、残りは読まずに決める
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (best.length && best[0][1] >= 2 && (best.length < 2 || best[0][1] > best[1][1])) return { value: best[0][0], votes: best[0][1], seen, bbox: boxes.get(best[0][0]) || null };
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (best.length && best[0][1] >= 2 && (best.length < 2 || best[0][1] > best[1][1])) return { value: best[0][0], votes: best[0][1], seen, bbox: boxes.get(best[0][0]) || null };
  return { value: null, votes: 0, seen };
}
