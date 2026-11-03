import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createMp3Encoder } from 'wasm-media-encoders';
import { compressToLimit } from '../src/compress.js';

const sampleRate = 44100;
function noiseSource(seconds = 6, channels = 2) {
  return async function* () {
    let seed = 9812;
    for (let pos = 0; pos < sampleRate * seconds; pos += 4096) {
      const length = Math.min(4096, sampleRate * seconds - pos);
      yield Array.from({ length: channels }, () => Float32Array.from({ length }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed / 2 ** 32 - .5) * .7;
      }));
    }
  };
}
test('real WASM LAME retries original stereo audio at lower VBR quality and produces an MP3', async () => {
  const encoder = await createMp3Encoder();
  const attempts = [];
  const result = await compressToLimit({ encoder, samples: noiseSource(), sampleRate, channels: 2,
    duration: 6, maxBytes: 100_000, onAttempt: a => attempts.push(a) });
  assert.ok(result.quality > 0, 'test must exercise retries');
  assert.ok(result.bytes < 100_000);
  assert.equal(result.frames, sampleRate * 6, 'all original audio frames must survive');
  assert.equal(attempts[0].fits, false);
  assert.equal(attempts.at(-1).fits, true);
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(bytes[0], 255);
  assert.equal(bytes[1] & 224, 224, 'MP3 frame sync');
  if (process.env.MP3_TEST_OUTPUT) await writeFile(process.env.MP3_TEST_OUTPUT, bytes);
});
test('a small mono file succeeds at the best quality without retrying', async () => {
  const attempts = [];
  const result = await compressToLimit({ encoder: await createMp3Encoder(), samples: noiseSource(1, 1),
    sampleRate, channels: 1, duration: 1, onAttempt: a => attempts.push(a) });
  assert.equal(result.quality, 0);
  assert.equal(result.frames, sampleRate);
  assert.equal(attempts.length, 1);
});
test('the strict byte limit includes encoder finalization, including exactly equal sizes', async () => {
  const encoder = { configure() {}, encode() { return new Uint8Array(9); }, finalize() { return new Uint8Array(1); } };
  await assert.rejects(compressToLimit({ encoder, samples: noiseSource(.01, 1), sampleRate, channels: 1,
    duration: .01, maxBytes: 10, qualities: [9.999] }), /lowest LAME VBR quality/);
});
test('an impossible target terminates after the minimum quality', async () => {
  const attempts = [];
  await assert.rejects(compressToLimit({ encoder: await createMp3Encoder(), samples: noiseSource(.1, 1),
    sampleRate, channels: 1, duration: .1, maxBytes: 1, onAttempt: a => attempts.push(a) }), /lowest LAME VBR quality/);
  assert.equal(attempts.length, 11);
  assert.equal(attempts.at(-1).quality, 9.999);
});
test('empty decoded audio fails instead of downloading an empty recording', async () => {
  await assert.rejects(compressToLimit({ encoder: await createMp3Encoder(), samples: async function* () {},
    sampleRate, channels: 1, duration: 1 }), /no decodable audio/);
});
