// スマブラ段位スキャナー：画面
import { CHARS, BY_ID, norm } from './chars.js';
import { TIERS, DEFAULT_BORDER, borderAt, tierOf, nextTierGap, groupOf, thresholdOf, pickGsp } from './tiers.js';
import { getWorker, prepare, readVote, readAnywhere } from './ocr.js';
import { identify, confident } from './icons.js';
import { loadVideo, seek, grab, findSegments, readSegments, makeTracker } from './video.js';

// ---------- 小道具 ----------
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
};
const KEY = 'gspscan.';
const load = (k, d = null) => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + k));
    return v == null ? d : v;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(KEY + k);
    else localStorage.setItem(KEY + k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};
const fmt = (n) => Number(n).toLocaleString('ja-JP');
const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet');
const toastRoot = document.getElementById('toasts');
function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastRoot.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => t.classList.remove('in'), 2200);
  setTimeout(() => t.remove(), 2600);
}
function openSheet(content) {
  sheetRoot.textContent = '';
  sheetRoot.append(h('div', { class: 'sheet-bg', onclick: closeSheet }), h('div', { class: 'sheet-panel' }, content));
  sheetRoot.classList.add('open');
}
function closeSheet() {
  sheetRoot.classList.remove('open');
  sheetRoot.textContent = '';
}
function confirmSheet(title, body, okLabel, onOk) {
  openSheet([
    h('div', { class: 'sheet-title' }, title),
    body ? h('p', { class: 'sheet-body' }, body) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'), h('button', { class: 'btn danger', onclick: () => (closeSheet(), onOk()) }, okLabel)),
  ]);
}
const SERIES_COLORS = ['#e5262b', '#1d5bd8', '#1f9d55', '#f29a00', '#7b3fd1', '#0aa3a8', '#d6336c', '#5c6b00', '#b3541e', '#2b2b2b', '#4a7fb5', '#9c2f8f'];
const seriesList = [...new Set(CHARS.map((c) => c.series))];
const badge = (id) => {
  const c = BY_ID[id];
  return h('span', { class: 'badge', style: `--c:${SERIES_COLORS[seriesList.indexOf(c.series) % SERIES_COLORS.length]}` }, [...c.name.replace(/^Mii /, '')][0]);
};
const shortName = (id) => BY_ID[id].name.replace(/^Mii /, 'Mii').replace(/[&＆].*$/, '').replace(/\/.*$/, '');
const ago = (t) => {
  const d = Math.floor((Date.now() - t) / 86400e3);
  return d <= 0 ? '今日' : d === 1 ? '昨日' : `${d}日前`;
};

// ---------- データ ----------
// data[id] = { gsp, at, border }  … border はその時の推定VIPボーダー（段位は比率で判定）
const S = {
  tab: load('tab', 'list'),
  data: load('data', {}),
  cursor: load('cursor', 0), // スキャン中のキャラ（CHARSの番号）
  view: load('view', 'tier'),
  border: DEFAULT_BORDER,
  stream: null,
  scanning: false,
  busy: false,
  lastAccepted: null,
  candidate: null,
  ocrReady: false,
  auto: load('auto', true), // アイコンでキャラを自動判定する（オフなら順番モード）
  unsure: 0,
  lastAsked: null,
  lastId: load('lastId', null),
};
function currentBorderSource() {
  const manual = load('border');
  const remote = S.remoteBorder;
  const all = [DEFAULT_BORDER, remote, manual].filter(Boolean);
  all.sort((a, b) => b.at - a.at);
  return all[0];
}
const borderNow = () => borderAt(S.border);
// 表示する数字：登録したときのボーダーとの比を、今のボーダーに当てはめた値（クマメイトに合わせて増えていく）
const nowGsp = (d) => (d.border ? Math.round((d.gsp / d.border) * borderNow()) : d.gsp);
function persist() {
  save('data', S.data);
  save('cursor', S.cursor);
}
function setGsp(id, gsp) {
  S.data[id] = { gsp, at: Date.now(), border: borderNow() };
  persist();
}
function info(id) {
  const d = S.data[id];
  if (!d) return null;
  const t = tierOf(d.gsp, d.border);
  return { ...d, tier: t, group: groupOf(t), gap: nextTierGap(d.gsp, d.border, borderNow()) };
}

// ---------- 画面 ----------
function render() {
  stopLoopIfLeaving();
  app.textContent = '';
  app.append(header());
  if (S.tab === 'scan') renderScan();
  else if (S.tab === 'settings') renderSettings();
  else renderList();
  app.append(nav());
}
function header() {
  return h(
    'header',
    { class: 'top' },
    h('a', { class: 'back', href: '../', 'aria-label': 'スマブラtier表へ戻る' }, '‹'),
    h('div', { class: 'brand' }, 'スマブラ', h('em', null, '段位スキャナー')),
    h('div', { class: 'border-chip' }, h('small', null, 'VIPボーダー推定'), h('b', { id: 'borderNow' }, fmt(borderNow())))
  );
}
setInterval(() => {
  const el = document.getElementById('borderNow');
  if (el) el.textContent = fmt(borderNow());
}, 30000);
function nav() {
  const items = [
    ['list', '段位一覧'],
    ['scan', 'スキャン'],
    ['settings', '設定'],
  ];
  return h(
    'nav',
    { class: 'tabs' },
    items.map(([k, l]) => h('button', { class: S.tab === k ? 'on' : '', onclick: () => ((S.tab = k), save('tab', k), render()) }, l))
  );
}

// ---------- 一覧 ----------
function renderList() {
  const rows = CHARS.map((c) => ({ c, i: info(c.id) }));
  const have = rows.filter((r) => r.i);
  const main = h('main', { class: 'list' });
  if (!have.length) {
    main.append(h('div', { class: 'empty' }, h('p', null, 'まだ1キャラも読み取っていません。'), h('button', { class: 'btn primary big', onclick: () => ((S.tab = 'scan'), save('tab', 'scan'), render()) }, 'スキャンを始める')));
    app.append(main);
    return;
  }
  main.append(
    h(
      'div',
      { class: 'seg' },
      [
        ['tier', '段位ごと'],
        ['gsp', '強い順'],
        ['roster', 'キャラ順'],
      ].map(([k, l]) => h('button', { class: S.view === k ? 'on' : '', onclick: () => ((S.view = k), save('view', k), render()) }, l))
    )
  );
  if (S.view === 'tier') {
    // 段位ごとにまとめた「一目でわかる」表
    for (const t of TIERS) {
      const list = have.filter((r) => r.i.tier === t).sort((a, b) => b.i.gsp / b.i.border - a.i.gsp / a.i.border);
      if (!list.length) continue;
      const g = groupOf(t);
      main.append(
        h(
          'section',
          { class: `tierbox g-${g}` },
          h('div', { class: 'tier-head' }, h('span', { class: 'dan' }, `${t.dan}段`), h('span', { class: 'tname' }, t.name), h('span', { class: 'th' }, `${fmt(thresholdOf(t, borderNow()))}〜`)),
          h(
            'div',
            { class: 'chips' },
            list.map((r) => h('button', { class: 'fchip', onclick: () => editSheet(r.c.id) }, badge(r.c.id), h('span', { class: 'fn' }, shortName(r.c.id)), h('span', { class: 'fg' }, fmt(nowGsp(r.i)))))
          )
        )
      );
    }
    const none = rows.filter((r) => !r.i);
    if (none.length)
      main.append(
        h(
          'section',
          { class: 'tierbox g-none' },
          h('div', { class: 'tier-head' }, h('span', { class: 'tname' }, `未登録 ${none.length}キャラ`)),
          h('div', { class: 'chips' }, none.map((r) => h('button', { class: 'fchip off', onclick: () => editSheet(r.c.id) }, badge(r.c.id), h('span', { class: 'fn' }, shortName(r.c.id)))))
        )
      );
  } else {
    const list = S.view === 'gsp' ? have.slice().sort((a, b) => b.i.gsp / b.i.border - a.i.gsp / a.i.border) : rows;
    main.append(
      h(
        'ol',
        { class: 'rows' },
        list.map((r) => {
          const i = r.i;
          return h(
            'li',
            { class: i ? `g-${i.group}` : 'off', onclick: () => editSheet(r.c.id) },
            badge(r.c.id),
            h('div', { class: 'nm' }, r.c.name, i ? h('small', null, `${fmt(nowGsp(i))}・${ago(i.at)}`) : h('small', null, '未登録')),
            i ? h('div', { class: 'tp' }, h('b', null, `${i.tier.dan}段`), h('small', null, i.tier.name), i.gap ? h('small', { class: 'gap' }, `次まで あと${fmt(i.gap.need)}`) : null) : null
          );
        })
      )
    );
  }
  main.append(h('p', { class: 'note' }, '数字は、読み取った時点のVIPボーダーとの比を今のボーダーに当てはめた値です（クマメイトの推定に合わせて毎日増えていきます）。段位もこの比で決めるので、日がたってもずれません。'));
  app.append(main);
}

function editSheet(id) {
  const i = info(id);
  const inp = h('input', { class: 'in num', inputmode: 'numeric', placeholder: '例：12,345,678', value: i ? fmt(nowGsp(i)) : '' });
  const ok = () => {
    const v = pickGsp(inp.value) ?? (+inp.value.replace(/\D/g, '') || null);
    if (!v) return toast('数字を入れてください', 'warn');
    setGsp(id, v);
    closeSheet();
    render();
  };
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
  openSheet([
    h('div', { class: 'sheet-title' }, badge(id), BY_ID[id].name),
    i ? h('p', { class: 'sheet-body' }, `${i.tier.dan}段「${i.tier.name}」・${ago(i.at)}に読み取り`) : h('p', { class: 'sheet-body' }, 'まだ登録されていません'),
    h('label', { class: 'lbl' }, '世界戦闘力を手で入れる'),
    inp,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeSheet }, '閉じる'), h('button', { class: 'btn primary', onclick: ok }, '保存')),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn sub', onclick: () => ((S.cursor = CHARS.findIndex((c) => c.id === id)), persist(), closeSheet(), (S.tab = 'scan'), save('tab', 'scan'), render()) }, 'カメラで読み直す'),
      i ? h('button', { class: 'btn ghost', onclick: () => (delete S.data[id], persist(), closeSheet(), render()) }, '消す') : null
    ),
  ]);
}

// ---------- スキャン ----------
let loopTimer = null;
function stopLoopIfLeaving() {
  if (S.tab !== 'scan') stopCamera();
}
function stopCamera() {
  S.scanning = false;
  clearTimeout(loopTimer);
  if (S.stream) {
    S.stream.getTracks().forEach((t) => t.stop());
    S.stream = null;
  }
}
function renderScan() {
  const c = CHARS[S.cursor] || CHARS[0];
  const done = Object.keys(S.data).length;
  const main = h('main', { class: 'scan' });
  const video = h('video', { id: 'cam', playsinline: true, muted: true, autoplay: true });
  const status = h('div', { class: 'status', id: 'scanStatus' }, S.stream ? '数字を枠に合わせてね' : '');
  const camBox = h(
    'div',
    { class: 'cam' },
    video,
    h('div', { class: 'icon-mark' }, h('span', null, 'アイコン')),
    h('div', { class: 'guide', id: 'guide' }, h('span', null, 'いちばん上の数字')),
    S.stream ? null : h('div', { class: 'cam-off' }, h('button', { class: 'btn primary big', onclick: startCamera }, 'カメラを起動'), h('p', null, 'キャラ選択画面の右下に数字が3つ並んでいます。そのいちばん上（そのキャラの世界戦闘力）を黄色い枠に、その左のキャラアイコンを点線の枠に合わせて写してください。'))
  );
  const last = S.lastId && BY_ID[S.lastId] ? S.lastId : null;
  main.append(
    S.auto
      ? h(
          'div',
          { class: 'now auto' },
          h(
            'div',
            { class: 'who' },
            h('small', null, `キャラは自動で判定（登録 ${done} / ${CHARS.length}）`),
            last ? h('span', null, badge(last), BY_ID[last].name) : h('span', { class: 'muted' }, 'まだ読み取っていません'),
            h('small', { class: 'cur' }, last && S.data[last] ? `${fmt(nowGsp(S.data[last]))} で登録` : 'Switchで好きなキャラにカーソルを合わせて')
          ),
          h('button', { class: 'nav-btn mode', onclick: () => ((S.auto = false), save('auto', false), render()) }, '順番', h('small', null, 'モード'))
        )
      : h(
          'div',
          { class: 'now' },
          h('button', { class: 'nav-btn', onclick: () => move(-1), 'aria-label': '前のキャラ' }, '‹'),
          h(
            'button',
            { class: 'who', onclick: pickSheet },
            h('small', null, `${S.cursor + 1} / ${CHARS.length}　（登録 ${done}）`),
            h('span', null, badge(c.id), c.name),
            h('small', { class: 'cur' }, S.data[c.id] ? `いま ${fmt(nowGsp(S.data[c.id]))}` : 'Switchでこのキャラにカーソルを合わせて')
          ),
          h('button', { class: 'nav-btn', onclick: () => move(1), 'aria-label': '次のキャラ' }, '›'),
          h('button', { class: 'nav-btn mode', onclick: () => ((S.auto = true), save('auto', true), render()) }, '自動', h('small', null, 'に戻す'))
        ),
    h(
      'label',
      { class: 'btn primary big file video-btn' },
      '動画からまとめて読む',
      h('small', null, 'スマホを立てかけて録画 → カーソルを次々動かすだけ（1キャラ0.1秒〜）'),
      h('input', { type: 'file', accept: 'video/*', onchange: (e) => e.target.files[0] && importVideo(e.target.files[0]) })
    ),
    h('div', { class: 'or-line' }, h('span', null, 'または、その場でカメラで読む')),
    camBox,
    status,
    h(
      'div',
      { class: 'row' },
      S.auto ? h('button', { class: 'btn ghost', onclick: pickSheetForManual }, '手で入力') : h('button', { class: 'btn ghost', onclick: () => editSheet(c.id) }, '手で入力'),
      S.auto ? null : h('button', { class: 'btn ghost', onclick: () => move(1) }, 'スキップ'),
      h('label', { class: 'btn sub file' }, 'スクショから', h('input', { type: 'file', accept: 'image/*', multiple: true, onchange: (e) => importShots([...e.target.files]) }))
    ),
    h('p', { class: 'note' }, S.auto ? '右下に並ぶ3つの数字のうち、いちばん上だけを枠に入れてください（No.1や総合の数字は入れない）。数字の左のキャラアイコンで、どのキャラかを自動で見分けます。好きな順番でカーソルを動かしてOK。自信がないときは「このキャラは？」と聞きます。画像はスマホの外に送られません。' : '右下に並ぶ3つの数字のうち、いちばん上だけを枠に入れてください。順番モード：同じ数字を2回続けて読めたら今のキャラに登録して、次のキャラに進みます。Switchのカーソルを1つずつ右へ。画像はスマホの外に送られません。'),
  );
  app.append(main);
  if (S.stream) {
    video.srcObject = S.stream;
    video.play().catch(() => {});
    S.scanning = true;
    scheduleLoop(300);
  }
}
function move(d) {
  S.cursor = (S.cursor + d + CHARS.length) % CHARS.length;
  S.candidate = null;
  persist();
  render();
}
function pickSheet() {
  const search = h('input', { class: 'in', placeholder: 'キャラ名でさがす' });
  const list = h('div', { class: 'pick-list' });
  const draw = () => {
    const q = norm(search.value);
    list.textContent = '';
    CHARS.forEach((c, i) => {
      if (q && !norm(c.name).includes(q)) return;
      list.append(h('button', { class: `pick ${i === S.cursor ? 'on' : ''} ${S.data[c.id] ? 'done' : ''}`, onclick: () => ((S.cursor = i), (S.candidate = null), persist(), closeSheet(), render()) }, badge(c.id), h('span', null, c.name)));
    });
  };
  search.addEventListener('input', draw);
  draw();
  openSheet([h('div', { class: 'sheet-title' }, 'どのキャラから読む？'), search, list]);
  sheetRoot.querySelector('.sheet-panel').classList.add('tall');
}
async function startCamera() {
  const st = document.getElementById('scanStatus');
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    if (st) st.textContent = 'カメラを使えませんでした。ブラウザの設定でカメラを許可してください。';
    return;
  }
  if (st) st.textContent = '読み取りの準備中…（初回は少しかかります）';
  render();
  getWorker()
    .then(() => {
      S.ocrReady = true;
    })
    .catch(() => {
      const s2 = document.getElementById('scanStatus');
      if (s2) s2.textContent = '読み取りの準備に失敗しました。通信を確認して開き直してください。';
    });
}
function scheduleLoop(ms) {
  clearTimeout(loopTimer);
  loopTimer = setTimeout(scanOnce, ms);
}
/** 画面上の枠 → 映像の中の割合（object-fit: cover を考慮） */
function guideCrop(video, guide) {
  const vr = video.getBoundingClientRect();
  const gr = guide.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = (vr.width - dispW) / 2;
  const offY = (vr.height - dispH) / 2;
  const x = (gr.left - vr.left - offX) / dispW;
  const y = (gr.top - vr.top - offY) / dispH;
  return { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1, gr.width / dispW), h: Math.min(1, gr.height / dispH) };
}
async function scanOnce() {
  if (!S.scanning) return;
  const video = document.getElementById('cam');
  const guide = document.getElementById('guide');
  const st = document.getElementById('scanStatus');
  if (!video || !guide || !video.videoWidth || !S.ocrReady || S.busy) return scheduleLoop(400);
  S.busy = true;
  try {
    const crop = guideCrop(video, guide);
    const r = await readVote(video, crop);
    if (!S.scanning) return;
    // 数字が枠の左右の端にかかっている＝はみ出して欠けているかもしれないので読まない
    if (r.value && r.bbox) {
      const vw = video.videoWidth;
      const margin = crop.w * vw * 0.004;
      if (r.bbox.x0 <= crop.x * vw + margin || r.bbox.x1 >= (crop.x + crop.w) * vw - margin) {
        S.candidate = null;
        if (st) st.textContent = '数字が枠からはみ出しています。少し離して枠の中に入れてね';
        return;
      }
    }
    if (S.auto) return void autoStep(r, video, st);
    const c = CHARS[S.cursor];
    if (r.value && r.value !== S.lastAccepted) {
      if (S.candidate === r.value) {
        // 2回続けて同じ数字 → 登録
        setGsp(c.id, r.value);
        S.lastAccepted = r.value;
        S.candidate = null;
        const t = tierOf(r.value, borderNow());
        try {
          navigator.vibrate && navigator.vibrate(40);
        } catch {
          /* ignore */
        }
        beep();
        toast(`${c.name}：${fmt(r.value)}（${t.dan}段 ${t.name}）`);
        S.cursor = (S.cursor + 1) % CHARS.length;
        persist();
        render();
        flash();
        return;
      }
      S.candidate = r.value;
      if (st) st.textContent = `読み取り中… ${fmt(r.value)} ?`;
    } else if (r.value && r.value === S.lastAccepted) {
      if (st) st.textContent = `前のキャラと同じ数字（${fmt(r.value)}）です。Switchでカーソルを次のキャラへ`;
    } else if (st) st.textContent = '数字を枠に合わせてね';
  } catch (e) {
    console.error(e);
  } finally {
    S.busy = false;
    if (S.scanning) scheduleLoop(350);
  }
}
/** 自動判定モード：数字＋アイコンでキャラを決めて登録 */
function autoStep(r, video, st) {
  if (!r.value) {
    S.candidate = null;
    S.unsure = 0;
    if (st) st.textContent = '数字を枠に合わせてね';
    return;
  }
  const list = r.bbox ? identify(video, r.bbox) : [];
  const sure = confident(list);
  const top = list[0] ? list[0].id : null;
  // すでに同じ数字で登録済みのキャラなら何もしない（カーソルをうろうろしても大丈夫）
  if (sure && S.data[top] && S.data[top].gsp === r.value) {
    S.candidate = null;
    S.unsure = 0;
    if (st) st.textContent = `${BY_ID[top].name} は登録済み（${fmt(r.value)}）`;
    return;
  }
  const key = `${r.value}|${sure ? top : '?'}`;
  if (S.candidate !== key) {
    S.candidate = key;
    S.unsure = sure ? 0 : 1;
    if (st) st.textContent = sure ? `読み取り中… ${BY_ID[top].name} ${fmt(r.value)} ?` : `読み取り中… ${fmt(r.value)}（キャラを確認中）`;
    return;
  }
  if (sure) {
    // 2回続けて同じ数字・同じキャラ → 登録
    S.candidate = null;
    S.unsure = 0;
    commitAuto(top, r.value);
    return;
  }
  // 数字は読めたけどキャラに自信がない → 3回続いたら聞く
  S.unsure++;
  if (S.unsure >= 3 && r.value !== S.lastAsked) {
    S.unsure = 0;
    S.lastAsked = r.value;
    askWho(r.value, list.slice(0, 3).map((x) => x.id));
  } else if (st) st.textContent = `読み取り中… ${fmt(r.value)}（キャラを確認中）`;
}
function commitAuto(id, value) {
  setGsp(id, value);
  S.lastId = id;
  save('lastId', id);
  const t = tierOf(value, borderNow());
  try {
    navigator.vibrate && navigator.vibrate(40);
  } catch {
    /* ignore */
  }
  beep();
  toast(`${BY_ID[id].name}：${fmt(value)}（${t.dan}段 ${t.name}）`);
  S.scanning = !!S.stream;
  render();
  flash();
}
/** キャラに自信がないとき：候補から選んでもらう（その間は読み取りを止める） */
function askWho(value, cands) {
  S.scanning = false;
  const resume = () => {
    closeSheet();
    S.scanning = true;
    scheduleLoop(300);
  };
  const pick = (id) => {
    closeSheet();
    commitAuto(id, value);
  };
  openSheet([
    h('div', { class: 'sheet-title' }, 'このキャラは？'),
    h('p', { class: 'sheet-body' }, `世界戦闘力 ${fmt(value)} は読めましたが、キャラに自信がありません。`),
    h('div', { class: 'pick-list cands' }, cands.filter((id) => BY_ID[id]).map((id) => h('button', { class: 'pick', onclick: () => pick(id) }, badge(id), h('span', null, BY_ID[id].name)))),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: resume }, '登録しない'), h('button', { class: 'btn sub', onclick: () => pickAny(value, pick, resume) }, 'ほかのキャラ')),
  ]);
  sheetRoot.querySelector('.sheet-bg').onclick = resume;
}
function pickAny(value, onPick, onCancel) {
  const search = h('input', { class: 'in', placeholder: 'キャラ名でさがす' });
  const list = h('div', { class: 'pick-list' });
  const draw = () => {
    const q = norm(search.value);
    list.textContent = '';
    for (const c of CHARS) if (!q || norm(c.name).includes(q)) list.append(h('button', { class: `pick ${S.data[c.id] ? 'done' : ''}`, onclick: () => onPick(c.id) }, badge(c.id), h('span', null, c.name)));
  };
  search.addEventListener('input', draw);
  draw();
  openSheet([h('div', { class: 'sheet-title' }, value ? `${fmt(value)} はどのキャラ？` : 'どのキャラ？'), search, list, h('button', { class: 'btn ghost', onclick: onCancel }, 'やめる')]);
  sheetRoot.querySelector('.sheet-panel').classList.add('tall');
  sheetRoot.querySelector('.sheet-bg').onclick = onCancel;
}
function pickSheetForManual() {
  pickAny(null, (id) => (closeSheet(), editSheet(id)), closeSheet);
}
function flash() {
  const g = document.getElementById('guide');
  if (g) {
    g.classList.remove('hit');
    void g.offsetWidth;
    g.classList.add('hit');
  }
}
let actx = null;
function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.15, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.12);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + 0.13);
  } catch {
    /* ignore */
  }
}

/** Switchのスクショ（スマホに送ったもの）をまとめて読む。今のキャラから順番に当てはめる */
// ---------- 動画からまとめて読む ----------
async function importVideo(file) {
  stopCamera();
  openSheet([h('div', { class: 'sheet-title' }, '動画を開いています…'), h('p', { class: 'sheet-body' }, '読み取りの準備もしています（初回は少しかかります）')]);
  let v;
  try {
    [v] = await Promise.all([loadVideo(file), getWorker()]);
  } catch (e) {
    closeSheet();
    toast(e.message || '動画を開けませんでした', 'warn');
    return;
  }
  calibrate(v);
}

/** 最初に1回だけ：黄色い枠を「いちばん上の数字」に合わせてもらう */
function calibrate(v) {
  const box = load('vbox', { x: 0.62, y: 0.6, w: 0.3, h: 0.08 });
  const wrap = h('div', { class: 'cal-wrap' });
  const cv = h('canvas', { class: 'cal-frame' });
  const frame = h('div', { class: 'cal-box' }, h('span', null, 'いちばん上の数字'), h('i', { class: 'cal-handle' }));
  wrap.append(cv, frame);
  const slider = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'cal-slider' });
  const info = h('p', { class: 'sheet-body cal-info' }, '黄色い枠を、右下のいちばん上の数字に合わせてください（ドラッグで移動、右下の角で大きさ）');
  const start = h('button', { class: 'btn primary', disabled: true }, '読み取り開始');
  let num = null;
  const place = () => {
    frame.style.left = `${box.x * 100}%`;
    frame.style.top = `${box.y * 100}%`;
    frame.style.width = `${box.w * 100}%`;
    frame.style.height = `${box.h * 100}%`;
  };
  const draw = () => {
    cv.width = v.videoWidth;
    cv.height = v.videoHeight;
    cv.getContext('2d').drawImage(v, 0, 0);
  };
  let testTimer = null;
  let testId = 0;
  const test = () => {
    clearTimeout(testTimer);
    testTimer = setTimeout(async () => {
      const my = ++testId;
      info.textContent = '確認中…';
      start.disabled = true;
      const c = grab(v);
      const r = await readVote(c, { ...box });
      if (my !== testId) return;
      if (r.value && r.bbox) {
        num = r.bbox;
        const list = identify(c, r.bbox);
        info.textContent = `読めました：${fmt(r.value)}${confident(list) ? `（${BY_ID[list[0].id].name}）` : ''}　この位置で開始できます`;
        start.disabled = false;
      } else {
        num = null;
        info.textContent = '数字が読めません。枠を数字に合わせるか、下のつまみで数字が映っている場面にしてください';
      }
    }, 250);
  };
  // ドラッグで移動・角で大きさを変える
  frame.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const resize = e.target.classList.contains('cal-handle');
    const sx = e.clientX;
    const sy = e.clientY;
    const b0 = { ...box };
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / r.width;
      const dy = (ev.clientY - sy) / r.height;
      if (resize) {
        box.w = Math.min(1 - b0.x, Math.max(0.05, b0.w + dx));
        box.h = Math.min(1 - b0.y, Math.max(0.02, b0.h + dy));
      } else {
        box.x = Math.min(1 - box.w, Math.max(0, b0.x + dx));
        box.y = Math.min(1 - box.h, Math.max(0, b0.y + dy));
      }
      place();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      test();
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
  slider.addEventListener('input', async () => {
    await seek(v, (slider.value / 1000) * v.duration);
    draw();
    test();
  });
  start.onclick = async () => {
    if (!num) return;
    save('vbox', box);
    await runVideo(v, { ...box }, num);
  };
  openSheet([
    h('div', { class: 'sheet-title' }, '数字の位置を合わせる'),
    wrap,
    slider,
    info,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'), start),
  ]);
  sheetRoot.querySelector('.sheet-panel').classList.add('tall');
  place();
  seek(v, Math.min(0.5, v.duration / 2)).then(() => {
    slider.value = Math.round((v.currentTime / v.duration) * 1000);
    draw();
    test();
  });
}

async function runVideo(v, box, num) {
  const bar = h('i');
  const msg = h('p', { class: 'sheet-body' }, '動画を再生して、キャラの切り替わりを探しています…');
  v.className = 'run-video';
  openSheet([h('div', { class: 'sheet-title' }, '読み取り中'), v, h('div', { class: 'run-bar' }, bar), msg, h('p', { class: 'note' }, 'このまま画面を開いておいてください')]);
  // 位置合わせしたコマで、手ぶれ追跡の目印（「世界戦闘力」の文字のあたり）を覚える
  const tracker = load('notrack') ? null : makeTracker(v, num);
  const segs = await findSegments(v, box, num, (p) => (bar.style.width = `${Math.round(p * 50)}%`), tracker);
  msg.textContent = `${segs.length}か所の切り替わりを見つけました。キャラと数字を判定しています…`;
  const res = await readSegments(
    v,
    box,
    segs,
    (p) => {
      bar.style.width = `${50 + Math.round(p * 50)}%`;
    },
    tracker
  );
  showVideoResults(res);
}

function showVideoResults(res) {
  if (!res.length) {
    openSheet([h('div', { class: 'sheet-title' }, '読み取れませんでした'), h('p', { class: 'sheet-body' }, '数字の枠の位置や、動画の明るさを確かめてもう一度ためしてください。'), h('button', { class: 'btn ghost wide', onclick: closeSheet }, '閉じる')]);
    return;
  }
  const rows = res.map((r) => {
    const sel = h('select', { class: `in small sel ${r.sure ? '' : 'unsure'}` }, h('option', { value: '' }, '（登録しない）'), CHARS.map((c) => h('option', { value: c.id, selected: c.id === r.id && (r.sure || r.list[0]) }, c.name)));
    if (!r.sure) {
      // 自信がないものは、候補を上にまとめて選びやすく
      const hint = h('div', { class: 'cand-row' }, r.list.slice(0, 3).map((x) => h('button', { class: 'cand', onclick: () => ((sel.value = x.id), sel.classList.remove('unsure')) }, BY_ID[x.id].name)));
      sel.after && setTimeout(() => sel.after(hint));
    }
    sel.addEventListener('change', () => sel.classList.remove('unsure'));
    const inp = h('input', { class: 'in small num', inputmode: 'numeric', value: fmt(r.value) });
    return { r, sel, inp, el: h('div', { class: `imp vrow ${r.sure ? '' : 'unsure'}` }, r.shot ? h('img', { src: r.shot, alt: '' }) : h('div'), h('div', null, sel, inp)) };
  });
  const sureN = res.filter((r) => r.sure).length;
  openSheet([
    h('div', { class: 'sheet-title' }, `${res.length}キャラ読み取りました`),
    h('p', { class: 'sheet-body' }, `${sureN}キャラは自動で判定しました。黄色の${res.length - sureN}キャラは自信がないので、候補から選ぶか直してください。`),
    h('div', { class: 'import-list' }, rows.map((x) => x.el)),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            let n = 0;
            for (const x of rows) {
              const v = +x.inp.value.replace(/\D/g, '');
              if (x.sel.value && v) {
                setGsp(x.sel.value, v);
                n++;
              }
            }
            closeSheet();
            toast(`${n}キャラ登録しました`);
            S.tab = 'list';
            save('tab', 'list');
            render();
          },
        },
        '登録する'
      )
    ),
  ]);
  sheetRoot.querySelector('.sheet-panel').classList.add('tall');
}

async function importShots(files) {
  if (!files.length) return;
  const start = S.cursor;
  const results = [];
  const prog = h('p', { class: 'sheet-body' }, '読み取りの準備中…');
  openSheet([h('div', { class: 'sheet-title' }, `${files.length}枚を読み取り中`), prog]);
  try {
    await getWorker();
    for (let k = 0; k < files.length; k++) {
      prog.textContent = `${k + 1} / ${files.length} 枚目…`;
      const img = await loadImage(files[k]);
      let r = await readAnywhere(prepare(img, null, 96, false));
      if (!r.value) r = await readAnywhere(prepare(img, null, 96, true));
      let id = CHARS[(start + k) % CHARS.length].id;
      let sure = false;
      if (S.auto && r.bbox) {
        const list = identify(img, r.bbox);
        if (list.length && confident(list)) {
          sure = true;
          id = list[0].id;
        }
      }
      results.push({ id, value: r.value, url: img.src, sure });
    }
  } catch (e) {
    console.error(e);
    prog.textContent = '読み取りに失敗しました。';
    return;
  }
  // 確認画面
  const inputs = results.map((r) => h('input', { class: 'in small num', inputmode: 'numeric', value: r.value ? fmt(r.value) : '' }));
  const selects = results.map((r) => h('select', { class: `in small sel ${r.sure ? '' : 'unsure'}` }, CHARS.map((c) => h('option', { value: c.id, selected: c.id === r.id }, c.name))));
  openSheet([
    h('div', { class: 'sheet-title' }, '読み取り結果を確認'),
    h('p', { class: 'sheet-body' }, S.auto ? 'キャラはアイコンで判定しました。黄色の欄は自信がないので確認してください。違っていたらキャラや数字を直してください（数字が空欄なら登録しません）。' : '今のキャラから順番に当てはめます。違っていたら直してください（数字が空欄なら登録しません）。'),
    h(
      'div',
      { class: 'import-list' },
      results.map((r, i) => h('div', { class: 'imp' }, h('img', { src: r.url, alt: '' }), h('div', null, selects[i], inputs[i])))
    ),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            let n = 0;
            results.forEach((r, i) => {
              const v = +inputs[i].value.replace(/\D/g, '');
              if (v) {
                setGsp(selects[i].value, v);
                n++;
              }
            });
            S.cursor = (start + results.length) % CHARS.length;
            persist();
            closeSheet();
            toast(`${n}キャラ登録しました`);
            render();
          },
        },
        '登録する'
      )
    ),
  ]);
  sheetRoot.querySelector('.sheet-panel').classList.add('tall');
}
function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- 設定 ----------
function renderSettings() {
  const b = S.border;
  const inp = h('input', { class: 'in num', inputmode: 'numeric', placeholder: '例：15,019,807' });
  const srcLabel = b.source === 'manual' ? '手で入力' : b.source === 'auto' ? '自動更新' : 'アプリの初期値';
  app.append(
    h(
      'main',
      { class: 'settings' },
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'VIPボーダー'),
        h('p', { class: 'big-num' }, fmt(borderNow())),
        h('p', { class: 'note' }, `${srcLabel}（${new Date(b.at).toLocaleString('ja-JP')} 時点 ${fmt(b.border)}）から、1分ごとに+1で推定しています。クマメイトと同じ計算です。`),
        h('label', { class: 'lbl' }, 'ずれていたら、いまのボーダーを入れる'),
        inp,
        h(
          'div',
          { class: 'row' },
          h('a', { class: 'btn ghost', href: 'https://kumamate.net/vip/', target: '_blank', rel: 'noopener' }, 'クマメイトで見る'),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                const v = +inp.value.replace(/\D/g, '');
                if (!v || v < 1000000) return toast('7〜8桁の数字を入れてください', 'warn');
                save('border', { border: v, at: Date.now(), source: 'manual' });
                S.border = currentBorderSource();
                toast('ボーダーを更新しました');
                render();
              },
            },
            '更新'
          )
        )
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, '段位の区切り（いま）'),
        h(
          'table',
          { class: 'tier-table' },
          TIERS.map((t) => h('tr', { class: `g-${groupOf(t)}` }, h('td', { class: 'd' }, t.dan), h('td', null, t.name), h('td', { class: 'n' }, `${fmt(thresholdOf(t, borderNow()))}〜`)))
        )
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'データ'),
        h('p', { class: 'note' }, '読み取った数字はこのスマホの中だけに保存されます。'),
        h('button', { class: 'btn danger', onclick: () => confirmSheet('全キャラの記録を消しますか？', '元に戻せません。', '消す', () => ((S.data = {}), (S.cursor = 0), persist(), render())) }, '記録をすべて消す')
      ),
      h(
        'p',
        { class: 'foot' },
        '段位の名前と区切りは ',
        h('a', { href: 'https://kumamate.net/vip/', target: '_blank', rel: 'noopener' }, 'クマメイトツール'),
        ' の「世界戦闘力段位」（クマメイトツールのオリジナル定義）を元にしています。非公式のファンツールで、任天堂とは関係ありません。'
      )
    )
  );
}

// ---------- 起動 ----------
async function boot() {
  S.border = currentBorderSource();
  render();
  // GitHub で毎日更新している最新のボーダー（あれば）
  try {
    const r = await fetch('border.json', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j && j.border > 1000000 && j.at) {
        S.remoteBorder = { border: j.border, at: typeof j.at === 'number' ? j.at : Date.parse(j.at), source: 'auto' };
        S.border = currentBorderSource();
        render();
      }
    }
  } catch {
    /* オフラインなどは初期値のまま */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
});
boot();
