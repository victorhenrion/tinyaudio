import { Input, BlobSource, ALL_FORMATS, AudioSampleSink } from 'mediabunny';
import { createEncoder } from 'wasm-media-encoders';
import wasmUrl from 'wasm-media-encoders/wasm/mp3?url';
import { QUALITIES, encodeQuality, compressToLimit } from './compress.js';

self.onmessage = async ({ data: { action = 'compress', file, maxBytes, quality, full = false, startQuality = 0, attempts } }) => {
  let input;
  try {
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('No audio track found. Choose an audio file such as WAV, MP3, M4A, or FLAC.');
    if (!(await track.canDecode())) throw new Error('Your browser cannot decode this audio format. Try a WAV or MP3 file, or use a current version of Chrome, Edge, or Safari.');
    const sampleRate = await track.getSampleRate();
    const channels = await track.getNumberOfChannels();
    if (channels > 2) throw new Error('This file has more than two audio channels. Export a mono or stereo version first.');
    const duration = await track.computeDuration();
    if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('The audio duration could not be read. The file may be empty or damaged.');
    if (action === 'inspect') {
      self.postMessage({ type: 'metadata', duration, channels, sampleRate });
      return;
    }
    const encoder = await createEncoder('audio/mpeg', wasmUrl);
    const sink = new AudioSampleSink(track);
    async function* samples() {
      for await (const sample of sink.samples()) {
        try {
          if (sample.sampleRate !== sampleRate || sample.numberOfChannels !== channels) {
            throw new Error('The audio format changes partway through this file. Export it as a WAV file first.');
          }
          const planes = Array.from({ length: channels }, (_, planeIndex) => {
            const data = new Float32Array(sample.numberOfFrames);
            sample.copyTo(data, { format: 'f32-planar', planeIndex });
            return data;
          });
          yield planes;
        } finally { sample.close(); }
      }
    }
    const options = { encoder, samples, sampleRate, channels, duration,
      onProgress: progress => self.postMessage({ type: 'progress', ...progress }),
    };
    let result;
    if (quality !== undefined) {
      if (!QUALITIES.includes(quality)) throw new Error('Choose a supported VBR quality.');
      result = await encodeQuality({ ...options, quality, maxBytes: full || quality === 9 ? Infinity : maxBytes });
      self.postMessage({ type: 'attempt', ...result });
    } else {
      if (!QUALITIES.includes(startQuality)) throw new Error('Choose a supported starting quality.');
      result = await compressToLimit({ ...options, maxBytes, attempts,
        qualities: QUALITIES.slice(QUALITIES.indexOf(startQuality)),
        onAttempt: attempt => self.postMessage({ type: 'attempt', ...attempt }),
      });
    }
    self.postMessage({ type: 'done', ...result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Compression failed. Try a different audio file.' });
  } finally { input?.dispose(); }
};
