import * as THREE from 'three';

export function createLampInspection(car, position) {
  const local = car.mesh.worldToLocal(position.clone());
  const side = local.x < 0 ? -1 : 1;
  const target = new THREE.Vector3(), stance = new THREE.Vector3();
  let stalled = 0;
  return {
    update(dt, actor, move, heightAt) {
      car.getRearLampWorld(side,target);
      car.mesh.worldToLocal(local.copy(actor.position));
      car.mesh.worldToLocal(stance.copy(target));
      // Approach the bumper from behind. A player beside the rear fender
      // first clears the corner at their current lateral offset.
      const goAround = local.z > -2.58 && Math.abs(local.x) > 1.35;
      stance.x = goAround ? local.x : stance.x + .16;
      stance.z -= .43;
      car.mesh.localToWorld(stance);
      const dx=stance.x-actor.position.x, dz=stance.z-actor.position.z;
      const distance=Math.hypot(dx,dz);
      const walking=distance>.035;
      const angle=walking && distance>.22 ? Math.atan2(dx,dz) : car.mesh.rotation.y;
      const turn=Math.atan2(Math.sin(angle-actor.rotation.y),Math.cos(angle-actor.rotation.y));
      actor.rotation.y+=THREE.MathUtils.clamp(turn,-7*dt,7*dt);
      let speed=0;
      if(walking){
        const step=Math.min(distance,1.95*dt),x=actor.position.x,z=actor.position.z;
        move(actor.position,dx/distance*step,dz/distance*step);
        actor.position.y=heightAt(actor.position.x,actor.position.z);
        speed=Math.hypot(actor.position.x-x,actor.position.z-z)/Math.max(dt,.001);
        stalled=speed<.03?stalled+dt:0;
      }
      return {target, speed, ready:!walking && Math.abs(turn)<.09, blocked:stalled>.4};
    }
  };
}
