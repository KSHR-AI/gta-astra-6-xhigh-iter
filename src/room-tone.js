// Vale's commission uses the two contrasting soundscapes around the Paloma.
export const recorderDesk = { x: -16, z: 23.1, label: 'Room Tone' };
const courtyard = { x: -28, z: 37, label: 'Pool courtyard', fee: 350, from: 3, until: 8, take: 'Poolside' };
const boulevard = { x: -13.5, z: -40, label: 'Boulevard traffic', fee: 650, from: 4, until: 6, take: 'Rush hour' };
const sites = { courtyard, boulevard };
const near = (position, point, radius = 3) => position && Math.hypot(position.x - point.x, position.z - point.z) < radius;

export function createRoomTone(saved, { dialogue, toast, save, finish, cue }) {
  let phase = 'available';
  let site = null;
  let elapsed = 0;
  let microphone = null;
  function restore(value) {
    phase = 'available'; site = null; elapsed = 0; microphone = null;
    if (value?.phase === 'choosing') phase = 'choosing';
    if (['returning', 'finished'].includes(value?.phase) && Object.hasOwn(sites, value.site)) {
      phase = value.phase; site = value.site;
    }
  }
  restore(saved);
  function checkpoint() {
    return { phase: phase === 'recording' ? 'choosing' : phase, site: phase === 'recording' ? null : site };
  }
  function active() { return ['choosing','recording','returning'].includes(phase); }
  function action(position, inCar) {
    if (inCar || phase === 'finished') return null;
    const prompt = (kind, name) => ({ kind, title: 'ROOM TONE · VALE FM', name });
    if (near(position, recorderDesk)) {
      if (phase === 'available') return prompt('radio-start', 'Borrow Vale’s field recorder');
      if (phase === 'returning') return prompt('radio-return', `Hand over “${sites[site].take}” · +$${sites[site].fee}`);
      if (phase === 'choosing') return prompt('radio-cancel', 'Return the recorder · cancel job');
    }
    if (phase === 'choosing') {
      for (const [key, point] of Object.entries(sites)) {
        if (near(position, point)) return prompt('radio-' + key, `Roll tape · ${point.label} · $${point.fee}`);
      }
    }
    if (phase === 'recording' && near(position, sites[site])) {
      return prompt('radio-cut', elapsed >= sites[site].from ? 'Cut now · keep this take' : 'Cut early · discard take');
    }
    return null;
  }
  function discard(detail) {
    phase = 'choosing'; site = null; elapsed = 0; microphone = null;
    toast?.('TAKE DISCARDED', detail);
  }
  function interact(kind, position, vehicle) {
    if (action(position, vehicle)?.kind !== kind) return {};
    if (kind === 'radio-start') {
      phase = 'choosing'; save();
      dialogue?.('VALE FM', ['I need one sound for tonight’s opening. The pool courtyard pays $350. A clean traffic swell on the boulevard pays $650. You pick.', 'Stand on the mark, roll tape and watch the recorder. Cut when it says CUT NOW. Bring the take back here.']);
    } else if (kind === 'radio-cancel') {
      phase = 'available'; save(); toast?.('RECORDER RETURNED', 'Vale will keep the commission open.');
    } else if (kind === 'radio-return') {
      phase = 'finished';
      finish(sites[site].fee, sites[site].take);
      dialogue?.('VALE FM', [site === 'courtyard' ? 'Water and the palms. I can hear the whole courtyard with my eyes shut. That opens tonight’s show.' : 'There it is. The boulevard takes a breath and the engines come back in. That opens tonight’s show.']);
    } else if (kind === 'radio-cut') {
      if (elapsed < sites[site].from) discard('Too short. Roll again and wait for CUT NOW.');
      else {
        phase = 'returning'; save(); toast?.('TAKE KEPT', 'Bring the recorder back to Vale at the Paloma.');
      }
    } else {
      site = kind.slice(6); phase = 'recording'; elapsed = 0;
      microphone = { x: position.x, z: position.z };
      toast?.('TAPE ROLLING', 'Stand still and cut on the cue.');
    }
    return { radioInteraction: true };
  }
  function update(dt, position, vehicle) {
    if (phase !== 'recording') return;
    if (vehicle || !near(position, sites[site]) || !near(position, microphone, 1)) {
      discard('The microphone moved. Stand still during the next take.'); return;
    }
    const before = elapsed;
    elapsed += dt;
    if (before < sites[site].from && elapsed >= sites[site].from) cue?.(site);
    if (elapsed > sites[site].until) discard('The tape ran long. Roll again and cut on the cue.');
  }
  function view(available) {
    const secondaryTarget = available && phase === 'available' ? recorderDesk : phase === 'choosing' ? boulevard : null;
    const base = { radioPhase: phase, radioActive: active(), tapeTime: 0, tapeWindow: 0, secondaryTarget };
    if (phase === 'choosing') return { ...base, target: courtyard, objectiveTitle: 'Choose your sound',
      objective: 'Record the Paloma pool ($350, gold marker) or boulevard traffic ($650, teal marker). Approach either mark on foot.',
      missionStage: 'ROOM TONE · FIELD RECORDING', missionProgress: .25 };
    if (phase === 'recording') {
      const point = sites[site], ready = elapsed >= point.from;
      return { ...base, target: point, tapeTime: elapsed / point.until, tapeWindow: point.from / point.until, objectiveTitle: ready ? 'CUT NOW · interact' : `Tape rolling · ${Math.max(1,Math.ceil(point.from-elapsed))}s`,
        objective: ready ? 'Cut the recording before the sound fades.' : 'Stay inside the mark until the sound comes in.',
        missionStage: 'ROOM TONE · ON AIR', missionProgress: Math.min(1,elapsed/point.until) };
    }
    if (phase === 'returning') return { ...base, target: recorderDesk, objectiveTitle: 'Return Vale’s recorder',
      objective: `Hand over “${sites[site].take}” at the Paloma for $${sites[site].fee}.`,
      missionStage: 'ROOM TONE · HANDOFF', missionProgress: .8 };
    return base;
  }
  return { active, checkpoint, action, interact, update, view, restore };
}
