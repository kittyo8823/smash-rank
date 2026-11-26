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
export function prepare(src, crop = null, targetH = 96, binarize = true) {
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
  g.drawImage(src, sx, sy, cw, ch, 0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  // 明るさ（白・黄色の文字が残りやすいように、RGBの最大値を使う）
  const lum = new Uint8ClampedArray(W * H);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = Math.max(d[i], d[i + 1], d[i + 2]) * 0.6 + (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * 0.4;
    lum[j] = v;
    hist[lum[j]]++;
  }
  if (!binarize) {
    for (let i = 0, j = 0; i < d.length; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = lum[j];
    g.putImageData(img, 0, 0);
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
  return out;
}

/** 1行（ガイド枠の中）を読む */
export async function readLine(canvas) {
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: '7' });
  const { data } = await w.recognize(canvas);
  return { value: pickGsp(data.text), text: data.text.trim(), conf: data.confidence };
}

/** 画像全体から探す（スクショの読み込み用） */
export async function readAnywhere(canvas) {
  const w = await getWorker();
  await w.setParameters({ tessedit_pageseg_mode: '11' });
  const { data } = await w.recognize(canvas);
  return { value: pickGsp(data.text), text: data.text.trim(), conf: data.confidence };
}
