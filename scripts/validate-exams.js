// Validates every reading, writing and listening exam and runs a sample grading pass.
// Usage: npm run validate

const path = require('path');
const { loadExams } = require('../src/main/exam-store');
const { gradeExam } = require('../src/main/grader');
const { gradeWriting } = require('../src/main/writing-grader');
const { gradeListening } = require('../src/main/listening-grader');
const { Dictionary } = require('../src/main/dictionary');

const dir = path.join(__dirname, '..', 'data');
// Questions per reading or listening exam, exercises per writing exam. Young children get shorter exams.
const ITEMS_PER_EXAM = 20;
const YOUNG_LEARNER_ITEMS = { Starters: 10, Movers: 15, Flyers: 20 };

function expectedItems(exam) {
  if (exam.group !== 'Young Learners') return ITEMS_PER_EXAM;
  const name = Object.keys(YOUNG_LEARNER_ITEMS).find((n) => exam.level.startsWith(n));
  if (!name) throw new Error(`${exam.id}: Young Learners level must start with ${Object.keys(YOUNG_LEARNER_ITEMS).join(', ')}`);
  return YOUNG_LEARNER_ITEMS[name];
}

// The perfect submission for an exam, using its answer key (and the model answer for writing).
function perfectRun(exam) {
  if (exam.skill === 'writing') {
    const exercises = Object.fromEntries(exam.exercises.map((e) => [e.id, e.type === 'choice' ? e.answer : e.answers[0]]));
    const full = { content: 2, organisation: 2, grammar: 2, vocabulary: 2 };
    return gradeWriting(exam, { exercises, essay: exam.task.modelAnswer }, full);
  }
  const answers = Object.fromEntries(exam.questions.map((q) => [q.id, q.answer]));
  return exam.skill === 'listening' ? gradeListening(exam, answers) : gradeExam(exam, answers);
}

function describe(exam, result) {
  if (exam.skill === 'writing') {
    return `${exam.exercises.length} exercises, ${exam.task.genre}, ${exam.task.minWords}-${exam.task.maxWords} words`;
  }
  if (exam.skill === 'listening') {
    const words = exam.parts.flatMap((p) => p.script).reduce((n, l) => n + l.text.split(' ').length, 0);
    return `${exam.parts.length} parts, ${exam.questions.length} questions, ${words} words of script`;
  }
  return `${exam.paragraphs.length} paragraphs, ${exam.questions.length} questions, ${result.summary.maxScore} marks`;
}

// Information only: words in exam texts that the dictionary popup cannot explain.
// Names are skipped (capitalised in the middle of a sentence). Add useful words to data/dictionary/supplement.json.
function reportMissingWords(exams) {
  const dictDir = path.join(dir, 'dictionary');
  let dictionary;
  try {
    dictionary = new Dictionary(path.join(dictDir, 'wordnet.json'), path.join(dictDir, 'supplement.json'), path.join(dictDir, 'vi.json'));
    dictionary.load();
  } catch {
    console.log('\nDictionary not built yet: run "npm run build:dict" to check word coverage.');
    return;
  }
  const missing = new Map(); // no dictionary entry at all
  const noVietnamese = new Map(); // base word -> exam ids, for words found but without a Vietnamese meaning
  const note = (map, key, id) => map.set(key, [...(map.get(key) ?? []), id]);
  for (const exam of exams.values()) {
    const texts =
      exam.skill === 'writing' ? [exam.task.modelAnswer]
        : exam.skill === 'listening' ? exam.parts.flatMap((p) => p.script.map((l) => l.text))
          : exam.paragraphs.map((p) => p.text);
    for (const text of texts) {
      for (const m of text.matchAll(/\p{L}+(?:['’-]\p{L}+)*/gu)) {
        const word = m[0];
        const before = text.slice(0, m.index).trimEnd();
        const nameLike = /^\p{Lu}/u.test(word) && before && !/[.!?:"]$/.test(before);
        if (nameLike) continue;
        const { entries } = dictionary.lookup(word);
        if (!entries.length) note(missing, word.toLowerCase(), exam.id);
        else if (!entries.some((e) => e.vi)) note(noVietnamese, entries[0].lemma, exam.id);
      }
    }
  }
  const list = (map) => [...map].sort().forEach(([word, ids]) => console.log(`    ${word.padEnd(24)} ${[...new Set(ids)].join(', ')}`));
  if (missing.size === 0) console.log('\nDictionary: every word in the exam texts can be looked up.');
  else {
    console.log(`\nDictionary: ${missing.size} word(s) in exam texts have no entry (add useful ones to data/dictionary/supplement.json):`);
    list(missing);
  }
  if (noVietnamese.size === 0) console.log('Vietnamese: every word in the exam texts has a Vietnamese meaning.');
  else {
    console.log(`\nVietnamese: ${noVietnamese.size} word(s) have no Vietnamese meaning yet (add them to data/dictionary/vi.json):`);
    list(noVietnamese);
  }
}

try {
  const exams = loadExams(dir);
  for (const exam of exams.values()) {
    const items = exam.skill === 'writing' ? exam.exercises.length : exam.questions.length;
    const expected = expectedItems(exam);
    if (items !== expected) throw new Error(`${exam.id}: has ${items} ${exam.skill === 'writing' ? 'exercises' : 'questions'}, expected ${expected}`);
    const result = perfectRun(exam);
    if (result.summary.percent !== 100) throw new Error(`${exam.id}: answer key does not grade to 100%`);
    console.log(`OK  ${exam.skill.padEnd(8)} ${exam.id.padEnd(40)} ${describe(exam, result)}`);
  }
  console.log(`\n${exams.size} exam(s) valid.`);

  const counts = new Map();
  for (const exam of exams.values()) {
    const key = `${exam.skill.padEnd(8)} ${exam.group ?? 'General English'} · ${exam.level}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...counts].sort()) console.log(`    ${key.padEnd(34)} ${n} exam(s)`);

  reportMissingWords(exams);
} catch (err) {
  console.error(`INVALID: ${err.message}`);
  process.exit(1);
}
