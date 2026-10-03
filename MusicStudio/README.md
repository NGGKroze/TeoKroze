# Kroze Music Studio

A desktop app for **making music videos**: generate music or load your own song,
build an audio-reactive visualizer on top of an image or video, auto-detect
and animate lyrics, and export a finished MP4/WebM.

Everything runs locally on your computer.

## Features

**Audio**
- Load your own song (mp3, wav, flac, ogg, m4a…)
- **Instant music generator**: 6 styles (Lo-fi, Synthwave, Deep House, Trap, Chill Pop, Ambient), key, scale, BPM, length, seed and a 5-channel mix (drums, bass, chords, pad, melody). It builds a full arrangement (intro, verse, chorus, break, outro). The same seed always gives the same track.
- **AI music (MusicGen, experimental)**: text-to-music from a prompt, up to 30 s per clip, runs on your machine
- Save any track as WAV

**Visuals**
- Background: animated gradient, solid colour, **your image** or **your video** (loops), with blur, darken, beat zoom and slow camera drift
- Visualizer styles: circle spectrum with cover art, spectrum bars, mirrored bars, spectrum mountains, waveform, pulse rings and particle burst
- Tuning: colours, rainbow cycle, bar count, sensitivity, smoothing, glow, size, width, position, rotation, peak markers
- Title/artist overlay, vignette, film grain, floating dust, beat shake and beat flash

**Lyrics**
- **Auto-detect lyrics** with Whisper (word-level timing, many languages)
- Import/export `.lrc` (including word-timed "enhanced" LRC), `.srt`, `.txt`
- **Tap-sync**: play the song and press Space at the start of each line
- Spread plain lyrics evenly, then edit the `[mm:ss.xx]` times by hand
- Animations: karaoke fill, word pop-in, bouncing word, glow, typewriter, slide and fade. You can also set the font, colours, outline, shadow, position, previous/next lines, beat pulse and a timing shift.

**Export**
- 16:9 (YouTube), 9:16 (TikTok/Reels/Shorts), 1:1, 4:5
- 720p, 1080p, 1440p or 4K at 24, 30 or 60 fps, as MP4 (H.264 + AAC) or WebM (VP9 + Opus)
- Every frame is rendered and passed to the bundled ffmpeg, so the export never drops frames. A slow computer only makes the export take longer.
- Quick-test export of the first 15, 30 or 60 seconds
- Save and open projects (settings + lyrics)

## Download

The installers are built automatically by GitHub Actions
(`.github/workflows/music-studio.yml`):

- Go to **Actions → Build Kroze Music Studio → latest run → Artifacts**
  - `KrozeMusicStudio-Windows`: `…-win-x64.exe` (installer) and `…-win-x64.zip` (portable)
  - `KrozeMusicStudio-macOS`: `.dmg` and `.zip`
  - `KrozeMusicStudio-Linux`: `.AppImage` and `.zip`
- If you push a tag like `studio-v1.0.0`, the workflow also attaches the files to a GitHub Release.

The builds are not code-signed:
- On Windows, SmartScreen may show a warning. Click *More info → Run anyway*.
- On macOS, right-click the app and choose *Open* the first time.

## Run from source

```bash
cd MusicStudio
npm install --ignore-scripts
node node_modules/ffmpeg-static/install.js
node node_modules/electron/install.js
npm start
```

Build installers locally with `npm run dist:win`, `npm run dist:mac` or
`npm run dist:linux`. Files are written to `MusicStudio/release/`.

## Notes

- The AI features (Whisper lyrics detection and MusicGen) download their models from Hugging Face the first time you use them and cache them after that. This needs an internet connection the first time. They run on WebGPU when available and otherwise on the CPU.
- Lyrics detection works best on songs with clear vocals. Always check the detected text. You can edit it directly in the lyrics box.
- Projects save settings and lyrics only. After opening a project, add your audio, images and videos again.

## Project layout

```
main.js              Electron main process: windows, dialogs, ffmpeg export pipe
preload.js           Safe bridge between UI and main process
src/index.html       UI
src/js/app.js        UI wiring and state
src/js/audio-engine.js  decoding, playback, FFT analysis, WAV encoding
src/js/generator.js  procedural music generator
src/js/visualizer.js canvas renderer (background, visualizers, effects)
src/js/lyrics.js     LRC/SRT parsing, transcript → lines, lyric animations
src/js/exporter.js   frame-by-frame video export
src/js/ai-worker.js  Whisper + MusicGen (transformers.js) in a web worker
```
