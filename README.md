# English Reading Test

This repo is for a small app which I develop for my kids' English practice.

A desktop app built with [Electron](https://www.electronjs.org) for practising English **reading** and **writing**, with 15 exams per skill for each CEFR level from A1 to C2. Every exam has **20 questions** (reading) or **20 exercises** (writing).

## Features

1. **Exam list** (left sidebar): choose **Reading** or **Writing**, pick a CEFR level (A1 – C2) from the **Level** dropdown, then choose an exam. Your choices are remembered.
2. **English Test tab**:
   - *Reading*: the passage, with numbered paragraphs, and 20 multiple-choice questions. On wide windows the passage stays visible next to the questions.
   - *Writing*: **Part 1** has 20 auto-marked exercises (multiple choice, gap fill, word order, error correction, sentence transformation). **Part 2** is a writing task (email, story, essay, report...) with the points to include, useful language and a live word counter.
   - The numbered buttons in the bottom bar show which questions you have answered; click one to jump to it.
3. **Test Result tab**: a dashboard that opens after you submit. It shows:
   - the number of paragraphs, questions, answers given, valid (correct) answers, invalid (wrong) answers and unanswered questions
   - the total mark and a percentage score ring
   - your performance by question type (main idea, detail, inference, vocabulary, author's purpose)
   - your learning level and personalised advice
4. **Saved results**: every submission is saved as an attempt. When you return to an exam you have submitted, its latest result opens. **Retake test** starts a new attempt and keeps the old ones, which are listed under **Attempt history**. The sidebar shows how many attempts you have made, your best score and your last score. Results are stored in `%APPDATA%\English Reading Test\results.json`. If an exam gets more questions later, older attempts are still marked against the questions they had, and are labelled as taken on an earlier version.
5. **Writing results**: Part 1 is marked automatically, with the correct answer and an explanation for each exercise. Part 2 shows automatic checks (word count, paragraphs, linking words), then your text next to a **model answer**. You then rate your own writing with a **self-check** (content, organisation, grammar, vocabulary; 0–2 each), and that rating is added to your total mark. Until you rate it, the score covers the exercises only.
6. **Dictionary**: **double-click** a word, or **right-click** any word (including in answer options), to see its meanings, example sentences and similar words, and to hear it read aloud (🔊, using the Windows voices). It covers about 147,000 words from WordNet, plus learner notes for grammar words (*the, although, whereas*) and modern words (*app, selfie*). Forms like *went*, *children* and *don't* lead to *go*, *child* and *do not*. During a reading test, words tested by a vocabulary question are locked until you submit.
7. **Show full answers** (reading): every correct answer with an explanation. The passage is shown with the **main idea or evidence for each answer highlighted**. Click an answer card to jump to its highlight.

## Run

```bash
git clone https://github.com/huynhphuong10284/english-test.git
cd english-test
npm install
npm start
```

`npm install` also builds the offline dictionary (`data/dictionary/wordnet.json`, about 17 MB), so it is not stored in the repository.

Check the exam data files:

```bash
npm run validate
```

## Build a Windows installer

```bash
npm run dist
```

This validates the exams and creates two files in `dist/`:

- `English-Reading-Test-Setup-<version>.exe`: an installer that adds Start Menu and Desktop shortcuts and an uninstaller.
- `English-Reading-Test-Portable-<version>.exe`: a single file that runs without installing.

Copy either file to another Windows 10/11 (64-bit) PC. That PC does not need Node.js. The app is not code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

## Project structure

```
english-reading-test/
├── package.json
├── LICENSE
├── LICENSE-WORDNET          # WordNet licence (required for the dictionary)
├── data/
│   ├── reading/             # one JSON file per reading exam (a1-*.json … c2-*.json)
│   ├── writing/             # one JSON file per writing exam
│   └── dictionary/          # wordnet.json (generated) + supplement.json (learner notes)

├── scripts/validate-exams.js
└── src/
    ├── main/                # MAIN process (Node.js)
    │   ├── main.js          # creates the window, registers IPC handlers
    │   ├── exam-store.js    # loads and validates exam JSON (both skills)
    │   ├── results-store.js # saves every attempt to results.json
    │   ├── grader.js        # reading: scoring, dashboard stats, advice
    │   ├── writing-grader.js# writing: exercise marking, text checks, self-check score
    │   ├── text-utils.js    # answer comparison, word count, linking words
    │   └── dictionary.js    # dictionary lookup (word forms, contractions, fallbacks)
    ├── preload/
    │   └── preload.js       # contextBridge: exposes window.examApi
    └── renderer/            # RENDERER process (web page)
        ├── index.html
        ├── styles.css
        ├── dictionary.js    # dictionary popup (double-click / right-click a word)
        ├── writing.js       # writing view (exercises, task, self-check)
        └── renderer.js      # shared UI + reading view
```

### How the processes talk (IPC)

```
renderer.js ──window.examApi.listExams()──▶ preload.js ──ipcRenderer.invoke('exams:list')──▶ main.js
renderer.js ──window.examApi.getExam(id)──▶ ...        ──'exams:get'    (answer key removed)
renderer.js ──window.examApi.submitExam(id, answers)──▶ 'exams:submit'  (graded + saved in main process)
renderer.js ──window.examApi.getResult(id, attemptId)──▶ 'results:get' (a saved attempt; latest if no attemptId)
dictionary.js ──window.examApi.lookupWord(word)──▶ 'dict:lookup'
writing.js  ──window.examApi.assessWriting(id, attemptId, rating)──▶ 'results:assess' (save self-check, re-score)
```

The answer key (and, for writing, the model answer) stays in the main process and is only sent after you submit, so it can't be seen in DevTools during the test.

## Adding a reading exam

Create a new file named `<level>-<id>.json`, such as `data/reading/b1-my-exam.json`:

```json
{
  "id": "my-exam",
  "title": "My Exam",
  "level": "B1 · Intermediate",
  "description": "Short description",
  "instructions": "Read the passage and answer the questions.",
  "paragraphs": [
    { "id": "p1", "text": "Paragraph text..." }
  ],
  "questions": [
    {
      "id": "q1",
      "type": "main-idea",
      "text": "Question text?",
      "options": ["A", "B", "C", "D"],
      "answer": 0,
      "points": 1,
      "explanation": "Why A is correct.",
      "evidence": [
        { "paragraphId": "p1", "quote": "exact words copied from the paragraph" }
      ]
    }
  ]
}
```

- `level` is shown in the Level dropdown. Use one of: `A1 · Beginner`, `A2 · Elementary`, `B1 · Intermediate`, `B2 · Upper-intermediate`, `C1 · Advanced`, `C2 · Proficiency`. Exams with exactly the same `level` text are grouped together.
- `answer` is the index of the correct option, starting from 0 (0 = A, 1 = B, ...).
- `type` must be one of `main-idea`, `detail`, `inference`, `vocabulary` or `purpose`.
- Every exam must have exactly 20 questions (writing: 20 exercises).
- To change an existing exam without breaking saved results, only **add** paragraphs and questions at the end, and never edit or reorder existing ones.
- Each `evidence.quote` must be copied **exactly** from the paragraph, because that text is what gets highlighted. Run `npm run validate` to check.

## Adding a writing exam

Create `data/writing/<level>-<name>.json`. The `id` must start with `w-`. [data/writing/a1-my-best-friend.json](data/writing/a1-my-best-friend.json) is a complete example.

```json
{
  "id": "w-my-exam",
  "title": "My Writing Exam",
  "level": "B1 · Intermediate",
  "description": "Short description",
  "instructions": "Do the exercises, then write your text.",
  "exercises": [
    { "id": "e1", "type": "choice", "focus": "Linking words", "prompt": "Choose the best word.",
      "text": "I was tired, ___ I went to bed.", "options": ["but", "so", "or", "because"], "answer": 1, "explanation": "..." },
    { "id": "e2", "type": "gap-fill", "prompt": "Write the correct form.", "text": "She ___ (go) home.", "answers": ["went"], "explanation": "..." },
    { "id": "e3", "type": "word-order", "prompt": "Put the words in order.", "words": ["home", "she", "went"], "answers": ["She went home."], "explanation": "..." },
    { "id": "e4", "type": "error-correction", "prompt": "Correct the mistake.", "text": "He go home.", "answers": ["He goes home."], "explanation": "..." },
    { "id": "e5", "type": "transformation", "prompt": "Rewrite using the word given.", "text": "It rained, but we went out.",
      "keyword": "despite", "answers": ["We went out despite the rain."], "explanation": "..." }
  ],
  "task": {
    "genre": "Informal email",
    "prompt": "Write an email to a friend about...",
    "contentPoints": ["Point 1", "Point 2", "Point 3"],
    "minWords": 100,
    "maxWords": 150,
    "usefulLanguage": ["I'm writing to ...", "Hope to hear from you soon."],
    "modelAnswer": "Hi Sam, ..."
  }
}
```

- Typed answers (`answers`) are compared ignoring case and punctuation. List **every** acceptable version (e.g. `don't` and `do not`), because anything not listed is marked wrong.
- `word-order`: `words` must be scrambled, and every answer must use exactly those words.
- `transformation`: every answer must contain the `keyword`.
- `modelAnswer` must be within `minWords`–`maxWords`. Separate paragraphs with `

`.
- Run `npm run validate` to check all of these.

## Dictionary

`data/dictionary/wordnet.json` is generated from WordNet 3.0 by `npm run build:dict` (`npm run dist` runs it for you). `data/dictionary/supplement.json` holds hand-written learner entries and is shown before WordNet's.

When you add an exam, `npm run validate` lists any words in its text that the dictionary cannot explain (names that start a sentence also appear). Add useful ones to `supplement.json`:

```json
"selfie": [["noun", "a photo you take of yourself, usually with a phone", "We took a selfie at the beach."]]
```

Use `noun`, `verb`, `adjective` or `adverb` as the part of speech so that other forms (*selfies*) also match.

## Copyright

© 2026 phuonghv. Released under the [MIT License](LICENSE).

Dictionary definitions: WordNet 3.0 © 2006 Princeton University, used under the [WordNet licence](LICENSE-WORDNET).
