import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { QUESTIONS } from './questions.js';

// G2 の画面は 576x288
const W = 576;
const TEXT_H = 118;
const LIST_Y = 122;
const LIST_H = 288 - LIST_Y;
const LETTERS = ['A', 'B', 'C', 'D'];
const SET_SIZE = 5;
const STORE_KEY = 'gkentei-stats';

const state = {
  screen: 'start', // start | question | result | break | end
  order: [],
  pos: 0,
  current: null, // { q, shown: [...], correct: index }
  picked: -1,
  answered: 0,
  correct: 0,
  setAnswered: 0,
  setCorrect: 0,
  // 累計の記録（Even アプリ内に保存）
  // cats: 分野ごとの [解いた数, 正解数] / weak: 苦手な問題（問題文 → 続けて正解した回数）
  stats: { answered: 0, correct: 0, last: '', conquered: 0, cats: {}, weak: {} },
  prevLast: '', // 起動時に読んだ「前回」の日時
  sessConquered: [], // 今回克服した問題の正解
  sessMiss: {}, // 今回間違えた分野 → 回数
};

let bridge = null;
let started = false;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function prepareQuestion() {
  if (state.pos >= state.order.length) {
    state.order = shuffle(QUESTIONS.map((_, i) => i));
    state.pos = 0;
  }
  const q = QUESTIONS[state.order[state.pos]];
  const shown = shuffle(q.choices.map((c, i) => ({ c, ok: i === 0 })));
  state.current = { q, shown: shown.map((s) => s.c), correct: shown.findIndex((s) => s.ok) };
}

function pageFor(screen) {
  const cur = state.current;
  let text = '';
  let items = [];
  if (screen === 'start') {
    const all = state.stats;
    if (!all.answered) {
      text = 'G検定 4択クイズ\n初めての学習です。がんばりましょう';
      items = ['始める'];
    } else {
      const weakN = Object.keys(all.weak).length;
      text = `前回 ${fmtDate(state.prevLast)}\n累計 ${all.correct}/${all.answered}（${pct(all.correct, all.answered)}%）\n苦手: ${weakCats()}\n苦手 ${weakN}問 ／ 克服 ${all.conquered}問`;
      items = weakN ? ['苦手から始める', 'いつもどおり'] : ['始める'];
    }
  } else if (screen === 'question') {
    text = `Q${state.answered + 1} [${cur.q.cat}]\n${cur.q.q}`;
    items = [...cur.shown.map((c, i) => `${LETTERS[i]} ${c}`), '終了'];
  } else if (screen === 'result') {
    const ok = state.picked === cur.correct;
    const mark = ok ? '⭕ 正解' : `❌ 不正解（正解は ${LETTERS[cur.correct]}）`;
    text = `${mark}\n${LETTERS[cur.correct]} ${cur.shown[cur.correct]}\n${cur.q.exp}`;
    items = ['次へ', '取り消し（選び直す）', '終了'];
  } else if (screen === 'break') {
    text = `${SET_SIZE}問の区切り\nこの${SET_SIZE}問: ${state.setCorrect}/${state.setAnswered} 正解\n今回の合計: ${state.correct}/${state.answered}`;
    items = ['続ける', '終了'];
  } else {
    const done = state.sessConquered;
    const conq = done.length ? `克服 ${done.length}問（${done.slice(0, 2).join('、')}${done.length > 2 ? 'ほか' : ''}）` : '克服 0問';
    const miss = Object.entries(state.sessMiss).sort((a, b) => b[1] - a[1]);
    const trend = miss.length ? `ミスが多い: ${miss.slice(0, 2).map(([c, n]) => `${c} ${n}問`).join('・')}` : 'ミスなし';
    text = `おつかれさまでした\n今回 ${state.correct}/${state.answered}（${pct(state.correct, state.answered)}%）\n${conq}\n${trend}`;
    items = ['もう一度', '閉じる'];
  }
  return {
    containerTotalNum: 2,
    textObject: [{
      xPosition: 0, yPosition: 0, width: W, height: TEXT_H,
      containerID: 1, containerName: 'msg', zOrderIndex: 1,
      content: text, isEventCapture: 0,
    }],
    listObject: [{
      xPosition: 0, yPosition: LIST_Y, width: W, height: LIST_H,
      containerID: 2, containerName: 'menu', zOrderIndex: 2,
      itemContainer: { itemCount: items.length, itemName: items, isItemSelectBorderEn: 1 },
      isEventCapture: 1,
    }],
    _items: items,
  };
}

let currentItems = [];

function pct(c, n) {
  return n ? Math.round((c / n) * 100) : 0;
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// 正答率の低い分野を2つ（3問以上解いた分野だけ）
function weakCats() {
  const list = Object.entries(state.stats.cats)
    .filter(([, v]) => v[0] >= 3)
    .sort((a, b) => a[1][1] / a[1][0] - b[1][1] / b[1][0])
    .slice(0, 2)
    .map(([c, v]) => `${c} ${pct(v[1], v[0])}%`);
  return list.length ? list.join('・') : 'まだなし';
}

// 1問の結果を累計の記録に反映する
function record(q, ok) {
  const st = state.stats;
  const c = st.cats[q.cat] || [0, 0];
  st.cats[q.cat] = [c[0] + 1, c[1] + (ok ? 1 : 0)];
  if (!ok) {
    st.weak[q.q] = 0; // 間違えたら苦手に入れる（続けて正解した回数をリセット）
    state.sessMiss[q.cat] = (state.sessMiss[q.cat] || 0) + 1;
  } else if (q.q in st.weak) {
    st.weak[q.q] += 1;
    if (st.weak[q.q] >= 2) { // 苦手な問題に2回続けて正解したら克服
      delete st.weak[q.q];
      st.conquered += 1;
      state.sessConquered.push(q.choices[0]);
    }
  }
}

// 苦手な問題を先に、残りをその後ろに並べる
function weakFirstOrder() {
  const weak = new Set(Object.keys(state.stats.weak));
  const idx = QUESTIONS.map((_, i) => i);
  return [...shuffle(idx.filter((i) => weak.has(QUESTIONS[i].q))), ...shuffle(idx.filter((i) => !weak.has(QUESTIONS[i].q)))];
}

async function show(screen) {
  state.screen = screen;
  const { _items, ...page } = pageFor(screen);
  currentItems = _items;
  if (!started) {
    started = true;
    await bridge.createStartUpPageContainer(page);
  } else {
    await bridge.rebuildPageContainer(page);
  }
  renderPhone();
}

async function saveStats() {
  state.stats.last = new Date().toISOString();
  try {
    await bridge.setLocalStorage(STORE_KEY, JSON.stringify(state.stats));
  } catch (_) { /* 保存できなくてもクイズは続ける */ }
}

async function loadStats() {
  try {
    const raw = await bridge.getLocalStorage(STORE_KEY);
    if (raw) state.stats = { ...state.stats, ...JSON.parse(raw) };
    state.prevLast = state.stats.last;
  } catch (_) { /* 初回 */ }
}

function nextQuestion() {
  state.pos += 1;
  prepareQuestion();
  return show('question');
}

async function onSelect(index) {
  const label = currentItems[index];
  if (label === undefined) return;

  if (state.screen === 'start') {
    state.order = label === '苦手から始める' ? weakFirstOrder() : shuffle(QUESTIONS.map((_, i) => i));
    state.pos = 0;
    prepareQuestion();
    return show('question');
  }

  if (state.screen === 'question') {
    if (label === '終了') return show('end');
    state.picked = index;
    return show('result');
  }

  if (state.screen === 'result') {
    if (label.startsWith('取り消し')) {
      state.picked = -1;
      return show('question'); // 採点せず同じ問題を出し直す
    }
    // ここで初めて採点を確定する（取り消しできるように）
    const ok = state.picked === state.current.correct;
    state.answered += 1;
    state.setAnswered += 1;
    state.stats.answered += 1;
    if (ok) { state.correct += 1; state.setCorrect += 1; state.stats.correct += 1; }
    record(state.current.q, ok);
    await saveStats();
    if (label === '終了') return show('end');
    if (state.setAnswered >= SET_SIZE) return show('break');
    return nextQuestion();
  }

  if (state.screen === 'break') {
    if (label === '終了') return show('end');
    state.setAnswered = 0;
    state.setCorrect = 0;
    return nextQuestion();
  }

  if (state.screen === 'end') {
    if (label === '閉じる') return bridge.shutDownPageContainer(0);
    state.answered = state.correct = state.setAnswered = state.setCorrect = 0;
    state.sessConquered = [];
    state.sessMiss = {};
    state.prevLast = state.stats.last;
    return show('start');
  }
}

function handleEvent(event) {
  // ダブルタップは、どの画面でもシステムの終了確認を出す（Even Hub の審査基準）
  const types = [event.listEvent, event.textEvent, event.sysEvent].map((e) => e?.eventType);
  if (types.includes(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    bridge.shutDownPageContainer(1);
    return;
  }
  const le = event.listEvent;
  if (!le) return;
  // CLICK_EVENT は 0 なので、省略されて undefined で届くことがある
  const type = le.eventType;
  if (type !== undefined && type !== OsEventTypeList.CLICK_EVENT) return;
  let index = le.currentSelectItemIndex;
  if (index === undefined && le.currentSelectItemName) {
    index = currentItems.indexOf(le.currentSelectItemName);
  }
  if (index === undefined || index < 0) index = 0; // 先頭項目は 0 が省略される
  onSelect(index);
}

function renderPhone() {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = `今回 ${state.correct}/${state.answered} 正解 ・ これまで ${state.stats.correct}/${state.stats.answered} 正解`;
}

async function main() {
  bridge = await waitForEvenAppBridge();
  await loadStats();
  bridge.onEvenHubEvent(handleEvent);
  await show('start');
}

main().catch((e) => {
  const el = document.getElementById('status');
  if (el) el.textContent = 'Even アプリの中で開いてください（' + (e?.message || e) + '）';
});
