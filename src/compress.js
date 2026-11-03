export const MAX_BYTES = 100_000_000; // Decimal MB; success is strictly below this.
export const QUALITIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9.999];

// The sample factory reopens the original audio for every pass. Never re-encode an MP3 attempt.
export async function compressToLimit({ encoder, samples, sampleRate, channels, duration,
  maxBytes = MAX_BYTES, qualities = QUALITIES, onProgress = () => {}, onAttempt = () => {} }) {
  for (let index = 0; index < qualities.length; index++) {
    const quality = qualities[index];
    encoder.configure({ sampleRate, channels, vbrQuality: quality });
    const chunks = [];
    let bytes = 0;
    let frames = 0;
    let lastUpdate = 0;
    const append = (data) => {
      bytes += data.byteLength;
      // Encoder output is borrowed WASM memory; copy it before the next encode call.
      if (bytes < maxBytes && data.byteLength) chunks.push(data.slice());
    };
    onProgress({ quality, pass: index + 1, fraction: 0, bytes: 0 });

    pass: for await (const planes of samples()) {
      if (planes.length !== channels || planes.some(p => p.length !== planes[0].length)) {
        throw new Error('The audio channel layout changed during decoding. Try exporting it as a WAV file.');
      }
      for (let offset = 0; offset < planes[0].length; offset += 16_384) {
        const block = planes.map(plane => plane.subarray(offset, offset + 16_384));
        append(encoder.encode(block));
        frames += block[0].length;
        const now = performance.now();
        if (now - lastUpdate > 150) {
          onProgress({ quality, pass: index + 1, fraction: Math.min(.99, frames / sampleRate / duration), bytes });
          lastUpdate = now;
        }
        // MP3 output only grows. A failed pass can stop without decoding the rest.
        if (bytes >= maxBytes) break pass;
      }
    }
    if (!frames) throw new Error('This file contains no decodable audio. Choose a different audio file.');
    if (bytes < maxBytes) append(encoder.finalize());
    const fits = bytes < maxBytes;
    onAttempt({ quality, bytes, fits });
    if (fits) {
      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      if (!blob.size || blob.size >= maxBytes) throw new Error('The encoded file did not pass the size check.');
      return { blob, quality, frames, sampleRate, bytes: blob.size };
    }
  }
  throw new Error('Even the lowest LAME VBR quality is too large for 100 MB. This recording cannot fit without shortening it or changing the audio format.');
}
