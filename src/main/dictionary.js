// Offline English dictionary: WordNet 3.0 (~147,000 words, see scripts/build-dictionary.js)
// plus a small learner supplement (data/dictionary/supplement.json) for grammar words and
// modern words WordNet lacks. Loaded lazily on the first lookup (the WordNet file is ~17 MB).

const fs = require('fs');

const POS_LABELS = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };
const LABEL_POS = { noun: 'n', verb: 'v', adjective: 'a', adverb: 'r' };

// WordNet's "morphy" suffix rules: turn an inflected form into a possible base form.
const SUFFIX_RULES = {
  n: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  v: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  a: [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e'], ['ier', 'y'], ['iest', 'y']],
  r: []
};

const CONTRACTIONS = {
  "won't": 'will not', "can't": 'cannot', "shan't": 'shall not', "i'm": 'I am',
  "let's": 'let us', "it's": 'it is / it has', "he's": 'he is / he has', "she's": 'she is / she has',
  "that's": 'that is', "there's": 'there is', "what's": 'what is', "who's": 'who is'
};
const CONTRACTION_ENDINGS = [["n't", ' not'], ["'re", ' are'], ["'ve", ' have'], ["'ll", ' will'], ["'d", ' would / had']];

// Prefixes and suffixes used to explain words that are not in the dictionary themselves.
const PREFIXES = [
  ['counter', 'against'], ['under', 'too little, or below'], ['over', 'too much'], ['inter', 'between'],
  ['anti', 'against'], ['multi', 'many'], ['super', 'above, more than'], ['self', 'of or by yourself'],
  ['non', 'not'], ['mis', 'wrongly'], ['dis', 'not, or the opposite of'], ['pre', 'before'], ['re', 'again'],
  ['un', 'not, or the opposite of'], ['in', 'not'], ['im', 'not'], ['ir', 'not'], ['il', 'not'], ['co', 'together']
];
const SUFFIXES = [
  ['ically', 'ic', 'in a way that is'], ['ably', 'able', 'in a way that is'], ['ibly', 'ible', 'in a way that is'],
  ['ily', 'y', 'in a way that is'], ['ly', '', 'in a way that is'], ['able', '', 'able to be'], ['able', 'e', 'able to be'],
  ['ness', '', 'the quality of being'], ['ity', 'e', 'the quality of being']
];

const MAX_SENSES = 12; // per part of speech; WordNet has 30 meanings for "go"

// "Café's" -> "cafe" (lower case, plain apostrophes, no accents, no possessive, no outer punctuation).
function cleanWord(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 60);
}

class Dictionary {
  constructor(wordnetFile, supplementFile) {
    this.wordnetFile = wordnetFile;
    this.supplementFile = supplementFile;
    this.wordnet = null;
    this.supplement = null;
  }

  load() {
    this.wordnet ??= JSON.parse(fs.readFileSync(this.wordnetFile, 'utf8'));
    if (!this.supplement) {
      const raw = JSON.parse(fs.readFileSync(this.supplementFile, 'utf8'));
      delete raw._about;
      this.supplement = raw;
    }
  }

  // Is there an entry for this base word and part of speech (WordNet or supplement)?
  has(lemma, pos) {
    return Boolean(this.wordnet.lemmas[lemma]?.[pos] || this.supplement[lemma]?.some(([label]) => LABEL_POS[label] === pos));
  }

  // Possible base forms of a word for one part of speech, e.g. ("stopped", "v") -> ["stop"].
  baseForms(word, pos) {
    const found = new Set(this.wordnet.exceptions[pos][word] ?? []);
    if (this.has(word, pos)) found.add(word);
    for (const [suffix, ending] of SUFFIX_RULES[pos]) {
      if (!word.endsWith(suffix) || word.length <= suffix.length + 1) continue;
      const base = word.slice(0, -suffix.length) + ending;
      if (this.has(base, pos)) found.add(base);
      // Doubled final consonant: "stopped" -> "stopp" -> "stop", "bigger" -> "bigg" -> "big".
      const undoubled = base.replace(/([b-df-hj-np-tv-z])\1$/, '$1');
      if (undoubled !== base && this.has(undoubled, pos)) found.add(undoubled);
    }
    return [...found].filter((base) => this.has(base, pos));
  }

  // All entries for an exact word (no fallbacks): supplement entries first, then WordNet.
  entriesFor(word) {
    const entries = [];
    const seen = new Set();

    // Supplement: grammar words match exactly; noun/verb/adjective/adverb entries also match inflected forms.
    const supplementWords = new Set([word]);
    for (const pos of Object.keys(POS_LABELS)) for (const base of this.baseForms(word, pos)) supplementWords.add(base);
    for (const lemma of supplementWords) {
      for (const [label, definition, example] of this.supplement[lemma] ?? []) {
        if (lemma !== word && !LABEL_POS[label]) continue;
        entries.push({ lemma, posLabel: label, source: 'learner', senseCount: 1, senses: [{ definition, examples: example ? [example] : [], synonyms: [] }] });
        seen.add(`${lemma}:${LABEL_POS[label] ?? label}`);
      }
    }

    const wordnetEntries = [];
    for (const pos of Object.keys(POS_LABELS)) {
      for (const lemma of this.baseForms(word, pos)) {
        const ids = this.wordnet.lemmas[lemma]?.[pos];
        if (!ids) continue;
        const senses = ids.slice(0, MAX_SENSES).map((id) => this.wordnet.synsets[id]);
        // WordNet keeps the capital letter of proper words ("Dutch", "Monday"); show it that way.
        const capitalised = senses.flatMap(([, , , words]) => words).find((w) => w.toLowerCase() === lemma && w !== lemma);
        wordnetEntries.push({
          lemma,
          display: capitalised ?? lemma,
          posLabel: POS_LABELS[pos],
          source: 'wordnet',
          senseCount: ids.length,
          senses: senses.map(([, definition, examples, words]) => ({
            definition,
            examples,
            synonyms: words.filter((w) => w.toLowerCase() !== lemma)
          }))
        });
      }
    }
    // Most useful first: many meanings usually means a common word; a small bonus for the exact form,
    // so "stopped" shows the verb "stop" before the rare adjective "stopped".
    const score = (e) => e.senseCount + (e.lemma === word ? 5 : 0);
    wordnetEntries.sort((a, b) => score(b) - score(a));
    return entries.concat(wordnetEntries);
  }

  // Look up a word as clicked in a text. Always returns { word, entries, note? }.
  lookup(raw) {
    this.load();
    let word = cleanWord(raw);
    if (!word) return { word, entries: [] };
    const possessive = word.match(/^(.+?)(?:'s|s')$/);

    let entries = this.entriesFor(word);
    if (entries.length) return { word, entries };
    const shown = word.replace(/^i(?=$|')/, 'I'); // "i'm" -> "I'm" in notes

    // Contractions: "don't" -> "do not", "she's" -> "she is / she has". Checked before possessives.
    const fullForm = CONTRACTIONS[word] ?? CONTRACTION_ENDINGS.filter(([end]) => word.endsWith(end)).map(([end, full]) => word.slice(0, -end.length) + full)[0];
    if (fullForm) {
      const main = fullForm.split(' ')[0].toLowerCase();
      return { word, entries: this.entriesFor(main), note: `"${shown}" is short for "${fullForm.replace(/^i\b/, 'I')}".` };
    }

    // Possessive: "Anna's" -> "anna", "teachers'" -> "teachers".
    if (possessive) {
      const base = word.endsWith("s'") ? word.slice(0, -1) : possessive[1];
      entries = this.entriesFor(base);
      if (entries.length) return { word, entries, note: `"${shown}" is the possessive form of "${base}".` };
      word = base;
    }

    // British -ise spellings: "organise" -> "organize".
    const american = word.replace(/is(e|es|ed|ing|er|ers|ation|ations)$/, 'iz$1');
    if (american !== word && (entries = this.entriesFor(american)).length) {
      return { word, entries, note: `"${word}" is the British spelling of "${american}".` };
    }

    // Hyphenated words: explain each part ("four-day" = four + day).
    if (word.includes('-')) {
      const parts = word.split('-').filter(Boolean);
      entries = parts.flatMap((p) => this.entriesFor(p).slice(0, 1));
      if (entries.length) return { word, entries, note: `"${word}" is made of: ${parts.join(' + ')}.` };
    }

    // Prefixes and suffixes: "unmanaged" = un- (not) + managed, "seamlessly" = seamless + -ly.
    for (const [prefix, meaning] of PREFIXES) {
      if (word.startsWith(prefix) && word.length > prefix.length + 3) {
        const rest = word.slice(prefix.length).replace(/^-/, '');
        entries = this.entriesFor(rest);
        if (entries.length) return { word, entries, note: `"${word}" = ${prefix}- (${meaning}) + "${rest}".` };
      }
    }
    for (const [suffix, ending, meaning] of SUFFIXES) {
      if (word.endsWith(suffix) && word.length > suffix.length + 3) {
        const base = word.slice(0, -suffix.length) + ending;
        entries = this.entriesFor(base);
        if (entries.length) return { word, entries, note: `"${word}" means ${meaning} "${base}".` };
      }
    }

    return { word, entries: [] };
  }
}

module.exports = { Dictionary };
