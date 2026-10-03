'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Threaded WASM (used by the on-device AI models) needs SharedArrayBuffer.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

function ffmpegPath() {
  let p = null;
  try {
    p = require('ffmpeg-static');
  } catch (e) {
    p = null;
  }
  // Inside a packaged app the binary lives in app.asar.unpacked.
  if (p) p = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  if (p && fs.existsSync(p)) return p;
  return 'ffmpeg'; // fall back to a system-wide install
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d0f14',
    title: 'Kroze Music Studio',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- generic file helpers ----------

ipcMain.handle('dialog:save', async (_e, opts) => {
  const res = await dialog.showSaveDialog(win, opts || {});
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('dialog:open', async (_e, opts) => {
  const res = await dialog.showOpenDialog(win, opts || {});
  return res.canceled ? null : res.filePaths;
});

ipcMain.handle('file:write', async (_e, filePath, data) => {
  const buf = typeof data === 'string' ? data : Buffer.from(data);
  await fs.promises.writeFile(filePath, buf);
  return true;
});

ipcMain.handle('file:read', async (_e, filePath, asText) => {
  const buf = await fs.promises.readFile(filePath);
  if (asText) return buf.toString('utf8');
  return new Uint8Array(buf);
});

ipcMain.handle('shell:showItem', (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

// ---------- video export (frame-by-frame into ffmpeg) ----------

let job = null;

function cleanupJob() {
  if (!job) return;
  try {
    fs.rmSync(job.tmpDir, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }
  job = null;
}

ipcMain.handle('export:start', async (_e, opts) => {
  if (job) throw new Error('An export is already running');
  const { outPath, width, height, fps, wav, format, quality } = opts;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kroze-'));
  const audioPath = path.join(tmpDir, 'audio.wav');
  await fs.promises.writeFile(audioPath, Buffer.from(wav));

  const crf = { high: 16, medium: 20, small: 26 }[quality] || 20;
  const args = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',
    '-i', audioPath,
  ];
  if (format === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-crf', String(crf + 12), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4');
    args.push('-c:a', 'libopus', '-b:a', '256k');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p');
    args.push('-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart');
  }
  args.push('-shortest', outPath);

  const proc = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 20000) stderr = stderr.slice(-20000);
  });
  const done = new Promise((resolve) => {
    proc.on('close', (code) => resolve({ code, stderr }));
    proc.on('error', (err) => resolve({ code: -1, stderr: String(err) }));
  });
  proc.stdin.on('error', () => {}); // surfaced through `done`
  job = { proc, done, tmpDir, outPath };
  return true;
});

ipcMain.handle('export:frame', async (_e, frame) => {
  if (!job) throw new Error('No export running');
  const buf = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  const ok = job.proc.stdin.write(buf);
  if (!ok) {
    await new Promise((resolve) => {
      const j = job;
      const onDone = () => {
        j.proc.stdin.removeListener('drain', onDone);
        j.proc.removeListener('close', onDone);
        resolve();
      };
      j.proc.stdin.on('drain', onDone);
      j.proc.on('close', onDone);
    });
  }
  return true;
});

ipcMain.handle('export:finish', async () => {
  if (!job) throw new Error('No export running');
  job.proc.stdin.end();
  const { code, stderr } = await job.done;
  const outPath = job.outPath;
  cleanupJob();
  if (code !== 0) throw new Error('ffmpeg failed (' + code + '):\n' + stderr.split('\n').slice(-12).join('\n'));
  return outPath;
});

ipcMain.handle('export:cancel', async () => {
  if (!job) return true;
  try {
    job.proc.stdin.destroy();
    job.proc.kill('SIGKILL');
  } catch (e) {
    /* ignore */
  }
  await job.done;
  const outPath = job.outPath;
  cleanupJob();
  try {
    fs.rmSync(outPath, { force: true });
  } catch (e) {
    /* ignore */
  }
  return true;
});

ipcMain.handle('ffmpeg:check', async () => {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath(), ['-version']);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => resolve(code === 0 ? out.split('\n')[0] : null));
    p.on('error', () => resolve(null));
  });
});
