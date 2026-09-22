import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { analyzeVideo, recommendProfile, validateOutput, encodeVideo } from '../../../packages/engine/src/index.js';

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
const ALLOWED_MODES = new Set(['maximum', 'balanced', 'fast']);
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  response.end(payload);
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function readBody(request, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload exceeds size limit'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  if (!boundaryMatch) throw Object.assign(new Error('Missing multipart boundary'), { statusCode: 400 });
  const boundary = Buffer.from(`--${(boundaryMatch[1] ?? boundaryMatch[2]).trim()}`);
  const delimiter = Buffer.from(`\r\n${boundary.toString('latin1')}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);
  while (cursor >= 0) {
    let start = cursor + boundary.length;
    if (buffer.subarray(start, start + 2).toString('latin1') === '--') break;
    if (buffer.subarray(start, start + 2).toString('latin1') === '\r\n') start += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd < 0) break;
    const headers = buffer.subarray(start, headerEnd).toString('utf8');
    const next = buffer.indexOf(delimiter, headerEnd + 4);
    if (next < 0) break;
    const nameMatch = /;\s*name="([^"]*)"/i.exec(headers);
    const filenameMatch = /;\s*filename="([^"]*)"/i.exec(headers);
    if (nameMatch) parts.push({ name: nameMatch[1], filename: filenameMatch ? filenameMatch[1] : undefined, content: buffer.subarray(headerEnd + 4, next) });
    cursor = next + 2;
  }
  return parts;
}

async function sendFile(response, filePath, contentType, filename) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return sendError(response, 404, `Missing file: ${filename ?? filePath}`);
  }
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': String(info.size),
    ...(filename ? { 'content-disposition': `attachment; filename="${filename}"` } : {}),
  });
  createReadStream(filePath).pipe(response);
}

export function createApp({ uploadRoot, outputRoot, webRoot }) {
  async function findInput(id) {
    if (!ID_PATTERN.test(id)) throw Object.assign(new Error('Invalid upload id'), { statusCode: 400 });
    const files = await readdir(uploadRoot);
    const match = files.find((file) => file.startsWith(`${id}.`));
    if (!match) throw Object.assign(new Error('Upload not found'), { statusCode: 404 });
    return join(uploadRoot, match);
  }

  async function findOutput(id) {
    if (!ID_PATTERN.test(id)) throw Object.assign(new Error('Invalid output id'), { statusCode: 400 });
    return join(outputRoot, `${id}.mp4`);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const route = `${request.method} ${url.pathname}`;
    try {
      if (route === 'GET /api/health') return sendJson(response, 200, { ok: true, service: 'reelready-server' });
      if (route === 'POST /api/upload') {
        const body = await readBody(request);
        const parts = parseMultipart(body, request.headers['content-type']);
        const file = parts.find((part) => part.name === 'file' && part.filename);
        if (!file || file.content.length === 0) return sendError(response, 400, 'Multipart field file with a video is required');
        const extension = extname(file.filename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(extension)) return sendError(response, 415, `Unsupported extension ${extension}; allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
        const id = randomUUID();
        await writeFile(join(uploadRoot, `${id}${extension}`), file.content, { flag: 'wx' });
        return sendJson(response, 201, { id, filename: file.filename, size: file.content.length });
      }
      if (route === 'POST /api/analyze') {
        const { id } = JSON.parse((await readBody(request, 64 * 1024)).toString('utf8') || '{}');
        const path = await findInput(id);
        const analysis = await analyzeVideo(path);
        const recommendation = recommendProfile(analysis.video, 'balanced');
        return sendJson(response, 200, { id, analysis, recommendation, validation: validateOutput({ ...analysis.video, container: analysis.container }, recommendation) });
      }
      if (route === 'POST /api/optimize') {
        const { id, mode = 'balanced' } = JSON.parse((await readBody(request, 64 * 1024)).toString('utf8') || '{}');
        if (!ALLOWED_MODES.has(mode)) return sendError(response, 400, `Unknown mode ${mode}; allowed: ${[...ALLOWED_MODES].join(', ')}`);
        const input = await findInput(id);
        const source = await analyzeVideo(input);
        const profile = recommendProfile(source.video, mode);
        const outputId = randomUUID();
        const output = join(outputRoot, `${outputId}.mp4`);
        await encodeVideo(input, output, profile);
        const result = await analyzeVideo(output);
        return sendJson(response, 200, { id, outputId, profile, analysis: result, validation: validateOutput({ ...result.video, container: result.container }, profile), download: `/api/download/${outputId}` });
      }
      if (route === 'POST /api/validate') {
        const { video, profile } = JSON.parse((await readBody(request, 256 * 1024)).toString('utf8') || '{}');
        if (!video || !profile) return sendError(response, 400, 'Body requires video and profile');
        return sendJson(response, 200, validateOutput(video, profile));
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/download/')) {
        const outputId = url.pathname.slice('/api/download/'.length);
        const filePath = await findOutput(outputId);
        return sendFile(response, filePath, 'video/mp4', `reelready-${outputId}.mp4`);
      }
      if (request.method === 'GET') {
        const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        const filePath = resolve(webRoot, normalize(relative));
        if (!filePath.startsWith(webRoot)) return sendError(response, 403, 'Forbidden');
        return sendFile(response, filePath, CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream');
      }
      return sendError(response, 405, `No route for ${route}`);
    } catch (error) {
      if (!(response.headersSent || response.writableEnded)) sendError(response, error.statusCode ?? 500, error.message);
      else response.destroy(error);
    }
  });
  return server;
}

export async function startServer({ port = Number(process.env.PORT ?? 3100), host = process.env.HOST ?? '127.0.0.1' } = {}) {
  const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const dataRoot = join(root, '.data');
  const uploadRoot = join(dataRoot, 'uploads');
  const outputRoot = join(dataRoot, 'outputs');
  await Promise.all([mkdir(uploadRoot, { recursive: true }), mkdir(outputRoot, { recursive: true })]);
  const server = createApp({ uploadRoot, outputRoot, webRoot: join(root, 'apps', 'web') });
  await new Promise((listening, listenFailed) => server.once('error', listenFailed).listen(port, host, listening));
  return { server, port: server.address().port, host, uploadRoot, outputRoot };
}
