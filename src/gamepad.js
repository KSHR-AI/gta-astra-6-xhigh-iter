const neutral = Object.freeze({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, throttle: 0, sprint: false, handbrake: false });
const buttonActions = [[9, 'menu'], [8, 'map'], [3, 'context'], [0, 'jump']];

function stick(x = 0, y = 0) {
  const length = Math.hypot(x, y);
  if (length <= .16) return [0, 0];
  const scale = (Math.min(1, length) - .16) / (.84 * length);
  return [x * scale, y * scale];
}

function trigger(button) {
  return Math.max(0, (Math.min(1, button?.value || 0) - .04) / .96);
}

export function createGamepadInput() {
  let index, previous = 0, waitForRelease = false;
  return {
    reset() { previous = 0; waitForRelease = true; },
    poll(pads, onPress) {
      const available = Array.from(pads || []).filter(pad => pad?.connected && pad.mapping === 'standard');
      const pad = available.find(candidate => candidate.index === index) || available[0];
      if (!pad) {
        if (index !== undefined) waitForRelease = true;
        index = undefined; previous = 0;
        return neutral;
      }
      if (index !== undefined && index !== pad.index) waitForRelease = true;
      index = pad.index;
      let mask = 0;
      for (const [button] of buttonActions) if (pad.buttons[button]?.pressed) mask |= 1 << button;
      const [moveX, moveY] = stick(pad.axes[0], pad.axes[1]);
      const [lookX, lookY] = stick(pad.axes[2], pad.axes[3]);
      const gas = trigger(pad.buttons[7]), brake = trigger(pad.buttons[6]);
      const sprint = !!pad.buttons[10]?.pressed, handbrake = !!pad.buttons[0]?.pressed;
      if (waitForRelease) {
        waitForRelease = !!(mask || moveX || moveY || lookX || lookY || gas || brake || sprint);
        return neutral;
      }
      for (const [button, action] of buttonActions) if ((mask & ~previous) & (1 << button)) onPress(action);
      previous = mask;
      return { moveX, moveY, lookX, lookY, throttle: gas - brake, sprint, handbrake };
    },
  };
}
