// Writing view: Part 1 auto-marked exercises + Part 2 free-writing task.
// Loaded before renderer.js; uses its shared helpers ($, el, state, answerChanged...) at call time.
//
// Draft answers: { exercises: { [id]: string | optionIndex }, order: { [id]: [wordIndex] }, essay: string }
// ("order" only remembers which word chips were clicked for word-order exercises.)

const RATING_LABELS = ['Not yet', 'Partly', 'Fully'];

// Same rule as countWords in src/main/text-utils.js (the renderer cannot require Node modules).
function countWords(text) {
  return (String(text ?? '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

const WritingView = {
  defaultInstructions: 'Do the exercises in Part 1, then write your text in Part 2.',
  byTypeTitle: 'Performance by exercise type',

  emptyAnswers: () => ({ exercises: {}, order: {}, essay: '' }),
  hasContent: (a) => Object.keys(a.exercises ?? {}).length > 0 || Boolean(a.essay?.trim()),
  toSubmission: (a) => ({ exercises: a.exercises, essay: a.essay }),
  answersFromResult: (result) => ({
    exercises: Object.fromEntries(result.review.exercises.filter((e) => e.userAnswer !== null).map((e) => [e.id, e.userAnswer])),
    order: {},
    essay: result.review.essay
  }),

  listMeta: (exam) => `${exam.genre} · ${exam.exerciseCount} exercises · ${exam.minWords}–${exam.maxWords} words`,
  meta: (exam) => `${exam.exercises.length} exercises · ${exam.task.genre} · ${exam.task.minWords}–${exam.task.maxWords} words`,

  progressText(a) {
    return `Exercises ${Object.keys(a.exercises).length} of ${state.exam.exercises.length} · ${countWords(a.essay)} words written`;
  },

  navItems() {
    const review = state.result?.review.exercises ?? [];
    return state.exam.exercises.map((ex) => ({ id: `ex-${ex.id}`, status: navStatus(review, ex.id, ex.id in state.answers.exercises) }));
  },

  submitWarning(a) {
    const problems = [];
    const done = Object.keys(a.exercises).length;
    const total = state.exam.exercises.length;
    const words = countWords(a.essay);
    const { minWords, maxWords } = state.exam.task;
    if (done < total) problems.push(`You have answered ${done} of ${total} exercises.`);
    if (words === 0) problems.push('You have not written your text in Part 2.');
    else if (words < minWords || words > maxWords) problems.push(`Your text has ${words} words (target ${minWords}–${maxWords}).`);
    return problems.length ? problems.join(' ') : null;
  },

  renderBody() {
    $('exercises').replaceChildren(...state.exam.exercises.map(renderExercise));
    renderTask();
  },

  stats(s) {
    const inRange = state.result.review.checks.inRange;
    return [
      ['Exercises', s.exerciseCount],
      ['Correct', s.correctCount, 'good'],
      ['Wrong', s.incorrectCount, 'bad'],
      ['Unanswered', s.unansweredCount, s.unansweredCount ? 'warn' : ''],
      ['Exercise mark', `${s.exerciseScore}/${s.exerciseMax}`],
      ['Words written', s.wordCount, inRange ? 'good' : 'warn'],
      ['Writing (self-check)', s.selfAssessed ? `${s.writingScore}/${s.writingMax}` : 'Not rated', s.selfAssessed ? '' : 'warn'],
      ['Total mark', `${s.score}/${s.maxScore}`]
    ];
  },

  renderReview() {
    renderSelfCheck();
    renderEssayCompare();
    renderExerciseReview();
  }
};

/* ---------------- Part 1: exercises (test tab) ---------------- */

function setExerciseAnswer(id, value) {
  const wasEmpty = !WritingView.hasContent(state.answers);
  if (value === null || value === '') delete state.answers.exercises[id];
  else state.answers.exercises[id] = value;
  answerChanged(wasEmpty);
}

function rerenderExercise(ex) {
  $(`ex-${ex.id}`).replaceWith(renderExercise(ex));
}

function renderExercise(ex) {
  // When reviewing a submitted attempt, show the result of each exercise.
  const reviewed = state.submitted ? state.result.review.exercises.find((r) => r.id === ex.id) : null;
  return el('li', { id: `ex-${ex.id}`, className: 'exercise' + (reviewed ? ` ${reviewed.status}` : '') },
    el('div', { className: 'q-text' }, ex.prompt, ex.focus ? el('span', { className: 'q-type' }, ex.focus) : null),
    EXERCISE_INPUTS[ex.type](ex, reviewed),
    reviewed && reviewed.status !== 'correct' ? el('div', { className: 'inline-answer' }, 'Correct answer: ', correctAnswerText(reviewed)) : null
  );
}

function typedInput(ex, reviewed, props = {}) {
  const value = state.answers.exercises[ex.id] ?? props.initial ?? '';
  return el('input', {
    type: 'text',
    className: props.className ?? 'line-input',
    value,
    placeholder: props.placeholder ?? '',
    disabled: state.submitted,
    spellcheck: false,
    oninput: (e) => {
      const v = e.target.value;
      // An error-correction sentence left exactly as given counts as not answered.
      setExerciseAnswer(ex.id, v.trim() && v !== props.initial ? v : null);
    }
  });
}

const EXERCISE_INPUTS = {
  choice(ex, reviewed) {
    const optionClass = (i) => {
      if (!reviewed) return '';
      if (i === reviewed.answer) return ' correct';
      return i === reviewed.userAnswer ? ' wrong' : '';
    };
    return [
      ex.text ? el('div', { className: 'ex-sentence' }, ex.text) : null,
      ...ex.options.map((text, i) =>
        el('label', {
          className: 'option' + (state.answers.exercises[ex.id] === i ? ' selected' : '') + (state.submitted ? ' locked' : '') + optionClass(i),
          dataset: { q: ex.id }
        },
          el('input', {
            type: 'radio',
            name: `ex-${ex.id}`,
            checked: state.answers.exercises[ex.id] === i,
            disabled: state.submitted,
            onchange: () => {
              setExerciseAnswer(ex.id, i);
              refreshOptionStyles(ex.id);
            }
          }),
          el('span', { className: 'option-letter' }, LETTERS[i] + '.'),
          el('span', {}, text)
        )
      )
    ];
  },

  'gap-fill'(ex, reviewed) {
    const [before, ...rest] = ex.text.split('___');
    return el('div', { className: 'ex-sentence' },
      before,
      typedInput(ex, reviewed, { className: 'gap-input' + statusClass(reviewed), placeholder: '...' }),
      rest.join('___')
    );
  },

  'error-correction'(ex, reviewed) {
    return [
      el('div', { className: 'ex-sentence wrong-sentence' }, ex.text),
      typedInput(ex, reviewed, { initial: ex.text, className: 'line-input' + statusClass(reviewed) })
    ];
  },

  transformation(ex, reviewed) {
    return [
      el('div', { className: 'ex-sentence' }, ex.text),
      el('div', { className: 'keyword' }, 'Use the word: ', el('strong', {}, ex.keyword.toUpperCase())),
      typedInput(ex, reviewed, { className: 'line-input' + statusClass(reviewed), placeholder: 'Write the new sentence here' })
    ];
  },

  'word-order'(ex, reviewed) {
    if (state.submitted) {
      // reviewed is undefined for exercises added after an older attempt was made.
      return el('div', { className: 'ex-sentence' + statusClass(reviewed) }, reviewed?.userAnswer ?? '(no answer)');
    }
    const chosen = (state.answers.order[ex.id] ??= []);
    const update = () => {
      setExerciseAnswer(ex.id, chosen.length ? chosen.map((i) => ex.words[i]).join(' ') : null);
      rerenderExercise(ex);
    };
    return [
      el('div', { className: 'word-line', title: 'Click a word to remove it' },
        chosen.length
          ? chosen.map((i, pos) => el('button', { className: 'chip chip-used', onclick: () => { chosen.splice(pos, 1); update(); } }, ex.words[i]))
          : el('span', { className: 'muted' }, 'Click the words below in the right order.')
      ),
      el('div', { className: 'word-pool' },
        ex.words.map((w, i) =>
          chosen.includes(i) ? null : el('button', { className: 'chip', onclick: () => { chosen.push(i); update(); } }, w)
        )
      )
    ];
  }
};

function statusClass(reviewed) {
  return reviewed ? ` ${reviewed.status}` : '';
}

function correctAnswerText(e) {
  if (e.type === 'choice') return `${LETTERS[e.answer]}. ${e.options[e.answer]}`;
  return e.answers[0];
}

function userAnswerText(e) {
  if (e.userAnswer === null) return '—';
  if (e.type === 'choice') return `${LETTERS[e.userAnswer]}. ${e.options[e.userAnswer]}`;
  return e.userAnswer;
}

/* ---------------- Part 2: writing task (test tab) ---------------- */

function renderTask() {
  const t = state.exam.task;
  const textarea = el('textarea', {
    id: 'essay-input',
    className: 'essay-input',
    rows: 12,
    value: state.answers.essay ?? '',
    readOnly: state.submitted,
    spellcheck: false,
    placeholder: 'Write your text here. Press Enter twice to start a new paragraph.',
    oninput: (e) => {
      const wasEmpty = !WritingView.hasContent(state.answers);
      state.answers.essay = e.target.value;
      updateWordCount();
      answerChanged(wasEmpty);
    }
  });

  $('task').replaceChildren(
    el('div', { className: 'task-head' },
      el('span', { className: 'badge' }, t.genre),
      el('span', { className: 'muted' }, `${t.minWords}–${t.maxWords} words`)
    ),
    el('p', { className: 'task-prompt' }, t.prompt),
    el('div', { className: 'task-points' }, el('strong', {}, 'In your text, you should:'), el('ul', {}, t.contentPoints.map((p) => el('li', {}, p)))),
    t.usefulLanguage?.length
      ? el('div', { className: 'useful' }, el('strong', {}, 'Useful language: '), t.usefulLanguage.map((p) => el('span', { className: 'chip chip-static' }, p)))
      : null,
    textarea,
    el('div', { id: 'word-count', className: 'word-count' })
  );
  updateWordCount();
}

function updateWordCount() {
  const { minWords, maxWords } = state.exam.task;
  const n = countWords(state.answers.essay);
  const tone = n === 0 ? '' : n < minWords ? 'warn' : n > maxWords ? 'bad' : 'good';
  $('word-count').className = `word-count ${tone}`;
  $('word-count').textContent = `${n} word${n === 1 ? '' : 's'} · target ${minWords}–${maxWords}`;
}

/* ---------------- Result tab: self-check, text vs model, exercise review ---------------- */

// Ratings being edited for the attempt on screen (saved only when the learner clicks Save).
let pendingRating = null;

function renderSelfCheck() {
  const { review, summary, attempt } = state.result;
  if (pendingRating?.attemptId !== attempt.id) {
    pendingRating = { attemptId: attempt.id, values: { ...(review.selfAssessment ?? {}) } };
  }
  const values = pendingRating.values;
  const complete = review.rubric.every((r) => Number.isInteger(values[r.id]));
  const changed = review.rubric.some((r) => values[r.id] !== review.selfAssessment?.[r.id]);
  const total = review.rubric.reduce((sum, r) => sum + (values[r.id] ?? 0), 0);

  $('self-check').classList.toggle('pending', !review.selfAssessment);
  $('self-check').replaceChildren(
    el('h3', {}, 'Part 2 · Self-check your writing'),
    el('p', { className: 'muted self-check-intro' },
      review.selfAssessment
        ? `Your rating: ${summary.writingScore}/${summary.writingMax}. You can change it at any time.`
        : 'Compare your text with the model answer below, then rate each point honestly. Your rating is added to your total mark.'
    ),
    el('div', { className: 'rubric' },
      review.rubric.map((r) =>
        el('div', { className: 'rubric-row' },
          el('div', { className: 'rubric-text' },
            el('strong', {}, r.label),
            el('span', { className: 'muted' }, r.description),
            r.id === 'content' ? el('ul', { className: 'rubric-points' }, review.task.contentPoints.map((p) => el('li', {}, p))) : null
          ),
          el('div', { className: 'rating', role: 'radiogroup', ariaLabel: r.label },
            RATING_LABELS.map((label, v) =>
              el('button', {
                className: 'rate-btn' + (values[r.id] === v ? ' active' : ''),
                role: 'radio',
                ariaChecked: String(values[r.id] === v),
                onclick: () => {
                  values[r.id] = v;
                  renderSelfCheck();
                }
              }, `${v} · ${label}`)
            )
          )
        )
      )
    ),
    el('div', { className: 'self-check-actions' },
      el('button', { className: 'btn btn-primary', disabled: !complete || !changed, onclick: saveRating }, review.selfAssessment ? 'Update rating' : 'Save rating'),
      el('span', { className: 'muted' }, complete ? `Writing score: ${total}/${summary.writingMax}` : 'Rate every point to save.')
    )
  );
}

async function saveRating() {
  state.result = await window.examApi.assessWriting(state.exam.id, state.result.attempt.id, pendingRating.values);
  renderResult();
  updateProgress();
  await refreshExamList(); // best / last score may have changed
}

function renderEssayCompare() {
  const { essay, checks, task } = state.result.review;
  const chip = (text, tone, title) => el('span', { className: `check ${tone}`, title: title ?? '' }, text);

  $('essay-checks').replaceChildren(
    chip(`${checks.wordCount} words · target ${checks.minWords}–${checks.maxWords}`, checks.inRange ? 'good' : 'warn'),
    chip(`${checks.paragraphs} paragraph${checks.paragraphs === 1 ? '' : 's'}`, ''),
    chip(`${checks.linkers.length} linking word${checks.linkers.length === 1 ? '' : 's'}`, checks.linkers.length >= 3 ? 'good' : 'warn', checks.linkers.join(', ')),
    checks.usefulUsed.length ? chip(`${checks.usefulUsed.length} useful phrase${checks.usefulUsed.length === 1 ? '' : 's'} used`, 'good', checks.usefulUsed.join('\n')) : null,
    checks.linkers.length ? el('div', { className: 'muted linkers' }, `Linking words: ${checks.linkers.join(', ')}`) : null
  );
  $('essay-text').textContent = essay.trim() ? essay : '(You did not write anything.)';
  $('model-answer').textContent = task.modelAnswer;
}

function renderExerciseReview() {
  const statusText = { correct: 'Correct', incorrect: 'Wrong', unanswered: 'Unanswered' };
  const questionText = (e) => {
    if (e.type === 'word-order') return `Words: ${e.words.join(' / ')}`;
    if (e.type === 'transformation') return `${e.text}  (use: ${e.keyword.toUpperCase()})`;
    return e.text;
  };

  $('exercise-review').replaceChildren(
    ...state.result.review.exercises.map((e) =>
      el('li', { className: `answer-card ${e.status}` },
        el('div', { className: 'head' },
          el('strong', {}, `${e.number}. ${e.prompt}`),
          el('span', { className: `status ${e.status}` }, `${statusText[e.status]} · ${e.earned}/${e.points}`)
        ),
        el('div', { className: 'muted answer-line' }, e.typeLabel + (e.focus ? ` · ${e.focus}` : '')),
        questionText(e) ? el('div', { className: 'evidence' }, questionText(e)) : null,
        el('div', { className: 'answer-line' }, el('strong', {}, 'Your answer:'), userAnswerText(e)),
        el('div', { className: 'answer-line' }, el('strong', {}, 'Correct answer:'), correctAnswerText(e)),
        e.answers?.length > 1 ? el('div', { className: 'answer-line muted' }, el('strong', {}, 'Also accepted:'), e.answers.slice(1).join(' · ')) : null,
        e.explanation ? el('p', { className: 'explanation' }, e.explanation) : null
      )
    )
  );
}
