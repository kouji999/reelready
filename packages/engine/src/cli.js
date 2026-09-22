#!/usr/bin/env node
import { analyzeVideo, recommendProfile, validateOutput } from './index.js';

const [input, mode = 'balanced'] = process.argv.slice(2);
if (!input) {
  console.error('Usage: reelready <input-video> [maximum|balanced|fast]');
  process.exitCode = 2;
} else {
  try {
    const analysis = await analyzeVideo(input);
    const recommendation = recommendProfile(analysis.video, mode);
    console.log(JSON.stringify({ analysis, recommendation, validation: validateOutput({ ...analysis.video, container: analysis.container }, recommendation) }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
