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
  screen: 'question', // question | result | break | end
  order: [],
  pos: 0,
  current: null, // { q, shown: [...], correct: index }
  picked: -1,
  answered: 0,
  correct: 0,
  setAnswered: 0,
  setCorrect: 0,
  stats: { answered: 0, correct: 0 },
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
  if (screen === 'question') {
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
    const rate = state.answered ? Math.round((state.correct / state.answered) * 100) : 0;
    const all = state.stats;
    const allRate = all.answered ? Math.round((all.correct / all.answered) * 100) : 0;
    text = `おつかれさまでした\n今回: ${state.correct}/${state.answered}（${rate}%）\nこれまで: ${all.correct}/${all.answered}（${allRate}%）`;
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
  try {
    await bridge.setLocalStorage(STORE_KEY, JSON.stringify(state.stats));
  } catch (_) { /* 保存できなくてもクイズは続ける */ }
}

async function loadStats() {
  try {
    const raw = await bridge.getLocalStorage(STORE_KEY);
    if (raw) state.stats = { answered: 0, correct: 0, ...JSON.parse(raw) };
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
    return nextQuestion();
  }
}

function handleEvent(event) {
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
  state.order = shuffle(QUESTIONS.map((_, i) => i));
  state.pos = 0;
  prepareQuestion();
  await show('question');
}

main().catch((e) => {
  const el = document.getElementById('status');
  if (el) el.textContent = 'Even アプリの中で開いてください（' + (e?.message || e) + '）';
});
