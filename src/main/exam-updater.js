// Downloads new and changed exams (and the dictionary files that go with them) from the
// app's GitHub repository, so installed copies get new exams without a new installer.
//
// Downloads go to <userData>/updates/data/..., next to the bundled data folder, which is
// read-only inside the installed app. Files are compared by their git blob hash, so only
// files that differ from the local copy are downloaded.
//
// updates/state.json: { appVersion, newExamIds: [...], lastUpdate }
// The downloads are dropped when a different app version is installed, because that
// version's bundled exams already include everything that was on GitHub when it was built.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateExam, validateWritingExam } = require('./exam-store');

const EXAM_FILE = /^data\/(reading|writing)\/([a-z0-9-]+\.json)$/;
const DICTIONARY_FILES = ['data/dictionary/vi.json', 'data/dictionary/supplement.json'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30000;

// The hash git gives a file's content, the same one GitHub lists for each file.
function gitBlobSha(buffer) {
  return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

class ExamUpdater {
  // repo: "owner/name"; bundledDir: the app's data folder; userDataDir: app.getPath('userData').
  constructor({ repo, branch, bundledDir, userDataDir, appVersion }) {
    this.repo = repo;
    this.branch = branch;
    this.bundledDir = bundledDir;
    this.root = path.join(userDataDir, 'updates');
    this.dataDir = path.join(this.root, 'data');
    this.stateFile = path.join(this.root, 'state.json');
    this.appVersion = appVersion;
    this.state = this.readState();
  }

  readState() {
    let state = null;
    try {
      state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      // No updates yet, or an unreadable file: start fresh.
    }
    if (state?.appVersion !== this.appVersion) {
      fs.rmSync(this.dataDir, { recursive: true, force: true });
      state = { appVersion: this.appVersion, newExamIds: [], lastUpdate: null };
    }
    return state;
  }

  saveState() {
    writeAtomic(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  // The local copy of a repository file: the downloaded one if there is one, else the bundled one.
  localFile(repoPath) {
    const relative = repoPath.slice('data/'.length);
    const downloaded = path.join(this.dataDir, relative);
    return fs.existsSync(downloaded) ? downloaded : path.join(this.bundledDir, relative);
  }

  // A file in the downloaded data folder (the dictionary loads these when present).
  downloadedFile(...parts) {
    const file = path.join(this.dataDir, ...parts);
    return fs.existsSync(file) ? file : null;
  }

  isNew(examId) {
    return this.state.newExamIds.includes(examId);
  }

  markSeen(examId) {
    if (!this.isNew(examId)) return;
    this.state.newExamIds = this.state.newExamIds.filter((id) => id !== examId);
    this.saveState();
  }

  async fetch(url, as) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'english-reading-test', Accept: as === 'json' ? 'application/vnd.github+json' : '*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.status === 403 || res.status === 429) throw new Error('GitHub is busy right now (too many update checks). Please try again in an hour.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`);
    if (as === 'json') return res.json();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_FILE_BYTES) throw new Error(`File too large: ${url}`);
    return buffer;
  }

  // Downloads every exam or dictionary file that differs from the local copy.
  // knownIds: ids of the exams loaded now, so newly added exams can be marked "new".
  // Returns { added, changed, dictionary, skipped } (counts, and the files that failed validation).
  async update(knownIds) {
    // Pin one commit, so the file list and the downloads always match.
    const commit = await this.fetch(`https://api.github.com/repos/${this.repo}/commits/${this.branch}`, 'json');
    const tree = await this.fetch(`https://api.github.com/repos/${this.repo}/git/trees/${commit.sha}?recursive=1`, 'json');

    const wanted = tree.tree.filter((f) => f.type === 'blob' && (EXAM_FILE.test(f.path) || DICTIONARY_FILES.includes(f.path)));
    const changedFiles = wanted.filter((f) => {
      const local = this.localFile(f.path);
      if (!fs.existsSync(local)) return true;
      // Git on Windows may check files out with CRLF line endings; GitHub stores LF.
      const content = fs.readFileSync(local);
      const lf = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
      return gitBlobSha(content) !== f.sha && gitBlobSha(lf) !== f.sha;
    });

    const result = { added: 0, changed: 0, dictionary: 0, skipped: [] };
    const newIds = [];
    for (const file of changedFiles) {
      try {
        const buffer = await this.fetch(`https://raw.githubusercontent.com/${this.repo}/${commit.sha}/${file.path}`, 'raw');
        if (gitBlobSha(buffer) !== file.sha) throw new Error('download was incomplete');
        const json = JSON.parse(buffer.toString('utf8'));
        const exam = file.path.match(EXAM_FILE);
        if (exam) {
          // Same checks as the bundled exams, so a broken file never reaches the app.
          (exam[1] === 'writing' ? validateWritingExam : validateExam)(json, file.path);
          if (knownIds.has(json.id)) result.changed++;
          else {
            result.added++;
            newIds.push(json.id);
          }
        } else {
          if (typeof json !== 'object' || Array.isArray(json)) throw new Error('unexpected format');
          result.dictionary++;
        }
        writeAtomic(path.join(this.dataDir, file.path.slice('data/'.length)), buffer);
      } catch (err) {
        result.skipped.push(`${file.path}: ${err.message}`);
      }
    }

    this.state.newExamIds = [...new Set([...this.state.newExamIds, ...newIds])];
    this.state.lastUpdate = new Date().toISOString();
    this.saveState();
    return result;
  }
}

module.exports = { ExamUpdater, gitBlobSha };
