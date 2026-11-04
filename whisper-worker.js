// Web Worker: speech-to-text with word timestamps, fully in the browser.
// Uses Whisper (via Transformers.js). The model is downloaded once and cached by the browser.
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js';

const SAMPLE_RATE = 16000;
let transcriber = null;
let loadedKey = null;

async function getTranscriber(model, device) {
  const key = model + '|' + device;
  if (transcriber && loadedKey === key) return transcriber;
  const dtype = device === 'webgpu'
    ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
    : { encoder_model: 'fp32', decoder_model_merged: 'q8' };
  transcriber = await pipeline('automatic-speech-recognition', model, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        self.postMessage({ type: 'download', file: p.file, loaded: p.loaded, total: p.total });
      }
    },
  });
  loadedKey = key;
  return transcriber;
}

// Pick a cut point near the target end, in the quietest 100 ms window, so words aren't split.
function findCut(audio, start, maxLen) {
  const hardEnd = Math.min(audio.length, start + maxLen);
  if (hardEnd >= audio.length) return audio.length;
  const searchFrom = start + Math.floor(maxLen * 0.7);
  const win = Math.floor(SAMPLE_RATE * 0.1);
  let best = hardEnd, bestEnergy = Infinity;
  for (let s = searchFrom; s + win <= hardEnd; s += Math.floor(win / 2)) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += audio[i] * audio[i];
    if (e < bestEnergy) { bestEnergy = e; best = s + Math.floor(win / 2); }
  }
  return best;
}

self.onmessage = async (ev) => {
  const { audio, model, device, language } = ev.data;
  try {
    self.postMessage({ type: 'status', text: 'Loading speech model (first time only — may take a minute)…' });
    let asr;
    let usedDevice = device;
    try {
      asr = await getTranscriber(model, device);
    } catch (err) {
      if (device !== 'wasm') {
        usedDevice = 'wasm';
        self.postMessage({ type: 'status', text: 'GPU not available, falling back to CPU…' });
        asr = await getTranscriber(model, 'wasm');
      } else throw err;
    }
    self.postMessage({ type: 'status', text: `Transcribing on ${usedDevice === 'webgpu' ? 'GPU' : 'CPU'}…` });

    const maxLen = SAMPLE_RATE * 29;
    let start = 0;
    const total = audio.length;
    while (start < total) {
      const end = findCut(audio, start, maxLen);
      const slice = audio.subarray(start, end);
      const offset = start / SAMPLE_RATE;
      const opts = { return_timestamps: 'word' };
      if (language && !model.endsWith('.en_timestamped')) { opts.language = language; opts.task = 'transcribe'; }
      const out = await asr(slice, opts);
      const words = (out.chunks || [])
        .map((c) => ({
          text: c.text.trim(),
          start: (c.timestamp[0] ?? 0) + offset,
          end: (c.timestamp[1] ?? c.timestamp[0] ?? 0) + offset,
        }))
        .filter((w) => w.text.length);
      self.postMessage({ type: 'words', words, progress: end / total });
      start = end;
    }
    self.postMessage({ type: 'done' });
  } catch (err) {
    self.postMessage({ type: 'error', text: String(err && err.message ? err.message : err) });
  }
};
