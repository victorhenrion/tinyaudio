export function enableFileDrop(zone, { onFile, onError }) {
  let depth = 0;
  const isFileDrag = event => event.dataTransfer?.types.includes('Files');
  const clear = () => {
    depth = 0;
    zone.classList.remove('is-dragging');
  };
  zone.addEventListener('dragenter', event => {
    if (!isFileDrag(event) || zone.disabled) return;
    event.preventDefault();
    depth++;
    zone.classList.add('is-dragging');
  });
  zone.addEventListener('dragover', event => {
    if (!isFileDrag(event) || zone.disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', event => {
    if (!isFileDrag(event)) return;
    if (--depth <= 0) clear();
  });
  zone.addEventListener('drop', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    clear();
    if (zone.disabled) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1) { onError('Drop one audio file at a time.'); return; }
    const file = files[0];
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|aac|flac|ogg|opus|aiff|aif)$/i.test(file.name)) {
      onError('Choose an audio file.'); return;
    }
    onFile(file);
  });
  // Keep file drops elsewhere from navigating away from the app.
  document.addEventListener('dragover', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (zone.disabled || !zone.contains(event.target)) event.dataTransfer.dropEffect = 'none';
  });
  document.addEventListener('drop', event => {
    if (isFileDrag(event)) event.preventDefault();
    clear();
  });
  window.addEventListener('dragend', clear);
}
