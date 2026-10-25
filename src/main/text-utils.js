// Text helpers shared by the writing grader and the exam validator.

// Linking words looked for in a learner's text (multi-word ones first so they match whole).
const LINKERS = [
  'on the other hand', 'in addition', 'as a result', 'for example', 'for instance', 'in conclusion',
  'in contrast', 'even though', 'as well as', 'first of all', 'to sum up',
  'and', 'but', 'so', 'because', 'then', 'also', 'or', 'after', 'before', 'when', 'finally', 'firstly',
  'secondly', 'however', 'although', 'therefore', 'moreover', 'furthermore', 'besides', 'while', 'whereas',
  'despite', 'nevertheless', 'nonetheless', 'consequently', 'meanwhile', 'otherwise', 'thus', 'hence',
  'unless', 'since'
];

// Lower-case, straighten quotes, drop punctuation and extra spaces, so
// "She goes to school." and "she goes to school" compare equal.
// Also treats contractions as their full form ("don't" = "do not", "I'd like" = "I would like")
// and British/American -ise/-ize spellings as the same ("organized" = "organised").
function normalizeAnswer(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/\bcan't\b|\bcannot\b/g, 'can not')
    .replace(/n't\b/g, ' not')
    .replace(/'ll\b/g, ' will')
    .replace(/'ve\b/g, ' have')
    .replace(/'re\b/g, ' are')
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\b([a-z]+)'([ds])\b(?:(\s+)([a-z]+))?/g, expandAmbiguous)
    .replace(/iz(e|es|ed|ing|ation|ations|er|ers)\b/g, 'is$1')
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/(^|\s)[-']+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Past participles that are not also common base forms, used to tell "I'd known" (had)
// from "I'd go" (would), and "he's got" (has) from "he's tall" (is).
const PARTICIPLES = new Set(
  ('been got gotten gone done had seen known made taken given written eaten begun broken chosen driven fallen ' +
    'forgotten found heard left lost met said sent spent told thought understood won worn bought brought caught ' +
    'taught felt kept slept built paid sold stood grown drawn shown flown thrown spoken stolen woken become').split(' ')
);
const IS_SUBJECTS = new Set('he she it that there here what who where how when why this'.split(' '));
const isParticiple = (w) => Boolean(w) && (PARTICIPLES.has(w) || (w.endsWith('ed') && w.length > 3));

// Expand an ambiguous 'd / 's using the next word; leave it alone when unsure (e.g. possessive "Tom's book").
function expandAmbiguous(match, word, suffix, space, next) {
  const rest = next ? `${space}${next}` : '';
  if (suffix === 'd') {
    return `${word} ${next === 'better' || isParticiple(next) ? 'had' : 'would'}${rest}`;
  }
  if (isParticiple(next)) return `${word} has${rest}`;
  if (IS_SUBJECTS.has(word)) return `${word} is${rest}`;
  return match;
}

function isAccepted(input, answers) {
  const given = normalizeAnswer(input);
  return given !== '' && answers.some((a) => normalizeAnswer(a) === given);
}

function tokens(text) {
  const n = normalizeAnswer(text);
  return n ? n.split(' ') : [];
}

// Whether an answer uses the transformation keyword. Ambiguous contractions count too:
// "I'd known" uses HAD (or WOULD), "It's" uses IT (and IS/HAS).
function containsKeyword(answer, keyword) {
  const expanded = normalizeAnswer(answer).replace(/'d\b/g, ' had would').replace(/'s\b/g, ' is has');
  return ` ${expanded} `.includes(` ${normalizeAnswer(keyword)} `);
}

function countWords(text) {
  return (String(text ?? '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

// Paragraphs = blocks of text separated by line breaks.
function countParagraphs(text) {
  return String(text ?? '').split(/\n+/).filter((p) => p.trim()).length;
}

function findLinkers(text) {
  const padded = ` ${normalizeAnswer(text)} `;
  return LINKERS.filter((w) => padded.includes(` ${w} `));
}

module.exports = { normalizeAnswer, isAccepted, containsKeyword, tokens, countWords, countParagraphs, findLinkers };
