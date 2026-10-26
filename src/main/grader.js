// Grades a reading submission and builds the dashboard summary, advice and answer review.

const TYPE_LABELS = {
  'main-idea': 'Main idea',
  detail: 'Detail',
  inference: 'Inference',
  vocabulary: 'Vocabulary',
  purpose: "Author's purpose"
};

const TYPE_TIPS = {
  'main-idea': 'For main-idea questions, read the first and last sentence of each paragraph and ask "what is this whole paragraph about?" before looking at the options.',
  detail: 'For detail questions, scan for key words from the question (names, numbers, dates), then read the sentence around them carefully.',
  inference: 'For inference questions, choose the option the text supports most strongly; avoid options that go beyond what is written.',
  vocabulary: 'For vocabulary questions, replace the word with each option and check which one keeps the sentence meaning the same.',
  purpose: "For author's purpose questions, ask why the writer included that sentence or paragraph: to explain, compare, give an example, or argue."
};

const LEVELS = [
  { min: 90, name: 'Excellent', headline: 'Outstanding reading comprehension. You understand both details and the bigger picture.' },
  { min: 75, name: 'Good', headline: 'Solid reading skills. A few targeted improvements will take you to the top level.' },
  { min: 50, name: 'Fair', headline: 'You understand the general meaning, but some details and inferences are being missed.' },
  { min: 0, name: 'Needs improvement', headline: 'Reading comprehension needs more practice. Focus on building basic strategies first.' }
];

function round1(n) {
  return Math.round(n * 10) / 10;
}

const NEXT_STEPS = {
  excellent: 'Next step: try a harder exam level and practise reading authentic texts (news articles, essays) without a dictionary.',
  good: 'Next step: review the highlighted evidence for each wrong answer, then retake this exam in a few days to check retention.',
  fair: 'Next step: read each paragraph once for the general idea, then return to it for each question. Use "Show full answers" to see where the evidence is.',
  weak: 'Next step: practise with shorter texts at a lower level, and build vocabulary daily (10–15 new words). Use "Show full answers" to study how each answer is found.'
};

// What differs between skills that share this grader (reading, listening).
const READING_PROFILE = { typeLabels: TYPE_LABELS, typeTips: TYPE_TIPS, levels: LEVELS, nextSteps: NEXT_STEPS };

function buildAdvice(percent, byType, unansweredCount, profile) {
  const advice = [];

  const weak = byType.filter((t) => t.percent < 70).sort((a, b) => a.percent - b.percent);
  const strong = byType.filter((t) => t.percent === 100);

  if (strong.length) {
    advice.push(`Strength: you answered every ${strong.map((t) => t.label.toLowerCase()).join(', ')} question correctly.`);
  }
  for (const t of weak.slice(0, 2)) {
    advice.push(`Focus area: ${t.label} (${t.correct}/${t.total} correct). ${profile.typeTips[t.type] ?? ''}`.trim());
  }
  if (unansweredCount > 0) {
    advice.push(`You left ${unansweredCount} question(s) unanswered. There is no penalty for guessing, so always choose an answer.`);
  }

  const steps = profile.nextSteps;
  advice.push(percent >= 90 ? steps.excellent : percent >= 75 ? steps.good : percent >= 50 ? steps.fair : steps.weak);

  return advice;
}

function gradeExam(exam, answers, profile = READING_PROFILE) {
  const reviewQuestions = exam.questions.map((q, index) => {
    const raw = answers[q.id];
    const userAnswer = Number.isInteger(raw) && raw >= 0 && raw < q.options.length ? raw : null;
    const points = q.points ?? 1;
    const status = userAnswer === null ? 'unanswered' : userAnswer === q.answer ? 'correct' : 'incorrect';

    return {
      id: q.id,
      number: index + 1,
      type: q.type,
      typeLabel: profile.typeLabels[q.type] ?? q.type,
      text: q.text,
      options: q.options,
      answer: q.answer,
      userAnswer,
      status,
      points,
      earned: status === 'correct' ? points : 0,
      explanation: q.explanation ?? '',
      evidence: q.evidence ?? []
    };
  });

  const count = (status) => reviewQuestions.filter((q) => q.status === status).length;
  const correctCount = count('correct');
  const incorrectCount = count('incorrect');
  const unansweredCount = count('unanswered');
  const score = reviewQuestions.reduce((sum, q) => sum + q.earned, 0);
  const maxScore = reviewQuestions.reduce((sum, q) => sum + q.points, 0);
  const percent = maxScore ? round1((score / maxScore) * 100) : 0;

  const typeMap = new Map();
  for (const q of reviewQuestions) {
    const entry = typeMap.get(q.type) ?? { type: q.type, label: q.typeLabel, total: 0, correct: 0 };
    entry.total += 1;
    if (q.status === 'correct') entry.correct += 1;
    typeMap.set(q.type, entry);
  }
  const byType = [...typeMap.values()].map((t) => ({ ...t, percent: round1((t.correct / t.total) * 100) }));

  const level = profile.levels.find((l) => percent >= l.min);

  return {
    examId: exam.id,
    title: exam.title,
    summary: {
      paragraphCount: exam.paragraphs.length,
      questionCount: reviewQuestions.length,
      answeredCount: correctCount + incorrectCount,
      correctCount,
      incorrectCount,
      unansweredCount,
      score,
      maxScore,
      percent
    },
    byType,
    assessment: {
      level: level.name,
      headline: level.headline,
      advice: buildAdvice(percent, byType, unansweredCount, profile)
    },
    review: {
      paragraphs: exam.paragraphs,
      questions: reviewQuestions
    }
  };
}

module.exports = { gradeExam, LEVELS, round1 };
