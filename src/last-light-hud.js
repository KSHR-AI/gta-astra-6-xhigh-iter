import { vehicleConditionPercent } from './last-light.js';

const dollars = value => '$' + Number(value).toLocaleString('en-US');

export const lastLightPanel = `
  <aside class="last-light-panel" id="last-light-panel" aria-label="Mara’s delivery" hidden>
    <small id="last-light-kicker"></small>
    <strong id="last-light-title"></strong>
    <div class="dispatch-fork" id="dispatch-fork" hidden>
      <span><b aria-hidden="true">↑</b> Vespucci Boulevard</span>
      <span><b aria-hidden="true">↱</b> Sunline service lane</span>
    </div>
    <div class="dispatch-condition" id="dispatch-condition" hidden>
      <div><span>Condition</span><b id="dispatch-condition-value"></b></div>
      <div class="dispatch-meter" aria-hidden="true"><i></i></div>
      <span id="dispatch-bonus"></span>
    </div>
  </aside>`;

export function createLastLightHud(root) {
  const panel = root.querySelector('#last-light-panel');
  const kicker = panel.querySelector('small');
  const title = panel.querySelector('strong');
  const fork = panel.querySelector('#dispatch-fork');
  const condition = panel.querySelector('#dispatch-condition');
  const percent = panel.querySelector('#dispatch-condition-value');
  const bonus = panel.querySelector('#dispatch-bonus');
  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  return state => {
    const run = state.lastLight;
    const active = state.inCar && run?.drivingJobCar !== false && !state.circuitActive && !state.radioActive && ['approach','fork','drive','handoff'].includes(run?.phase);
    panel.hidden = !active;
    root.classList.toggle('has-dispatch', Boolean(active));
    if (!active) return;
    const approaching = run.phase === 'approach';
    const choosing = approaching || run.phase === 'fork';
    const arrived = run.phase === 'handoff';
    const waitingForClearance = arrived && (state.wanted > 0 || ['reported','pursuit','searching'].includes(state.policeState));
    fork.hidden = !choosing;
    condition.hidden = choosing;
    panel.dataset.route = run.route || '';
    setText(kicker, arrived ? 'Auto Works · delivery bay' : run.replay ? 'Last Light · practice run' : 'Last Light at the Paloma');
    setText(title, approaching ? 'Ahead at Calypso' : choosing ? 'Choose your route' : waitingForClearance ? 'Lose the patrol' : arrived ? 'Park for the handoff' : run.routeLabel || 'North to Calypso');
    if (choosing) return;
    const pct = vehicleConditionPercent(run.conditionPct);
    setText(percent, pct + '%');
    condition.style.setProperty('--condition', pct + '%');
    condition.style.setProperty('--threshold', run.cleanThreshold + '%');
    condition.classList.toggle('below-threshold', !run.cleanEligible);
    const quote = state.deliveryQuote;
    const clean = run.cleanEligible ? 'Clean at ' + run.cleanThreshold + '% or higher' : 'Clean bonus lost';
    setText(bonus, run.replay ? 'Practice delivery' : arrived && quote ? dollars(quote.total) + ' due at handoff' : clean);
  };
}

export function showDeliveryReceipt(element, info) {
  const receipt = Number.isFinite(info.basePay);
  element.hidden = !receipt;
  element.replaceChildren();
  if (!receipt) return;
  for (const [label, value] of [
    ['Route', info.routeLabel],
    ['Final condition', vehicleConditionPercent(info.conditionPct) + '%'],
    ['Delivery fee', dollars(info.basePay)],
    ['Clean bonus', dollars(info.cleanBonus)],
  ]) {
    const term = document.createElement('dt'), amount = document.createElement('dd');
    term.textContent = label;
    amount.textContent = value;
    element.append(term, amount);
  }
}
