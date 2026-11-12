// 最強キャラ決定戦：画面
import { connect, HostRoom, GuestRoom } from './net.js';
import { normalizeCode, cleanName, NAME_MAX, MAX_PLAYERS, ratings } from './rank.js';
import { CHARS, BY_ID, norm } from './chars.js';

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
const KEY = 'smashrank.';
const load = (k) => {
  try {
    return JSON.parse(localStorage.getItem(KEY + k));
  } catch {
    return null;
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
function myId() {
  let id = load('id');
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    save('id', id);
  }
  return id;
}
const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet');
const toastRoot = document.getElementById('toasts');
function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastRoot.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => t.classList.remove('in'), 2400);
  setTimeout(() => t.remove(), 2800);
}
function busy(msg) {
  let b = document.getElementById('busy');
  if (!msg) return b && b.remove();
  if (!b) {
    b = h('div', { id: 'busy' }, h('div', { class: 'spin' }), h('div', { class: 'busy-msg' }));
    document.body.append(b);
  }
  b.querySelector('.busy-msg').textContent = msg;
}
function openSheet(content, tall = false) {
  sheetRoot.textContent = '';
  sheetRoot.append(h('div', { class: 'sheet-bg', onclick: closeSheet }), h('div', { class: `sheet-panel ${tall ? 'tall' : ''}` }, content));
  sheetRoot.classList.add('open');
}
function closeSheet() {
  sheetRoot.classList.remove('open');
  sheetRoot.textContent = '';
}
function confirmSheet(title, body, okLabel, onOk, danger = false) {
  openSheet([
    h('div', { class: 'sheet-title' }, title),
    body ? h('p', { class: 'sheet-body' }, body) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeSheet }, 'やめる'), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => (closeSheet(), onOk()) }, okLabel)),
  ]);
}

// シリーズごとの色
const SERIES_COLORS = ['#e5262b', '#1d5bd8', '#1f9d55', '#f29a00', '#7b3fd1', '#0aa3a8', '#d6336c', '#5c6b00', '#b3541e', '#2b2b2b', '#4a7fb5', '#9c2f8f'];
const seriesList = [...new Set(CHARS.map((c) => c.series))];
const colorOf = (id) => SERIES_COLORS[seriesList.indexOf(BY_ID[id].series) % SERIES_COLORS.length];
const initial = (id) => {
  const n = BY_ID[id].name.replace(/^Mii /, '');
  return [...n][0];
};
const badge = (id, size = '') => h('span', { class: `badge ${size}`, style: `--c:${colorOf(id)}` }, initial(id));

// ---------- 状態 ----------
const S = { room: null, st: null, tab: 'vs', key: '', lastSeq: null, lastStateAt: 0 };
const isHost = () => S.room && S.room.isHost;
const meId = () => S.room && S.room.me.id;

function inviteUrl(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  const b = new URLSearchParams(location.search).get('broker');
  if (b) u.searchParams.set('broker', b);
  u.searchParams.set('room', code);
  return u.toString();
}
function setUrlRoom(code) {
  const u = new URL(location.href);
  if (code) u.searchParams.set('room', code);
  else u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

// ---------- タイトル ----------
function renderTitle(msg) {
  S.key = '';
  app.className = 'scr-title';
  app.textContent = '';
  const params = new URLSearchParams(location.search);
  const nameIn = h('input', { class: 'in', maxlength: NAME_MAX, placeholder: 'ニックネーム', value: load('name') || '', autocomplete: 'nickname', enterkeyhint: 'done' });
  const codeIn = h('input', { class: 'in code', type: 'text', placeholder: '6文字のコード', value: normalizeCode(params.get('room') || ''), autocapitalize: 'characters', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', lang: 'en' });
  const tidy = () => {
    const v = normalizeCode(codeIn.value);
    if (v !== codeIn.value) codeIn.value = v;
    codeIn.classList.toggle('filled', v.length > 0);
  };
  codeIn.addEventListener('input', (e) => !e.isComposing && tidy());
  codeIn.addEventListener('compositionend', tidy);
  codeIn.addEventListener('blur', tidy);
  tidy();
  const err = h('div', { class: 'err' }, msg || '');
  const getName = () => {
    const n = cleanName(nameIn.value);
    if (!n) {
      err.textContent = 'ニックネームを入れてください';
      nameIn.focus();
      return null;
    }
    save('name', n);
    return n;
  };
  const doJoin = () => {
    const n = getName();
    if (!n) return;
    const c = normalizeCode(codeIn.value);
    if (c.length !== 6) {
      err.textContent = '部屋コードは6文字です';
      codeIn.focus();
      return;
    }
    joinRoom(c, n);
  };
  codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin());

  const resume = [];
  const hostSave = load('host');
  if (hostSave && Date.now() - hostSave.at < 7 * 86400e3 && hostSave.room && hostSave.room.hostId === myId()) {
    resume.push(h('button', { class: 'btn resume', onclick: () => createRoom(hostSave.room.players[0].name, hostSave.room) }, `つづきから（部屋 ${hostSave.room.code}・判定${hostSave.room.history.length}回）`));
  }
  const last = load('last');
  if (last && Date.now() - last.at < 86400e3 && (!hostSave || last.code !== hostSave.room?.code)) {
    resume.push(h('button', { class: 'btn resume', onclick: () => joinRoom(last.code, load('name') || 'ゲスト') }, `部屋 ${last.code} に戻る`));
  }
  const invited = codeIn.value.length === 6;
  app.append(
    h(
      'div',
      { class: 'title-wrap' },
      h('div', { class: 'logo' }, h('div', { class: 'logo-sub' }, 'スマブラSP 全86ファイター'), h('h1', null, h('span', null, '最強キャラ'), h('span', { class: 'r' }, '決定戦')), h('p', { class: 'tag' }, '「どっちが強い？」を答えるだけで、みんなのキャラランクができあがる。')),
      h(
        'div',
        { class: 'panel' },
        h('label', { class: 'lbl' }, 'ニックネーム'),
        nameIn,
        invited ? null : h('button', { class: 'btn primary big', onclick: () => { const n = getName(); if (n) createRoom(n); } }, '部屋を作る（ホスト）'),
        invited ? null : h('div', { class: 'or' }, h('span', null, 'または')),
        h('label', { class: 'lbl' }, '部屋コードで参加'),
        h('div', { class: 'join-row' }, codeIn, h('button', { class: `btn ${invited ? 'primary' : 'sub'}`, onclick: doJoin }, '参加')),
        invited ? h('button', { class: 'linkbtn', onclick: () => (setUrlRoom(null), renderTitle()) }, '自分で部屋を作る') : null,
        err,
        resume.length ? h('div', { class: 'resume-box' }, resume) : null
      ),
      h('details', { class: 'rules' }, h('summary', null, '使いかた'), rulesBody()),
      h('p', { class: 'foot' }, '非公式のファンツールです。任天堂・各権利者とは関係ありません。')
    )
  );
  if (!nameIn.value) nameIn.focus();
}
function rulesBody() {
  return h(
    'ol',
    { class: 'rules-list' },
    h('li', null, 'ホストが部屋を作って、友だちに部屋コードかリンクを送ります（ひとりでもOK）。'),
    h('li', null, '2キャラが出るので、ホストが「強いと思う方」をタップ。参加者は自分の意見を投票できます。'),
    h('li', null, '答えるたびに全キャラの順位が計算し直されます。TOP10・11〜20位…と10位ずつ見られます。'),
    h('li', null, '目安：150回くらいでざっくり、300回くらいでかなり正確な順位になります。いつやめてもOK。'),
    h('li', null, '知らないキャラは「設定」で外せます。ホストの端末に保存されるので、続きはあとからでも。')
  );
}

// ---------- 接続 ----------
async function createRoom(name, saved = null) {
  busy('部屋を作っています…');
  try {
    const client = await connect();
    const room = await HostRoom.create(client, { id: myId(), name }, saved);
    enterRoom(room);
  } catch (e) {
    console.error(e);
    renderTitle('サーバーにつながりませんでした。通信を確認してもう一度ためしてください');
  } finally {
    busy();
  }
}
async function joinRoom(code, name) {
  busy(`部屋 ${code} をさがしています…`);
  let client;
  try {
    client = await connect();
    const room = await GuestRoom.join(client, code, { id: myId(), name });
    enterRoom(room);
  } catch (e) {
    if (client) client.end(true);
    const m = String(e && e.message);
    if (m === 'notfound') {
      if (load('last')?.code === code) save('last', null);
      renderTitle('部屋が見つかりません。コードを確かめてください');
    } else if (m === 'full') renderTitle(`満員です（最大${MAX_PLAYERS}人）`);
    else if (m === 'timeout') renderTitle('ホストから返事がありません。もう一度ためしてください');
    else renderTitle('サーバーにつながりませんでした。通信を確認してもう一度ためしてください');
  } finally {
    busy();
  }
}
function enterRoom(room) {
  S.room = room;
  S.st = null;
  S.key = '';
  S.tab = 'vs';
  S.lastSeq = null;
  setUrlRoom(room.code);
  if (!room.isHost) save('last', { code: room.code, at: Date.now() });
  room.onState((st) => {
    if (S.room !== room) return;
    S.st = st;
    S.lastStateAt = Date.now();
    if (!room.isHost && !st.players.some((p) => p.id === room.me.id)) return leaveToTitle('部屋から外れました');
    render();
  });
  if (!room.isHost) room.onClosed = () => S.room === room && leaveToTitle('ホストが部屋を閉じました', true);
}
function leaveToTitle(msg, silent = false) {
  const r = S.room;
  S.room = null;
  S.st = null;
  closeSheet();
  if (r) {
    if (r.isHost) r.close();
    else {
      save('last', null);
      r.leave(silent);
    }
  }
  setUrlRoom(null);
  renderTitle(msg);
}
setInterval(() => {
  if (!S.room || isHost() || !S.st) return;
  document.body.classList.toggle('host-lost', Date.now() - S.lastStateAt > 32000);
}, 3000);

// ---------- 部屋 ----------
function render() {
  if (!S.room || !S.st) return;
  const key = JSON.stringify([S.st, S.tab]);
  if (key === S.key) return;
  S.key = key;
  const y = window.scrollY;
  app.textContent = '';
  app.className = 'scr-room';
  app.append(topBar(), tabs());
  if (S.tab === 'vs') renderVs();
  else if (S.tab === 'rank') renderRank();
  else if (S.tab === 'members') renderMembers();
  else renderSettings();
  window.scrollTo(0, S.tab === 'vs' ? 0 : y);
}
function topBar() {
  return h(
    'header',
    { class: 'top' },
    h('div', { class: 'brand' }, '最強キャラ', h('em', null, '決定戦')),
    h('button', { class: 'code-chip', onclick: share }, h('small', null, '部屋'), S.st.code),
    h(
      'button',
      {
        class: 'linkbtn',
        onclick: () =>
          isHost()
            ? confirmSheet('部屋を閉じますか？', '参加者はタイトルに戻ります。ランキングはこの端末に残るので、「つづきから」で再開できます。', '閉じる', () => leaveToTitle(), true)
            : confirmSheet('部屋から出ますか？', '同じコードでまた戻れます。', '出る', () => leaveToTitle()),
      },
      isHost() ? '閉じる' : '退出'
    ),
    h('div', { class: 'lost-banner' }, 'ホストとの通信が止まっています…')
  );
}
function tabs() {
  const list = [
    ['vs', '対決'],
    ['rank', 'ランキング'],
    ['members', `メンバー ${S.st.players.length}`],
  ];
  if (isHost()) list.push(['settings', '設定']);
  return h(
    'nav',
    { class: 'tabs' },
    list.map(([k, label]) => h('button', { class: S.tab === k ? 'on' : '', onclick: () => ((S.tab = k), render()) }, label))
  );
}
async function share() {
  const url = inviteUrl(S.st.code);
  const text = `最強キャラ決定戦（スマブラ）で一緒にランク作ろう！ 部屋コード：${S.st.code}`;
  try {
    if (navigator.share) return await navigator.share({ title: '最強キャラ決定戦', text, url });
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('招待リンクをコピーしました');
  } catch {
    openSheet([h('div', { class: 'sheet-title' }, '招待リンク'), h('textarea', { class: 'in', rows: 3, readonly: true }, url), h('button', { class: 'btn ghost', onclick: closeSheet }, '閉じる')]);
  }
}

// 現在の順位（id -> 順位）
function rankMap(history, excluded) {
  const ids = CHARS.filter((c) => !excluded.includes(c.id)).map((c) => c.id);
  const rs = ratings(history, ids).sort((x, y) => y.score - x.score || x.count - y.count || BY_ID[x.id].no - BY_ID[y.id].no);
  return { list: rs, pos: new Map(rs.map((r, i) => [r.id, i + 1])) };
}

// ---------- 対決 ----------
function renderVs() {
  const st = S.st;
  const pr = st.pair;
  const active = CHARS.length - st.excluded.length;
  const n = st.history.length;
  const avg = (n * 2) / Math.max(1, active);
  const { pos, list } = rankMap(st.history, st.excluded);
  const count = new Map(list.map((r) => [r.id, r.count]));
  const myVote = st.votes[meId()];
  const host = isHost();
  const tally = { a: [], b: [], d: [] };
  for (const [pid, v] of Object.entries(st.votes)) {
    const p = st.players.find((x) => x.id === pid);
    if (p && tally[v]) tally[v].push(p.name);
  }
  const goal = Math.round(active * 3.5);
  const main = h('main', { class: 'vs-main' });
  main.append(
    h(
      'div',
      { class: 'meter' },
      h('div', { class: 'meter-text' }, h('b', null, n), '回判定', h('span', null, `1キャラ平均 ${avg.toFixed(1)}回`)),
      h('div', { class: 'meter-bar' }, h('i', { style: `width:${Math.min(100, (n / goal) * 100)}%` }), h('span', { class: 'mark', style: 'left:43%' }), h('span', { class: 'mark', style: 'left:86%' })),
      h('div', { class: 'meter-legend' }, h('span', null, 'ざっくり'), h('span', null, 'かなり正確'))
    )
  );
  if (!pr) {
    main.append(h('div', { class: 'empty' }, '比べるキャラが足りません。「設定」でキャラを戻してください。'));
  } else {
    const side = (k) => {
      const id = pr[k];
      const c = BY_ID[id];
      const chosen = myVote === k;
      return h(
        'button',
        { class: `fighter ${k} ${chosen ? 'chosen' : ''}`, style: `--c:${colorOf(id)}`, onclick: () => pick(k) },
        h('span', { class: 'f-rank' }, count.get(id) ? `いま ${pos.get(id)}位` : 'はじめての対決', h('small', null, `比較${count.get(id) || 0}回`)),
        badge(id, 'xl'),
        h('span', { class: 'f-name' }, c.name),
        h('span', { class: 'f-series' }, c.series),
        h('span', { class: 'f-votes' }, tally[k].length ? `${tally[k].length}票：${tally[k].join('、')}` : '')
      );
    };
    main.append(
      h('div', { class: 'q' }, host ? 'どっちが強い？' : 'どっちが強いと思う？', h('small', null, host ? 'タップで決定（あなたの判定がランクに入ります）' : 'タップで投票（決めるのはホスト）')),
      h('div', { class: 'arena' }, side('a'), h('div', { class: 'vs' }, 'VS'), side('b')),
      h('button', { class: `btn even ${myVote === 'd' ? 'chosen' : ''}`, onclick: () => pick('d') }, '同じくらい', tally.d.length ? h('small', null, ` ${tally.d.length}票`) : null)
    );
    if (host)
      main.append(
        h(
          'div',
          { class: 'host-tools' },
          h('button', { class: 'tool', onclick: () => S.room.skip() }, 'スキップ'),
          h('button', { class: 'tool', onclick: choosePairSheet }, '自分で選ぶ'),
          h('button', { class: 'tool', disabled: !n, onclick: () => S.room.undo() }, '1つ戻す')
        )
      );
  }
  // 直前の判定
  if (st.last) {
    const L = st.last;
    const fresh = S.lastSeq !== null && S.lastSeq !== L.seq;
    S.lastSeq = L.seq;
    const w = L.r === 1 ? L.a : L.r === 0 ? L.b : null;
    const lose = L.r === 1 ? L.b : L.r === 0 ? L.a : null;
    const agree = Object.values(L.votes || {}).filter((v) => (L.r === 1 ? 'a' : L.r === 0 ? 'b' : 'd') === v).length;
    const total = Object.keys(L.votes || {}).length;
    main.append(
      h(
        'div',
        { class: `last ${fresh ? 'fresh' : ''}` },
        h('span', { class: 'last-k' }, '前回の判定'),
        w ? h('span', null, h('b', null, BY_ID[w].name), ' ＞ ', BY_ID[lose].name) : h('span', null, BY_ID[L.a].name, ' ＝ ', BY_ID[L.b].name, '（同じくらい）'),
        total ? h('span', { class: 'agree' }, `同じ意見 ${agree}/${total}人`) : null
      )
    );
  } else S.lastSeq = 0;
  app.append(main);
}

function pick(k) {
  if (isHost()) S.room.judge(k);
  else {
    S.room.vote(k);
    toast(k === 'd' ? '「同じくらい」に投票しました' : `${BY_ID[S.st.pair[k]].name} に投票しました`);
  }
}

function choosePairSheet() {
  let first = null;
  const search = h('input', { class: 'in', placeholder: 'キャラ名でさがす', enterkeyhint: 'search' });
  const head = h('div', { class: 'sheet-title' }, '1人目を選ぶ');
  const list = h('div', { class: 'pick-list' });
  const draw = () => {
    const q = norm(search.value);
    list.textContent = '';
    for (const c of CHARS) {
      if (S.st.excluded.includes(c.id) || (q && !norm(c.name).includes(q) && !norm(c.series).includes(q))) continue;
      list.append(
        h(
          'button',
          {
            class: `pick ${first === c.id ? 'on' : ''}`,
            onclick: () => {
              if (!first) {
                first = c.id;
                head.textContent = `${c.name} と比べるキャラを選ぶ`;
                search.value = '';
                draw();
                search.focus();
              } else if (c.id !== first) {
                S.room.choose(first, c.id);
                closeSheet();
              }
            },
          },
          badge(c.id),
          h('span', null, c.name)
        )
      );
    }
  };
  search.addEventListener('input', draw);
  draw();
  openSheet([head, search, list, h('button', { class: 'btn ghost wide', onclick: closeSheet }, 'やめる')], true);
}

// ---------- ランキング ----------
function renderRank() {
  const st = S.st;
  const { list } = rankMap(st.history, st.excluded);
  // 1つ前の判定時点との比較（↑↓）
  const prev = st.history.length ? rankMap(st.history.slice(0, -1), st.excluded).pos : null;
  const main = h('main', { class: 'rank-main' });
  main.append(
    h(
      'div',
      { class: 'rank-head' },
      h('div', null, h('b', null, `${list.length}キャラ`), ` ・ 判定${st.history.length}回`),
      h('button', { class: 'btn sub small', onclick: () => copyRanking(list) }, 'テキストでコピー')
    )
  );
  if (st.history.length < 20) main.append(h('p', { class: 'note' }, 'まだ判定が少ないので、順位はほぼバラバラです。「対決」で答えるほど正確になります。'));
  for (let g = 0; g < list.length; g += 10) {
    const label = g === 0 ? 'TOP 10' : `${g + 1}〜${Math.min(g + 10, list.length)}位`;
    const sec = h('section', { class: `tier t${Math.min(g / 10, 8)}` }, h('h2', null, label, g >= 10 ? h('small', null, `TOP ${g + 10}`) : null));
    const ol = h('ol', { class: 'tier-list' });
    list.slice(g, g + 10).forEach((r, i) => {
      const rank = g + i + 1;
      const c = BY_ID[r.id];
      const was = prev && prev.get(r.id);
      const mv = was ? was - rank : 0;
      ol.append(
        h(
          'li',
          { class: st.pair && (st.pair.a === r.id || st.pair.b === r.id) ? 'now' : '' },
          h('span', { class: 'no' }, rank),
          badge(r.id),
          h('span', { class: 'nm' }, c.name, h('small', null, c.series)),
          mv ? h('span', { class: `mv ${mv > 0 ? 'up' : 'down'}` }, mv > 0 ? `↑${mv}` : `↓${-mv}`) : null,
          h('span', { class: `cnt ${r.count < 3 ? 'low' : ''}` }, `${r.count}回`)
        )
      );
    });
    sec.append(ol);
    main.append(sec);
  }
  app.append(main);
}
async function copyRanking(list) {
  const lines = ['【最強キャラ決定戦】スマブラSP キャラランク', `（判定${S.st.history.length}回）`];
  list.forEach((r, i) => {
    if (i % 10 === 0) lines.push('', i === 0 ? '■ TOP 10' : `■ ${i + 1}〜${Math.min(i + 10, list.length)}位`);
    lines.push(`${i + 1}. ${BY_ID[r.id].name}`);
  });
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('ランキングをコピーしました');
  } catch {
    openSheet([h('div', { class: 'sheet-title' }, 'ランキング'), h('textarea', { class: 'in', rows: 12, readonly: true }, text), h('button', { class: 'btn ghost wide', onclick: closeSheet }, '閉じる')], true);
  }
}

// ---------- メンバー ----------
function renderMembers() {
  const st = S.st;
  app.append(
    h(
      'main',
      { class: 'members' },
      h('section', { class: 'card invite' }, h('div', null, h('small', null, '部屋コード'), h('strong', null, st.code)), h('button', { class: 'btn primary', onclick: share }, '友だちを招待')),
      h(
        'ul',
        { class: 'mlist' },
        st.players.map((p) =>
          h(
            'li',
            { class: p.online ? '' : 'off' },
            h('span', { class: 'dot' }),
            h('span', { class: 'pname' }, p.name),
            p.id === st.hostId ? h('span', { class: 'tag-s host' }, 'ホスト') : null,
            p.id === meId() ? h('span', { class: 'tag-s' }, 'あなた') : null,
            !p.online ? h('span', { class: 'tag-s off' }, '通信なし') : null,
            isHost() && p.id !== st.hostId ? h('button', { class: 'kick', onclick: () => confirmSheet(`${p.name} さんを外しますか？`, null, '外す', () => S.room.kick(p.id), true) }, '×') : null
          )
        )
      )
    )
  );
}

// ---------- 設定（ホスト） ----------
function renderSettings() {
  const st = S.st;
  const ex = new Set(st.excluded);
  const search = h('input', { class: 'in', placeholder: 'キャラ名・シリーズでしぼりこみ', enterkeyhint: 'search', value: S.exQuery || '' });
  const grid = h('div', { class: 'ex-grid' });
  const draw = () => {
    const q = norm(search.value);
    grid.textContent = '';
    for (const c of CHARS) {
      if (q && !norm(c.name).includes(q) && !norm(c.series).includes(q)) continue;
      const off = ex.has(c.id);
      grid.append(
        h(
          'button',
          {
            class: `ex ${off ? 'off' : ''}`,
            onclick: () => {
              if (off) ex.delete(c.id);
              else ex.add(c.id);
              S.room.setExcluded([...ex]);
            },
          },
          badge(c.id),
          h('span', null, c.name),
          h('i', null, off ? '外す' : '')
        )
      );
    }
  };
  search.addEventListener('input', () => ((S.exQuery = search.value), draw()));
  draw();
  app.append(
    h(
      'main',
      { class: 'settings' },
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'ランキングに入れるキャラ', h('small', null, `${CHARS.length - ex.size}/${CHARS.length}`)),
        h('p', { class: 'note' }, 'タップで入れる／外すを切りかえ。外したキャラは対決にもランキングにも出ません。'),
        h('div', { class: 'row tight' }, h('button', { class: 'btn sub small', onclick: () => S.room.setExcluded([]) }, '全員入れる'), h('button', { class: 'btn sub small', onclick: () => S.room.setExcluded(CHARS.filter((c) => c.series === 'Miiファイター').map((c) => c.id).concat([...ex])) }, 'Miiを外す')),
        search,
        grid
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', null, 'リセット'),
        h('p', { class: 'note' }, 'これまでの判定をすべて消して、最初からやり直します。'),
        h('button', { class: 'btn danger', disabled: !st.history.length, onclick: () => confirmSheet('判定をすべて消しますか？', `${st.history.length}回分の判定が消えます。元に戻せません。`, '消す', () => S.room.reset(), true) }, 'ランキングをリセット')
      )
    )
  );
}

renderTitle();
