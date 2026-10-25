// Dictionary popup: double-click a word in any text, or right-click any word (including in
// answer options), to see its meanings. Lookups go to the main process via window.examApi.lookupWord.
// Loaded before renderer.js; uses its shared helpers ($, el, state) at call time.
//
// During a reading test, words tested by a vocabulary question are locked until the test is submitted.

const SENSES_SHOWN = 3; // per entry, before "Show all"
const ENTRIES_SHOWN = 4;

let popupHistory = []; // previous lookups in this popup, for the Back button
let lockedCache = { examId: null, lemmas: new Map() }; // word/lemma -> question number

/* ---------------- Finding the clicked word ---------------- */

const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

// The word under a screen point, using the browser's caret position API (no extra markup needed).
function wordAtPoint(x, y) {
  const range = document.caretRangeFromPoint(x, y);
  const node = range?.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent;
  let start = range.startOffset;
  let end = range.startOffset;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  // Trim leading/trailing apostrophes and hyphens ("'hello'" -> "hello").
  while (start < end && /['’-]/.test(text[start])) start++;
  while (end > start && /['’-]/.test(text[end - 1])) end--;

  const word = text.slice(start, end);
  if (!/\p{L}/u.test(word)) return null;

  const wordRange = document.createRange();
  wordRange.setStart(node, start);
  wordRange.setEnd(node, end);
  // A capital letter in the middle of a sentence suggests a name ("Anna", "Okafor").
  const before = text.slice(0, start);
  const sentenceStart = /(^|[.!?:]["')\]]?\s+|^["'(\[])$/.test(before) || before.trim() === '';
  return { word, rect: wordRange.getBoundingClientRect(), capitalisedMidSentence: /^\p{Lu}/u.test(word) && !sentenceStart && word !== 'I' };
}

// Text the learner types into is not looked up (it would interfere with editing).
function isEditable(target) {
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/* ---------------- Locked words during a reading test ---------------- */

// Words quoted in vocabulary questions ("the word \"afford\" means...") and their base forms.
async function lockedLemmas() {
  const exam = state.exam;
  if (lockedCache.examId === exam.id) return lockedCache.lemmas;

  const lemmas = new Map();
  for (const [index, q] of exam.questions.entries()) {
    if (q.type !== 'vocabulary') continue;
    for (const [, quoted] of q.text.matchAll(/"([^"]+)"/g)) {
      const word = quoted.toLowerCase();
      lemmas.set(word, index + 1);
      const result = await window.examApi.lookupWord(word);
      // Only direct matches: a fallback (e.g. parts of a hyphenated word) would lock unrelated words.
      if (!result.note) for (const e of result.entries) lemmas.set(e.lemma, index + 1);
    }
  }
  lockedCache = { examId: exam.id, lemmas };
  return lemmas;
}

async function lockedQuestion(result) {
  if (state.exam?.skill !== 'reading' || state.submitted) return null;
  const lemmas = await lockedLemmas();
  const hit = [result.word, ...result.entries.map((e) => e.lemma)].find((w) => lemmas.has(w));
  return hit ? lemmas.get(hit) : null;
}

/* ---------------- Popup ---------------- */

function speak(word) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en'));
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? 'en-US'; // Electron may list no voices but still speaks with the Windows default
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}

function closeDictionary() {
  $('dict-popup').hidden = true;
  popupHistory = [];
}

// Position the popup below the word, or above it if there is no room, inside the window.
function placePopup(rect) {
  const popup = $('dict-popup');
  const margin = 8;
  const width = popup.offsetWidth;
  const height = popup.offsetHeight;
  let left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 6);
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

async function openDictionary(word, { rect, capitalisedMidSentence = false, fromPopup = false } = {}) {
  const popup = $('dict-popup');
  if (!fromPopup) popupHistory = [];
  popupHistory.push(word);

  popup.hidden = false;
  popup.replaceChildren(el('div', { className: 'dict-loading muted' }, `Looking up "${word}"...`));
  if (rect) placePopup(rect);

  const result = await window.examApi.lookupWord(word);
  const questionNumber = await lockedQuestion(result);
  renderPopup(word, result, { questionNumber, capitalisedMidSentence });
  if (rect) placePopup(rect);
}

function renderPopup(word, result, { questionNumber, capitalisedMidSentence }) {
  const popup = $('dict-popup');
  const headword = result.entries[0]?.lemma && !result.note ? result.entries[0].lemma : word;

  const header = el('div', { className: 'dict-header' },
    popupHistory.length > 1
      ? el('button', { className: 'dict-icon', title: 'Back', onclick: () => { popupHistory.pop(); openDictionary(popupHistory.pop(), { fromPopup: true }); } }, '←')
      : null,
    el('strong', { className: 'dict-word' }, word),
    el('button', { className: 'dict-icon', title: 'Listen', onclick: () => speak(word) }, '🔊'),
    el('span', { className: 'dict-spacer' }),
    el('button', { className: 'dict-icon', title: 'Close (Esc)', onclick: closeDictionary }, '×')
  );

  const notes = [];
  if (result.error) notes.push(result.error);
  if (result.note) notes.push(result.note);
  const formOf = result.entries.map((e) => e.lemma).find((l) => l !== result.word && !result.note);
  if (formOf && !result.entries.some((e) => e.lemma === result.word)) notes.push(`"${word}" is a form of "${formOf}".`);
  // Capitalised mid-sentence and not a proper dictionary word like "Dutch": probably a person's or place name.
  const properWord = result.entries.some((e) => e.display && e.display !== e.lemma);
  if (capitalisedMidSentence && !properWord) notes.push(`"${word}" starts with a capital letter here, so it is probably a name.`);

  let body;
  if (questionNumber) {
    body = el('div', { className: 'dict-locked' },
      '🔒 This word is tested in question ', el('strong', {}, String(questionNumber)),
      '. You can look it up after you submit the test.');
  } else if (result.entries.length === 0) {
    body = el('p', { className: 'muted dict-empty' },
      capitalisedMidSentence ? 'Names are not in the dictionary.' : `No dictionary entry for "${word}". You can still listen to it.`);
  } else {
    body = el('div', { className: 'dict-entries' }, result.entries.slice(0, ENTRIES_SHOWN).map(renderEntry));
  }

  popup.replaceChildren(...[
    header,
    notes.length && !questionNumber ? el('div', { className: 'dict-notes' }, notes.map((n) => el('div', {}, n))) : null,
    body,
    el('div', { className: 'dict-footer' }, 'Definitions: WordNet 3.0 © Princeton University, plus learner notes')
  ].filter(Boolean));
  popup.dataset.headword = headword;
}

function renderEntry(entry) {
  const senses = entry.senses.map((s, i) =>
    el('li', { className: i >= SENSES_SHOWN ? 'dict-extra' : '' },
      el('span', {}, s.definition),
      s.examples.length ? el('div', { className: 'dict-example' }, s.examples.slice(0, 2).map((x) => el('q', {}, x))) : null,
      s.synonyms.length
        ? el('div', { className: 'dict-synonyms' }, 'Similar: ',
            s.synonyms.slice(0, 5).flatMap((syn, k) => [k ? ', ' : null, el('button', { className: 'dict-link', onclick: () => openDictionary(syn, { fromPopup: true }) }, syn)]))
        : null
    )
  );
  const list = el('ol', { className: 'dict-senses' }, senses);
  const hidden = entry.senses.length - SENSES_SHOWN;

  return el('section', { className: 'dict-entry' },
    el('div', { className: 'dict-entry-head' },
      el('span', { className: 'dict-lemma' }, entry.display ?? entry.lemma),
      el('span', { className: 'dict-pos' }, entry.posLabel),
      entry.source === 'learner' ? el('span', { className: 'dict-badge' }, 'learner') : null
    ),
    list,
    hidden > 0
      ? el('button', {
          className: 'dict-link dict-more',
          onclick: (e) => {
            list.classList.add('show-all');
            e.target.remove();
          }
        }, `Show ${entry.senseCount > entry.senses.length ? `${entry.senses.length} of ${entry.senseCount}` : `all ${entry.senses.length}`} meanings`)
      : null
  );
}

/* ---------------- Events ---------------- */

function initDictionary() {
  // Double-click: any word in non-interactive text (the first click of a double-click
  // would select an answer option, so options use right-click instead).
  document.addEventListener('dblclick', (e) => {
    if (isEditable(e.target) || e.target.closest('#dict-popup, .option, button, .chip, .tab')) return;
    $('dict-popup').hidden = true; // an open popup must not cover the word being clicked
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (hit) openDictionary(hit.word, hit);
  });

  // Right-click: any word anywhere, including answer options.
  document.addEventListener('contextmenu', (e) => {
    if (isEditable(e.target) || e.target.closest('#dict-popup')) return;
    $('dict-popup').hidden = true;
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    openDictionary(hit.word, hit);
  });

  // Close on Escape, on a click outside the popup, or when the page scrolls.
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDictionary());
  document.addEventListener('mousedown', (e) => {
    if (!$('dict-popup').hidden && !e.target.closest('#dict-popup')) closeDictionary();
  });
  for (const panel of document.querySelectorAll('.panel, .exam-list')) {
    panel.addEventListener('scroll', () => !$('dict-popup').hidden && closeDictionary(), { passive: true });
  }
}
