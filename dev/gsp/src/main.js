// スマブラ段位スキャナー：画面
import { CHARS, BY_ID, norm } from './chars.js';
import { TIERS, DEFAULT_BORDER, borderAt, tierOf, nextTierGap, groupOf, thresholdOf, pickGsp } from './tiers.js';
import { getWorker, prepare, readLine, readAnywhere } from './ocr.js';

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
};
function currentBorderSource() {
  const manual = load('border');
  const remote = S.remoteBorder;
  const all = [DEFAULT_BORDER, remote, manual].filter(Boolean);
  all.sort((a, b) => b.at - a.at);
  return all[0];
}
const borderNow = () => borderAt(S.border);
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
            list.map((r) => h('button', { class: 'fchip', onclick: () => editSheet(r.c.id) }, badge(r.c.id), h('span', { class: 'fn' }, shortName(r.c.id)), h('span', { class: 'fg' }, fmt(r.i.gsp))))
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
            h('div', { class: 'nm' }, r.c.name, i ? h('small', null, `${fmt(i.gsp)}・${ago(i.at)}`) : h('small', null, '未登録')),
            i ? h('div', { class: 'tp' }, h('b', null, `${i.tier.dan}段`), h('small', null, i.tier.name), i.gap ? h('small', { class: 'gap' }, `次まで あと${fmt(i.gap.need)}`) : null) : null
          );
        })
      )
    );
  }
  main.append(h('p', { class: 'note' }, '段位は、読み取った時点のVIPボーダーとの比で決めています。世界戦闘力は日々上がるので、数日たっても段位はずれません。'));
  app.append(main);
}

function editSheet(id) {
  const i = info(id);
  const inp = h('input', { class: 'in num', inputmode: 'numeric', placeholder: '例：12,345,678', value: i ? fmt(i.gsp) : '' });
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
    h('div', { class: 'guide', id: 'guide' }, h('span', null, '世界戦闘力をこの枠に')),
    S.stream ? null : h('div', { class: 'cam-off' }, h('button', { class: 'btn primary big', onclick: startCamera }, 'カメラを起動'), h('p', null, 'テレビやSwitchの画面に出ている世界戦闘力を、枠に合わせて写してください。'))
  );
  main.append(
    h(
      'div',
      { class: 'now' },
      h('button', { class: 'nav-btn', onclick: () => move(-1), 'aria-label': '前のキャラ' }, '‹'),
      h(
        'button',
        { class: 'who', onclick: pickSheet },
        h('small', null, `${S.cursor + 1} / ${CHARS.length}　（登録 ${done}）`),
        h('span', null, badge(c.id), c.name),
        h('small', { class: 'cur' }, S.data[c.id] ? `いま ${fmt(S.data[c.id].gsp)}` : 'Switchでこのキャラにカーソルを合わせて')
      ),
      h('button', { class: 'nav-btn', onclick: () => move(1), 'aria-label': '次のキャラ' }, '›')
    ),
    camBox,
    status,
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => editSheet(c.id) }, '手で入力'),
      h('button', { class: 'btn ghost', onclick: () => move(1) }, 'スキップ'),
      h('label', { class: 'btn sub file' }, 'スクショから', h('input', { type: 'file', accept: 'image/*', multiple: true, onchange: (e) => importShots([...e.target.files]) }))
    ),
    h('p', { class: 'note' }, 'カメラは同じ数字を2回続けて読めたら自動で登録して、次のキャラに進みます。Switchのキャラ選択でカーソルを1つずつ右に動かしていけばOK。画像はスマホの外に送られません。')
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
    const cv = prepare(video, guideCrop(video, guide));
    const r = await readLine(cv);
    if (!S.scanning) return;
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
      results.push({ id: CHARS[(start + k) % CHARS.length].id, value: r.value, url: img.src });
    }
  } catch (e) {
    console.error(e);
    prog.textContent = '読み取りに失敗しました。';
    return;
  }
  // 確認画面
  const inputs = results.map((r) => h('input', { class: 'in small num', inputmode: 'numeric', value: r.value ? fmt(r.value) : '' }));
  openSheet([
    h('div', { class: 'sheet-title' }, '読み取り結果を確認'),
    h('p', { class: 'sheet-body' }, '左のキャラの順に当てはめます。違っていたら数字を直してください（空欄は登録しません）。'),
    h(
      'div',
      { class: 'import-list' },
      results.map((r, i) => h('div', { class: 'imp' }, h('img', { src: r.url, alt: '' }), h('div', null, h('div', { class: 'imp-name' }, badge(r.id), BY_ID[r.id].name), inputs[i])))
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
                setGsp(r.id, v);
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
