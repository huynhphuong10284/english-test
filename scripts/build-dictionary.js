// Builds data/dictionary/wordnet.json from the WordNet 3.0 database files
// (npm package "wndb-with-exceptions", a build-time dependency only).
// Usage: npm run build:dict
//
// Output shape (compact, loaded by src/main/dictionary.js):
// {
//   source: "WordNet 3.0",
//   synsets: [[pos, definition, [examples], [words]], ...],   // one entry per meaning
//   lemmas: { "go": { "v": [synsetIds...], "n": [...] }, ... }, // sense order = most common first
//   exceptions: { "v": { "went": ["go"] }, "n": {...}, "a": {...}, "r": {...} } // irregular forms
// }

const fs = require('fs');
const path = require('path');

const SRC = path.join(path.dirname(require.resolve('wndb-with-exceptions/package.json')), 'dict');
const OUT_DIR = path.join(__dirname, '..', 'data', 'dictionary');
const OUT = path.join(OUT_DIR, 'wordnet.json');

const FILE_POS = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' };

// Data and index lines; the license header lines start with two spaces.
function lines(file) {
  return fs.readFileSync(path.join(SRC, file), 'utf8').split('\n').filter((l) => l && !l.startsWith('  '));
}

const cleanWord = (w) => w.replace(/_/g, ' ').replace(/\((a|p|ip)\)$/, '');

// "definition; \"example one\"; \"example two\"" -> [definition, [examples]]
function splitGloss(gloss) {
  const [definition, ...rest] = gloss.split(/;\s*(?=")/);
  const examples = rest.map((e) => e.trim().replace(/^"|"$/g, '').replace(/"\s*$/, '')).filter(Boolean);
  return [definition.trim(), examples];
}

const synsets = [];
const idOf = new Map(); // "pos:offset" -> synset id

for (const [file, pos] of Object.entries(FILE_POS)) {
  for (const line of lines(`data.${file}`)) {
    const parts = line.split(' ');
    const offset = parts[0];
    const wordCount = parseInt(parts[3], 16);
    const words = [];
    for (let i = 0; i < wordCount; i++) words.push(cleanWord(parts[4 + i * 2]));
    const [definition, examples] = splitGloss(line.slice(line.indexOf(' | ') + 3).trim());
    idOf.set(`${pos}:${offset}`, synsets.length);
    synsets.push([pos, definition, examples, words]);
  }
}

const lemmas = {};
for (const [file, pos] of Object.entries(FILE_POS)) {
  for (const line of lines(`index.${file}`)) {
    const parts = line.trim().split(' ');
    const lemma = cleanWord(parts[0]);
    const synsetCount = parseInt(parts[2], 10);
    const offsets = parts.slice(parts.length - synsetCount);
    (lemmas[lemma] ??= {})[pos] = offsets.map((o) => {
      const id = idOf.get(`${pos}:${o}`);
      if (id === undefined) throw new Error(`index.${file}: unknown synset ${o} for "${lemma}"`);
      return id;
    });
  }
}

const exceptions = {};
for (const [file, pos] of Object.entries(FILE_POS)) {
  exceptions[pos] = {};
  for (const line of lines(`${file}.exc`)) {
    const [form, ...bases] = line.trim().split(' ').map(cleanWord);
    exceptions[pos][form] = bases;
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'WordNet 3.0', synsets, lemmas, exceptions }));

const size = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(lemmas).length} words, ${synsets.length} meanings, ` +
  `${Object.values(exceptions).reduce((n, e) => n + Object.keys(e).length, 0)} irregular forms, ${size} MB`);
