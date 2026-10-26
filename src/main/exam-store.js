// Loads exam JSON files from disk and validates their structure.
// data/reading/*.json are reading exams, data/writing/*.json writing exams, data/listening/*.json listening exams.

const fs = require('fs');
const path = require('path');
const { normalizeAnswer, containsKeyword, tokens, countWords } = require('./text-utils');
const { LISTENING_TYPES } = require('./listening-grader');

const SKILLS = ['reading', 'writing', 'listening'];
const VOICES = ['male', 'female'];
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
  if (exam.group !== undefined && (typeof exam.group !== 'string' || !exam.group)) fail('"group" must be a non-empty string when given');
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

// Listening: parts with a script (read aloud by the Windows voices), and questions like reading,
// each belonging to a part, whose evidence quotes point at script lines.
function validateListeningExam(exam, file) {
  const fail = failer(file);
  validateCommon(exam, fail);
  if (!exam.id.startsWith('l-')) fail('listening exam ids must start with "l-"');
  if (!Array.isArray(exam.parts) || exam.parts.length === 0) fail('"parts" must be a non-empty array');
  if (!Array.isArray(exam.questions) || exam.questions.length === 0) fail('"questions" must be a non-empty array');

  const parts = new Map();
  const lines = new Map(); // line id -> { line, partId }
  for (const part of exam.parts) {
    const where = `part "${part.id}"`;
    if (!part.id || parts.has(part.id)) fail(`${where}: missing or duplicate id`);
    if (!part.title) fail(`${where}: missing "title"`);
    parts.set(part.id, part);
    const speakers = part.speakers ?? {};
    if (Object.keys(speakers).length === 0) fail(`${where}: "speakers" must name at least one speaker`);
    for (const [name, voice] of Object.entries(speakers)) {
      if (!VOICES.includes(voice)) fail(`${where}: speaker "${name}" must have voice "male" or "female"`);
    }
    // There is one male and one female voice, so two speakers of the same voice would sound the same.
    for (const voice of VOICES) {
      const same = Object.keys(speakers).filter((n) => speakers[n] === voice);
      if (same.length > 1) fail(`${where}: ${same.join(' and ')} both use the ${voice} voice; use at most one ${voice} speaker per part`);
    }
    if (!Array.isArray(part.script) || part.script.length === 0) fail(`${where}: "script" must be a non-empty array`);
    for (const line of part.script) {
      if (!line.id || lines.has(line.id)) fail(`${where}: script line "${line.id}" has a missing or duplicate id`);
      if (!(line.speaker in speakers)) fail(`${where}: line "${line.id}" has unknown speaker "${line.speaker}"`);
      if (!line.text?.trim()) fail(`${where}: line "${line.id}" has no text`);
      lines.set(line.id, { line, partId: part.id });
    }
  }

  if (new Set(exam.questions.map((q) => q.id)).size !== exam.questions.length) fail('question ids must be unique');
  const partOrder = [...parts.keys()];
  let lastPart = 0;
  for (const q of exam.questions) {
    const where = `question "${q.id}"`;
    if (!parts.has(q.partId)) fail(`${where}: unknown partId "${q.partId}"`);
    const partIndex = partOrder.indexOf(q.partId);
    if (partIndex < lastPart) fail(`${where}: questions must be listed part by part`);
    lastPart = partIndex;
    if (!LISTENING_TYPES.includes(q.type)) fail(`${where}: "type" must be one of ${LISTENING_TYPES.join(', ')}`);
    if (!Array.isArray(q.options) || q.options.length < 2) fail(`${where}: needs at least 2 options`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) fail(`${where}: invalid "answer" index`);
    if (!Array.isArray(q.evidence) || q.evidence.length === 0) fail(`${where}: needs "evidence" (where the answer is heard)`);
    for (const ev of q.evidence) {
      const found = lines.get(ev.lineId);
      if (!found) fail(`${where}: unknown lineId "${ev.lineId}"`);
      if (found.partId !== q.partId) fail(`${where}: evidence line "${ev.lineId}" is not in part "${q.partId}"`);
      if (!found.line.text.includes(ev.quote)) fail(`${where}: evidence quote not found in line "${ev.lineId}": "${ev.quote}"`);
    }
  }
}

const VALIDATORS = { reading: validateExam, writing: validateWritingExam, listening: validateListeningExam };

// Loads data/<skill>/*.json for every skill into one Map keyed by exam id.
// dataDirs: one data folder, or several (bundled exams, then downloaded updates):
// a file in a later folder replaces the file with the same name in an earlier one.
// strict (default): the first invalid file throws. Not strict (used by the app):
// invalid files are skipped and reported to onError, so one bad file can't stop the app.
function loadExams(dataDirs, { strict = true, onError = () => {} } = {}) {
  const exams = new Map();
  for (const skill of SKILLS) {
    const files = new Map(); // file name -> full path
    for (const dataDir of [dataDirs].flat()) {
      const dir = path.join(dataDir, skill);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) files.set(file, path.join(dir, file));
    }
    for (const file of [...files.keys()].sort()) {
      try {
        let exam;
        try {
          exam = JSON.parse(fs.readFileSync(files.get(file), 'utf8'));
        } catch (err) {
          throw new Error(`${skill}/${file}: invalid JSON (${err.message})`);
        }
        VALIDATORS[skill](exam, `${skill}/${file}`);
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
    group: exam.group,
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

  if (exam.skill === 'listening') {
    // The script stays in the main process: the learner only hears it until they submit.
    return {
      ...base,
      parts: exam.parts.map((p) => ({ id: p.id, title: p.title, intro: p.intro ?? '', speakers: Object.keys(p.speakers) })),
      questions: exam.questions.map((q) => ({ id: q.id, partId: q.partId, type: q.type, text: q.text, options: q.options, points: q.points ?? 1 }))
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

module.exports = { loadExams, validateExam, validateWritingExam, validateListeningExam, VALIDATORS, toPublicExam, SKILLS };
