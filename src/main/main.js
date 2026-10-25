// Main process: creates the window and owns the exam data + grading logic.
// The answer key never leaves this process until the user submits.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { loadExams, toPublicExam } = require('./exam-store');
const { gradeExam } = require('./grader');
const { gradeWriting, cleanSelfAssessment, WRITING_MAX } = require('./writing-grader');
const { ResultsStore } = require('./results-store');
const { Dictionary } = require('./dictionary');

const DATA_DIR = path.join(__dirname, '..', '..', 'data'); // data/reading and data/writing
const MAX_ESSAY_LENGTH = 20000; // characters; guards the results file against huge pastes

let exams = new Map();
let results; // ResultsStore, created once the app is ready (needs app.getPath)
const dictionary = new Dictionary(
  path.join(DATA_DIR, 'dictionary', 'wordnet.json'),
  path.join(DATA_DIR, 'dictionary', 'supplement.json')
);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'English Reading Test',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function getExamOrThrow(examId) {
  const exam = exams.get(examId);
  if (!exam) throw new Error(`Exam not found: ${examId}`);
  return exam;
}

function grade(exam, answers, selfAssessment) {
  return exam.skill === 'writing' ? gradeWriting(exam, answers, selfAssessment) : gradeExam(exam, answers);
}

// The answers worth saving, as normalised by the grader (invalid input dropped).
function cleanAnswers(exam, graded) {
  if (exam.skill === 'writing') {
    const exercises = Object.fromEntries(
      graded.review.exercises.filter((e) => e.userAnswer !== null).map((e) => [e.id, e.userAnswer])
    );
    return { exercises, essay: graded.review.essay };
  }
  return Object.fromEntries(graded.review.questions.filter((q) => q.userAnswer !== null).map((q) => [q.id, q.userAnswer]));
}

function itemsOf(exam) {
  return exam.skill === 'writing' ? exam.exercises : exam.questions;
}

// Exams only grow by appending questions, so an attempt made on an older, shorter
// version is graded against the questions it had: the first N items. Attempts saved
// before questionCount was recorded are matched by their stored exercise/question total.
function questionCountOf(exam, attempt) {
  const items = itemsOf(exam);
  if (attempt.questionCount) return Math.min(attempt.questionCount, items.length);
  const target = attempt.maxScore - (attempt.selfAssessment ? WRITING_MAX : 0);
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i].points ?? 1;
    if (sum === target) return i + 1;
  }
  return items.length;
}

function examAsTaken(exam, attempt) {
  const count = questionCountOf(exam, attempt);
  if (count === itemsOf(exam).length) return exam;
  const items = itemsOf(exam).slice(0, count);
  return exam.skill === 'writing' ? { ...exam, exercises: items } : { ...exam, questions: items };
}

// A graded result for one saved attempt, plus the exam's full attempt history.
function buildResult(exam, attempt) {
  const asTaken = examAsTaken(exam, attempt);
  return {
    ...grade(asTaken, attempt.answers, attempt.selfAssessment),
    attempt: summarizeAttempt(attempt, results.list(exam.id).indexOf(attempt)),
    history: results.list(exam.id).map(summarizeAttempt),
    // Set when this attempt was made on an earlier, shorter version of the exam.
    olderVersion: asTaken === exam ? null : { questionCount: itemsOf(asTaken).length, currentCount: itemsOf(exam).length }
  };
}

function summarizeAttempt(attempt, index) {
  const { id, submittedAt, score, maxScore, percent } = attempt;
  return { id, number: index + 1, submittedAt, score, maxScore, percent };
}

function registerIpc() {
  ipcMain.handle('exams:list', () =>
    [...exams.values()].map((exam) => ({
      id: exam.id,
      skill: exam.skill,
      title: exam.title,
      level: exam.level,
      description: exam.description,
      ...(exam.skill === 'writing'
        ? { exerciseCount: exam.exercises.length, genre: exam.task.genre, minWords: exam.task.minWords, maxWords: exam.task.maxWords }
        : { paragraphCount: exam.paragraphs.length, questionCount: exam.questions.length }),
      progress: results.progress(exam.id)
    }))
  );

  ipcMain.handle('exams:get', (_event, examId) => toPublicExam(getExamOrThrow(examId)));

  // Grade, save as a new attempt (earlier attempts are kept), and return the result.
  ipcMain.handle('exams:submit', (_event, examId, answers) => {
    const exam = getExamOrThrow(examId);
    let input = answers ?? {};
    if (exam.skill === 'writing') {
      input = { exercises: input.exercises ?? {}, essay: String(input.essay ?? '').slice(0, MAX_ESSAY_LENGTH) };
    }
    const graded = grade(exam, input, null);
    return buildResult(exam, results.add(exam.id, cleanAnswers(exam, graded), graded.summary, itemsOf(exam).length));
  });

  // Writing only: save the learner's self-check ratings for an attempt and re-score it.
  ipcMain.handle('results:assess', (_event, examId, attemptId, selfAssessment) => {
    const exam = getExamOrThrow(examId);
    if (exam.skill !== 'writing') throw new Error('Only writing attempts can be self-assessed');
    const attempt = results.get(examId, attemptId);
    if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
    const clean = cleanSelfAssessment(selfAssessment);
    if (!clean) throw new Error('Every criterion must be rated 0, 1 or 2');
    const graded = gradeWriting(examAsTaken(exam, attempt), attempt.answers, clean);
    return buildResult(exam, results.assess(examId, attempt.id, clean, graded.summary));
  });

  // A saved attempt (the latest one when attemptId is omitted), or null if there is none.
  ipcMain.handle('results:get', (_event, examId, attemptId) => {
    const exam = getExamOrThrow(examId);
    const attempt = results.get(examId, attemptId);
    return attempt ? buildResult(exam, attempt) : null;
  });

  // Dictionary lookup for a clicked word.
  ipcMain.handle('dict:lookup', (_event, word) => {
    try {
      return dictionary.lookup(word);
    } catch (err) {
      console.error(`Dictionary lookup failed: ${err.message}`);
      return { word: String(word ?? ''), entries: [], error: 'The dictionary could not be loaded.' };
    }
  });
}

app.whenReady().then(() => {
  exams = loadExams(DATA_DIR, { strict: false, onError: (err) => console.error(`Skipped exam: ${err.message}`) });
  // e.g. %APPDATA%\English Reading Test\results.json on Windows
  results = new ResultsStore(path.join(app.getPath('userData'), 'results.json'));
  registerIpc();
  createWindow();

  // Load the large dictionary file shortly after start-up, so the first lookup is instant.
  setTimeout(() => {
    try {
      dictionary.load();
    } catch (err) {
      console.error(`Dictionary not loaded: ${err.message}`);
    }
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
