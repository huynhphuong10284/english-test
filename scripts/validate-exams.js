// Validates every reading and writing exam and runs a sample grading pass.
// Usage: npm run validate

const path = require('path');
const { loadExams } = require('../src/main/exam-store');
const { gradeExam } = require('../src/main/grader');
const { gradeWriting } = require('../src/main/writing-grader');
const { Dictionary } = require('../src/main/dictionary');

const dir = path.join(__dirname, '..', 'data');
const ITEMS_PER_EXAM = 20; // questions per reading exam, exercises per writing exam

// The perfect submission for an exam, using its answer key (and the model answer for writing).
function perfectRun(exam) {
  if (exam.skill === 'writing') {
    const exercises = Object.fromEntries(exam.exercises.map((e) => [e.id, e.type === 'choice' ? e.answer : e.answers[0]]));
    const full = { content: 2, organisation: 2, grammar: 2, vocabulary: 2 };
    return gradeWriting(exam, { exercises, essay: exam.task.modelAnswer }, full);
  }
  return gradeExam(exam, Object.fromEntries(exam.questions.map((q) => [q.id, q.answer])));
}

function describe(exam, result) {
  if (exam.skill === 'writing') {
    return `${exam.exercises.length} exercises, ${exam.task.genre}, ${exam.task.minWords}-${exam.task.maxWords} words`;
  }
  return `${exam.paragraphs.length} paragraphs, ${exam.questions.length} questions, ${result.summary.maxScore} marks`;
}

// Information only: words in exam texts that the dictionary popup cannot explain.
// Names are skipped (capitalised in the middle of a sentence). Add useful words to data/dictionary/supplement.json.
function reportMissingWords(exams) {
  const dictDir = path.join(dir, 'dictionary');
  let dictionary;
  try {
    dictionary = new Dictionary(path.join(dictDir, 'wordnet.json'), path.join(dictDir, 'supplement.json'));
    dictionary.load();
  } catch {
    console.log('\nDictionary not built yet: run "npm run build:dict" to check word coverage.');
    return;
  }
  const missing = new Map();
  for (const exam of exams.values()) {
    const texts = exam.skill === 'writing' ? [exam.task.modelAnswer] : exam.paragraphs.map((p) => p.text);
    for (const text of texts) {
      for (const m of text.matchAll(/\p{L}+(?:['’-]\p{L}+)*/gu)) {
        const word = m[0];
        const before = text.slice(0, m.index).trimEnd();
        const nameLike = /^\p{Lu}/u.test(word) && before && !/[.!?:"]$/.test(before);
        if (nameLike || dictionary.lookup(word).entries.length) continue;
        missing.set(word.toLowerCase(), [...(missing.get(word.toLowerCase()) ?? []), exam.id]);
      }
    }
  }
  if (missing.size === 0) return console.log('\nDictionary: every word in the exam texts can be looked up.');
  console.log(`\nDictionary: ${missing.size} word(s) in exam texts have no entry (add useful ones to data/dictionary/supplement.json):`);
  for (const [word, ids] of [...missing].sort()) console.log(`    ${word.padEnd(24)} ${[...new Set(ids)].join(', ')}`);
}

try {
  const exams = loadExams(dir);
  for (const exam of exams.values()) {
    const items = exam.skill === 'writing' ? exam.exercises.length : exam.questions.length;
    if (items !== ITEMS_PER_EXAM) throw new Error(`${exam.id}: has ${items} ${exam.skill === 'writing' ? 'exercises' : 'questions'}, expected ${ITEMS_PER_EXAM}`);
    const result = perfectRun(exam);
    if (result.summary.percent !== 100) throw new Error(`${exam.id}: answer key does not grade to 100%`);
    console.log(`OK  ${exam.skill.padEnd(8)} ${exam.id.padEnd(40)} ${describe(exam, result)}`);
  }
  console.log(`\n${exams.size} exam(s) valid.`);

  const counts = new Map();
  for (const exam of exams.values()) {
    const key = `${exam.skill.padEnd(8)} ${exam.level}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...counts].sort()) console.log(`    ${key.padEnd(34)} ${n} exam(s)`);

  reportMissingWords(exams);
} catch (err) {
  console.error(`INVALID: ${err.message}`);
  process.exit(1);
}
