# Instagram Reels Optimization Knowledge Base

Status: baseline research, verify against current Meta documentation before production release.

## Working target

- Canvas: 1080 x 1920, 9:16.
- Container: MP4 with faststart metadata.
- Video: H.264, progressive, yuv420p.
- Frame rate: preserve source cadence when it is between 23 and 60 FPS.
- Audio: AAC, mono or stereo, up to 48 kHz.
- Bitrate: keep below the documented ingest ceiling and tune by content class.

## Product language

Readiness means the file matches the selected ingest profile. It does not guarantee that Instagram will skip platform transcoding.

## Evidence gaps

Published limits vary by upload surface and account. Store source URL, retrieval date, upload surface, source characteristics, encode parameters, and measured output quality for every experiment.
