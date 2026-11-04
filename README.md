# Follow Along Reader

A browser app that helps students follow and understand what they're reading. A pointer and highlight move word by word through the text.

## Three ways to use it

| Mode | What you give it | What happens |
|---|---|---|
| 🎧 **Audio → Text** | An audio file (MP3, WAV, M4A, OGG, or even an MP4 video) | It writes out every word with its exact timing. When you press play, the pointer follows the speaker. Click any word to jump the audio there. |
| 📄 **PDF → Audio** | A PDF, a .txt file, or pasted text | It reads the text aloud with the computer's voice while the pointer follows along. You can choose the voice and speed. Click any word to start reading from there. |
| 🎤 **Read aloud yourself** | Any text loaded in the reader | The student reads into the microphone and the pointer follows where they are. Words read correctly get a green underline. Skipped words get an orange wavy underline. It also shows a words-per-minute count. |

Reading supports: adjustable text size and line spacing, readable fonts (Atkinson Hyperlegible and Lexend), the current sentence highlighted lightly, words already read faded, a "focus line" mode that dims other paragraphs, and auto-scroll. Press **Space** to play or pause and **Esc** to stop.

## Run it

It's a static site with no build step. Serve the folder with any web server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk (`file://`) won't work, because the speech model runs in a Web Worker. The microphone also needs `localhost` or `https://`. To share it, put the folder on any static host, such as GitHub Pages, Netlify, or Vercel.

## How it works

- **Speech to text:** Whisper (via [Transformers.js](https://github.com/huggingface/transformers.js)) runs **entirely in the browser**, with word-level timestamps (`whisper-worker.js`). The model downloads once (~40–80 MB) and is then cached. The app uses the GPU (WebGPU) when it's available and falls back to the CPU. Long recordings are cut into ~30-second pieces at quiet moments, and the words appear while it's still working.
- **PDF text:** [pdf.js](https://mozilla.github.io/pdf.js/) pulls out the text. It rebuilds paragraphs from the line spacing, joins words split by hyphens, and removes page numbers. Scanned (image-only) PDFs have no text to pull out.
- **Text to speech:** the browser's built-in `speechSynthesis`, one sentence at a time. Some voices don't report which word they're on. For those, the app estimates the position from the speaking speed.
- **Following the microphone:** the browser's `SpeechRecognition`. Each word it hears is matched against the next few words in the text. The matching allows for close mispronunciations and ignores "um" and "uh". If the reader skips ahead or goes back, the app finds them again from their last three words.

## Browser support & notes

- Use **Chrome or Edge** for everything. Safari works for most features. **Firefox can't do microphone following** (it has no speech recognition).
- In Chrome, microphone speech recognition is processed by Google's servers. Audio transcription and PDF reading stay on the device.
- The PDF → Audio mode reads aloud live. It doesn't save an MP3, because browsers' built-in voices can't be recorded to a file.
