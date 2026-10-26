// Turns a listening script into a WAV file with the Windows English voices (System.Speech,
// through PowerShell), so the app needs no audio files. A male and a female voice are used
// so two speakers in a dialogue sound different.
//
// Audio is cached in <userData>/audio-cache, keyed by a hash of the script and settings,
// so each part is synthesised only once. The newest MAX_CACHE_FILES files are kept.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MAX_CACHE_FILES = 40;
const TIMEOUT_MS = 180000;
const PAUSE_MS = 600; // between lines
const NO_VOICE_EXIT = 3;

// The PowerShell program. It reads the job (lines, rate, output file) from the JSON file
// named in $env:ERT_SPEECH_JOB, because a script inside the app's asar archive can't be run
// directly. Exit code 3 means no English voice is installed.
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$job = Get-Content -Raw -Encoding UTF8 $env:ERT_SPEECH_JOB | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$english = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' } | ForEach-Object { $_.VoiceInfo })
if ($english.Count -eq 0) { exit ${NO_VOICE_EXIT} }
$male = @($english | Where-Object { $_.Gender -eq 'Male' })[0]
$female = @($english | Where-Object { $_.Gender -eq 'Female' })[0]
if (-not $male) { $male = $english[0] }
if (-not $female) { $female = $english[0] }
$synth.Rate = [int]$job.rate
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($job.out, $format)
$prompt = New-Object System.Speech.Synthesis.PromptBuilder
foreach ($line in $job.lines) {
  if ($line.voice -eq 'female') { $prompt.StartVoice($female) } else { $prompt.StartVoice($male) }
  $prompt.AppendText([string]$line.text)
  $prompt.EndVoice()
  $prompt.AppendBreak([TimeSpan]::FromMilliseconds([int]$job.pauseMs))
}
$synth.Speak($prompt)
$synth.Dispose()
`;
const ENCODED_SCRIPT = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

class SpeechError extends Error {}

class Speech {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.queue = Promise.resolve(); // one synthesis at a time
  }

  // lines: [{ voice: 'male' | 'female', text }], rate: -10 (slow) .. 10 (fast). Resolves to a WAV Buffer.
  audioFor(lines, rate) {
    const key = crypto.createHash('sha1').update(JSON.stringify({ lines, rate, pause: PAUSE_MS })).digest('hex');
    const file = path.join(this.cacheDir, `${key}.wav`);
    const run = async () => {
      if (!fs.existsSync(file)) await this.synthesise(lines, rate, file);
      const now = new Date();
      fs.utimesSync(file, now, now); // mark as recently used
      return fs.readFileSync(file);
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  synthesise(lines, rate, file) {
    if (process.platform !== 'win32') return Promise.reject(new SpeechError('Listening audio needs the Windows voices.'));
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const tmp = `${file}.part.wav`;
    const jobFile = `${file}.job.json`;
    fs.writeFileSync(jobFile, JSON.stringify({ lines, rate, pauseMs: PAUSE_MS, out: tmp }), 'utf8');
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED_SCRIPT],
        { env: { ...process.env, ERT_SPEECH_JOB: jobFile }, windowsHide: true, timeout: TIMEOUT_MS },
        (err, _stdout, stderr) => {
          fs.rmSync(jobFile, { force: true });
          if (err) {
            fs.rmSync(tmp, { force: true });
            if (err.code === NO_VOICE_EXIT) {
              return reject(new SpeechError('No English voice is installed on this computer. Open Windows Settings › Time & language › Speech › Add voices, add "English (United States)", then try again.'));
            }
            return reject(new SpeechError(`The audio could not be made: ${String(stderr || err.message).trim().slice(0, 300)}`));
          }
          fs.renameSync(tmp, file);
          this.prune();
          resolve();
        }
      );
    });
  }

  // Keep only the most recently used files.
  prune() {
    const files = fs.readdirSync(this.cacheDir)
      .filter((f) => /^[0-9a-f]{40}\.wav$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(this.cacheDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(MAX_CACHE_FILES)) fs.rmSync(path.join(this.cacheDir, f), { force: true });
  }
}

module.exports = { Speech, SpeechError };
