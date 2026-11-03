export function createQualityPicker(root, options) {
  const trigger = root.querySelector('.quality-trigger');
  const list = root.querySelector('[role="listbox"]');
  const label = root.querySelector('#selected-quality');
  const badge = root.querySelector('#suggested');
  const buttons = options.map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quality-option';
    button.value = option.value;
    button.tabIndex = -1;
    button.setAttribute('role', 'option');
    const text = document.createElement('span');
    text.textContent = option.label;
    const suggestion = document.createElement('span');
    suggestion.className = 'badge';
    suggestion.textContent = 'Suggested';
    suggestion.hidden = true;
    button.append(text, suggestion);
    button.addEventListener('click', () => {
      trigger.value = button.value;
      trigger.dispatchEvent(new Event('change', { bubbles: true }));
      close(true);
    });
    list.append(button);
    return button;
  });
  const selectedIndex = () => Math.max(0, buttons.findIndex(button => button.value === trigger.value));
  function close(focus = false) {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  }
  function open(index = selectedIndex()) {
    if (trigger.disabled) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    buttons[index].focus({ preventScroll: true });
    buttons[index].scrollIntoView({ block: 'nearest' });
  }
  trigger.addEventListener('click', () => list.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      open(event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : selectedIndex());
    }
  });
  list.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      next = buttons.findIndex((_, offset) => options[(index + 1 + offset) % options.length].label.toLowerCase().startsWith(event.key.toLowerCase()));
      next = next < 0 ? undefined : (index + 1 + next) % buttons.length;
    }
    if (next !== undefined) { event.preventDefault(); buttons[next].focus(); }
  });
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(); });
  return {
    update(suggested) {
      const selected = selectedIndex();
      label.textContent = options[selected].label;
      badge.hidden = Number(trigger.value) !== suggested;
      trigger.setAttribute('aria-labelledby', `quality-label selected-quality${badge.hidden ? '' : ' suggested'}`);
      buttons.forEach((button, index) => {
        button.setAttribute('aria-selected', String(index === selected));
        button.querySelector('.badge').hidden = Number(button.value) !== suggested;
      });
      if (trigger.disabled) close();
    },
  };
}
