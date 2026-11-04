// Follow Along Reader
// 1) Audio file  -> transcript with word timings (Whisper in the browser) -> pointer follows playback
// 2) PDF / text  -> read aloud with the browser's text-to-speech -> pointer follows the voice
// 3) Microphone  -> student reads aloud -> pointer follows where they are in the text

const $ = (id) => document.getElementById(id);
const els = {
  tabs: document.querySelectorAll('.tab'),
  audioFile: $('audioFile'), audioDrop: $('audioDrop'), audio: $('audio'),
  modelSelect: $('modelSelect'), langSelect: $('langSelect'),
  transcribeBtn: $('transcribeBtn'), downloadTranscriptBtn: $('downloadTranscriptBtn'),
  asrProgress: $('asrProgress'), pastedTranscript: $('pastedTranscript'), useTranscriptBtn: $('useTranscriptBtn'),
  pdfFile: $('pdfFile'), pdfDrop: $('pdfDrop'), pageRow: $('pageRow'), pageFrom: $('pageFrom'), pageTo: $('pageTo'),
  loadPagesBtn: $('loadPagesBtn'), pastedText: $('pastedText'), usePastedTextBtn: $('usePastedTextBtn'),
  voiceSelect: $('voiceSelect'), rateInput: $('rateInput'), rateOut: $('rateOut'),
  ttsPlayBtn: $('ttsPlayBtn'), ttsStopBtn: $('ttsStopBtn'),
  micBtn: $('micBtn'), micIndicator: $('micIndicator'), heard: $('heard'), micStats: $('micStats'),
  fontSize: $('fontSize'), lineHeight: $('lineHeight'), fontSelect: $('fontSelect'),
  followToggle: $('followToggle'), dimToggle: $('dimToggle'), focusToggle: $('focusToggle'),
  status: $('status'), reader: $('reader'), text: $('text'), pointer: $('pointer'),
};

function setStatus(msg) { els.status.textContent = msg; }

// ---------- tiny storage helpers (never required to work) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('far:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('far:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// =====================================================================
// Document model + reader rendering
// =====================================================================
// doc.words[i] = { text, norm, start?, end?, el, sent, para }
const doc = { kind: null, words: [], sentences: [], paras: [], title: '' };
let cur = -1;

const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'etc', 'eg', 'ie', 'prof', 'mt', 'no', 'fig']);
const normalize = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

function endsSentence(word) {
  if (!/[.!?…]["'”’)\]]*$/.test(word)) return false;
  const base = normalize(word);
  return !(word.endsWith('.') && ABBREV.has(base)) && !/^[A-Z]\.$/.test(word);
}

// blocks: [{ type: 'p', words: [{text, start?, end?}] } | { type: 'page', label }]
function loadDocument(blocks, kind, title = '', { keepPlaying = false } = {}) {
  if (!keepPlaying) stopEverything();
  doc.kind = kind; doc.title = title; doc.words = []; doc.sentences = []; doc.paras = [];
  cur = -1;
  const frag = document.createDocumentFragment();
  let sentStart = 0;
  for (const b of blocks) {
    if (b.type === 'page') {
      const d = document.createElement('div');
      d.className = 'page-mark'; d.textContent = b.label;
      frag.appendChild(d);
      continue;
    }
    if (!b.words.length) continue;
    const p = document.createElement('p');
    const paraIdx = doc.paras.length;
    doc.paras.push(p);
    b.words.forEach((w, k) => {
      const i = doc.words.length;
      const span = document.createElement('span');
      span.className = 'w'; span.textContent = w.text; span.dataset.i = i;
      p.appendChild(span);
      p.appendChild(document.createTextNode(' '));
      doc.words.push({ text: w.text, norm: normalize(w.text), start: w.start, end: w.end, el: span, sent: doc.sentences.length, para: paraIdx });
      if (endsSentence(w.text) || k === b.words.length - 1) {
        doc.sentences.push([sentStart, i]);
        sentStart = i + 1;
      }
    });
    frag.appendChild(p);
  }
  els.text.replaceChildren(frag);
  if (!doc.words.length) {
    els.text.innerHTML = '<p class="empty">No readable text was found.</p>';
  }
  els.pointer.classList.remove('show');
  if (!keepPlaying) els.reader.scrollTop = 0;
  refreshButtons();
}

function setCurrent(i, { scroll = true } = {}) {
  const words = doc.words;
  if (!words.length) return;
  i = Math.max(-1, Math.min(i, words.length - 1));
  if (i === cur) return;
  const prev = cur;
  if (prev >= 0) words[prev].el.classList.remove('cur');

  // sentence highlight
  const ps = prev >= 0 ? words[prev].sent : -1;
  const ns = i >= 0 ? words[i].sent : -1;
  if (ps !== ns) {
    if (ps >= 0) { const [a, b] = doc.sentences[ps]; for (let k = a; k <= b; k++) words[k].el.classList.remove('sent'); }
    if (ns >= 0) { const [a, b] = doc.sentences[ns]; for (let k = a; k <= b; k++) words[k].el.classList.add('sent'); }
  }
  // "already read" marks
  if (i > prev) for (let k = Math.max(prev, 0); k < i; k++) words[k].el.classList.add('done');
  else for (let k = Math.max(i, 0); k <= prev; k++) words[k].el.classList.remove('done');

  // focus paragraph
  const pp = prev >= 0 ? words[prev].para : -1;
  const np = i >= 0 ? words[i].para : -1;
  if (pp !== np) {
    if (pp >= 0) doc.paras[pp].classList.remove('active');
    if (np >= 0) doc.paras[np].classList.add('active');
  }

  cur = i;
  if (i < 0) { els.pointer.classList.remove('show'); return; }
  const el = words[i].el;
  el.classList.add('cur');
  movePointer(el);
  if (scroll) autoScroll(el);
}

function movePointer(el) {
  const x = el.offsetLeft + el.offsetWidth / 2 - 9;
  const y = el.offsetTop + el.offsetHeight - 2;
  els.pointer.style.transform = `translate(${x}px, ${y}px)`;
  els.pointer.classList.add('show');
}

let userScrolledAt = 0;
['wheel', 'touchmove'].forEach((e) => els.reader.addEventListener(e, () => { userScrolledAt = performance.now(); }, { passive: true }));

function autoScroll(el) {
  if (!els.followToggle.checked || performance.now() - userScrolledAt < 4000) return;
  const r = els.reader;
  const top = el.offsetTop;
  if (top < r.scrollTop + 30 || top > r.scrollTop + r.clientHeight * 0.6) {
    r.scrollTo({ top: Math.max(0, top - r.clientHeight * 0.3) });
  }
}

window.addEventListener('resize', () => { if (cur >= 0) movePointer(doc.words[cur].el); });

// Click a word to jump there
els.text.addEventListener('click', (e) => {
  const span = e.target.closest('.w');
  if (!span) return;
  const i = +span.dataset.i;
  if (mic.active) { micSetPosition(i); return; }
  if (doc.kind === 'audio') {
    const w = doc.words[i];
    if (w.start != null) {
      els.audio.currentTime = w.start + 0.01;
      setCurrent(i);
      els.audio.play();
    }
    return;
  }
  if (tts.playing) speakFrom(i);
  else { setCurrent(i); tts.resumeAt = i; }
});

// ---------- reader settings ----------
function applySettings() {
  els.text.style.setProperty('--reader-size', els.fontSize.value + 'px');
  els.text.style.setProperty('--reader-lh', els.lineHeight.value);
  els.text.classList.remove('font-lexend', 'font-serif');
  if (els.fontSelect.value !== 'atkinson') els.text.classList.add('font-' + els.fontSelect.value);
  els.reader.classList.toggle('dim', els.dimToggle.checked);
  els.reader.classList.toggle('focus', els.focusToggle.checked);
  store.set('settings', {
    fontSize: els.fontSize.value, lineHeight: els.lineHeight.value, font: els.fontSelect.value,
    follow: els.followToggle.checked, dim: els.dimToggle.checked, focus: els.focusToggle.checked,
  });
  if (cur >= 0) requestAnimationFrame(() => movePointer(doc.words[cur].el));
}
(function restoreSettings() {
  const s = store.get('settings', null);
  if (s) {
    els.fontSize.value = s.fontSize; els.lineHeight.value = s.lineHeight; els.fontSelect.value = s.font;
    els.followToggle.checked = s.follow; els.dimToggle.checked = s.dim; els.focusToggle.checked = s.focus;
  }
  applySettings();
})();
[els.fontSize, els.lineHeight, els.fontSelect, els.followToggle, els.dimToggle, els.focusToggle]
  .forEach((el) => el.addEventListener('input', applySettings));
document.fonts && document.fonts.ready.then(() => { if (cur >= 0) movePointer(doc.words[cur].el); });

// ---------- tabs ----------
els.tabs.forEach((tab) => tab.addEventListener('click', () => {
  els.tabs.forEach((t) => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab); });
  $('tab-audio').hidden = tab.dataset.tab !== 'audio';
  $('tab-pdf').hidden = tab.dataset.tab !== 'pdf';
}));

// ---------- drag & drop ----------
function wireDrop(zone, input) {
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag');
    if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); }
  });
}
wireDrop(els.audioDrop, els.audioFile);
wireDrop(els.pdfDrop, els.pdfFile);

function refreshButtons() {
  const hasAudio = !!els.audio.src;
  els.transcribeBtn.disabled = !hasAudio || asr.running;
  els.useTranscriptBtn.disabled = !hasAudio;
  els.downloadTranscriptBtn.disabled = !doc.words.length;
  els.ttsPlayBtn.disabled = !doc.words.length || doc.kind === 'audio';
  els.ttsStopBtn.disabled = !tts.playing;
  els.micBtn.disabled = !doc.words.length || !SR;
}

function stopEverything() {
  if (!els.audio.paused) els.audio.pause();
  stopSpeech();
  if (mic.active) stopMic();
}

// =====================================================================
// 1) AUDIO -> TEXT (Whisper in a Web Worker)
// =====================================================================
const asr = { worker: null, running: false, words: [], file: null };

els.audioFile.addEventListener('change', () => {
  const f = els.audioFile.files[0];
  if (!f) return;
  asr.file = f;
  els.audio.src = URL.createObjectURL(f);
  els.audio.hidden = false;
  els.audioDrop.querySelector('.file-drop-text').innerHTML = `<strong>${escapeHtml(f.name)}</strong><br><small>Choose a different file</small>`;
  setStatus('Audio loaded. Press “Transcribe audio” to turn it into text.');
  refreshButtons();
});

async function decodeTo16k(file) {
  const ab = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const buf = await ctx.decodeAudioData(ab);
  ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

// Group timed words into readable paragraphs (new paragraph on long pauses / every few sentences)
function timedWordsToBlocks(words) {
  const blocks = [];
  let para = [], sentences = 0;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && para.length && ((w.start - prev.end > 1.6) || (sentences >= 4 && endsSentence(prev.text)))) {
      blocks.push({ type: 'p', words: para }); para = []; sentences = 0;
    }
    para.push(w);
    if (endsSentence(w.text)) sentences++;
  });
  if (para.length) blocks.push({ type: 'p', words: para });
  return blocks;
}

async function pickDevice() {
  try { if (navigator.gpu && await navigator.gpu.requestAdapter()) return 'webgpu'; } catch { /* no gpu */ }
  return 'wasm';
}

els.transcribeBtn.addEventListener('click', async () => {
  if (!asr.file || asr.running) return;
  asr.running = true; asr.words = [];
  refreshButtons();
  const bar = els.asrProgress.querySelector('.progress-bar');
  els.asrProgress.hidden = false; bar.style.width = '0%';
  try {
    setStatus('Preparing audio…');
    const audio = await decodeTo16k(asr.file);
    if (!asr.worker) asr.worker = new Worker('whisper-worker.js', { type: 'module' });
    const device = await pickDevice();
    const dl = {};
    asr.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'status') setStatus(m.text);
      else if (m.type === 'download') {
        dl[m.file] = [m.loaded, m.total];
        const [l, t] = Object.values(dl).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
        setStatus(`Downloading speech model… ${Math.round((l / t) * 100)}% (only the first time)`);
        bar.style.width = Math.round((l / t) * 100) + '%';
      } else if (m.type === 'words') {
        asr.words.push(...m.words);
        const keep = cur;
        loadDocument(timedWordsToBlocks(asr.words), 'audio', asr.file.name, { keepPlaying: true });
        if (!els.audio.paused) { cancelAnimationFrame(rafId); loop(); }
        bar.style.width = Math.round(m.progress * 100) + '%';
        setStatus(`Transcribing… ${Math.round(m.progress * 100)}% — you can start playing already.`);
        if (keep >= 0) syncToAudio();
      } else if (m.type === 'done') {
        asr.running = false; els.asrProgress.hidden = true;
        setStatus(`Done — ${asr.words.length} words. Press play, or click any word to jump there.`);
        refreshButtons();
      } else if (m.type === 'error') {
        asr.running = false; els.asrProgress.hidden = true;
        setStatus('Transcription failed: ' + m.text + ' — you can paste a transcript instead.');
        refreshButtons();
      }
    };
    asr.worker.postMessage({ audio, model: els.modelSelect.value, device, language: els.langSelect.value }, [audio.buffer]);
  } catch (err) {
    asr.running = false; els.asrProgress.hidden = true;
    setStatus('Could not read that audio file: ' + (err.message || err));
    refreshButtons();
  }
});

// Paste-a-transcript fallback: spread words over the audio duration, weighted by length and punctuation.
els.useTranscriptBtn.addEventListener('click', async () => {
  const raw = els.pastedTranscript.value.trim();
  if (!raw) { setStatus('Paste the transcript first.'); return; }
  if (!isFinite(els.audio.duration)) await new Promise((r) => els.audio.addEventListener('loadedmetadata', r, { once: true }));
  const dur = els.audio.duration;
  const paras = textToParagraphs(raw);
  const all = paras.flat();
  const weight = (t) => t.length + 2 + (/[.!?]$/.test(t) ? 6 : /[,;:]$/.test(t) ? 3 : 0);
  const total = all.reduce((s, t) => s + weight(t), 0);
  let t = 0;
  const blocks = paras.map((p) => ({
    type: 'p',
    words: p.map((text) => { const d = (weight(text) / total) * dur; const w = { text, start: t, end: t + d }; t += d; return w; }),
  }));
  loadDocument(blocks, 'audio', asr.file ? asr.file.name : 'transcript');
  setStatus('Transcript synced by estimate. Press play. (Use “Transcribe audio” for exact timing.)');
});

els.downloadTranscriptBtn.addEventListener('click', () => {
  const text = doc.paras.map((p) => p.textContent.trim()).join('\n\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = (doc.title || 'transcript').replace(/\.[^.]+$/, '') + '.txt';
  a.click();
});

// Playback sync
function wordAtTime(t) {
  const w = doc.words;
  let lo = 0, hi = w.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (w[mid].start <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
function syncToAudio() { if (doc.kind === 'audio') setCurrent(wordAtTime(els.audio.currentTime)); }
let rafId = 0;
function loop() { syncToAudio(); if (!els.audio.paused) rafId = requestAnimationFrame(loop); }
els.audio.addEventListener('play', () => {
  if (mic.active) stopMic();
  stopSpeech();
  els.pointer.classList.remove('mic');
  cancelAnimationFrame(rafId); loop();
});
els.audio.addEventListener('seeked', syncToAudio);
els.audio.addEventListener('pause', () => cancelAnimationFrame(rafId));

// =====================================================================
// 2) PDF / TEXT -> AUDIO (Web Speech synthesis)
// =====================================================================
const PDFJS = window.pdfjsLib;
if (PDFJS) PDFJS.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfDoc = null, pdfName = '';

function textToParagraphs(raw) {
  let parts = raw.replace(/\r/g, '').split(/\n\s*\n/);
  if (parts.length === 1) parts = raw.split(/\n/);
  return parts.map((p) => p.replace(/-\n(?=\p{Ll})/gu, '').split(/\s+/).filter(Boolean)).filter((p) => p.length);
}

els.pdfFile.addEventListener('change', async () => {
  const f = els.pdfFile.files[0];
  if (!f) return;
  els.pdfDrop.querySelector('.file-drop-text').innerHTML = `<strong>${escapeHtml(f.name)}</strong><br><small>Choose a different file</small>`;
  if (f.type === 'text/plain' || /\.txt$/i.test(f.name)) {
    els.pageRow.hidden = true;
    const paras = textToParagraphs(await f.text());
    loadDocument(paras.map((p) => ({ type: 'p', words: p.map((text) => ({ text })) })), 'text', f.name);
    setStatus(`Loaded ${doc.words.length} words. Press “Read aloud”, or use the microphone.`);
    return;
  }
  if (!PDFJS) { setStatus('The PDF reader failed to load. Check your internet connection and reload.'); return; }
  try {
    setStatus('Opening PDF…');
    pdfDoc = await PDFJS.getDocument({ data: await f.arrayBuffer() }).promise;
    pdfName = f.name;
    const n = pdfDoc.numPages;
    els.pageFrom.max = els.pageTo.max = n;
    els.pageFrom.value = 1; els.pageTo.value = Math.min(n, 30);
    els.pageRow.hidden = n <= 1;
    await loadPdfPages(1, Math.min(n, 30));
  } catch (err) {
    setStatus('Could not open that PDF: ' + (err.message || err));
  }
});

els.loadPagesBtn.addEventListener('click', () => {
  if (!pdfDoc) return;
  const n = pdfDoc.numPages;
  let a = Math.max(1, Math.min(n, +els.pageFrom.value || 1));
  let b = Math.max(a, Math.min(n, +els.pageTo.value || a));
  loadPdfPages(a, b);
});

async function pageToParagraphs(page) {
  const tc = await page.getTextContent();
  const lines = [];
  let line = null;
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform[5];
    const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    if (line && Math.abs(y - line.y) > h * 0.5 && line.text.trim()) { lines.push(line); line = null; }
    if (!line) line = { text: '', y, h };
    if (line.text && it.str && !/\s$/.test(line.text) && !/^\s/.test(it.str) && Math.abs(y - line.y) <= h * 0.5) {
      // items on the same line sometimes arrive without a space between them
      const prevEnd = line.x2 ?? null;
      if (prevEnd != null && it.transform[4] - prevEnd > h * 0.15) line.text += ' ';
    }
    line.text += it.str;
    line.x2 = it.transform[4] + (it.width || 0);
    if (it.hasEOL) { if (line.text.trim()) lines.push(line); line = null; }
  }
  if (line && line.text.trim()) lines.push(line);

  const clean = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text && !/^\d{1,4}$/.test(l.text)); // drop bare page numbers
  const gaps = [];
  for (let i = 1; i < clean.length; i++) { const g = clean[i - 1].y - clean[i].y; if (g > 0) gaps.push(g); }
  gaps.sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;

  const paras = [];
  let text = '';
  clean.forEach((l, i) => {
    if (i > 0) {
      const gap = clean[i - 1].y - l.y;
      const newPara = gap > typical * 1.45 || gap < -typical; // big vertical gap, or jumped to a new column
      if (newPara) { paras.push(text); text = ''; }
    }
    if (!text) text = l.text;
    else if (/[A-Za-z]-$/.test(text) && /^\p{Ll}/u.test(l.text)) text = text.slice(0, -1) + l.text;
    else text += ' ' + l.text;
  });
  if (text) paras.push(text);
  return paras.map((p) => p.split(/\s+/).filter(Boolean)).filter((p) => p.length);
}

async function loadPdfPages(from, to) {
  const blocks = [];
  for (let n = from; n <= to; n++) {
    setStatus(`Reading page ${n} of ${to}…`);
    const page = await pdfDoc.getPage(n);
    const paras = await pageToParagraphs(page);
    if (to > from) blocks.push({ type: 'page', label: `Page ${n}` });
    paras.forEach((p) => blocks.push({ type: 'p', words: p.map((text) => ({ text })) }));
  }
  loadDocument(blocks, 'text', pdfName);
  if (!doc.words.length) setStatus('No text found — this PDF may be a scanned image. Try a text-based PDF or paste the text.');
  else setStatus(`Loaded ${doc.words.length} words from pages ${from}–${to}. Press “Read aloud”, or use the microphone.`);
}

els.usePastedTextBtn.addEventListener('click', () => {
  const raw = els.pastedText.value.trim();
  if (!raw) { setStatus('Type or paste some text first.'); return; }
  loadDocument(textToParagraphs(raw).map((p) => ({ type: 'p', words: p.map((text) => ({ text })) })), 'text', 'pasted text');
  setStatus(`Loaded ${doc.words.length} words. Press “Read aloud”, or use the microphone.`);
});

// ---------- speech synthesis ----------
const synth = window.speechSynthesis;
const tts = { playing: false, token: 0, utter: null, timer: 0, boundaryWorks: null, resumeAt: 0 };
let voices = [];

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices();
  if (!voices.length) return;
  const lang = (navigator.language || 'en').slice(0, 2);
  const sorted = [...voices].sort((a, b) => {
    const sa = (a.lang.startsWith(lang) ? 0 : 2) + (a.localService ? 0 : 1);
    const sb = (b.lang.startsWith(lang) ? 0 : 2) + (b.localService ? 0 : 1);
    return sa - sb || a.name.localeCompare(b.name);
  });
  const saved = store.get('voice', null);
  els.voiceSelect.innerHTML = '';
  sorted.forEach((v) => {
    const o = document.createElement('option');
    o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`;
    els.voiceSelect.appendChild(o);
  });
  if (saved && sorted.some((v) => v.voiceURI === saved)) els.voiceSelect.value = saved;
}
if (synth) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
} else {
  els.voiceSelect.innerHTML = '<option>Text-to-speech not supported in this browser</option>';
}
els.voiceSelect.addEventListener('change', () => {
  store.set('voice', els.voiceSelect.value);
  tts.boundaryWorks = null;
  if (tts.playing) speakFrom(Math.max(cur, 0));
});
els.rateInput.addEventListener('input', () => { els.rateOut.textContent = (+els.rateInput.value).toFixed(2).replace(/0$/, '') + '×'; });
els.rateInput.addEventListener('change', () => { if (tts.playing) speakFrom(Math.max(cur, 0)); });
els.rateInput.dispatchEvent(new Event('input'));

function chunkEnd(i) {
  // speak one sentence at a time (max ~30 words) — keeps Chrome from cutting off long utterances
  const [, sEnd] = doc.sentences[doc.words[i].sent];
  return Math.min(sEnd + 1, i + 30);
}

function speakFrom(i) {
  if (!synth) { setStatus('Text-to-speech is not supported in this browser.'); return; }
  stopSpeech();
  if (mic.active) stopMic();
  if (!els.audio.paused) els.audio.pause();
  els.pointer.classList.remove('mic');
  tts.playing = true;
  const tok = ++tts.token;
  els.ttsPlayBtn.textContent = '⏸ Pause';
  refreshButtons();
  setTimeout(() => speakChunk(i, tok), 60); // brief gap after cancel() for Chrome
}

function speakChunk(i, tok) {
  if (tok !== tts.token) return;
  if (i >= doc.words.length) { finishSpeech(); return; }
  const end = chunkEnd(i);
  const offsets = [];
  let text = '';
  for (let k = i; k < end; k++) { offsets.push(text.length); text += doc.words[k].text + ' '; }
  const u = new SpeechSynthesisUtterance(text);
  const v = voices.find((x) => x.voiceURI === els.voiceSelect.value);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = +els.rateInput.value;
  let got = false, startedAt = 0;
  const wordAtChar = (c) => { let k = 0; while (k + 1 < offsets.length && offsets[k + 1] <= c) k++; return i + k; };

  // Fallback for voices that don't report word boundaries: estimate from elapsed time.
  const startEstimate = () => {
    clearInterval(tts.timer);
    const cps = 14.5 * u.rate;
    tts.timer = setInterval(() => {
      if (tok !== tts.token) return clearInterval(tts.timer);
      const c = ((performance.now() - startedAt) / 1000) * cps;
      setCurrent(Math.min(wordAtChar(c), end - 1));
    }, 60);
  };
  u.onstart = () => {
    if (tok !== tts.token) return;
    startedAt = performance.now();
    setCurrent(i);
    if (tts.boundaryWorks === false) startEstimate();
    else setTimeout(() => { if (!got && tok === tts.token && end - i > 2) { tts.boundaryWorks = false; startEstimate(); } }, 900);
  };
  u.onboundary = (e) => {
    if (tok !== tts.token || (e.name && e.name !== 'word')) return;
    if (!got) { got = true; tts.boundaryWorks = true; clearInterval(tts.timer); }
    setCurrent(wordAtChar(e.charIndex));
  };
  u.onend = () => {
    if (tok !== tts.token) return;
    clearInterval(tts.timer);
    speakChunk(end, tok);
  };
  u.onerror = (e) => {
    if (tok !== tts.token || e.error === 'interrupted' || e.error === 'canceled') return;
    setStatus('Speech error: ' + e.error);
    stopSpeech();
  };
  tts.utter = u; // keep a reference so the browser doesn't garbage-collect it mid-speech
  synth.speak(u);
}

function stopSpeech() {
  if (!synth) return;
  tts.token++;
  clearInterval(tts.timer);
  if (tts.playing) { tts.resumeAt = Math.max(cur, 0); }
  tts.playing = false;
  synth.cancel();
  els.ttsPlayBtn.textContent = '▶ Read aloud';
  refreshButtons();
}
function finishSpeech() {
  stopSpeech();
  tts.resumeAt = 0;
  setStatus('Finished reading. Press “Read aloud” to start again, or click a word to start there.');
}

els.ttsPlayBtn.addEventListener('click', () => {
  if (tts.playing) { stopSpeech(); setStatus('Paused. Press “Read aloud” to continue.'); return; }
  speakFrom(tts.resumeAt || 0);
  setStatus('Reading aloud… click any word to jump there.');
});
els.ttsStopBtn.addEventListener('click', () => { stopSpeech(); tts.resumeAt = 0; setCurrent(-1); setStatus('Stopped.'); });

// =====================================================================
// 3) MICROPHONE -> follow the student's reading
// =====================================================================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = { active: false, rec: null, pos: 0, finalUpto: 0, misses: 0, recent: [], ok: 0, missed: 0, startedAt: 0 };
const FILLERS = new Set(['um', 'uh', 'er', 'ah', 'hmm', 'mm', 'erm']);
const LOOKAHEAD = 8;

if (!SR) {
  els.heard.textContent = 'Microphone following needs Chrome, Edge, or Safari (this browser has no speech recognition).';
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
function sameWord(textNorm, spoken) {
  if (!textNorm || !spoken) return false;
  if (textNorm === spoken) return true;
  const L = Math.max(textNorm.length, spoken.length);
  if (L >= 4 && (textNorm.startsWith(spoken) || spoken.startsWith(textNorm)) && Math.min(textNorm.length, spoken.length) >= 3) return true;
  const d = lev(textNorm, spoken);
  return (L >= 4 && d <= 1) || (L >= 7 && d <= 2);
}

// Advance through the text using the spoken words. When commit=true, mark words and update stats.
function advance(pos, spoken, commit) {
  const W = doc.words;
  let p = pos;
  for (const s of spoken) {
    if (!s || FILLERS.has(s)) continue;
    let found = -1;
    for (let j = p; j < Math.min(W.length, p + LOOKAHEAD); j++) {
      if (sameWord(W[j].norm, s)) { found = j; break; }
    }
    if (commit) { mic.recent.push(s); if (mic.recent.length > 4) mic.recent.shift(); }
    if (found >= 0) {
      if (commit) {
        for (let k = p; k < found; k++) { W[k].el.classList.add('missed'); mic.missed++; }
        W[found].el.classList.remove('missed'); W[found].el.classList.add('ok'); mic.ok++;
        mic.misses = 0;
      }
      p = found + 1;
    } else if (commit && ++mic.misses >= 3) {
      const j = resync(p);
      if (j >= 0) { p = j + 1; mic.misses = 0; }
    }
  }
  return p;
}

// Lost? Find the last 3 spoken words anywhere in the text, closest to where we were.
function resync(p) {
  const W = doc.words, r = mic.recent.slice(-3);
  if (r.length < 3) return -1;
  let best = -1, bestDist = Infinity;
  for (let j = 2; j < W.length; j++) {
    if (sameWord(W[j].norm, r[2]) && sameWord(W[j - 1].norm, r[1]) && sameWord(W[j - 2].norm, r[0])) {
      const dist = j >= p ? j - p : (p - j) * 1.5;
      if (dist < bestDist) { bestDist = dist; best = j; }
    }
  }
  return best;
}

function showMicPos(p) {
  if (p >= doc.words.length) {
    setCurrent(doc.words.length - 1);
    setStatus('🎉 You reached the end!');
  } else setCurrent(p);
}

function micSetPosition(i) {
  mic.pos = i; mic.misses = 0; mic.recent = [];
  showMicPos(i);
  setStatus('Okay — start reading from the highlighted word.');
}

function updateStats() {
  const mins = (performance.now() - mic.startedAt) / 60000;
  const wpm = mins > 0.15 ? Math.round(mic.ok / mins) : '—';
  els.micStats.hidden = false;
  els.micStats.innerHTML = `<span>✅ Read <b>${mic.ok}</b></span><span>⚠️ Skipped <b>${mic.missed}</b></span><span>⏱ <b>${wpm}</b> words/min</span>`;
}

function startMic() {
  if (!SR || !doc.words.length) return;
  els.audio.pause();
  stopSpeech();
  mic.active = true;
  mic.pos = Math.max(cur, 0);
  mic.misses = 0; mic.recent = []; mic.ok = 0; mic.missed = 0; mic.startedAt = performance.now();
  doc.words.forEach((w) => w.el.classList.remove('ok', 'missed'));
  els.pointer.classList.add('mic');
  showMicPos(mic.pos);
  els.micBtn.textContent = 'Stop listening';
  els.micBtn.classList.add('listening');
  setStatus('Listening… start reading from the highlighted word.');
  updateStats();
  startRecognizer();
}

function startRecognizer() {
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';
  rec.maxAlternatives = 1;
  mic.finalUpto = 0;
  rec.onaudiostart = () => els.micIndicator.classList.add('on');
  rec.onaudioend = () => els.micIndicator.classList.remove('on');
  rec.onresult = (e) => {
    if (!mic.active) return;
    let interim = '';
    for (let r = mic.finalUpto; r < e.results.length; r++) {
      const res = e.results[r];
      const said = res[0].transcript;
      if (res.isFinal) {
        mic.pos = advance(mic.pos, said.split(/\s+/).map(normalize), true);
        mic.finalUpto = r + 1;
        updateStats();
      } else interim += ' ' + said;
    }
    const tentative = advance(mic.pos, interim.split(/\s+/).map(normalize), false);
    showMicPos(tentative);
    const lastHeard = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim().split(/\s+/).slice(-12).join(' ');
    els.heard.textContent = lastHeard ? `Heard: “…${lastHeard}”` : '';
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      setStatus('Microphone access was blocked. Allow the microphone in your browser and try again.');
      stopMic();
    } else setStatus('Microphone: ' + e.error);
  };
  rec.onend = () => { if (mic.active) { try { startRecognizer(); } catch { stopMic(); } } };
  mic.rec = rec;
  try { rec.start(); } catch (err) { setStatus('Could not start the microphone: ' + err.message); stopMic(); }
}

function stopMic() {
  mic.active = false;
  if (mic.rec) { mic.rec.onend = null; try { mic.rec.stop(); } catch { /* already stopped */ } }
  mic.rec = null;
  els.micIndicator.classList.remove('on');
  els.micBtn.textContent = 'Start listening';
  els.micBtn.classList.remove('listening');
}

els.micBtn.addEventListener('click', () => {
  if (mic.active) { stopMic(); setStatus('Stopped listening.'); } else startMic();
});

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space' && doc.words.length) {
    e.preventDefault();
    if (doc.kind === 'audio' && els.audio.src) { els.audio.paused ? els.audio.play() : els.audio.pause(); }
    else if (doc.kind === 'text') els.ttsPlayBtn.click();
  } else if (e.code === 'Escape') stopEverything();
});

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

refreshButtons();

// exposed for testing in the console
window.__far = { doc, advance, normalize, loadDocument, setCurrent, mic };
