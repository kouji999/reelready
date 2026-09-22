import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp, parseMultipart } from '../src/app.js';

const execFileAsync = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';

let ffmpegAvailable;
async function hasFfmpeg() {
  ffmpegAvailable ??= execFileAsync(ffmpeg, ['-version']).then(() => true, () => false);
  return ffmpegAvailable;
}

async function start() {
  const [uploadRoot, outputRoot, webRoot] = await Promise.all([mkdtemp(join(tmpdir(), 'rr-up-')), mkdtemp(join(tmpdir(), 'rr-out-')), mkdtemp(join(tmpdir(), 'rr-web-'))]);
  const server = createApp({ uploadRoot, outputRoot, webRoot });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}`, uploadRoot, outputRoot, webRoot };
}

async function makeSample(path) {
  await execFileAsync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:s=320x180:d=1:r=30', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path]);
}

test('parseMultipart keeps name and filename separate', () => {
  const boundary = 'XBOUNDARY';
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a b.mp4"\r\nContent-Type: video/mp4\r\n\r\nhello\r\n--${boundary}--\r\n`);
  const parts = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, 'file');
  assert.equal(parts[0].filename, 'a b.mp4');
  assert.equal(parts[0].content.toString(), 'hello');
});

test('health endpoint responds', async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  } finally {
    server.close();
  }
});

test('upload rejects unsupported extension', async () => {
  const { server, base } = await start();
  try {
    const data = new FormData();
    data.append('file', new Blob([Buffer.from('x')], { type: 'application/octet-stream' }), 'notes.txt');
    const response = await fetch(`${base}/api/upload`, { method: 'POST', body: data });
    assert.equal(response.status, 415);
  } finally {
    server.close();
  }
});

test('analyze rejects unknown id', async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'nope' }) });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test('static files are served from webRoot', async () => {
  const { server, base, webRoot } = await start();
  try {
    await (await import('node:fs/promises')).writeFile(join(webRoot, 'index.html'), '<html><body>RR</body></html>');
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(await response.text(), '<html><body>RR</body></html>');
  } finally {
    server.close();
  }
});

test('upload, analyze, optimize, validate, download full flow', async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg unavailable');
  const { server, base, uploadRoot } = await start();
  try {
    const samplePath = join(uploadRoot, 'seed.mp4');
    await makeSample(samplePath);
    const bytes = await readFile(samplePath);
    const data = new FormData();
    data.append('file', new Blob([bytes], { type: 'video/mp4' }), 'sample.mp4');
    const uploadResponse = await fetch(`${base}/api/upload`, { method: 'POST', body: data });
    assert.equal(uploadResponse.status, 201);
    const { id } = await uploadResponse.json();

    const analyzeResponse = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    assert.equal(analyzeResponse.status, 200);
    const analysis = await analyzeResponse.json();
    assert.equal(analysis.analysis.video.width, 320);
    assert.equal(analysis.recommendation.width, 1080);

    const optimizeResponse = await fetch(`${base}/api/optimize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, mode: 'fast' }) });
    assert.equal(optimizeResponse.status, 200);
    const optimized = await optimizeResponse.json();
    assert.equal(optimized.validation.ready, true);
    assert.equal(optimized.analysis.video.width, 1080);
    assert.equal(optimized.analysis.video.height, 1920);

    const validateResponse = await fetch(`${base}/api/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ video: optimized.analysis.video, profile: optimized.profile }) });
    assert.equal(validateResponse.status, 200);
    assert.equal((await validateResponse.json()).ready, true);

    const downloadResponse = await fetch(`${base}${optimized.download}`);
    assert.equal(downloadResponse.status, 200);
    assert.match(downloadResponse.headers.get('content-disposition'), /^attachment; filename="reelready-.*\.mp4"$/);
    assert.ok((await downloadResponse.arrayBuffer()).byteLength > 0);
  } finally {
    server.close();
  }
});

test('download of missing output returns 404', async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/download/${'0'.repeat(8)}-0000-0000-0000-000000000000`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});
