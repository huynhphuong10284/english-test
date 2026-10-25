// Renderer: UI logic. Talks to the main process only through window.examApi (see preload.js).
// Shared parts (sidebar, tabs, attempts, result dashboard) live here, together with the
// reading view. The writing view is in writing.js. Each view is an object with the same
// methods, so the shared code can call view().renderBody() etc. without caring about the skill.

const LETTERS = 'ABCDEFGH';

const state = {
  exams: [],
  skill: 'reading', // selected skill filter in the sidebar
  level: '', // selected level filter ('' = all levels)
  exam: null, // public exam (no answer key)
  drafts: {}, // examId -> answers not yet submitted (kept while switching exams)
  answers: {}, // answers shown in the test tab (shape depends on the skill)
  result: null, // saved attempt shown in the result tab (graded, with history)
  submitted: false // true = the test tab shows state.result's answers, locked
};

const $ = (id) => document.getElementById(id);

// Small DOM helper: el('div', { className: 'x', onclick: fn }, child1, 'text', ...)
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node[key] = value;
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function view(skill = state.exam?.skill) {
  return skill === 'writing' ? WritingView : ReadingView;
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the choice just won't be remembered.
  }
}

function recall(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function levelTone(percent) {
  if (percent >= 75) return 'good';
  if (percent >= 50) return 'warn';
  return 'bad';
}

/* ---------------- Tabs ---------------- */

function showTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  $('panel-test').hidden = name !== 'test';
  $('panel-result').hidden = name !== 'result';
}

/* ---------------- Sidebar: skill, level, exam list ---------------- */

const SKILL_KEY = 'selectedSkill';
const LEVEL_KEY = 'selectedLevel';

function selectSkill(skill) {
  state.skill = skill;
  remember(SKILL_KEY, skill);
  for (const btn of document.querySelectorAll('.skill-btn')) {
    const active = btn.dataset.skill === skill;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  }
  renderLevelOptions();
  renderExamList();
}

// Fill the level dropdown with each distinct level of the selected skill (CEFR codes sort naturally: A1 < A2 < B1 ...).
function renderLevelOptions() {
  const exams = state.exams.filter((e) => e.skill === state.skill);
  const counts = new Map();
  for (const exam of exams) counts.set(exam.level, (counts.get(exam.level) ?? 0) + 1);
  const levels = [...counts.keys()].sort();

  // Keep the chosen level even if this skill has no exams for it yet.
  $('level-select').replaceChildren(
    el('option', { value: '' }, `All levels (${exams.length})`),
    ...levels.map((level) => el('option', { value: level }, `${level} (${counts.get(level)})`))
  );
  $('level-select').value = levels.includes(state.level) ? state.level : '';
}

function selectLevel(level) {
  state.level = level;
  remember(LEVEL_KEY, level);
  renderExamList();
}

function renderExamList() {
  const list = $('exam-list');
  const level = $('level-select').value; // may differ from state.level if this skill lacks that level
  const visible = state.exams.filter((exam) => exam.skill === state.skill && (!level || exam.level === level));
  if (visible.length === 0) {
    list.replaceChildren(el('li', { className: 'muted empty' }, `No ${state.skill} exams for this level yet.`));
    return;
  }
  list.replaceChildren(
    ...visible.map((exam) =>
      el('li', {},
        el('button', {
          className: 'exam-item' + (state.exam?.id === exam.id ? ' active' : ''),
          onclick: () => selectExam(exam.id)
        },
          el('span', { className: 'title' }, exam.title),
          el('span', { className: 'meta' }, `${exam.level} · ${view(exam.skill).listMeta(exam)}`),
          progressNote(exam)
        )
      )
    )
  );
}

function progressNote(exam) {
  const p = exam.progress;
  const draft = state.drafts[exam.id];
  const inProgress = draft && view(exam.skill).hasContent(draft);
  return [
    p ? el('div', { className: 'done' }, `✓ ${p.attempts} attempt${p.attempts > 1 ? 's' : ''} · best ${p.bestPercent}% · last ${p.lastPercent}%`) : null,
    inProgress ? el('div', { className: 'draft' }, '✎ Answers in progress') : null
  ];
}

async function refreshExamList() {
  state.exams = await window.examApi.listExams();
  renderExamList();
}

async function selectExam(examId) {
  if (state.exam?.id === examId) return;

  // Load the exam and its latest saved result (null if never submitted) in parallel.
  const [exam, result] = await Promise.all([window.examApi.getExam(examId), window.examApi.getResult(examId)]);
  state.exam = exam;
  state.result = result;

  if (state.drafts[examId] || !result) {
    // Continue an unfinished attempt, or start the first one.
    state.submitted = false;
    state.answers = state.drafts[examId] ??= view().emptyAnswers();
  } else {
    // Already submitted: show the latest result.
    state.submitted = true;
    state.answers = view().answersFromResult(result);
  }

  renderExamList();
  renderTest();
  if (result) renderResult();
  else renderResultEmpty();
  showTab(state.submitted ? 'result' : 'test');
  $('panel-test').scrollTop = 0;
  $('panel-result').scrollTop = 0;
}

/* ---------------- Test tab (shared) ---------------- */

function renderTest() {
  const exam = state.exam;
  const v = view();
  $('test-empty').hidden = true;
  $('test-view').hidden = false;
  $('reading-body').hidden = exam.skill !== 'reading';
  $('writing-body').hidden = exam.skill !== 'writing';

  $('exam-title').textContent = exam.title;
  $('exam-meta').textContent = v.meta(exam);
  $('exam-level').textContent = exam.level;
  $('exam-instructions').textContent = exam.instructions || v.defaultInstructions;

  v.renderBody();
  updateProgress();
}

// Called by the views whenever an answer changes.
function answerChanged(wasEmpty) {
  if (wasEmpty) renderExamList(); // show "in progress" in the sidebar
  updateProgress();
}

function updateProgress() {
  const attempt = state.result?.attempt;
  $('progress').textContent = state.submitted
    ? `Attempt #${attempt.number} · ${formatDate(attempt.submittedAt)} · ${attempt.score}/${attempt.maxScore} marks`
    : view().progressText(state.answers);

  // Taking the test: Clear + Submit. Reviewing a saved attempt: View result + Retake.
  $('btn-reset').hidden = state.submitted;
  $('btn-submit').hidden = state.submitted;
  $('btn-view-result').hidden = !state.submitted;
  $('btn-retake-bar').hidden = !state.submitted;
  $('btn-reset').disabled = !view().hasContent(state.answers);
  renderQuestionNav();
}

// Numbered buttons in the submit bar: answered / unanswered (or correct / wrong when reviewing).
function renderQuestionNav() {
  const statusLabel = { answered: 'answered', correct: 'correct', incorrect: 'wrong', unanswered: 'not answered', '': 'not answered' };
  $('q-nav').replaceChildren(
    ...view().navItems().map((item, i) =>
      el('button', {
        className: item.status,
        title: `Question ${i + 1}: ${statusLabel[item.status]}`,
        onclick: () => {
          const target = $(item.id);
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.remove('flash');
          void target.offsetWidth; // restart the highlight animation
          target.classList.add('flash');
        }
      }, i + 1)
    )
  );
}

// Nav status of one item: its review status after submitting, else whether it is answered.
function navStatus(reviewItems, id, answered) {
  if (state.submitted) return reviewItems.find((r) => r.id === id)?.status ?? '';
  return answered ? 'answered' : '';
}

async function submitTest() {
  const warning = view().submitWarning(state.answers);
  if (warning && !confirm(`${warning} Submit anyway?`)) return;

  state.result = await window.examApi.submitExam(state.exam.id, view().toSubmission(state.answers));
  state.submitted = true;
  delete state.drafts[state.exam.id];

  renderTest(); // re-render to lock inputs and mark answers
  renderResult();
  showTab('result');
  $('panel-result').scrollTop = 0;
  await refreshExamList(); // updates attempts / best score in the sidebar
}

function resetAnswers() {
  if (!confirm('Clear all your answers?')) return;
  state.answers = state.drafts[state.exam.id] = view().emptyAnswers();
  renderTest();
  renderExamList();
}

// Start a new attempt. Earlier attempts stay saved and visible in the result tab.
function retake() {
  state.answers = state.drafts[state.exam.id] = view().emptyAnswers();
  state.submitted = false;
  renderTest();
  renderExamList();
  showTab('test');
  $('panel-test').scrollTop = 0;
}

async function viewAttempt(attemptId) {
  state.result = await window.examApi.getResult(state.exam.id, attemptId);
  if (state.submitted) {
    state.answers = view().answersFromResult(state.result);
    renderTest();
  }
  renderResult();
  $('panel-result').scrollTop = 0;
}

/* ---------------- Result tab (shared) ---------------- */

function renderResultEmpty() {
  $('tab-result').disabled = true;
  $('result-empty').hidden = false;
  $('result-view').hidden = true;
}

function renderResult() {
  const { summary, byType, assessment, title, attempt, history } = state.result;
  const v = view();
  $('tab-result').disabled = false;
  $('result-empty').hidden = true;
  $('result-view').hidden = false;

  $('result-title').textContent = title;
  const older = state.result.olderVersion;
  $('result-subtitle').textContent =
    `Attempt #${attempt.number} of ${history.length} · submitted ${formatDate(attempt.submittedAt)}` +
    (older ? ` · taken on an earlier version with ${older.questionCount} of today's ${older.currentCount} questions` : '');

  // Score ring
  const ring = $('score-ring');
  ring.style.setProperty('--p', summary.percent);
  ring.style.setProperty('--ring-color', `var(--${levelTone(summary.percent)})`);
  $('score-percent').textContent = `${summary.percent}%`;
  $('score-value').textContent = `${summary.score} / ${summary.maxScore}`;
  $('level-badge').textContent = assessment.level;
  $('level-headline').textContent = assessment.headline;

  // Stat cards
  $('stats').replaceChildren(
    ...v.stats(summary).map(([label, value, cls]) =>
      el('div', { className: `stat ${cls ?? ''}` }, el('div', { className: 'label' }, label), el('div', { className: 'value' }, value))
    )
  );

  // By question / exercise type
  $('by-type-title').textContent = v.byTypeTitle;
  $('by-type').replaceChildren(
    ...byType.map((t) => {
      const fill = el('div');
      fill.style.setProperty('--w', t.percent);
      return el('div', { className: 'type-row' },
        el('div', { className: 'row-head' }, el('span', {}, t.label), el('span', { className: 'muted' }, `${t.correct}/${t.total} · ${t.percent}%`)),
        el('div', { className: `bar ${levelTone(t.percent)}` }, fill)
      );
    })
  );

  $('advice').replaceChildren(...assessment.advice.map((a) => el('li', {}, a)));

  renderHistory();

  // Skill-specific sections
  $('btn-toggle-answers').hidden = state.exam.skill !== 'reading';
  $('answers-view').hidden = true;
  $('writing-review').hidden = state.exam.skill !== 'writing';
  $('exercise-review-card').hidden = state.exam.skill !== 'writing';
  v.renderReview();
}

// Every saved attempt for this exam, newest first.
function renderHistory() {
  const { attempt, history } = state.result;
  const best = Math.max(...history.map((h) => h.percent));
  $('history').replaceChildren(
    ...[...history].reverse().map((h) =>
      el('li', {},
        el('button', { className: 'history-item' + (h.id === attempt.id ? ' active' : ''), onclick: () => viewAttempt(h.id) },
          el('span', { className: 'num' }, `#${h.number}`),
          el('span', { className: 'date' }, formatDate(h.submittedAt)),
          h.percent === best ? el('span', { className: 'tag' }, 'Best') : null,
          el('span', { className: 'score' }, `${h.score}/${h.maxScore}`),
          el('span', { className: `pct ${levelTone(h.percent)}` }, `${h.percent}%`)
        )
      )
    )
  );
}

/* ---------------- Reading view ---------------- */

const ReadingView = {
  defaultInstructions: 'Read the passage carefully, then choose the best answer for each question.',
  byTypeTitle: 'Performance by question type',

  emptyAnswers: () => ({}),
  hasContent: (answers) => Object.keys(answers).length > 0,
  toSubmission: (answers) => answers,
  answersFromResult: (result) =>
    Object.fromEntries(result.review.questions.filter((q) => q.userAnswer !== null).map((q) => [q.id, q.userAnswer])),

  listMeta: (exam) => `${exam.paragraphCount} paragraphs · ${exam.questionCount} questions`,
  meta: (exam) =>
    `${exam.paragraphs.length} paragraphs · ${exam.questions.length} questions · ${exam.questions.reduce((s, q) => s + (q.points ?? 1), 0)} marks`,

  progressText(answers) {
    return `Answered ${Object.keys(answers).length} of ${state.exam.questions.length} questions`;
  },

  navItems() {
    const review = state.result?.review.questions ?? [];
    return state.exam.questions.map((q) => ({ id: `q-${q.id}`, status: navStatus(review, q.id, q.id in state.answers) }));
  },

  submitWarning(answers) {
    const answered = Object.keys(answers).length;
    const total = state.exam.questions.length;
    return answered < total ? `You have answered ${answered} of ${total} questions.` : null;
  },

  renderBody() {
    const exam = state.exam;
    $('passage').replaceChildren(
      ...exam.paragraphs.map((p, i) => el('p', {}, el('span', { className: 'para-num' }, `[${i + 1}]`), p.text))
    );
    $('questions').replaceChildren(...exam.questions.map(renderQuestion));
  },

  stats: (summary) => [
    ['Paragraphs', summary.paragraphCount],
    ['Questions', summary.questionCount],
    ['Answers given', summary.answeredCount],
    ['Valid answers', summary.correctCount, 'good'],
    ['Invalid answers', summary.incorrectCount, 'bad'],
    ['Unanswered', summary.unansweredCount, summary.unansweredCount ? 'warn' : ''],
    ['Total mark', `${summary.score}/${summary.maxScore}`]
  ],

  renderReview() {
    $('btn-toggle-answers').textContent = 'Show full answers';
    renderReviewPassage();
    renderAnswerList();
  }
};

function renderQuestion(q) {
  // When reviewing a submitted attempt, mark the correct option and any wrong choice.
  const reviewed = state.submitted ? state.result.review.questions.find((r) => r.id === q.id) : null;
  const optionClass = (i) => {
    if (!reviewed) return '';
    if (i === reviewed.answer) return ' correct';
    return i === reviewed.userAnswer ? ' wrong' : '';
  };

  const options = q.options.map((text, i) => {
    const input = el('input', {
      type: 'radio',
      name: `q-${q.id}`,
      value: String(i),
      checked: state.answers[q.id] === i,
      disabled: state.submitted,
      onchange: () => {
        const wasEmpty = Object.keys(state.answers).length === 0;
        state.answers[q.id] = i;
        refreshOptionStyles(q.id);
        answerChanged(wasEmpty);
      }
    });
    return el('label', {
      className: 'option' + (state.answers[q.id] === i ? ' selected' : '') + (state.submitted ? ' locked' : '') + optionClass(i),
      dataset: { q: q.id }
    }, input, el('span', { className: 'option-letter' }, LETTERS[i] + '.'), el('span', {}, text));
  });

  return el('li', { id: `q-${q.id}` },
    el('div', { className: 'q-text' }, q.text, el('span', { className: 'q-type' }, `(${q.points ?? 1} mark${(q.points ?? 1) > 1 ? 's' : ''})`)),
    options
  );
}

function refreshOptionStyles(questionId) {
  for (const label of document.querySelectorAll(`.option[data-q="${CSS.escape(questionId)}"]`)) {
    label.classList.toggle('selected', label.querySelector('input').checked);
  }
}

function toggleAnswers() {
  const answers = $('answers-view');
  answers.hidden = !answers.hidden;
  $('btn-toggle-answers').textContent = answers.hidden ? 'Show full answers' : 'Hide full answers';
  if (!answers.hidden) answers.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Build a paragraph with <mark> highlights for every evidence quote that
 * points at it. Overlapping quotes are handled by splitting the text at every
 * range boundary and marking each segment with all questions that cover it.
 */
function highlightParagraph(paragraph, questions) {
  const text = paragraph.text;
  const ranges = [];
  for (const q of questions) {
    for (const ev of q.evidence) {
      if (ev.paragraphId !== paragraph.id) continue;
      const start = text.indexOf(ev.quote);
      if (start >= 0) ranges.push({ start, end: start + ev.quote.length, q: q.number });
    }
  }

  const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
  const nodes = [];

  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const segment = text.slice(a, b);
    const covering = ranges.filter((r) => r.start <= a && r.end >= b);

    nodes.push(
      covering.length
        ? el('mark', { dataset: { qs: covering.map((r) => r.q).join(' ') }, title: 'Evidence for ' + covering.map((r) => `Q${r.q}`).join(', ') }, segment)
        : segment
    );

    // Tag the end of each evidence quote with its question number(s).
    for (const r of ranges.filter((r) => r.end === b)) {
      nodes.push(el('span', { className: 'q-tag', onclick: () => focusQuestion(r.q) }, `Q${r.q}`));
    }
  }
  return nodes;
}

function renderReviewPassage() {
  const { paragraphs, questions } = state.result.review;
  $('review-passage').replaceChildren(
    el('h3', {}, 'Passage with main ideas highlighted'),
    ...paragraphs.map((p, i) =>
      el('p', {}, el('span', { className: 'para-num' }, `[${i + 1}]`), ...highlightParagraph(p, questions))
    )
  );
}

function renderAnswerList() {
  const { paragraphs, questions } = state.result.review;
  const paraIndex = new Map(paragraphs.map((p, i) => [p.id, i + 1]));
  const statusText = { correct: 'Valid', incorrect: 'Invalid', unanswered: 'Unanswered' };
  const optionText = (q, i) => (i == null ? '—' : `${LETTERS[i]}. ${q.options[i]}`);

  $('answer-list').replaceChildren(
    ...questions.map((q) =>
      el('li', { className: `answer-card ${q.status}`, dataset: { q: q.number }, onclick: () => focusQuestion(q.number) },
        el('div', { className: 'head' },
          el('strong', {}, `Q${q.number}. ${q.text}`),
          el('span', { className: `status ${q.status}` }, `${statusText[q.status]} · ${q.earned}/${q.points}`)
        ),
        el('div', { className: 'muted answer-line' }, q.typeLabel),
        el('div', { className: 'answer-line' }, el('strong', {}, 'Correct answer:'), optionText(q, q.answer)),
        q.status !== 'correct' ? el('div', { className: 'answer-line' }, el('strong', {}, 'Your answer:'), optionText(q, q.userAnswer)) : null,
        ...q.evidence.map((ev) =>
          el('div', { className: 'evidence' },
            el('div', { className: 'label' }, `Main idea · paragraph ${paraIndex.get(ev.paragraphId)}`),
            el('q', {}, ev.quote)
          )
        ),
        q.explanation ? el('p', { className: 'explanation' }, q.explanation) : null
      )
    )
  );
}

function focusQuestion(number) {
  for (const card of document.querySelectorAll('#answer-list .answer-card')) {
    card.classList.toggle('active', card.dataset.q === String(number));
  }
  let first = null;
  for (const mark of document.querySelectorAll('#review-passage mark')) {
    const hit = mark.dataset.qs.split(' ').includes(String(number));
    mark.classList.toggle('active', hit);
    if (hit && !first) first = mark;
  }
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------------- Init ---------------- */

async function init() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => !tab.disabled && showTab(tab.dataset.tab));
  }
  for (const btn of document.querySelectorAll('.skill-btn')) {
    btn.addEventListener('click', () => selectSkill(btn.dataset.skill));
  }
  $('btn-submit').addEventListener('click', submitTest);
  $('btn-reset').addEventListener('click', resetAnswers);
  $('btn-retake').addEventListener('click', retake);
  $('btn-retake-bar').addEventListener('click', retake);
  $('btn-view-result').addEventListener('click', () => showTab('result'));
  $('btn-toggle-answers').addEventListener('click', toggleAnswers);
  $('level-select').addEventListener('change', (e) => selectLevel(e.target.value));
  initDictionary(); // dictionary.js: double-click / right-click a word to look it up

  state.level = recall(LEVEL_KEY, '');
  const skill = recall(SKILL_KEY, 'reading');

  try {
    state.exams = await window.examApi.listExams();
    selectSkill(skill === 'writing' ? 'writing' : 'reading');
  } catch (err) {
    $('exam-list').replaceChildren(el('li', { className: 'muted' }, `Could not load exams: ${err.message}`));
  }
}

init();
