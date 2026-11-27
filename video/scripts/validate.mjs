import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const files = [
  ['Almox-ERP-Full.mp4', 78],
  ['Almox-ERP-Launch.mp4', 35],
];

for (const [name, seconds] of files) {
  const path = 'out/final/' + name;
  const probe = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
  ], {encoding: 'utf8'}));
  const video = probe.streams.find(({codec_type}) => codec_type === 'video');
  const audio = probe.streams.find(({codec_type}) => codec_type === 'audio');
  assert.ok(video && audio, name);
  assert.equal(video.codec_name, 'h264', name);
  assert.equal(audio.codec_name, 'aac', name);
  assert.equal(audio.channels, 2, name);
  assert.equal(video.width, 1920, name);
  assert.equal(video.height, 1080, name);
  assert.equal(video.avg_frame_rate, '30/1', name);
  assert.equal(Number(video.nb_frames), seconds * 30, name);
  assert.ok(Math.abs(Number(probe.format.duration) - seconds) < 0.04, name);
  console.log(name + ' · 1920×1080 · 30 fps · ' + seconds + ' s · H.264/AAC');
}

const thumbnail = JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json',
  'out/final/Almox-ERP-Thumbnail.png',
], {encoding: 'utf8'})).streams[0];
assert.equal(thumbnail.codec_name, 'png');
assert.equal(thumbnail.width, 1920);
assert.equal(thumbnail.height, 1080);
console.log('Almox-ERP-Thumbnail.png · 1920×1080');
