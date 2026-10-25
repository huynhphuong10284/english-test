// Grades a writing submission: exercises are marked automatically, the free-writing
// task gets automatic checks (word count, paragraphs, linking words) and is scored
// by the learner with a self-check rubric after comparing with the model answer.

const { LEVELS, round1 } = require('./grader');
const { isAccepted, countWords, countParagraphs, findLinkers } = require('./text-utils');

const EXERCISE_LABELS = {
  choice: 'Multiple choice',
  'gap-fill': 'Gap fill',
  'word-order': 'Word order',
  'error-correction': 'Error correction',
  transformation: 'Sentence transformation'
};

const EXERCISE_TIPS = {
  choice: 'For multiple-choice grammar, read the whole sentence first and look at the words around the gap (subject, time words) before choosing.',
  'gap-fill': 'For gap fills, decide what kind of word is missing (verb, preposition, article...) and check tense and agreement with the subject.',
  'word-order': 'For word order, find the subject and main verb first, then add objects, and put time and place phrases at the end.',
  'error-correction': 'For error correction, check one thing at a time: verb form, agreement, articles, prepositions, then word order.',
  transformation: 'For transformations, keep the meaning identical, use the key word unchanged, and check that your sentence is grammatical as a whole.'
};

// Self-check criteria. Each is rated 0 (not yet), 1 (partly) or 2 (fully).
const RUBRIC = [
  { id: 'content', label: 'Content', description: 'I covered every point in the task and kept within the word limit.' },
  { id: 'organisation', label: 'Organisation', description: 'My ideas are in a logical order, with paragraphs and linking words.' },
  { id: 'grammar', label: 'Grammar', description: 'My sentences are mostly correct, and I used a range of structures.' },
  { id: 'vocabulary', label: 'Vocabulary', description: 'I used words suited to the topic and level, without much repetition.' }
];
const RUBRIC_MAX = 2;

const RUBRIC_TIPS = {
  content: 'Before writing, turn each task point into a note, and tick them off as you write. Check your word count at the end.',
  organisation: 'Plan paragraphs before you start (introduction, one idea per paragraph, ending) and join ideas with linking words.',
  grammar: 'Reread your text once just for grammar: verb tenses, subject-verb agreement and articles.',
  vocabulary: 'Learn topic words in phrases (collocations), and replace repeated words with synonyms when you check your work.'
};

// Keep only valid ratings; return null unless every criterion is rated.
function cleanSelfAssessment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clean = {};
  for (const { id } of RUBRIC) {
    const v = raw[id];
    if (!Number.isInteger(v) || v < 0 || v > RUBRIC_MAX) return null;
    clean[id] = v;
  }
  return clean;
}

function checkEssay(task, essay) {
  const wordCount = countWords(essay);
  const lower = essay.toLowerCase();
  return {
    wordCount,
    minWords: task.minWords,
    maxWords: task.maxWords,
    inRange: wordCount >= task.minWords && wordCount <= task.maxWords,
    paragraphs: countParagraphs(essay),
    linkers: findLinkers(essay),
    // A phrase like "I like him/her because ..." counts as used if its fixed start appears.
    usefulUsed: (task.usefulLanguage ?? []).filter((phrase) => {
      const stem = phrase.split('...')[0].split('/')[0].trim().toLowerCase();
      return stem.length > 2 && lower.includes(stem);
    })
  };
}

function buildAdvice(percent, byType, checks, selfAssessment, unansweredCount) {
  const advice = [];

  for (const t of byType.filter((t) => t.percent < 70).sort((a, b) => a.percent - b.percent).slice(0, 2)) {
    advice.push(`Focus area: ${t.label} (${t.correct}/${t.total} correct). ${EXERCISE_TIPS[t.type]}`);
  }
  if (unansweredCount > 0) advice.push(`You left ${unansweredCount} exercise(s) unanswered. Always try an answer.`);

  if (checks.wordCount === 0) {
    advice.push('You did not write anything in Part 2. The writing task is the most important part, so retake the test and try it.');
  } else if (checks.wordCount < checks.minWords) {
    advice.push(`Your text has ${checks.wordCount} words, but the task asks for ${checks.minWords}–${checks.maxWords}. Add more detail to each content point.`);
  } else if (checks.wordCount > checks.maxWords) {
    advice.push(`Your text has ${checks.wordCount} words, more than the ${checks.maxWords}-word limit. Practise cutting repetition and keeping only what answers the task.`);
  }
  if (checks.wordCount > 0 && checks.linkers.length < 3) {
    advice.push('Use more linking words to connect your ideas, for example: because, however, also, as a result, finally.');
  }

  if (!selfAssessment) {
    if (checks.wordCount > 0) advice.push('Compare your text with the model answer, then rate it with the self-check below to complete your score.');
  } else {
    const weakest = RUBRIC.filter((r) => selfAssessment[r.id] < RUBRIC_MAX).sort((a, b) => selfAssessment[a.id] - selfAssessment[b.id]);
    for (const r of weakest.slice(0, 2)) advice.push(`Writing – ${r.label}: ${RUBRIC_TIPS[r.id]}`);
  }

  if (percent >= 90) advice.push('Next step: try the next level, and write without looking at the useful language first.');
  else if (percent >= 50) advice.push('Next step: study the explanations for each wrong exercise, then rewrite your text using ideas from the model answer.');
  else advice.push('Next step: practise the exercises at this level again, and copy useful sentences from model answers into a notebook.');

  return advice;
}

// submission: { exercises: { [exerciseId]: string | optionIndex }, essay: string }
function gradeWriting(exam, submission, rawSelfAssessment) {
  const given = submission?.exercises ?? {};

  const exercises = exam.exercises.map((ex, index) => {
    const raw = given[ex.id];
    const points = ex.points ?? 1;
    let userAnswer;
    let correct;
    if (ex.type === 'choice') {
      userAnswer = Number.isInteger(raw) && raw >= 0 && raw < ex.options.length ? raw : null;
      correct = userAnswer === ex.answer;
    } else {
      userAnswer = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
      correct = userAnswer !== null && isAccepted(userAnswer, ex.answers);
    }
    const status = userAnswer === null ? 'unanswered' : correct ? 'correct' : 'incorrect';

    return {
      ...ex,
      number: index + 1,
      typeLabel: EXERCISE_LABELS[ex.type],
      userAnswer,
      status,
      points,
      earned: status === 'correct' ? points : 0,
      explanation: ex.explanation ?? ''
    };
  });

  const count = (status) => exercises.filter((e) => e.status === status).length;
  const correctCount = count('correct');
  const incorrectCount = count('incorrect');
  const unansweredCount = count('unanswered');
  const exerciseScore = exercises.reduce((sum, e) => sum + e.earned, 0);
  const exerciseMax = exercises.reduce((sum, e) => sum + e.points, 0);

  const essay = typeof submission?.essay === 'string' ? submission.essay : '';
  const checks = checkEssay(exam.task, essay);
  const selfAssessment = cleanSelfAssessment(rawSelfAssessment);
  const writingMax = RUBRIC.length * RUBRIC_MAX;
  const writingScore = selfAssessment ? Object.values(selfAssessment).reduce((a, b) => a + b, 0) : null;

  // Until the writing is self-rated, the score covers the exercises only.
  const score = exerciseScore + (writingScore ?? 0);
  const maxScore = exerciseMax + (writingScore === null ? 0 : writingMax);
  const percent = maxScore ? round1((score / maxScore) * 100) : 0;

  const typeMap = new Map();
  for (const e of exercises) {
    const entry = typeMap.get(e.type) ?? { type: e.type, label: e.typeLabel, total: 0, correct: 0 };
    entry.total += 1;
    if (e.status === 'correct') entry.correct += 1;
    typeMap.set(e.type, entry);
  }
  const byType = [...typeMap.values()].map((t) => ({ ...t, percent: round1((t.correct / t.total) * 100) }));

  const level = LEVELS.find((l) => percent >= l.min);

  return {
    examId: exam.id,
    skill: 'writing',
    title: exam.title,
    summary: {
      exerciseCount: exercises.length,
      answeredCount: correctCount + incorrectCount,
      correctCount,
      incorrectCount,
      unansweredCount,
      exerciseScore,
      exerciseMax,
      writingScore,
      writingMax,
      wordCount: checks.wordCount,
      selfAssessed: selfAssessment !== null,
      score,
      maxScore,
      percent
    },
    byType,
    assessment: {
      level: level.name,
      headline: selfAssessment ? level.headline : 'Score so far is for the exercises only. Rate your writing below to complete it.',
      advice: buildAdvice(percent, byType, checks, selfAssessment, unansweredCount)
    },
    review: {
      exercises,
      task: exam.task,
      essay,
      checks,
      rubric: RUBRIC,
      rubricMax: RUBRIC_MAX,
      selfAssessment
    }
  };
}

module.exports = { gradeWriting, cleanSelfAssessment, WRITING_MAX: RUBRIC.length * RUBRIC_MAX };
