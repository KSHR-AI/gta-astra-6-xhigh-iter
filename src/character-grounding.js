// Actors use the actual walkable surface as their local animation floor.
// Walking across a curb stays grounded; a jump retains its world-space arc.
export function advanceGroundedPosition(position, previous, verticalVelocity, dt, heightAt) {
  const floor = heightAt(position.x, position.z);
  const previousFloor = heightAt(previous.x, previous.z);
  const supported = previous.y <= previousFloor + .001 && verticalVelocity <= 0;
  let velocity = supported ? 0 : verticalVelocity - 14 * Math.max(0, dt);
  position.y = supported ? floor : Math.max(floor, previous.y + velocity * Math.max(0, dt));
  if (position.y <= floor) velocity = 0;
  return { verticalVelocity: velocity, height: position.y - floor, floor };
}
