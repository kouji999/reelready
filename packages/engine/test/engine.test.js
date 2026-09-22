import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRate, recommendProfile, validateOutput, buildFilterGraph } from '../src/index.js';
test('parseRate converts rational frame rates', () => {
  assert.equal(parseRate('60000/1001').toFixed(2), '59.94');
});

test('balanced profile preserves native high frame rate', () => {
  assert.equal(recommendProfile({ fps: 59.94 }, 'balanced').fps, 60);
});

test('validation reports a compliant output', () => {
  const profile = recommendProfile({ fps: 30 }, 'balanced');
  const result = validateOutput({ width: 1080, height: 1920, fps: 30, codec: 'h264', pixelFormat: 'yuv420p', container: 'mov,mp4,m4a,3gp,3g2,mj2', audio: { codec: 'aac', sampleRate: 48000 } }, profile);
  assert.equal(result.ready, true);
});

test('buildFilterGraph targets profile canvas and fps', () => {
  const graph = buildFilterGraph({ width: 1080, height: 1920, fps: 29.97 });
  assert.match(graph, /scale=1080:1920:force_original_aspect_ratio=decrease/);
  assert.match(graph, /pad=1080:1920/);
  assert.match(graph, /fps=30$/);
});
