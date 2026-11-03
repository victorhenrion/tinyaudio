import { MAX_BYTES } from './compress.js';
const $ = id => document.getElementById(id);
let worker = null;
let outputUrl = null;
const size = bytes => `${(bytes / 1_000_000).toFixed(2)} MB`;
function clearOutput() {
  $('download').hidden = true;
  $('download').removeAttribute('href');
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
}
function stop() {
  worker?.terminate();
  worker = null;
  $('file').disabled = false;
  $('compress').disabled = !$('file').files.length;
  $('cancel').hidden = $('progress').hidden = true;
}
function fail(message) {
  stop();
  $('status').textContent = '';
  $('error').textContent = message;
  $('error').hidden = false;
}
$('file').addEventListener('change', () => {
  clearOutput();
  $('error').hidden = true;
  const file = $('file').files[0];
  $('compress').disabled = !file;
  $('status').textContent = file ? `${file.name} · ${size(file.size)}` : 'Choose one audio file.';
});
$('compress').addEventListener('click', () => {
  const file = $('file').files[0];
  if (!file || worker) return;
  clearOutput();
  $('error').hidden = true;
  if (!file.size) { fail('This file is empty. Choose another audio file.'); return; }
  $('file').disabled = $('compress').disabled = true;
  $('cancel').hidden = $('progress').hidden = false;
  $('progress').removeAttribute('value');
  $('status').textContent = 'Reading audio…';
  try { worker = new Worker(new URL('./encoder.worker.js', import.meta.url), { type: 'module' }); }
  catch (error) { fail(error.message); return; }
  worker.onerror = () => fail('The audio worker stopped. Your browser may be low on memory. Close other tabs and retry.');
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      const percent = Math.floor(data.fraction * 100);
      $('progress').value = percent;
      $('status').textContent = `V${data.quality} · ${percent}% · ${size(data.bytes)} encoded`;
    } else if (data.type === 'attempt' && !data.fits) {
      $('status').textContent = `V${data.quality} exceeds 100 MB. Trying lower quality…`;
    } else if (data.type === 'error') {
      fail(data.message);
    } else if (data.type === 'done') {
      if (!(data.blob instanceof Blob) || !data.blob.size || data.blob.size >= MAX_BYTES) {
        fail('The output did not pass the 100 MB size check.'); return;
      }
      stop();
      outputUrl = URL.createObjectURL(data.blob);
      $('download').href = outputUrl;
      $('download').download = `${file.name.replace(/\.[^.]+$/, '') || 'audio'}-under100.mp3`;
      $('download').hidden = false;
      $('status').textContent = `${size(data.blob.size)} · V${data.quality} · verified under 100 MB`;
    }
  };
  worker.postMessage({ file });
});
$('cancel').addEventListener('click', () => {
  stop();
  $('status').textContent = 'Cancelled.';
});
window.addEventListener('beforeunload', () => {
  worker?.terminate();
  if (outputUrl) URL.revokeObjectURL(outputUrl);
});
