import { QUALITIES, guessStartingQuality } from './compress.js';
import { createQualityPicker } from './quality-picker.js';
import { enableFileDrop } from './file-drop.js';
const $ = id => document.getElementById(id);
const qualityNames = ['Highest', 'Very high', 'High', 'Good', 'Balanced', 'Medium', 'Reduced', 'Low', 'Very low', 'Minimal'];
const qualityName = quality => qualityNames[QUALITIES.indexOf(quality)];
const qualityLabel = quality => `${qualityName(quality)} (VBR${quality})`;
const qualityPicker = createQualityPicker($('quality-picker'), QUALITIES.map(value => ({ value, label: qualityLabel(value) })));
const attempts = new Map();
const states = new Map();
let worker = null;
let inspector = null;
let sourceFile = null;
let metadata = null;
let suggestedQuality = 0;
let customStart = false;
let currentQuality = null;
let latestQuality = null;
let started = false;
let progressView = null;
let progressData = null;
let toastTimer = null;
const size = bytes => `${(bytes / 1_000_000).toFixed(2)} MB`;
const targetEnabled = () => $('target-enabled').checked;
const maxBytes = () => targetEnabled() ? Math.floor($('limit').valueAsNumber * 1_000_000) : Infinity;
const validLimit = () => !targetEnabled() || ($('limit').validity.valid && Number.isSafeInteger(maxBytes()) && maxBytes() > 0);
const filename = quality => `${sourceFile.name.replace(/\.[^.]+$/, '') || 'audio'}-VBR${quality}.mp3`;
function hideToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  $('toast').hidden = true;
}
function showToast(message) {
  hideToast();
  $('toast-message').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(hideToast, 5000);
}
function durationLabel(seconds) {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}:${String(total % 60).padStart(2, '0')}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
function timeLeft(seconds) {
  if (seconds === null) return 'Estimating…';
  const total = Math.max(1, Math.ceil(seconds));
  if (total < 60) return `~${total}s left`;
  const minutes = Math.ceil(total / 60);
  return minutes < 60 ? `~${minutes}m left` : `~${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}
function controls() {
  const locked = started || !!worker;
  const hasSuggestion = targetEnabled() && !!metadata && validLimit();
  $('setup-content').inert = started;
  $('start-over').hidden = !started;
  $('choose-file').disabled = $('target-enabled').disabled = $('target-help').disabled = locked;
  $('limit').disabled = locked || !targetEnabled();
  $('quality-label').textContent = targetEnabled() ? 'Starting quality' : 'Quality';
  $('start-quality').disabled = locked || !metadata;
  $('compress').disabled = locked || !metadata || !validLimit();
  $('compress').hidden = started;
  qualityPicker.update(hasSuggestion ? suggestedQuality : null);
}
function updateSuggestion() {
  const file = sourceFile;
  if (file && metadata && targetEnabled() && validLimit()) {
    suggestedQuality = guessStartingQuality({ inputBytes: file.size, maxBytes: maxBytes(), ...metadata });
    if (!customStart) $('start-quality').value = suggestedQuality;
  }
  controls();
}
function stateFor(quality) {
  if (states.has(quality)) return states.get(quality);
  const result = attempts.get(quality);
  if (!result) return 'not-started';
  if (result.blob) return 'ready';
  return validLimit() && result.bytes >= maxBytes() ? 'above-target' : 'stopped';
}
function updateProgress() {
  if (!progressView || !progressData) return;
  const percent = Math.floor(progressData.fraction * 100);
  progressView.ring.style.setProperty('--progress', percent);
  progressView.ring.setAttribute('aria-valuenow', percent);
  progressView.percent.textContent = `${percent}% compressed`;
  progressView.time.textContent = timeLeft(progressData.remainingSeconds);
}
function qualityRow(quality) {
  const result = attempts.get(quality);
  const state = stateFor(quality);
  const row = document.createElement('tr');
  row.className = `state-${state}`;
  const name = document.createElement('td');
  const human = document.createElement('span');
  human.className = 'quality-name';
  human.textContent = qualityName(quality);
  const code = document.createElement('span');
  code.className = 'quality-code';
  code.textContent = `(VBR${quality})`;
  name.append(human, code);
  const status = document.createElement('td');
  const label = document.createElement('span');
  label.className = 'state-label';
  const icon = document.createElement('span');
  icon.className = 'state-icon';
  icon.setAttribute('aria-hidden', 'true');
  const labels = { 'not-started': 'Not started', waiting: 'Waiting', compressing: '0% compressed', ready: 'Ready', 'above-target': 'Above target', stopped: 'Stopped early', cancelled: 'Cancelled', failed: 'Failed' };
  if (state === 'above-target') label.title = 'Stopped early because the output reached the target size.';
  if (state === 'stopped') label.title = 'The earlier attempt stopped before the full recording was encoded.';
  const stateText = document.createElement('span');
  stateText.textContent = labels[state];
  label.append(icon, stateText);
  status.append(label);
  if (state === 'compressing') {
    icon.removeAttribute('aria-hidden');
    icon.setAttribute('role', 'progressbar');
    icon.setAttribute('aria-label', `${qualityLabel(quality)} compression progress`);
    icon.setAttribute('aria-valuemin', '0');
    icon.setAttribute('aria-valuemax', '100');
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 16 16');
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = '<circle class="progress-track" cx="8" cy="8" r="6.5"/><circle class="progress-fill" cx="8" cy="8" r="6.5" pathLength="100"/>';
    icon.append(ring);
    const time = document.createElement('span');
    time.className = 'compression-time';
    time.title = 'Estimated time left for this quality';
    label.append(time);
    status.colSpan = 2;
    progressView = { percent: stateText, time, ring: icon };
  }
  const bytes = document.createElement('td');
  bytes.className = 'size-cell';
  bytes.textContent = result ? `${result.blob ? '' : '≥ '}${size(result.blob?.size ?? result.bytes)}` : '—';
  if (result?.blob && validLimit() && result.blob.size >= maxBytes()) {
    const over = document.createElement('span');
    over.className = 'over-limit';
    over.textContent = 'Above target';
    bytes.append(over);
  }
  const action = document.createElement('td');
  if (state === 'waiting' || state === 'compressing') {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'row-button';
    cancel.textContent = 'Cancel';
    cancel.setAttribute('aria-label', `Cancel ${qualityLabel(quality)}`);
    cancel.addEventListener('click', cancelRun);
    action.append(cancel);
  } else if (result?.blob) {
    const link = document.createElement('a');
    link.className = 'row-button download-button';
    link.href = result.url;
    link.download = filename(quality);
    link.textContent = 'Download';
    link.setAttribute('aria-label', `Download ${qualityLabel(quality)}`);
    action.append(link);
  } else {
    const retry = !result && (state === 'cancelled' || state === 'failed');
    const button = document.createElement('button');
    button.className = `row-button ${retry ? 'retry-button' : 'compress-button'}`;
    button.type = 'button';
    button.disabled = !!worker || !metadata || !validLimit();
    button.textContent = retry ? 'Retry' : 'Compress';
    if (result && targetEnabled()) button.title = 'Encode the complete recording at this quality, including files above the target size.';
    button.setAttribute('aria-label', `${retry ? 'Retry' : 'Compress'} ${qualityLabel(quality)}`);
    button.addEventListener('click', () => start(quality, !!result && !result.blob));
    action.append(button);
  }
  row.append(name, status);
  if (state !== 'compressing') row.append(bytes);
  row.append(action);
  return row;
}
function renderResults() {
  $('results').hidden = !started;
  progressView = null;
  $('result-list').replaceChildren();
  $('other-list').replaceChildren();
  const best = targetEnabled() && validLimit() ? [...attempts.values()].sort((a, b) => a.quality - b.quality).find(result => result.blob && result.blob.size < maxBytes()) : null;
  const featured = [...new Set([currentQuality, best?.quality, latestQuality].filter(quality => quality !== null && quality !== undefined))];
  for (const quality of featured) $('result-list').append(qualityRow(quality));
  const others = targetEnabled() ? QUALITIES.filter(quality => !featured.includes(quality)) : [];
  for (const quality of others) $('other-list').append(qualityRow(quality));
  $('other-qualities').hidden = !others.length;
  updateProgress();
}
function stop() {
  worker?.terminate();
  worker = null;
  currentQuality = null;
  progressData = null;
  controls();
  renderResults();
}
function fail(message) {
  if (currentQuality !== null) {
    if (attempts.has(currentQuality)) states.delete(currentQuality);
    else states.set(currentQuality, 'failed');
  }
  stop();
  $('error').textContent = message;
  $('error').hidden = false;
  $('announcement').textContent = message;
}
function cancelRun() {
  if (currentQuality !== null) {
    if (attempts.has(currentQuality)) states.delete(currentQuality);
    else states.set(currentQuality, 'cancelled');
  }
  stop();
  $('announcement').textContent = 'Compression cancelled.';
}
function inspectFile(file) {
  hideToast();
  $('announcement').textContent = '';
  worker?.terminate();
  worker = null;
  inspector?.terminate();
  inspector = null;
  metadata = null;
  customStart = false;
  started = false;
  currentQuality = latestQuality = null;
  states.clear();
  for (const result of attempts.values()) if (result.url) URL.revokeObjectURL(result.url);
  attempts.clear();
  $('other-qualities').open = false;
  $('error').hidden = true;
  sourceFile = file;
  $('file-name').textContent = file?.name || 'Choose an audio file';
  $('file-name').title = file?.name || '';
  $('file-meta').textContent = file ? `${size(file.size)} · Reading…` : 'or drop it here';
  $('file-action').textContent = file ? 'Change' : 'Browse';
  $('start-quality').value = 0;
  controls();
  renderResults();
  if (!file) return;
  if (!file.size) {
    $('file-meta').textContent = size(file.size);
    fail('This file is empty. Choose another audio file.');
    return;
  }
  try { inspector = new Worker(new URL('./encoder.worker.js', import.meta.url), { type: 'module' }); }
  catch (error) { fail(error.message); return; }
  const current = inspector;
  const finish = () => {
    current.terminate();
    inspector = null;
    $('file-meta').textContent = size(file.size);
  };
  current.onerror = () => {
    if (inspector !== current) return;
    finish();
    fail('Could not read this audio file. Try another file.');
  };
  current.onmessage = ({ data }) => {
    if (inspector !== current) return;
    if (data.type === 'metadata') {
      finish();
      metadata = data;
      $('file-meta').textContent = `${size(file.size)} · ${durationLabel(data.duration)}`;
      updateSuggestion();
    } else if (data.type === 'error') {
      finish();
      fail(data.message);
    }
  };
  current.postMessage({ action: 'inspect', file });
}
function start(quality, full = false) {
  const file = sourceFile;
  if (!file || worker || !metadata || (targetEnabled() && !$('limit').reportValidity())) return;
  const limit = maxBytes();
  if (!validLimit()) { fail('Enter a valid positive size in MB.'); return; }
  if (!targetEnabled()) {
    quality ??= Number($('start-quality').value);
    full = true;
  }
  hideToast();
  const notified = new Set();
  const notifyAboveTarget = (attemptQuality, bytes) => {
    if (bytes >= limit && !notified.has(attemptQuality)) {
      notified.add(attemptQuality);
      showToast(`${qualityLabel(attemptQuality)} is above the ${limit / 1_000_000} MB target.`);
    }
  };
  $('error').hidden = true;
  started = true;
  currentQuality = quality ?? Number($('start-quality').value);
  latestQuality = currentQuality;
  states.set(currentQuality, 'waiting');
  progressData = null;
  try { worker = new Worker(new URL('./encoder.worker.js', import.meta.url), { type: 'module' }); }
  catch (error) { fail(error.message); return; }
  controls();
  renderResults();
  $('announcement').textContent = `${qualityLabel(currentQuality)} waiting.`;
  const currentWorker = worker;
  currentWorker.onerror = () => {
    if (worker === currentWorker) fail('Compression stopped. Completed downloads remain available.');
  };
  currentWorker.onmessage = ({ data }) => {
    if (worker !== currentWorker) return;
    if (data.type === 'progress') {
      const changed = currentQuality !== data.quality || states.get(data.quality) !== 'compressing';
      if (currentQuality !== data.quality) states.delete(currentQuality);
      currentQuality = latestQuality = data.quality;
      states.set(data.quality, 'compressing');
      progressData = data;
      if (changed) {
        renderResults();
        $('announcement').textContent = `${qualityLabel(data.quality)} compressing.`;
      } else updateProgress();
      notifyAboveTarget(data.quality, data.bytes);
    } else if (data.type === 'attempt') {
      const complete = data.blob instanceof Blob && data.blob.size > 0;
      if (!complete && !(data.complete === false && Number.isFinite(data.bytes) && data.bytes >= limit)) {
        fail('The encoder returned an empty file.'); return;
      }
      notifyAboveTarget(data.quality, complete ? data.blob.size : data.bytes);
      const previous = attempts.get(data.quality);
      if (previous?.url) URL.revokeObjectURL(previous.url);
      attempts.set(data.quality, complete ? { ...data, url: URL.createObjectURL(data.blob) } : data);
      states.delete(data.quality);
      latestQuality = data.quality;
      renderResults();
    } else if (data.type === 'error') {
      fail(data.message);
    } else if (data.type === 'done') {
      if (currentQuality !== null) states.delete(currentQuality);
      states.delete(data.quality);
      latestQuality = data.quality;
      stop();
      $('announcement').textContent = data.blob
        ? `${qualityLabel(data.quality)} ready, ${size(data.blob.size)}.`
        : `${qualityLabel(data.quality)} stopped early above the target size.`;
    }
  };
  worker.postMessage({ action: 'compress', file, maxBytes: limit, quality, full,
    startQuality: Number($('start-quality').value),
    attempts: [...attempts.values()].map(({ quality, blob, bytes, complete }) => ({ quality, blob, bytes, complete })),
  });
}
controls();
$('target-help').addEventListener('keydown', event => {
  if (event.key === 'Escape') event.currentTarget.closest('.help').classList.add('dismissed');
});
for (const event of ['pointerleave', 'focusout']) {
  $('target-help').closest('.help').addEventListener(event, event => event.currentTarget.classList.remove('dismissed'));
}
function chooseFile() {
  $('file').value = '';
  $('file').click();
}
$('choose-file').addEventListener('click', chooseFile);
$('start-over').addEventListener('click', () => {
  $('file').value = '';
  inspectFile(null);
  $('choose-file').focus();
});
$('file').addEventListener('change', () => inspectFile($('file').files[0] ?? null));
enableFileDrop($('choose-file'), {
  onFile(file) {
    $('file').value = '';
    inspectFile(file);
  },
  onError: showToast,
});
function changeSettings() {
  hideToast();
  $('error').hidden = true;
  updateSuggestion();
  renderResults();
}
$('limit').addEventListener('input', changeSettings);
$('target-enabled').addEventListener('change', () => {
  $('other-qualities').open = false;
  changeSettings();
});
$('start-quality').addEventListener('change', () => {
  customStart = !targetEnabled() || Number($('start-quality').value) !== suggestedQuality;
  controls();
});
$('compress').addEventListener('click', () => start());
$('toast-close').addEventListener('click', hideToast);
window.addEventListener('beforeunload', () => {
  clearTimeout(toastTimer);
  worker?.terminate();
  inspector?.terminate();
  for (const result of attempts.values()) if (result.url) URL.revokeObjectURL(result.url);
});
