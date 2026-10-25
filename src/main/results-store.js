// Saves every submitted attempt to a JSON file in the user's app-data folder,
// so results survive switching exams, retaking a test and restarting the app.
//
// File shape: { "version": 1, "attempts": { "<examId>": [ { id, submittedAt, answers, score, maxScore, percent } ] } }
// Reading answers: { questionId: optionIndex }. Writing answers: { exercises: {...}, essay: "..." },
// and writing attempts also get "selfAssessment" once the learner rates their text.

const fs = require('fs');
const path = require('path');

class ResultsStore {
  constructor(file) {
    this.file = file;
    this.data = this.read();
  }

  read() {
    if (!fs.existsSync(this.file)) return { version: 1, attempts: {} };
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data && typeof data.attempts === 'object') return data;
      throw new Error('unexpected format');
    } catch (err) {
      // Keep the unreadable file instead of overwriting it, then start fresh.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, backup);
      console.error(`Could not read ${this.file} (${err.message}); moved it to ${backup}`);
      return { version: 1, attempts: {} };
    }
  }

  write() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // Write to a temp file first so a crash mid-write can't corrupt the real file.
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list(examId) {
    return this.data.attempts[examId] ?? [];
  }

  get(examId, attemptId) {
    const attempts = this.list(examId);
    return attemptId ? attempts.find((a) => a.id === attemptId) : attempts[attempts.length - 1];
  }

  // questionCount: how many questions/exercises the exam had when this attempt was made.
  add(examId, answers, summary, questionCount) {
    const attempt = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      submittedAt: new Date().toISOString(),
      questionCount,
      answers,
      score: summary.score,
      maxScore: summary.maxScore,
      percent: summary.percent
    };
    (this.data.attempts[examId] ??= []).push(attempt);
    this.write();
    return attempt;
  }

  // Save the learner's self-check ratings for a writing attempt, with the updated score.
  assess(examId, attemptId, selfAssessment, summary) {
    const attempt = this.get(examId, attemptId);
    if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
    Object.assign(attempt, { selfAssessment, score: summary.score, maxScore: summary.maxScore, percent: summary.percent });
    this.write();
    return attempt;
  }

  // Short per-exam summary for the sidebar.
  progress(examId) {
    const attempts = this.list(examId);
    if (attempts.length === 0) return null;
    return {
      attempts: attempts.length,
      bestPercent: Math.max(...attempts.map((a) => a.percent)),
      lastPercent: attempts[attempts.length - 1].percent
    };
  }
}

module.exports = { ResultsStore };
