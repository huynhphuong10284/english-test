// Loads exam JSON files from disk and validates their structure.
// data/reading/*.json are reading exams, data/writing/*.json are writing exams.

const fs = require('fs');
const path = require('path');
const { normalizeAnswer, containsKeyword, tokens, countWords } = require('./text-utils');

const SKILLS = ['reading', 'writing'];
const QUESTION_TYPES = ['main-idea', 'detail', 'inference', 'vocabulary', 'purpose'];
const EXERCISE_TYPES = ['choice', 'gap-fill', 'word-order', 'error-correction', 'transformation'];

function failer(file) {
  return (msg) => {
    throw new Error(`${file}: ${msg}`);
  };
}

function validateCommon(exam, fail) {
  if (!exam.id) fail('missing "id"');
  if (!exam.title) fail('missing "title"');
  if (!exam.level) fail('missing "level"');
}

function validateExam(exam, file) {
  const fail = failer(file);
  validateCommon(exam, fail);
  if (!Array.isArray(exam.paragraphs) || exam.paragraphs.length === 0) fail('"paragraphs" must be a non-empty array');
  if (!Array.isArray(exam.questions) || exam.questions.length === 0) fail('"questions" must be a non-empty array');

  const paragraphs = new Map(exam.paragraphs.map((p) => [p.id, p]));
  if (paragraphs.size !== exam.paragraphs.length) fail('paragraph ids must be unique');
  if (new Set(exam.questions.map((q) => q.id)).size !== exam.questions.length) fail('question ids must be unique');

  for (const q of exam.questions) {
    const where = `question "${q.id}"`;
    if (!QUESTION_TYPES.includes(q.type)) fail(`${where}: "type" must be one of ${QUESTION_TYPES.join(', ')}`);
    if (!Array.isArray(q.options) || q.options.length < 2) fail(`${where}: needs at least 2 options`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) fail(`${where}: invalid "answer" index`);

    // Every evidence quote must appear verbatim in its paragraph so it can be highlighted.
    for (const ev of q.evidence ?? []) {
      const paragraph = paragraphs.get(ev.paragraphId);
      if (!paragraph) fail(`${where}: unknown paragraphId "${ev.paragraphId}"`);
      if (!paragraph.text.includes(ev.quote)) fail(`${where}: evidence quote not found in paragraph "${ev.paragraphId}": "${ev.quote}"`);
    }
  }
}

function validateWritingExam(exam, file) {
  const fail = failer(file);
  validateCommon(exam, fail);
  if (!exam.id.startsWith('w-')) fail('writing exam ids must start with "w-"');
  if (!Array.isArray(exam.exercises) || exam.exercises.length === 0) fail('"exercises" must be a non-empty array');

  const ids = new Set();
  for (const ex of exam.exercises) {
    const where = `exercise "${ex.id}"`;
    if (!ex.id || ids.has(ex.id)) fail(`${where}: missing or duplicate id`);
    ids.add(ex.id);
    if (!EXERCISE_TYPES.includes(ex.type)) fail(`${where}: "type" must be one of ${EXERCISE_TYPES.join(', ')}`);
    if (!ex.prompt) fail(`${where}: missing "prompt"`);

    if (ex.type === 'choice') {
      if (!Array.isArray(ex.options) || ex.options.length < 2) fail(`${where}: needs at least 2 options`);
      if (!Number.isInteger(ex.answer) || ex.answer < 0 || ex.answer >= ex.options.length) fail(`${where}: invalid "answer" index`);
      continue;
    }

    // Typed exercises: one or more accepted answers, compared ignoring case and punctuation.
    if (!Array.isArray(ex.answers) || ex.answers.length === 0 || ex.answers.some((a) => !normalizeAnswer(a))) {
      fail(`${where}: "answers" must be a non-empty array of strings`);
    }

    if (ex.type === 'gap-fill' && !ex.text?.includes('___')) fail(`${where}: "text" must contain ___ for the gap`);

    if (ex.type === 'error-correction') {
      if (!ex.text) fail(`${where}: missing "text" (the sentence with the mistake)`);
      if (ex.answers.some((a) => normalizeAnswer(a) === normalizeAnswer(ex.text))) fail(`${where}: an answer is identical to the incorrect sentence`);
    }

    if (ex.type === 'word-order') {
      // The answer must use exactly the given words, so the puzzle is solvable.
      if (!Array.isArray(ex.words) || ex.words.length < 3) fail(`${where}: "words" needs at least 3 items`);
      const given = ex.words.flatMap(tokens).sort().join(' ');
      for (const a of ex.answers) {
        if (tokens(a).sort().join(' ') !== given) fail(`${where}: answer "${a}" does not use exactly the given words`);
      }
      if (ex.answers.some((a) => normalizeAnswer(a) === ex.words.flatMap(tokens).join(' '))) fail(`${where}: "words" must be scrambled`);
    }

    if (ex.type === 'transformation') {
      if (!ex.text || !ex.keyword) fail(`${where}: needs "text" (original sentence) and "keyword"`);
      for (const a of ex.answers) {
        if (!containsKeyword(a, ex.keyword)) fail(`${where}: answer "${a}" does not contain the keyword "${ex.keyword}"`);
      }
    }
  }

  const t = exam.task;
  if (!t) fail('missing "task"');
  if (!t.genre || !t.prompt) fail('task: needs "genre" and "prompt"');
  if (!Array.isArray(t.contentPoints) || t.contentPoints.length === 0) fail('task: "contentPoints" must be a non-empty array');
  if (!Number.isInteger(t.minWords) || !Number.isInteger(t.maxWords) || t.minWords >= t.maxWords) fail('task: invalid "minWords"/"maxWords"');
  if (!t.modelAnswer) fail('task: missing "modelAnswer"');
  const words = countWords(t.modelAnswer);
  if (words < t.minWords || words > t.maxWords) fail(`task: model answer has ${words} words, outside ${t.minWords}-${t.maxWords}`);
}

// Loads data/<skill>/*.json for every skill into one Map keyed by exam id.
// strict (default): the first invalid file throws. Not strict (used by the app):
// invalid files are skipped and reported to onError, so one bad file can't stop the app.
function loadExams(dataDir, { strict = true, onError = () => {} } = {}) {
  const exams = new Map();
  for (const skill of SKILLS) {
    const dir = path.join(dataDir, skill);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        let exam;
        try {
          exam = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        } catch (err) {
          throw new Error(`${skill}/${file}: invalid JSON (${err.message})`);
        }
        (skill === 'writing' ? validateWritingExam : validateExam)(exam, `${skill}/${file}`);
        if (exams.has(exam.id)) throw new Error(`${skill}/${file}: duplicate exam id "${exam.id}"`);
        exams.set(exam.id, { ...exam, skill });
      } catch (err) {
        if (strict) throw err;
        onError(err);
      }
    }
  }
  return exams;
}

// Strip the answer key, explanations, evidence and model answer before sending to the renderer.
function toPublicExam(exam) {
  const base = {
    id: exam.id,
    skill: exam.skill,
    title: exam.title,
    level: exam.level,
    description: exam.description,
    instructions: exam.instructions
  };

  if (exam.skill === 'writing') {
    const { modelAnswer, ...task } = exam.task;
    return {
      ...base,
      exercises: exam.exercises.map(({ answer, answers, explanation, ...ex }) => ({ ...ex, points: ex.points ?? 1 })),
      task
    };
  }

  return {
    ...base,
    paragraphs: exam.paragraphs,
    questions: exam.questions.map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      options: q.options,
      points: q.points ?? 1
    }))
  };
}

module.exports = { loadExams, validateExam, validateWritingExam, toPublicExam, SKILLS };
