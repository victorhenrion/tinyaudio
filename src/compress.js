export const QUALITIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// Rough LAME VBR averages, not size guarantees. Actual output is always measured.
const BITRATES = [245, 225, 190, 175, 165, 130, 115, 100, 85, 65];

export function guessStartingQuality({ inputBytes, maxBytes, duration, channels }) {
  const v0Bytes = duration * BITRATES[0] * 1000 / 8 * (channels === 1 ? .7 : 1);
  // Source size is only a weak hint: a compressed source can grow when re-encoded.
  const sourceFactor = Math.max(.8, Math.min(1, inputBytes / v0Bytes));
  const index = BITRATES.findIndex(rate => v0Bytes * sourceFactor * rate / BITRATES[0] < maxBytes * .9);
  return QUALITIES[index < 0 ? QUALITIES.length - 1 : index];
}

export async function encodeQuality({ encoder, samples, sampleRate, channels, duration, quality,
  maxBytes = Infinity, onProgress = () => {} }) {
  encoder.configure({ sampleRate, channels, vbrQuality: quality });
  const chunks = [];
  let bytes = 0;
  let frames = 0;
  let lastUpdate = 0;
  const started = performance.now();
  const append = data => {
    // Output is borrowed WASM memory; copy it before the next encoder call.
    if (data.byteLength) chunks.push(data.slice());
    bytes += data.byteLength;
  };
  onProgress({ quality, fraction: 0, bytes: 0, remainingSeconds: null });
  for await (const planes of samples()) {
    if (planes.length !== channels || planes.some(p => p.length !== planes[0].length)) {
      throw new Error('The audio channel layout changed during decoding. Try exporting it as a WAV file.');
    }
    for (let offset = 0; offset < planes[0].length; offset += 16_384) {
      const block = planes.map(plane => plane.subarray(offset, offset + 16_384));
      append(encoder.encode(block));
      frames += block[0].length;
      // MP3 output only grows. Stop automatic passes as soon as they cannot fit.
      // Return no Blob so an incomplete recording can never become a download.
      if (bytes >= maxBytes) return { quality, frames, sampleRate, bytes, complete: false };
      const now = performance.now();
      if (now - lastUpdate > 150) {
        const fraction = Math.min(.999, frames / sampleRate / duration);
        const elapsed = (now - started) / 1000;
        const remainingSeconds = elapsed >= .3 ? Math.max(0, elapsed / fraction - elapsed) : null;
        onProgress({ quality, fraction, bytes, remainingSeconds });
        lastUpdate = now;
      }
    }
  }
  if (!frames) throw new Error('This file contains no decodable audio. Choose a different audio file.');
  append(encoder.finalize());
  const blob = new Blob(chunks, { type: 'audio/mpeg' });
  if (!blob.size) throw new Error('The encoder returned an empty file.');
  return { blob, quality, frames, sampleRate, bytes: blob.size, complete: true };
}

export async function compressToLimit({ maxBytes, qualities = QUALITIES, attempts = [],
  onAttempt = () => {}, ...options }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Enter a valid positive size in MB.');
  let result;
  for (const quality of qualities) {
    // Finish Minimal to keep a complete fallback download.
    const finish = quality === 9;
    result = attempts.find(attempt => attempt.quality === quality);
    if (!result?.blob && (finish || !(result?.complete === false && result.bytes >= maxBytes))) {
      // Every quality is encoded from the original audio.
      result = await encodeQuality({ ...options, quality, maxBytes: finish ? Infinity : maxBytes });
      onAttempt(result);
    }
    if (result.blob && result.blob.size < maxBytes) return result;
  }
  return result;
}
