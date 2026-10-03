// On-device AI models (run in a worker so the UI stays responsive).
//  - Whisper: lyrics / speech detection with word timestamps
//  - MusicGen: text-to-music generation
// Models are downloaded from the Hugging Face Hub on first use and cached.

import { pipeline, env, AutoTokenizer, MusicgenForConditionalGeneration } from '../../node_modules/@huggingface/transformers/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

const cache = {};

function progressCb(task) {
  return (p) => {
    if (p.status === 'progress') {
      self.postMessage({ type: 'progress', task, file: p.file, progress: p.progress || 0, loaded: p.loaded, total: p.total });
    } else if (p.status === 'ready') {
      self.postMessage({ type: 'status', task, message: 'Model loaded' });
    }
  };
}

async function device() {
  try {
    if (navigator.gpu && (await navigator.gpu.requestAdapter())) return 'webgpu';
  } catch (e) { /* ignore */ }
  return 'wasm';
}

async function transcribe({ audio, model, language }) {
  const dev = await device();
  const key = `asr:${model}:${dev}`;
  if (!cache[key]) {
    self.postMessage({ type: 'status', task: 'asr', message: `Loading ${model} (${dev})…` });
    cache[key] = await pipeline('automatic-speech-recognition', model, {
      device: dev,
      dtype: dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback: progressCb('asr'),
    });
  }
  const asr = cache[key];
  self.postMessage({ type: 'status', task: 'asr', message: 'Detecting lyrics… (this can take a while)' });
  const opts = { chunk_length_s: 30, stride_length_s: 5 };
  if (language && language !== 'auto' && !model.endsWith('.en')) {
    opts.language = language;
    opts.task = 'transcribe';
  }
  try {
    return await asr(audio, { ...opts, return_timestamps: 'word' });
  } catch (e) {
    // some checkpoints lack alignment heads -> fall back to segment timestamps
    self.postMessage({ type: 'status', task: 'asr', message: 'Word timing unavailable, using line timing…' });
    return await asr(audio, { ...opts, return_timestamps: true });
  }
}

async function musicgen({ prompt, seconds, guidance, model }) {
  const key = `mg:${model}`;
  if (!cache[key]) {
    self.postMessage({ type: 'status', task: 'musicgen', message: `Loading ${model}… (first run downloads ~600 MB)` });
    const tokenizer = await AutoTokenizer.from_pretrained(model, { progress_callback: progressCb('musicgen') });
    const mg = await MusicgenForConditionalGeneration.from_pretrained(model, {
      dtype: { text_encoder: 'q8', decoder_model_merged: 'q8', encodec_decode: 'fp32' },
      device: 'wasm',
      progress_callback: progressCb('musicgen'),
    });
    cache[key] = { tokenizer, mg };
  }
  const { tokenizer, mg } = cache[key];
  self.postMessage({ type: 'status', task: 'musicgen', message: 'Generating music… (CPU, may take several minutes)' });
  const inputs = tokenizer(prompt);
  const maxTokens = Math.round(Math.max(2, Math.min(30, seconds)) * 50);
  let produced = 0;
  const streamer = {
    put() {
      produced++;
      if (produced % 10 === 0) self.postMessage({ type: 'progress', task: 'musicgen', progress: (produced / maxTokens) * 100, file: 'generating' });
    },
    end() {},
  };
  const audio = await mg.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: true, guidance_scale: guidance, streamer });
  const sr = mg.config.audio_encoder.sampling_rate;
  return { samples: audio.data, sampleRate: sr };
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    let result;
    if (type === 'transcribe') result = await transcribe(payload);
    else if (type === 'musicgen') result = await musicgen(payload);
    else throw new Error('Unknown task ' + type);
    const transfer = result && result.samples ? [result.samples.buffer] : [];
    self.postMessage({ type: 'done', id, result }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String(err && err.message ? err.message : err) });
  }
};
