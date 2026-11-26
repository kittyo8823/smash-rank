// 世界戦闘力の段位（クマメイトツール https://kumamate.net/vip/ の「段位指数」を元にしています）
// 段位は「推定VIPボーダー × 段位指数」で区切る。VIPボーダーは日々上がるので、ボーダーとの比で判定する。

// [段位, 名前, 指数]（上から順）
export const TIERS = [
  ['25', '桜井', 1.105],
  ['24', '神(3)', 1.1036],
  ['24', '神(2)', 1.1023],
  ['24', '神(1)', 1.101],
  ['23', '宇宙最強', 1.099],
  ['22', '地元最強', 1.097],
  ['21', '魔境卒業', 1.095],
  ['20', '魔境Lv.5（トップオブザ魔境）', 1.093],
  ['19', '魔境Lv.4', 1.09],
  ['18', '魔境Lv.3（魔境街道）', 1.087],
  ['17', '魔境Lv.2', 1.084],
  ['16', '魔境Lv.1（魔境到達！）', 1.081],
  ['15', '魔境まであと2-3勝', 1.076],
  ['14', 'VIP街道爆進', 1.054],
  ['13', '一人前VIP', 1.046],
  ['12', 'VIP不安定層', 1.039],
  ['11', 'VIP入りたて', 1.011],
  ['10', 'VIP到達！', 1],
  ['9の2', 'VIPまであと2-3勝！', 0.979],
  ['9', 'VIPまでラストスパート', 0.9],
  ['8', 'VIPの階段登る', 0.8],
  ['7', '未VIP修行ゾーン（上）', 0.7],
  ['6', '未VIP修行ゾーン（中）', 0.6],
  ['5', '未VIP修行ゾーン（下）', 0.5],
  ['4', 'VIPに向けた発射台', 0.4],
  ['3', '未VIPカオス（上）', 0.3],
  ['2', '未VIPカオス（中）', 0.2],
  ['1', '未VIPカオス（下）', 0.1],
  ['0', '未VIP発射台', 0],
].map(([dan, name, index], i) => ({ dan, name, index, order: i }));

// ボーダーの初期値（クマメイトの表示値、2026/11/26 14:28 JST 時点）。1分ごとに +1 される。
export const DEFAULT_BORDER = { border: 15019807, at: Date.parse('2026-11-26T05:28:00Z'), source: 'built-in' };

/** その時刻の推定VIPボーダー */
export function borderAt(b, t = Date.now()) {
  return b.border + Math.floor((t - b.at) / 60000);
}

/** その段位の下限（クマメイトと同じく切り捨て） */
export const thresholdOf = (t, border) => Math.floor(border * t.index);

/** 世界戦闘力 → 段位（読み取った時点のボーダーとの比で判定） */
export function tierOf(gsp, borderThen) {
  for (const t of TIERS) if (gsp >= thresholdOf(t, borderThen)) return t;
  return TIERS[TIERS.length - 1];
}

/** 次の段位までの比率差 → いまのボーダー換算の差（目安） */
export function nextTierGap(gsp, borderThen, borderNow) {
  const cur = tierOf(gsp, borderThen);
  const next = TIERS[cur.order - 1];
  if (!next) return null;
  const nowGsp = (gsp / borderThen) * borderNow;
  return { tier: next, need: Math.max(0, Math.ceil(thresholdOf(next, borderNow) - nowGsp)) };
}

/** 段位の大分類（色分け用） */
export function groupOf(t) {
  const n = parseFloat(t.dan);
  if (n >= 24) return 'god';
  if (n >= 16) return 'makyo';
  if (n >= 10) return 'vip';
  if (n >= 8) return 'near';
  return 'pre';
}
export const GROUP_LABEL = { god: '神・桜井', makyo: '魔境', vip: 'VIP', near: 'VIP目前', pre: '未VIP' };

/** 文字列から世界戦闘力らしい数字を拾う */
export function pickGsp(text) {
  const t = String(text || '').replace(/[，､、．]/g, ',').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[Ss]/g, '5');
  const cands = [];
  // 1,234,567 / 12,345,678 の形を最優先
  for (const m of t.matchAll(/\d{1,2}[,.]\s?\d{3}[,.]\s?\d{3}(?!\d)/g)) cands.push({ v: +m[0].replace(/\D/g, ''), score: 3 });
  for (const m of t.matchAll(/\d{1,3}[,.]\s?\d{3}(?![\d,])/g)) cands.push({ v: +m[0].replace(/\D/g, ''), score: 1 });
  for (const m of t.replace(/[,.\s]/g, '').matchAll(/\d{6,8}/g)) cands.push({ v: +m[0], score: 2 });
  const ok = cands.filter((c) => c.v >= 1000 && c.v <= 30000000);
  if (!ok.length) return null;
  ok.sort((a, b) => b.score - a.score || b.v - a.v);
  return ok[0].v;
}
