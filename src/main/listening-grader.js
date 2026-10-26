// Grades a listening submission. Listening questions work like reading questions, so this
// reuses the reading grader: the transcript lines become the "paragraphs" that evidence
// quotes point at, and the advice is about listening instead of reading.

const { gradeExam } = require('./grader');

const TYPE_LABELS = {
  'main-idea': 'Main idea',
  detail: 'Detail',
  inference: 'Inference',
  attitude: "Speaker's opinion",
  purpose: "Speaker's purpose"
};

const TYPE_TIPS = {
  'main-idea': 'For main-idea questions, listen to the whole part before choosing: the topic is often given at the start and repeated at the end.',
  detail: 'For detail questions, read the question before the audio starts and listen for its key words (names, numbers, times, places). Speakers often correct themselves, so wait for the final answer.',
  inference: 'For inference questions, choose what the speaker clearly means, even if they do not say it directly; avoid options that only repeat words you heard.',
  attitude: "For opinion questions, listen to how the speaker feels: words like 'actually', 'to be honest', 'I'm not sure' and 'I really love' show their opinion.",
  purpose: 'For purpose questions, ask why the speaker is talking: to invite, complain, explain, persuade or give advice.'
};

const LEVELS = [
  { min: 90, name: 'Excellent', headline: 'Outstanding listening. You catch both the details and what the speakers really mean.' },
  { min: 75, name: 'Good', headline: 'Solid listening skills. A few targeted improvements will take you to the top level.' },
  { min: 50, name: 'Fair', headline: 'You understand the general meaning, but some details and opinions are being missed.' },
  { min: 0, name: 'Needs improvement', headline: 'Listening needs more practice. Focus on hearing key words and numbers first.' }
];

const NEXT_STEPS = {
  excellent: 'Next step: try a harder level, and listen to English podcasts or news without subtitles.',
  good: 'Next step: listen again while reading the transcript, paying attention to the highlighted parts you missed.',
  fair: 'Next step: before each part, read the questions and underline the key words, then listen for them. Use "Show full answers" to see where each answer is heard.',
  weak: 'Next step: practise at a lower level, and listen with the transcript first, then without it. Short daily listening (10 minutes) helps more than one long session.'
};

const PROFILE = { typeLabels: TYPE_LABELS, typeTips: TYPE_TIPS, levels: LEVELS, nextSteps: NEXT_STEPS };

// Every transcript line, labelled with its speaker, in order.
function transcriptLines(exam) {
  return exam.parts.flatMap((part) =>
    part.script.map((line) => ({ id: line.id, partId: part.id, text: line.speaker ? `${line.speaker}: ${line.text}` : line.text }))
  );
}

function gradeListening(exam, answers) {
  const lines = transcriptLines(exam);
  const asReading = {
    ...exam,
    paragraphs: lines,
    questions: exam.questions.map((q) => ({ ...q, evidence: (q.evidence ?? []).map((ev) => ({ paragraphId: ev.lineId, quote: ev.quote })) }))
  };
  const result = gradeExam(asReading, answers, PROFILE);
  result.summary.partCount = exam.parts.length;
  delete result.summary.paragraphCount;
  result.review.parts = exam.parts.map((p) => ({ id: p.id, title: p.title }));
  return result;
}

module.exports = { gradeListening, transcriptLines, LISTENING_TYPES: Object.keys(TYPE_LABELS) };
