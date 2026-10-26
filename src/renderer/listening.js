// Listening view: each part has an audio player and its questions. The audio is made by
// the main process from the script with the Windows voices; the script itself only reaches
// this page after submitting, as the transcript in "Show full answers".
// Shared behaviour (answers, navigation, submit warnings) is the reading view's.

const PLAYS_ALLOWED = 2; // per part, in General English tests; Young Learners can replay freely

const audio = { examId: null, parts: {} }; // partId -> { promise, url } for the open exam
const playsUsed = {}; // examId -> { partId: number of plays started }
let players = []; // <audio> elements on screen, paused when the view is re-rendered

function playLimit() {
  return state.exam.group === 'Young Learners' || state.submitted ? Infinity : PLAYS_ALLOWED;
}

// The part's audio as a blob: URL, made once per exam (the main process also caches it on disk).
function loadAudio(partId) {
  if (audio.examId !== state.exam.id) {
    for (const entry of Object.values(audio.parts)) if (entry.url) URL.revokeObjectURL(entry.url);
    audio.examId = state.exam.id;
    audio.parts = {};
  }
  if (!audio.parts[partId]) {
    const entry = {};
    entry.promise = window.examApi.getListeningAudio(state.exam.id, partId).then((bytes) => {
      entry.url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      return entry.url;
    });
    audio.parts[partId] = entry;
  }
  return audio.parts[partId].promise;
}

function stopPlayers() {
  for (const p of players) p.pause();
  players = [];
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function cleanError(err) {
  return String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// A player for one part. With a play limit it has its own controls (no seeking);
// without one (Young Learners, or after submitting) it uses the normal audio controls.
function renderPlayer(part) {
  const examId = state.exam.id;
  const limit = playLimit();
  const player = el('audio', { preload: 'auto', controls: limit === Infinity });
  players.push(player);
  const status = el('span', { className: 'player-status muted' }, 'Preparing audio…');

  if (limit === Infinity) {
    loadAudio(part.id)
      .then((url) => { player.src = url; status.textContent = ''; })
      .catch((err) => { status.textContent = cleanError(err); status.className = 'player-status bad'; });
    return el('div', { className: 'player' }, player, status);
  }

  const used = () => playsUsed[examId]?.[part.id] ?? 0;
  const button = el('button', { className: 'btn btn-primary btn-small play-btn', disabled: true }, '▶ Play');
  const fill = el('div');
  const bar = el('div', { className: 'player-bar' }, fill);
  const time = el('span', { className: 'player-time muted' }, '0:00 / 0:00');

  const update = () => {
    const atStart = player.currentTime === 0 || player.ended;
    const left = limit - used();
    if (!player.paused) button.textContent = '⏸ Pause';
    else if (!atStart) button.textContent = '▶ Continue';
    else button.textContent = left > 0 ? `▶ Play (${left} play${left > 1 ? 's' : ''} left)` : 'No plays left';
    button.disabled = !player.src || (player.paused && atStart && left <= 0);
    fill.style.setProperty('--w', player.duration ? (player.currentTime / player.duration) * 100 : 0);
    time.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
  };

  button.addEventListener('click', () => {
    if (!player.paused) return player.pause();
    if (player.currentTime === 0 || player.ended) {
      if (used() >= limit) return;
      playsUsed[examId] = { ...playsUsed[examId], [part.id]: used() + 1 };
      player.currentTime = 0;
    }
    player.play();
  });
  for (const event of ['play', 'pause', 'timeupdate', 'loadedmetadata']) player.addEventListener(event, update);
  player.addEventListener('ended', () => {
    player.currentTime = 0;
    update();
  });

  loadAudio(part.id)
    .then((url) => { player.src = url; status.textContent = ''; update(); })
    .catch((err) => { status.textContent = cleanError(err); status.className = 'player-status bad'; });

  return el('div', { className: 'player' }, player, button, bar, time, status);
}

const ListeningView = {
  defaultInstructions: 'Read the questions for each part, then press Play and listen. Choose the best answer for each question.',
  byTypeTitle: 'Performance by question type',

  // A new attempt (or cleared answers) also gets its plays back.
  emptyAnswers: () => {
    if (state.exam) delete playsUsed[state.exam.id];
    return {};
  },
  hasContent: (answers) => ReadingView.hasContent(answers),
  toSubmission: (answers) => answers,
  answersFromResult: (result) => ReadingView.answersFromResult(result),
  progressText: (answers) => ReadingView.progressText(answers),
  navItems: () => ReadingView.navItems(),
  submitWarning: (answers) => ReadingView.submitWarning(answers),

  listMeta: (exam) => `${exam.partCount} parts · ${exam.questionCount} questions · ~${exam.minutes} min`,
  meta: (exam) =>
    `${exam.parts.length} parts · ${exam.questions.length} questions · ${exam.questions.reduce((s, q) => s + (q.points ?? 1), 0)} marks`,

  renderBody() {
    stopPlayers();
    const exam = state.exam;
    const limit = playLimit();
    const rule = state.submitted
      ? 'Test submitted: you can listen again as many times as you like.'
      : limit === Infinity
        ? 'You can listen as many times as you like.'
        : `You can play each part ${PLAYS_ALLOWED} times, like in a real exam. You can pause.`;
    let number = 0;
    $('listening-rule').textContent = rule;
    $('listening-parts').replaceChildren(
      ...exam.parts.map((part) => {
        const questions = exam.questions.filter((q) => q.partId === part.id);
        const start = number + 1;
        number += questions.length;
        return el('section', { className: 'card listening-part' },
          el('h3', {}, part.title),
          part.intro ? el('p', { className: 'part-intro' }, part.intro) : null,
          renderPlayer(part),
          el('ol', { className: 'questions', start }, questions.map(renderQuestion))
        );
      })
    );
  },

  stats: (summary) => [
    ['Parts', summary.partCount],
    ['Questions', summary.questionCount],
    ['Answers given', summary.answeredCount],
    ['Valid answers', summary.correctCount, 'good'],
    ['Invalid answers', summary.incorrectCount, 'bad'],
    ['Unanswered', summary.unansweredCount, summary.unansweredCount ? 'warn' : ''],
    ['Total mark', `${summary.score}/${summary.maxScore}`]
  ],

  // "Show full answers": the transcript of each part with its audio, answers highlighted.
  renderReview() {
    $('btn-toggle-answers').textContent = 'Show full answers';
    const { paragraphs, questions, parts } = state.result.review;
    $('review-passage').replaceChildren(
      el('h3', {}, 'Transcript with answers highlighted'),
      ...parts.map((part) => {
        const player = el('audio', { controls: true, preload: 'none' });
        loadAudio(part.id).then((url) => { player.src = url; }).catch(() => player.remove());
        return el('section', { className: 'transcript-part' },
          el('h4', {}, part.title),
          player,
          ...paragraphs.filter((p) => p.partId === part.id).map((p) => el('p', { className: 'transcript-line' }, ...highlightParagraph(p, questions)))
        );
      })
    );
    const partTitle = new Map(parts.map((p) => [p.id, p.title]));
    const linePart = new Map(paragraphs.map((p) => [p.id, p.partId]));
    renderAnswerList((ev) => `Heard in ${partTitle.get(linePart.get(ev.paragraphId))}`);
  }
};
