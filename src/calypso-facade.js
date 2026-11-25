// Interwar seaside commercial block. The display-board wall stays clear and
// the southwest lantern marks the crossing from either boulevard approach.
export function addCalypsoFacade({ box, cylinder, line, materials: m }) {
  const stone=m.limestone, coping=m.trim, tile=m.teal, brass=m.yellow;
  const cx=19.35, cz=-20.95;
  // Recess the tower's glazing between full-height limestone piers. The
  // lantern overlaps the original roof, extending both visible elevations.
  box(stone,cx,15.2,cz,4.85,21.7,4.35);
  box(stone,cx,25.8,cz,4.1,3.5,3.68);
  box(stone,cx,27.96,cz,3.15,1.5,2.86);
  box(tile,cx,28.75,cz,3.28,.24,3.04);
  box(coping,cx,29.15,cz,2.4,.65,2.08);
  for(const [x,z,yaw] of [[cx,-18.57,0],[16.73,cz,-Math.PI/2]]) {
    const face=(material,u,y,depth,w,h,d)=>{
      box(material,x+Math.cos(yaw)*u+Math.sin(yaw)*depth,y,z-Math.sin(yaw)*u+Math.cos(yaw)*depth,w,h,d,yaw);
    };
    face(tile,0,14.55,0,3.83,17.4,.24);
    for(const u of [-1.84,-1.46,1.46,1.84]) face(coping,u,15.16,.15,.19,19.8,.29);
    for(let floor=0;floor<6;floor++){
      const y=6.05+floor*3.16;
      face(floor===1||floor===4?m.glassWarm:m.glass,0,y,.14,2.56,2.13,.14);
      face(m.metal,0,y,.24,.064,2.13,.06);
      face(coping,0,y-1.14,.23,2.72,.15,.31);
    }
    face(stone,0,23.8,.17,3.15,2.9,.36);
    // A stamped rising sun fans across the cap above the fluted tower.
    for(let i=0;i<9;i++){
      const a=Math.PI*i/8;
      const point=(r)=>[x+Math.cos(yaw)*Math.cos(a)*r+Math.sin(yaw)*.39,
        23.23+Math.sin(a)*r,z-Math.sin(yaw)*Math.cos(a)*r+Math.cos(yaw)*.39];
      line(brass,point(.43),point(1.16),.058,undefined,false);
    }
    face(tile,0,23.1,.41,2.55,.15,.13);
    for(const u of [-.56,0,.56]) face(tile,u,26.2,-.27,.18,2.28,.2);
  }
  // Two horizontal coping levels wrap the corner. The old brick stays
  // exposed between stories instead of disappearing behind a curtain wall.
  for(const [y,w,d] of [[22.92,.23,.4],[23.42,.41,.79],[24.02,.24,.48]]) {
    box(coping,34.15,y,-18.96,25.65,w,d);
    box(coping,17.03,y,-33.0,d,w,22.68);
  }
  // A pair of shaded oriels frames the other side of the mural. Alternate
  // drawn shades and casements between floors, all in existing batches.
  for(const x of [37.85,43.12]){
    box(stone,x,13.75,-18.85,3.82,18.5,.51);
    for(let floor=0;floor<5;floor++){
      const y=7.0+floor*3.16;
      box(m.dark,x,y,-18.53,3.15,2.58,.19);
      box((floor+(x>40?1:0))%3===0?m.glassWarm:m.glassLight,x,y,-18.39,2.88,2.29,.13);
      for(const dx of [-1.56,1.56])box(stone,x+dx,y,-18.34,.21,2.65,.59);
      box(tile,x,y+1.17,-18.28,3.27,.15,.8);
      box(coping,x,y-1.28,-18.30,3.43,.2,.83);
      box(m.metal,x,y,-18.27,.07,2.28,.06);
      if((floor+(x>40?1:0))%3===1)box(m.sage,x,y+.81,-18.26,2.85,.54,.07);
    }
    box(coping,x,23.55,-18.69,4.20,.42,1.03);
  }
  // Street-facing paired bays pick up the corner's scale across the fire
  // escape without obstructing the metal platforms or the awning below.
  for(const z of [-25.5,-30.3]){
    for(const y of [6.04,12.44,18.84]){
      box(stone,16.94,y,z,.28,2.71,3.38);
      box(m.glass,16.70,y,z,.26,2.22,2.92);
      box(m.metal,16.54,y,z,.08,2.22,.09);
      box(tile,16.52,y+1.2,z,.97,.16,3.57);
      box(coping,16.55,y-1.22,z,.84,.20,3.45);
    }
  }
  // A compact mast terminates the stepped parapet; its coved base and collar
  // stay legible when the upper stories are silhouetted against the sky.
  cylinder(coping,cx,29.73,cz,.51,.56);
  cylinder(tile,cx,30.2,cz,.29,.54);
  cylinder(brass,cx,31.35,cz,.085,2.22);
}
