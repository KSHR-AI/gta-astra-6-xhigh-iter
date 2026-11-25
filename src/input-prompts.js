// Keep interaction codes stable while adapting the hints to the last input used.
export function createInputPrompts(root) {
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const coarse = () => (coarsePointer.matches || navigator.maxTouchPoints > 0) ? 'touch' : 'keyboard';
  let mode, keyboardKey = 'E';
  const context = root.querySelector('#interaction-key');
  const mapKey = root.querySelector('#map-button kbd');
  const pauseKey = root.querySelector('#controls-button kbd');
  const exitKey = root.querySelector('#vehicle-exit-key');
  const waypointHelp = root.querySelector('#waypoint-help');
  const photoKey = root.querySelector('#photo-mode-button kbd');
  function setContext(key) {
    keyboardKey = key;
    const label = mode === 'gamepad' ? 'Y / △' : mode === 'touch' ? 'TAP' : key;
    if (context.textContent !== label) context.textContent = label;
  }
  function setMode(next) {
    if (next === 'fallback') {
      if (mode !== 'gamepad') return;
      next = coarse();
    }
    if (next === mode) return;
    mode = next;
    root.dataset.input = mode;
    document.documentElement.classList.toggle('touch-layout', mode === 'touch');
    exitKey.textContent = mode === 'gamepad' ? 'B / ○' : 'F';
    setContext(keyboardKey);
    mapKey.textContent = mode === 'gamepad' ? 'VIEW' : mode === 'touch' ? 'MAP' : 'M';
    pauseKey.textContent = mode === 'gamepad' ? 'MENU' : mode === 'touch' ? 'TAP' : 'ESC';
    waypointHelp.textContent = mode === 'gamepad' ? 'Use the D-pad to choose a destination and A / × to mark it.'
      : mode === 'touch' ? 'Tap a street or destination to set your waypoint.'
      : 'Click a street, or focus the map and use arrow keys and Enter.';
    photoKey.textContent = mode === 'gamepad' ? 'A / ×' : mode === 'touch' ? 'TAP' : 'P';
  }
  setMode(coarse());
  window.addEventListener('keydown', () => setMode('keyboard'), true);
  window.addEventListener('pointerdown', event => {
    setMode(event.pointerType === 'touch' || event.pointerType === 'pen' ? 'touch' : 'keyboard');
  }, true);
  return { setMode, setContext };
}

export function controllerMenuInput(button, scope, close, defaultButton) {
  if (!scope) return false;
  if (button === 'back') { close?.(); return true; }
  if (!['jump', 'up', 'down', 'left', 'right'].includes(button)) return false;
  const controls = [...scope.querySelectorAll('button:not(:disabled), input:not(:disabled), summary')]
    .filter(el => el.getClientRects().length && !el.closest('[hidden],[inert]'));
  if (!controls.length) return true;
  const focused = document.activeElement;
  if (button === 'jump') {
    const target = controls.includes(focused) ? focused : defaultButton || controls[0];
    target.click();
    return true;
  }
  if (focused?.type === 'range' && (button === 'right' || button === 'left')) {
    if (button === 'right') focused.stepUp(); else focused.stepDown();
    focused.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  const index = controls.indexOf(focused);
  const delta = button === 'down' || button === 'right' ? 1 : -1;
  controls[index < 0 ? 0 : (index + delta + controls.length) % controls.length].focus();
  return true;
}
