# tinyaudio

Compress one audio file to an MP3 strictly under 100,000,000 bytes using
bundled WebAssembly LAME VBR. Everything runs locally in a browser worker.

Choose a file, press **Compress**, then download the MP3. The encoder starts
at V0 and retries from the original audio at V1 through V9, then V9.999, until
the actual output fits. If the lowest quality still exceeds the limit, it
reports an error. It never truncates the recording or switches to CBR.

## Development

```sh
npm ci
npm run dev
```

`npm test` verifies real WASM encoding, quality retries, complete frame counts,
strict byte limits including finalization, and failure cases.
`npm run build` creates `dist/`; `npm run preview` serves that build locally.

## GitHub Pages

The Pages workflow tests, builds, and deploys every push to `main`.
The repository's Pages source must be **GitHub Actions**. Vite uses relative
asset URLs so the app works at `/tinyaudio/` and under a custom domain.

## Limits

Input decoding depends on the browser's codecs (WebCodecs and Mediabunny).
Use a current browser over HTTPS or localhost. Mono and stereo are supported;
unsupported formats and multichannel audio show an error. Original tags and
artwork are omitted. Decoding happens in chunks; up to approximately 100 MB
of MP3 output and decoder buffers remain in memory. Long files may need
multiple passes. Some recordings cannot fit at any LAME VBR quality.

Third-party notices, the LAME license, and corresponding encoder sources
are bundled under `public/` and linked from the app.
