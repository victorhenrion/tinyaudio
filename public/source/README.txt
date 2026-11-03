tinyaudio — corresponding encoder sources

This distribution uses the unmodified wasm-media-encoders 0.7.0 npm package.
Its LAME submodule points to revision 98db548e8e851defbba3184125ce10725355c332
of https://github.com/arseneyr/lame.

Archives in this directory:
- lame-source.tar.gz: LAME at that exact revision, including its license.
- wasm-media-encoders-0.7.0.tar.gz: JavaScript/WASM wrapper, Makefile,
  configuration, and build instructions at tag v0.7.0.
  Generated Yarn dependency caches and PnP maps are omitted; install the
  dependencies from the included package.json and yarn.lock before building.

To rebuild the encoder, extract both archives, place the LAME files in the
wrapper's src/wasm/lame/lame-src directory, and follow the wrapper README.
The package's Makefile builds the WebAssembly with Emscripten (make prod).
Its full build also uses the Ogg/Vorbis submodules documented in .gitmodules;
the MP3 build targets depend only on LAME. tinyaudio does not ship Ogg encoding.

The app imports wasm-media-encoders/wasm/mp3?url in src/encoder.worker.js.
To substitute a compatible rebuilt WASM, change that import to your module
asset and run npm run build. No signing or integrity gate restricts replacement.

Mediabunny is distributed without modifications; its source is available at
https://github.com/Vanilagy/mediabunny/tree/v1.61.6

Audio encoding and decoding happen in a browser Worker. No server receives
your selected audio. Downloaded MP3s do not contain the original file metadata.
