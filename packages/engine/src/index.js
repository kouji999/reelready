import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';

export async function analyzeVideo(inputPath) {
  const file = await stat(inputPath);
  const { stdout } = await execFileAsync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', inputPath]);
  const probe = JSON.parse(stdout);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  if (!video) throw new Error('Input has no video stream');
  return { path: inputPath, fileSize: file.size, duration: Number(probe.format?.duration ?? 0), container: probe.format?.format_name ?? null, video: { codec: video.codec_name, profile: video.profile ?? null, width: video.width, height: video.height, fps: parseRate(video.r_frame_rate), bitrate: Number(video.bit_rate ?? probe.format?.bit_rate ?? 0), pixelFormat: video.pix_fmt ?? null, colorSpace: video.color_space ?? null, colorTransfer: video.color_transfer ?? null }, audio: audio ? { codec: audio.codec_name, bitrate: Number(audio.bit_rate ?? 0), sampleRate: Number(audio.sample_rate ?? 0), channels: audio.channels ?? 0 } : null };
}

export function parseRate(value) {
  const [numerator, denominator] = String(value ?? '0/1').split('/').map(Number);
  return denominator ? numerator / denominator : 0;
}

export function recommendProfile(video, mode = 'balanced') {
  const fps = video.fps >= 50 ? 60 : video.fps >= 23 ? Math.round(video.fps) : 30;
  const bitrate = mode === 'maximum' ? 12 : mode === 'fast' ? 5 : 8;
  return { platform: 'instagram-reels', mode, width: 1080, height: 1920, fps, videoCodec: 'h264', videoBitrateMbps: bitrate, audioCodec: 'aac', audioBitrateKbps: 160, sampleRate: 48000, pixelFormat: 'yuv420p', container: 'mp4', fastStart: true };
}

export function buildFilterGraph(profile) {
  return `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${Math.round(profile.fps)}`;
}

export async function encodeVideo(inputPath, outputPath, profile) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
    '-vf', buildFilterGraph(profile),
    '-c:v', profile.videoCodec, '-b:v', `${profile.videoBitrateMbps}M`, '-pix_fmt', profile.pixelFormat,
    '-c:a', profile.audioCodec, '-b:a', `${profile.audioBitrateKbps}k`, '-ar', String(profile.sampleRate),
  ];
  if (profile.fastStart) args.push('-movflags', '+faststart');
  args.push(outputPath);
  await execFileAsync(ffmpeg, args, { maxBuffer: 1024 * 1024 * 8 });
  return outputPath;
}

export function validateOutput(video, profile) {
  const checks = [{ key: 'resolution', pass: video.width === profile.width && video.height === profile.height }, { key: 'codec', pass: video.codec === profile.videoCodec }, { key: 'fps', pass: video.fps >= 23 && video.fps <= 60 }, { key: 'pixelFormat', pass: video.pixelFormat === profile.pixelFormat }, { key: 'audio', pass: !video.audio || (video.audio.codec === profile.audioCodec && video.audio.sampleRate <= 48000) }, { key: 'container', pass: video.container?.includes(profile.container) }];
  return { ready: checks.every((check) => check.pass), checks };
}
