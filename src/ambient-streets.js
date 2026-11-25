import { Vector3 } from 'three';

// The stripes on Ocean Drive run across the boulevard at z=13. Both stops
// lie on the pavement, outside the turning lanes and corner signal masts.
const dinerStops = [[15,30], [13.5,13], [-14,13], [-14,26], [-14,13], [13.5,13]];
const shutterHandle = new Vector3(17.9, 2.4, -130.25);
const mechanicPost = new Vector3(16.8, 0, -130.25);
const mechanicAside = new Vector3(16.7, 0, -133.2);

export function dinerRoute() {
  return dinerStops.map(([x,z]) => new Vector3(x,0,z));
}

export function dinerPace(person, time) {
  const crossing = person.waypoint === 2 || person.waypoint === 5;
  if (!crossing) return 1.35;
  const position = person.actor.mesh.position;
  const atCurb = person.waypoint === 2 ? position.x > 12 : position.x < -12;
  // Wait for an east-west signal with enough time to establish a crossing.
  // Once committed, clear the road even if the light changes mid-crossing.
  const phase = time % 24;
  if (atCurb && (phase < 12 || phase > 18)) {
    person.streetBehavior = 'waiting-at-crosswalk';
    person.yieldReason = 'signal';
    return 0;
  }
  person.streetBehavior = 'crossing';
  return person.hornUntil > time ? 2.9 : 2.25;
}

export function mechanicActivity(person, open, playerPosition) {
  if (open !== person.lastShutterOpen) {
    person.shutterClosing = open < (person.lastShutterOpen || 0);
    person.lastShutterOpen = open;
  }
  if (open > .02 && open < .96) return {
    destination: mechanicPost, focus: shutterHandle,
    behavior: person.shutterClosing ? 'lowering-shutter' : 'raising-shutter', gesture: 'shutter', progress: open,
  };
  if (open >= .96) {
    person.customerFocus ??= new Vector3();
    person.customerFocus.copy(playerPosition);
    person.customerFocus.y += 1.1;
    return { destination: mechanicAside, focus: person.customerFocus, behavior: 'receiving-car' };
  }
  return { destination: mechanicPost, focus: shutterHandle, behavior: 'at-workshop' };
}

const calypsoDisplays = [
  { destination: new Vector3(34,0,-20.5), focus: new Vector3(34.56,1.9,-23.5), behavior:'browsing-shop' },
  { destination: new Vector3(30,0,-20.6), focus: new Vector3(29.4,2.2,-23.5), behavior:'browsing-shop' },
];

export function shopperActivity(person, time) {
  person.displayIndex ??= 0;
  const stop = calypsoDisplays[person.displayIndex];
  const pos = person.actor.mesh.position;
  if (Math.hypot(pos.x-stop.destination.x,pos.z-stop.destination.z) < .26) {
    if (!person.browseUntil) person.browseUntil = time + 8;
    if (time >= person.browseUntil) { person.displayIndex = 1-person.displayIndex; person.browseUntil = 0; }
  }
  return calypsoDisplays[person.displayIndex];
}
