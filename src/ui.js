const icons = {
  logo: '<svg viewBox="0 0 34 34" fill="none" aria-hidden="true"><path d="M17 2 20 13 31 17 20 20 17 32 14 20 3 17 14 13 17 2Z" fill="currentColor"/><path d="m25 6 2 2M7 26l2 2M6 7l2 2m18 17 2 2" stroke="currentColor" stroke-width="1"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4v16M15 4v16M3 8h12M9 16h12" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="8" r="2.5" fill="currentColor"/><circle cx="15" cy="16" r="2.5" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8Z"/></svg>',
  pin: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15.7 8.4c0 4.1-5.7 9-5.7 9s-5.7-4.9-5.7-9a5.7 5.7 0 1 1 11.4 0Z" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="8" r="1.7" fill="currentColor"/></svg>',
  chevron: '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7 4 6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2V5Zm6-2v15m6-12v15" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5" stroke="currentColor" stroke-width="1.4"/></svg>',
  health: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  stamina: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.5 1-6 8H8l-1.5 6 6-8H8l1.5-6Z" fill="currentColor"/></svg>',
  weapon: '<svg viewBox="0 0 100 47" fill="none" aria-hidden="true"><path d="M12 9h66v4h12v9H56l-2 7H41l-4 15H19l6-22H12V9Z" fill="currentColor"/><path d="M41 22h11l-1 5H40" stroke="#171b1e" stroke-width="3"/><path d="M17 12h56M27 29l-2 10" stroke="#171b1e" stroke-width="2"/></svg>',
  fist: '<svg viewBox="0 0 100 47" fill="none" aria-hidden="true"><path d="M35 22V10c0-6 8-6 8 0v10-14c0-6 8-6 8 0v14-11c0-6 8-6 8 0v12-6c0-6 8-6 8 0v16c0 7-5 12-7 14H41c-2-5-5-7-8-10l-7-9c-3-4 2-9 6-5l6 6" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 9 2-5h10l2 5m-15 1h16v8H4v-8Zm2 8v3m12-3v3M6 13h3m6 0h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4V9Zm12-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zm7 0h3v14h-3z" fill="currentColor"/></svg>',
};

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));
const moneyFormat = new Intl.NumberFormat('en-US');

export function createUI(callbacks = {}) {
  const root = document.createElement('div');
  root.id = 'game-ui';
  root.className = 'game-ui is-welcome';
  root.innerHTML = `
    <div class="screen-shade" aria-hidden="true"></div>
    <header class="game-header">
      <div class="brand-lockup"><span class="brand-symbol">${icons.logo}</span><span class="brand-name">GRAND THEFT<span>ASTRA</span></span><span class="brand-separator"></span><span class="mode-chip"><i></i> FREE ROAM</span></div>
      <div class="header-status"><span class="world-clock">${icons.sun}<span id="world-time">18:42</span><span class="clock-divider">/</span><span class="weather-label">LOS PACIFICOS</span></span><span class="balance"><span class="dollar-sign">$</span><span id="money-value">2,450</span></span><button class="icon-button menu-button" id="pause-button" type="button" aria-label="Open settings and pause">${icons.settings}</button></div>
    </header>
    <main class="welcome" id="welcome-screen">
      <div class="welcome-eyebrow"><span></span> A LOS PACIFICOS STORY</div>
      <h1 class="title-lockup" aria-label="Grand Theft Astra"><span class="title-prelude">GRAND THEFT</span><span class="title-astra">ASTRA</span></h1>
      <div class="welcome-heading"><span class="story-label">STORY CHAPTER</span>The Coastal Job</div>
      <p class="welcome-copy">Meet your contact. Find the car. Lose the heat.<br>One job can change everything.</p>
      <div class="welcome-menu"><button class="enter-button" id="start-button" type="button" disabled><span class="menu-index">01</span><span id="start-label">Preparing the city</span><span class="button-arrow">${icons.arrow}</span></button><button class="welcome-settings" id="welcome-settings" type="button"><span class="menu-index">02</span><span>Settings &amp; controls</span><span class="button-arrow">${icons.settings}</span></button></div>
      <div class="start-subtitle"><span class="status-dot"></span><span id="ready-label">PREPARING YOUR SESSION</span><span class="subtitle-line"></span><span id="save-label">SINGLE PLAYER</span></div>
      <div class="welcome-controls"><div><kbd>WASD</kbd><span>Explore</span></div><div><kbd>E</kbd><span>Take a ride</span></div><div><kbd>1</kbd><span>Equip</span></div></div>
    </main>
    <aside class="welcome-world" aria-hidden="true"><span class="world-line"></span><span>SOUTHERN SAN ANDREAS</span><b>LOS PACIFICOS</b><span class="world-tag">34° 03′ N &nbsp; / &nbsp; 118° 15′ W</span></aside>
    <footer class="welcome-footer"><span>GRAND THEFT ASTRA <i></i> AN OPEN WORLD SANDBOX</span><span><span class="footer-version">SINGLE PLAYER</span><i></i> THE CITY IS YOURS</span></footer>
    <div class="play-hud" id="play-hud">
      <aside class="objective-card"><div class="objective-icon">${icons.arrow}</div><div class="objective-content"><div class="objective-eyebrow"><span id="mission-chapter">THE COASTAL JOB</span><span id="objective-distance">EXPLORE</span></div><h2 id="objective-title">A fresh start</h2><p id="objective-description">Find a ride. Make the city yours.</p><div class="mission-progress" id="mission-progress" hidden role="progressbar" aria-label="Mission progress" aria-valuemin="0" aria-valuemax="100"><span id="mission-progress-fill"></span></div></div></aside>
      <aside class="wanted-panel" id="police-panel" aria-label="Police status"><div class="wanted-stars" id="wanted-stars">${Array.from({ length: 5 }, (_, i) => `<span data-star="${i}">${icons.star}</span>`).join('')}</div><span id="wanted-caption">ALL CLEAR</span><span class="police-instruction" id="police-instruction"></span><div class="police-search" id="police-search" hidden><div class="police-search-track" role="progressbar" aria-label="Escape progress" aria-valuemin="0" aria-valuemax="100" id="search-progress"><span id="search-progress-fill"></span></div><span>LOSING THE HEAT</span></div></aside>
      <div class="crosshair" id="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <aside class="minimap-panel"><div class="minimap-topline"><span class="district-name" id="location-name">VESPUCCI BOULEVARD</span><button class="map-button" id="map-button" type="button" aria-label="Open city map"><kbd>M</kbd>${icons.map}</button></div><button class="minimap-frame" id="minimap-open" type="button" aria-label="Open city map"><canvas id="minimap" width="440" height="300"></canvas><span class="minimap-north">N</span><span class="minimap-scale">100 m <i></i></span></button><div class="vitals"><div class="vital health">${icons.health}<div class="vital-track"><span id="health-fill"></span></div><span id="health-value">100</span></div><div class="vital stamina">${icons.stamina}<div class="vital-track"><span id="stamina-fill"></span></div></div></aside>
      <button class="interaction-prompt" id="interaction-prompt" type="button" hidden><kbd id="interaction-key">E</kbd><span class="interaction-copy"><span id="interaction-title">ENTER VEHICLE</span><strong id="interaction-name">Take it for a spin</strong></span><span class="interaction-icon" id="interaction-icon">${icons.arrow}</span></button>
      <aside class="equipment-panel"><div id="weapon-panel"><span class="equipment-label" id="weapon-name">9MM PISTOL</span><div class="weapon-row"><span class="weapon-silhouette" id="weapon-silhouette">${icons.weapon}</span><span class="ammo-count" id="ammo-value">12</span><span class="ammo-divider" id="ammo-divider">/</span><span class="ammo-reserve" id="reserve-value">96</span></div><div class="equipment-hint" id="weapon-hints"><span><kbd>R</kbd> RELOAD</span><span><kbd>LMB</kbd> FIRE</span></div></div><div class="speedometer" id="speed-panel" hidden><span class="equipment-label">ON THE STREETS</span><div class="speed-row"><span id="speed-value">000</span><div><b>KM/H</b><span id="gear-value">N</span></div></div><div class="vehicle-telemetry"><div class="rpm-label"><span>ENGINE</span><span id="rpm-value">— RPM</span></div><div class="speed-track"><span id="speed-fill"></span></div><div class="vehicle-condition" id="vehicle-condition"><span>CONDITION</span><div class="condition-track"><span id="vehicle-health-fill"></span></div><strong id="vehicle-health-value">100%</strong></div></div><div class="equipment-hint"><span><kbd>SPACE</kbd> HANDBRAKE</span><span><kbd>E</kbd> EXIT</span></div></div></aside>
      <div class="game-bottom-hint"><span><kbd>ESC</kbd> MENU &amp; CONTROLS</span></div><div class="dialogue-panel" id="dialogue-panel" hidden role="status" aria-live="polite"><span class="dialogue-speaker" id="dialogue-speaker"></span><p id="dialogue-text"></p></div><div class="mission-complete" id="mission-complete" role="status" aria-live="polite" hidden><span class="complete-symbol">${icons.logo}</span><div><span class="complete-eyebrow">JOB COMPLETE</span><h2 id="complete-title"></h2><p id="complete-reward"></p></div></div>
      <div class="toast" id="game-toast" role="status" aria-live="polite"><span class="toast-icon">${icons.pin}</span><div><strong id="toast-title"></strong><p id="toast-detail"></p></div></div>
      <div class="mobile-controls"><div class="mobile-dpad"><button class="touch-key up" data-code="KeyW" aria-label="Move forward">${icons.chevron}</button><button class="touch-key left" data-code="KeyA" aria-label="Move left">${icons.chevron}</button><button class="touch-key down" data-code="KeyS" aria-label="Move backward">${icons.chevron}</button><button class="touch-key right" data-code="KeyD" aria-label="Move right">${icons.chevron}</button></div><div class="mobile-actions"><button class="touch-key" data-code="ShiftLeft" aria-label="Sprint">RUN</button><button class="touch-key" data-code="Space" aria-label="Jump or handbrake">JUMP</button><button class="touch-key touch-interact" data-code="KeyE" id="mobile-interact" aria-label="Interact or enter vehicle">USE</button><button class="touch-key touch-fire" data-code="Mouse0" aria-label="Fire weapon">${icons.target}</button><button class="touch-key touch-utility" data-code="KeyR" aria-label="Reload weapon">RELOAD</button><button class="touch-key touch-utility" data-code="Digit1" aria-label="Equip or holster weapon">EQUIP</button></div></div>
    </div>
    <div class="modal-backdrop" id="pause-overlay" hidden><section class="pause-menu" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div class="modal-topline"><span class="small-eyebrow" id="pause-eyebrow">YOUR EXPERIENCE</span><button class="icon-button" id="close-pause" type="button" aria-label="Close pause menu">${icons.close}</button></div><h2 id="pause-title">Settings<span>.</span></h2><p class="pause-subtitle" id="pause-subtitle">Set the tone for your time in Los Pacificos.</p><button class="enter-button resume-button" id="resume-button" type="button"><span id="resume-label">Back to main menu</span>${icons.arrow}</button><div class="settings-list"><div class="setting-row"><span>${icons.sound}Sound</span><button class="setting-toggle is-on" id="sound-button" type="button" aria-pressed="true"><span class="setting-value">On</span><i></i></button></div><div class="setting-row"><span>${icons.settings}Graphics</span><div class="segmented" aria-label="Graphics quality"><button type="button" data-quality="high" class="is-selected">Cinematic</button><button type="button" data-quality="performance">Performance</button></div></div><div class="setting-row"><span>${icons.sun}Time of day</span><div class="segmented" aria-label="Time of day"><button type="button" data-time="golden" class="is-selected">Golden hour</button><button type="button" data-time="night">Night</button></div></div></div><details class="controls-details"><summary>Controls<span>VIEW ALL ${icons.chevron}</span></summary><div class="controls-grid"><span>Move / drive</span><kbd>W A S D</kbd><span>Look around</span><kbd>MOUSE / DRAG</kbd><span>Sprint</span><kbd>SHIFT</kbd><span>Jump / handbrake</span><kbd>SPACE</kbd><span>Interact / enter / exit</span><kbd>E</kbd><span>Equip weapon</span><kbd>1</kbd><span>Fire / aim</span><kbd>LMB / RMB</kbd><span>Horn</span><kbd>H</kbd><span>Reload</span><kbd>R</kbd><span>City map / pause</span><kbd>M / ESC</kbd></div></details><button class="restart-button" id="restart-button" type="button">Start a fresh session<span>↗</span></button><div class="session-summary" id="session-summary" hidden><span id="session-save">PROGRESS SAVED</span><span id="session-jobs">0 JOBS COMPLETED</span></div><div class="pause-footer">GRAND THEFT ASTRA <span>LOS PACIFICOS AWAITS</span></div></section></div>
    <div class="modal-backdrop map-backdrop" id="map-overlay" hidden><section class="city-map-dialog" role="dialog" aria-modal="true" aria-labelledby="city-map-title"><div class="city-map-heading"><div><span class="small-eyebrow">KNOW YOUR NEIGHBORHOOD</span><h2 id="city-map-title">Los Pacificos<span>.</span></h2></div><button class="icon-button" id="close-map" type="button" aria-label="Close city map">${icons.close}</button></div><div class="city-map-surface"><canvas id="city-map" width="1000" height="800"></canvas><span class="map-compass">N <i></i></span></div><div class="map-legend"><span><i class="legend-player"></i> You</span><span><i class="legend-car"></i> Vehicles</span><span><i class="legend-objective"></i> Objective</span><span class="map-legend-caption">YOUR NEXT MOVE IS UP TO YOU.</span></div></section></div>
  `;
  document.body.append(root);
  const find = (id) => root.querySelector(`#${id}`);
  const elements = Object.fromEntries(['welcome-screen', 'start-button', 'start-label', 'ready-label', 'world-time', 'money-value', 'objective-title', 'objective-description', 'objective-distance', 'wanted-caption', 'location-name', 'health-fill', 'health-value', 'stamina-fill', 'weapon-name', 'weapon-panel', 'weapon-silhouette', 'weapon-hints', 'ammo-divider', 'ammo-value', 'reserve-value', 'speed-panel', 'speed-value', 'speed-fill', 'gear-value', 'interaction-prompt', 'interaction-title', 'interaction-name', 'crosshair', 'pause-overlay', 'pause-title', 'pause-eyebrow', 'pause-subtitle', 'resume-label', 'map-overlay', 'sound-button', 'game-toast', 'toast-title', 'toast-detail', 'save-label', 'mission-chapter', 'mission-progress', 'mission-progress-fill', 'police-panel', 'police-instruction', 'police-search', 'search-progress', 'search-progress-fill', 'interaction-key', 'interaction-icon', 'mobile-interact', 'rpm-value', 'vehicle-condition', 'vehicle-health-fill', 'vehicle-health-value', 'dialogue-panel', 'dialogue-speaker', 'dialogue-text', 'mission-complete', 'complete-title', 'complete-reward', 'session-summary', 'session-save', 'session-jobs'].map((id) => [id, find(id)]));
  let started = false;
  let paused = false;
  let mapOpen = false;
  let sound = true;
  let toastTimer;
  let completeTimer;
  let ready = false;
  let interactionCode = 'KeyE';
  let lastState = {};
  let lastArmed;
  let returnFocus;
  const call = (name, ...args) => callbacks[name]?.(...args);
  const inputCode = (key = 'E') => {
    const value = String(key);
    if (/^(Key[A-Z]|Digit[0-9]|Space|ShiftLeft|ShiftRight|Mouse[0-9])$/.test(value)) return value;
    if (/^[a-z]$/i.test(value)) return `Key${value.toUpperCase()}`;
    if (/^[0-9]$/.test(value)) return `Digit${value}`;
    return value.toUpperCase() === 'SPACE' ? 'Space' : 'KeyE';
  };
  const keyLabel = (key) => String(key || 'E').replace(/^Key/, '').replace(/^Digit/, '').toUpperCase();
  const savedTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'PROGRESS SAVED' : `SAVED ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };
  const text = (id, value) => { const el = elements[id]; const next = String(value); if (el && el.textContent !== next) el.textContent = next; };
  const start = () => {
    if (elements['start-button'].disabled) return;
    started = true;
    root.classList.remove('is-welcome');
    root.classList.add('is-playing');
    call('onStart');
  };
  const setPaused = (value) => {
    paused = Boolean(value);
    elements['pause-overlay'].hidden = !paused;
    text('pause-title', started ? 'Game paused.' : 'Settings.');
    text('pause-eyebrow', started ? 'THE CITY CAN WAIT' : 'YOUR EXPERIENCE');
    text('pause-subtitle', started ? 'Take a moment. Your story continues when you return.' : 'Set the tone for your time in Los Pacificos.');
    text('resume-label', started ? 'Resume session' : 'Back to main menu');
    find('restart-button').hidden = !started;
    root.classList.toggle('is-paused', paused);
    if (paused) { returnFocus = document.activeElement; find('resume-button').focus({ preventScroll: true }); }
    else if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };
  const pause = () => { setPaused(true); call('onPause'); };
  const resume = () => { setPaused(false); call('onResume'); };
  const showMap = (value) => {
    mapOpen = Boolean(value);
    elements['map-overlay'].hidden = !mapOpen;
    root.classList.toggle('is-map-open', mapOpen);
    if (mapOpen) find('close-map').focus({ preventScroll: true });
  };
  const toggleMap = (value) => { showMap(value ?? !mapOpen); call('onMap', mapOpen); };
  find('start-button').addEventListener('click', start);
  find('pause-button').addEventListener('click', pause);
  find('welcome-settings').addEventListener('click', pause);
  find('close-pause').addEventListener('click', resume);
  find('resume-button').addEventListener('click', resume);
  find('map-button').addEventListener('click', () => toggleMap());
  find('minimap-open').addEventListener('click', () => toggleMap());
  find('close-map').addEventListener('click', () => toggleMap(false));
  find('interaction-prompt').addEventListener('click', () => { const code = interactionCode; call('onMobile', code, true); setTimeout(() => call('onMobile', code, false), 0); });
  find('restart-button').addEventListener('click', () => { clearTimeout(completeTimer); elements['mission-complete'].hidden = true; root.classList.remove('has-completion'); setPaused(false); showMap(false); started = true; root.classList.remove('is-welcome'); root.classList.add('is-playing'); call('onRestart'); });
  find('sound-button').addEventListener('click', () => {
    sound = !sound;
    elements['sound-button'].classList.toggle('is-on', sound);
    elements['sound-button'].setAttribute('aria-pressed', String(sound));
    elements['sound-button'].querySelector('.setting-value').textContent = sound ? 'On' : 'Off';
    call('onSound', sound);
  });
  root.querySelectorAll('[data-quality]').forEach((button) => button.addEventListener('click', () => {
    root.querySelectorAll('[data-quality]').forEach((el) => el.classList.toggle('is-selected', el === button));
    call('onQuality', button.dataset.quality);
  }));
  root.querySelectorAll('[data-time]').forEach((button) => button.addEventListener('click', () => {
    root.querySelectorAll('[data-time]').forEach((el) => el.classList.toggle('is-selected', el === button));
    call('onTime', button.dataset.time);
  }));
  root.querySelectorAll('[data-code]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); button.setPointerCapture(event.pointerId); button.classList.add('is-held'); button.heldCode = button.dataset.code; call('onMobile', button.heldCode, true); });
    const release = (event) => { event.preventDefault(); event.stopPropagation(); button.classList.remove('is-held'); if (button.heldCode) call('onMobile', button.heldCode, false); button.heldCode = null; };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', () => { button.classList.remove('is-held'); if (button.heldCode) call('onMobile', button.heldCode, false); button.heldCode = null; });
  });
  // Keep pointer input on menus from becoming a shot or a camera drag.
  root.querySelectorAll('button, .pause-menu, .city-map-dialog').forEach((element) => {
    element.addEventListener('pointerdown', (event) => event.stopPropagation());
    element.addEventListener('mousedown', (event) => event.stopPropagation());
  });
  const update = (state = {}) => {
    lastState = { ...lastState, ...state };
    const s = lastState;
    if (s.started !== undefined && s.started !== started) { started = s.started; root.classList.toggle('is-welcome', !started); root.classList.toggle('is-playing', started); }
    if (s.paused !== undefined && s.paused !== paused) setPaused(s.paused);
    if (s.time !== undefined) text('world-time', s.time);
    if (s.money !== undefined) text('money-value', moneyFormat.format(s.money));
    if (s.health !== undefined) { elements['health-fill'].style.width = `${clamp(s.health)}%`; text('health-value', Math.round(clamp(s.health))); root.classList.toggle('low-health', s.health < 25); }
    if (s.stamina !== undefined) elements['stamina-fill'].style.width = `${clamp(s.stamina)}%`;
    if (s.location) text('location-name', s.location.toUpperCase());
    if (s.savedAt !== undefined) {
      if (ready) text('start-label', s.savedAt ? 'Continue your story' : 'Begin The Coastal Job');
      text('save-label', s.savedAt ? savedTime(s.savedAt) : 'SINGLE PLAYER');
      text('session-save', s.savedAt ? savedTime(s.savedAt) : 'NO SAVE YET');
    }
    elements['session-summary'].hidden = !s.savedAt && !s.completedJobs;
    if (s.completedJobs !== undefined) text('session-jobs', `${Math.max(0, Number(s.completedJobs) || 0)} ${Number(s.completedJobs) === 1 ? 'JOB' : 'JOBS'} COMPLETED`);
    if (s.missionStage !== undefined) {
      const chapter = typeof s.missionStage === 'number' ? `CHAPTER ${String(Math.max(0, s.missionStage)).padStart(2, '0')}` : String(s.missionStage || 'THE COASTAL JOB');
      text('mission-chapter', chapter.toUpperCase());
    }
    if (s.missionProgress !== undefined) {
      const progress = clamp(s.missionProgress, 0, 1) * 100;
      elements['mission-progress'].hidden = false;
      elements['mission-progress-fill'].style.width = `${progress}%`;
      elements['mission-progress'].setAttribute('aria-valuenow', Math.round(progress));
    }
    if (s.objectiveTitle) text('objective-title', s.objectiveTitle);
    if (s.objective) text('objective-description', s.objective);
    if (s.objectiveDistance !== undefined) text('objective-distance', s.objectiveDistance > 0 ? `${Math.round(s.objectiveDistance)} M` : 'EXPLORE');
    if (s.wanted !== undefined) {
      root.querySelectorAll('[data-star]').forEach((star) => star.classList.toggle('is-active', Number(star.dataset.star) < s.wanted));
      root.classList.toggle('is-wanted', s.wanted > 0);
    }
    const policeState = ['clear', 'reported', 'pursuit', 'searching'].includes(s.policeState) ? s.policeState : (s.wanted > 0 ? 'pursuit' : 'clear');
    const policeCopy = { clear: ['ALL CLEAR', ''], reported: ['CRIME REPORTED', 'Officers are responding'], pursuit: ['POLICE PURSUIT', 'Break their line of sight'], searching: ['SEARCH IN PROGRESS', 'Stay out of sight'] }[policeState];
    root.dataset.policeState = policeState;
    elements['police-panel'].hidden = policeState === 'clear' && !(s.wanted > 0);
    text('wanted-caption', policeCopy[0]);
    text('police-instruction', policeCopy[1]);
    elements['police-search'].hidden = policeState !== 'searching';
    const searchProgress = clamp(s.searchProgress ?? 0, 0, 1) * 100;
    elements['search-progress-fill'].style.width = `${searchProgress}%`;
    elements['search-progress'].setAttribute('aria-valuenow', Math.round(searchProgress));
    if (s.ammo !== undefined) text('ammo-value', String(s.ammo).padStart(2, '0'));
    if (s.reserve !== undefined) text('reserve-value', String(s.reserve).padStart(2, '0'));
    if (s.weapon) {
      text('weapon-name', s.weapon.toUpperCase());
      const armed = s.weapon.toUpperCase() !== 'UNARMED';
      root.classList.toggle('is-armed', armed);
      if (lastArmed !== armed) {
        elements['weapon-silhouette'].innerHTML = armed ? icons.weapon : icons.fist;
        elements['weapon-hints'].innerHTML = armed ? '<span><kbd>R</kbd> RELOAD</span><span><kbd>LMB</kbd> FIRE</span>' : '<span><kbd>1</kbd> EQUIP WEAPON</span>';
        elements['ammo-divider'].hidden = !armed;
        elements['reserve-value'].hidden = !armed;
        elements['ammo-value'].hidden = !armed;
        lastArmed = armed;
      }
    }
    if (s.inCar !== undefined) {
      elements['weapon-panel'].hidden = Boolean(s.inCar);
      elements['speed-panel'].hidden = !s.inCar;
      root.classList.toggle('is-driving', Boolean(s.inCar));
    }
    if (s.speed !== undefined) text('speed-value', String(Math.round(Math.abs(Number(s.speed) || 0))).padStart(3, '0'));
    const gear = s.gear === undefined || s.gear === null ? '—' : Number(s.gear) === -1 ? 'R' : Number(s.gear) === 0 ? 'N' : String(s.gear).toUpperCase();
    text('gear-value', gear);
    const rpm = Math.max(0, Number(s.rpm) || 0);
    const rpmValue = rpm <= 1 ? rpm * 8000 : rpm;
    text('rpm-value', s.rpm === undefined ? '— RPM' : `${(rpmValue / 1000).toFixed(1)} × 1000 RPM`);
    elements['speed-fill'].style.width = `${clamp(rpmValue / 80)}%`;
    root.classList.toggle('engine-redline', rpmValue >= 6500);
    const vehicleHealth = s.vehicleHealth === undefined ? 100 : clamp(s.vehicleHealth);
    text('vehicle-health-value', `${Math.round(vehicleHealth)}%`);
    elements['vehicle-health-fill'].style.width = `${vehicleHealth}%`;
    root.classList.toggle('vehicle-damaged', vehicleHealth <= 35);
    const interactionVisible = s.interactionVisible === undefined ? Boolean(s.nearCar) && !s.inCar : Boolean(s.interactionVisible);
    elements['interaction-prompt'].hidden = !interactionVisible;
    root.classList.toggle('has-interaction', interactionVisible);
    interactionCode = inputCode(s.interactionKey || 'E');
    text('interaction-key', keyLabel(s.interactionKey));
    text('interaction-title', s.interactionTitle || 'ENTER VEHICLE');
    text('interaction-name', s.interactionName || (typeof s.nearCar === 'string' ? s.nearCar : s.nearCar?.name) || 'Take it for a spin');
    elements['mobile-interact'].dataset.code = interactionVisible ? interactionCode : 'KeyE';
    text('mobile-interact', s.inCar && !interactionVisible ? 'EXIT' : 'USE');
    elements['mobile-interact'].setAttribute('aria-label', interactionVisible ? [s.interactionTitle, s.interactionName].filter(Boolean).join(': ') || 'Interact' : s.inCar ? 'Exit vehicle' : 'Interact or enter vehicle');
    const subtitle = typeof s.subtitle === 'string' ? s.subtitle.trim() : '';
    elements['dialogue-panel'].hidden = !subtitle;
    root.classList.toggle('has-subtitle', Boolean(subtitle));
    text('dialogue-text', subtitle);
    text('dialogue-speaker', String(s.subtitleSpeaker || 'CONTACT').toUpperCase());

  };
  const toast = (title, detail = '') => {
    clearTimeout(toastTimer);
    text('toast-title', title);
    text('toast-detail', detail);
    elements['toast-detail'].hidden = !detail;
    elements['game-toast'].classList.add('is-visible');
    toastTimer = setTimeout(() => elements['game-toast'].classList.remove('is-visible'), 4200);
  };
  const missionComplete = ({ title = 'The Coastal Job', reward } = {}) => {
    clearTimeout(completeTimer);
    text('complete-title', title);
    const numericReward = Number(reward);
    text('complete-reward', Number.isFinite(numericReward) && reward !== undefined ? `+$${moneyFormat.format(numericReward)} RECEIVED` : reward || 'JOB SUCCESSFULLY COMPLETED');
    elements['mission-complete'].hidden = false;
    root.classList.add('has-completion');
    completeTimer = setTimeout(() => { elements['mission-complete'].hidden = true; root.classList.remove('has-completion'); }, 6500);
  };
  const setReady = (value) => {
    ready = Boolean(value);
    elements['start-button'].disabled = !ready;
    text('start-label', ready ? (lastState.savedAt ? 'Continue your story' : 'Begin The Coastal Job') : 'Preparing the city');
    text('ready-label', ready ? 'READY TO PLAY' : 'PREPARING YOUR SESSION');
    root.classList.toggle('is-ready', Boolean(ready));
  };
  return { update, toast, missionComplete, setPaused, setReady, showMap, root, get started() { return started; }, get paused() { return paused; }, get mapOpen() { return mapOpen; } };
}
