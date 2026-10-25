// Offline English dictionary: WordNet 3.0 (~147,000 words, see scripts/build-dictionary.js)
// plus a small learner supplement (data/dictionary/supplement.json) for grammar words and
// modern words WordNet lacks, and Vietnamese meanings (data/dictionary/vi.json) for every
// word used in the exams. Loaded lazily on the first lookup (the WordNet file is ~17 MB).
//
// Each entry carries "vi" (Vietnamese meanings for that word and part of speech, if any).
// Notes about word forms come as English text ("note") and as data ("noteInfo") so the
// popup can show them in Vietnamese too.

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
  constructor(wordnetFile, supplementFile, viFile) {
    this.wordnetFile = wordnetFile;
    this.supplementFile = supplementFile;
    this.viFile = viFile;
    this.wordnet = null;
    this.supplement = null;
    this.vi = null;
  }

  load() {
    this.wordnet ??= JSON.parse(fs.readFileSync(this.wordnetFile, 'utf8'));
    if (!this.supplement) {
      const raw = JSON.parse(fs.readFileSync(this.supplementFile, 'utf8'));
      delete raw._about;
      this.supplement = raw;
    }
    // { word: { "part of speech": ["nghĩa 1", ...] } }; optional, so English still works without it.
    if (!this.vi) this.vi = this.viFile && fs.existsSync(this.viFile) ? JSON.parse(fs.readFileSync(this.viFile, 'utf8')) : {};
  }

  // Attach Vietnamese meanings to each entry.
  withVietnamese(entries) {
    return entries.map((e) => ({ ...e, vi: this.vi[e.lemma]?.[e.posLabel] ?? null }));
  }

  // Is there an entry for this base word and part of speech (WordNet or supplement)?
  has(lemma, pos) {
    return Boolean(this.wordnet.lemmas[lemma]?.[pos] || this.supplement[lemma]?.some(([label]) => LABEL_POS[label] === pos));
  }

  // Possible base forms of a word for one part of speech, e.g. ("stopped", "v") -> ["stop"].
  baseForms(word, pos) {
    return this.candidates(word).filter((c) => c.pos === pos).map((c) => c.lemma);
  }

  // Every (base word, part of speech) the word could be, with how it was found:
  // "exact" (the word itself), "exception" (WordNet's irregular forms: went -> go) or
  // "rule" (suffix rules: stopped -> stop). Suffix rules over-generate ("does" -> "doe",
  // "pulls" -> "pul", "fines" -> "fin"), so their guesses are filtered.
  candidates(word) {
    const found = [];
    const add = (lemma, pos, origin, suffix = null) => {
      if (this.has(lemma, pos) && !found.some((c) => c.lemma === lemma && c.pos === pos)) found.push({ lemma, pos, origin, suffix });
    };
    for (const pos of Object.keys(POS_LABELS)) {
      if (this.has(word, pos)) add(word, pos, 'exact');
      for (const base of this.wordnet.exceptions[pos][word] ?? []) add(base, pos, 'exception');
    }

    // Spelling of plural/verb "-es": after ss, x, sh or tch the ending is "-es" ("crosses" -> cross,
    // "watches" -> watch); otherwise the base keeps its e ("rates" -> rate, not "rat"). After o, a single
    // s, z or ch both happen ("goes"/"toes", "buses"/"uses", "teaches"/"aches").
    const exact = found.some((c) => c.origin === 'exact');
    const esStem = word.endsWith('es') ? word.slice(0, -2) : null;
    const sibilantStem = esStem !== null && /(ss|x|sh|tch)$/.test(esStem);
    const eitherStem = esStem !== null && /([^s]s|z|[^t]ch|o)$/.test(esStem);

    for (const pos of Object.keys(POS_LABELS)) {
      for (const [suffix, ending] of SUFFIX_RULES[pos]) {
        if (!word.endsWith(suffix) || word.length <= suffix.length + 1) continue;
        // "-s" is not a plural/verb ending in "pass", nor in a word like "status", "bus" or "crisis" that is a
        // dictionary word itself (but "menus" -> menu), nor after a sibilant ("crosses" is not "crosse" + s).
        if (suffix === 's' && (/ss$/.test(word) || (/(us|is)$/.test(word) && exact) || sibilantStem)) continue;
        if (suffix === 'es') {
          if (ending === '' && !sibilantStem && !eitherStem) continue;
          if (ending === 'e' && sibilantStem) continue;
        }
        const base = word.slice(0, -suffix.length) + ending;
        add(base, pos, 'rule', suffix);
        // Doubled final consonant only before -ed/-ing/-er/-est: "stopped" -> "stop", "bigger" -> "big".
        if (['ed', 'ing', 'er', 'est'].includes(suffix)) {
          const undoubled = base.replace(/([b-df-hj-np-tv-z])\1$/, '$1');
          if (undoubled !== base) add(undoubled, pos, 'rule', suffix);
        }
      }
    }

    // Irregular forms and grammar words are reliable, so ignore rule guesses next to them
    // ("has" -> have, not "ha"; "his" -> his, not "hi").
    if (found.some((c) => c.origin === 'exception') || this.supplement[word]) {
      return found.filter((c) => c.origin !== 'rule');
    }

    const meanings = (lemma) => Object.values(this.wordnet.lemmas[lemma] ?? {}).reduce((n, ids) => n + ids.length, 0) || 1;
    const exactMeanings = found.some((c) => c.origin === 'exact') ? meanings(word) : 0;
    const affix = ['ed', 'ing', 'er', 'est'];
    return found.filter((c) => {
      if (c.origin !== 'rule') return true;
      // The clicked word is a dictionary word in its own right: drop rarer -s/-er guesses ("species" -> specie).
      // -ed/-ing guesses stay, because the verb matters for learners ("annoyed" -> annoy, "running" -> run).
      if (exactMeanings && !affix.slice(0, 2).includes(c.suffix) && meanings(c.lemma) <= exactMeanings) return false;
      // Both X and X+e possible after -ed/-ing/-er ("stared" -> star / stare): the e form is right,
      // because the -ed form of "star" doubles the consonant ("starred").
      if (affix.includes(c.suffix) && found.some((o) => o.lemma === `${c.lemma}e` && affix.includes(o.suffix))) return false;
      return true;
    });
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
    return this.withVietnamese(entries.concat(wordnetEntries));
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
      const full = fullForm.replace(/^i\b/, 'I');
      return { word, entries: this.entriesFor(main), note: `"${shown}" is short for "${full}".`, noteInfo: { kind: 'contraction', word: shown, full } };
    }

    // Possessive: "Anna's" -> "anna", "teachers'" -> "teachers".
    if (possessive) {
      const base = word.endsWith("s'") ? word.slice(0, -1) : possessive[1];
      entries = this.entriesFor(base);
      if (entries.length) return { word, entries, note: `"${shown}" is the possessive form of "${base}".`, noteInfo: { kind: 'possessive', word: shown, base } };
      word = base;
    }

    // British -ise spellings: "organise" -> "organize".
    const american = word.replace(/is(e|es|ed|ing|er|ers|ation|ations)$/, 'iz$1');
    if (american !== word && (entries = this.entriesFor(american)).length) {
      return { word, entries, note: `"${word}" is the British spelling of "${american}".`, noteInfo: { kind: 'british', word, american } };
    }

    // Hyphenated words: explain each part ("four-day" = four + day).
    if (word.includes('-')) {
      const parts = word.split('-').filter(Boolean);
      entries = parts.flatMap((p) => this.entriesFor(p).slice(0, 1));
      if (entries.length) return { word, entries, note: `"${word}" is made of: ${parts.join(' + ')}.`, noteInfo: { kind: 'parts', word, parts } };
    }

    // Prefixes and suffixes: "unmanaged" = un- (not) + managed, "seamlessly" = seamless + -ly.
    for (const [prefix, meaning] of PREFIXES) {
      if (word.startsWith(prefix) && word.length > prefix.length + 3) {
        const rest = word.slice(prefix.length).replace(/^-/, '');
        entries = this.entriesFor(rest);
        if (entries.length) return { word, entries, note: `"${word}" = ${prefix}- (${meaning}) + "${rest}".`, noteInfo: { kind: 'prefix', word, prefix, rest } };
      }
    }
    for (const [suffix, ending, meaning] of SUFFIXES) {
      if (word.endsWith(suffix) && word.length > suffix.length + 3) {
        const base = word.slice(0, -suffix.length) + ending;
        entries = this.entriesFor(base);
        if (entries.length) return { word, entries, note: `"${word}" means ${meaning} "${base}".`, noteInfo: { kind: 'suffix', word, suffix, base } };
      }
    }

    return { word, entries: [] };
  }
}

module.exports = { Dictionary };
