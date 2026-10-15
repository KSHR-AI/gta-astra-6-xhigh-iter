import * as THREE from 'three';

// Small, authored infrastructure clusters make the street's construction readable.
// All repeated parts enter the district's existing spatial instancing batches.
export function addStreetDetails(api) {
  const { box, panel, cylinder, line, instance, materials: m, canvasTexture, colliders, panelGeometry, range } = api;
  const thinCylinder = new THREE.CylinderGeometry(1, 1, 1, 5);
  const cone = new THREE.CylinderGeometry(0.2, 1, 1, 7);
  const orange = new THREE.MeshStandardMaterial({ color: '#d97837', roughness: 0.9 });
  const solid = (x, z, w, d, h) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: h });

  // One texture atlas supplies the signs, utility labels and original posters.
  const atlas = canvasTexture(1024, 1024, (c) => {
    const label = (row, background, heading, sub, color = '#f0eedc') => {
      const y = row * 128;
      c.fillStyle = background; c.fillRect(0, y, 1024, 128);
      c.strokeStyle = color; c.lineWidth = 3; c.strokeRect(11, y + 11, 1002, 106);
      c.fillStyle = color; c.textAlign = 'center'; c.font = 'bold 48px Arial';
      c.fillText(heading, 512, y + 62);
      c.font = '20px Arial'; c.fillText(sub, 512, y + 97);
    };
    label(0, '#31564f', '← OCEANFRONT', 'PUBLIC BEACH  •  2 BLOCKS');
    label(1, '#31564f', 'PALM AVENUE →', 'PACIFIC DISTRICT');
    label(2, '#e3dfc9', '2 HOUR PARKING', '8 AM – 6 PM   /   EXCEPT SUNDAY', '#385c4d');
    label(3, '#caa858', 'CAUTION  /  ELECTRICAL', 'PACIFIC POWER & LIGHT   •   SERVICE 014', '#343b37');
    label(4, '#e5d7b4', 'THE AFTERHOURS', 'LIVE AT THE PALM HOUSE  /  FRIDAY 9 PM', '#344d4a');
    label(5, '#984f3a', 'KEEP OUR COAST WILD', 'PACIFIC CONSERVANCY   /   VOLUNTEER SATURDAY');
    label(6, '#e5dfcb', 'WATER MAIN REPAIR', 'CITY UTILITIES   /   LOCAL ACCESS OPEN', '#374744');
    label(7, '#344b48', 'PAY HERE', 'ZONE 024   •   $2 / HOUR');
  });
  const signs = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.86 });
  const signGeometry = Array.from({ length: 8 }, (_, row) => {
    const geometry = panelGeometry.clone();
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, (7 - row + uv.getY(i)) / 8);
    return geometry;
  });
  const plaque = (row, x, y, z, w, h, rotation = 0) => {
    instance(signGeometry[row], signs, [x, y, z], [w, h, 1], [0, rotation, 0], false);
  };

  // Utility poles sit in the service alley, with a clear route on either side.
  const poles = [-75, -36, 24, 70];
  for (const z of poles) {
    cylinder(m.trunk, -57, 4.65, z, 0.17, 9.3);
    box(m.trunkLight, -57, 8.65, z, 2.65, 0.16, 0.16);
    box(m.metal, -57, 8.3, z, 0.2, 0.8, 0.27);
    for (const side of [-1, 1]) line(m.metal, [-57, 7.9, z], [-57 + side * 1.1, 8.63, z], 0.025, thinCylinder);
    for (const x of [-58.1, -57, -55.9]) {
      instance(thinCylinder, m.white, [x, 8.91, z], [0.09, 0.31, 0.09]);
      instance(thinCylinder, m.metal, [x, 9.09, z], [0.055, 0.12, 0.055]);
    }
    solid(-57, z, 0.36, 0.36, 9.3);
  }
  for (let i = 0; i < poles.length - 1; i++) {
    const start = poles[i], end = poles[i + 1];
    for (const x of [-58.1, -57, -55.9]) {
      for (let part = 0; part < 8; part++) {
        const a = part / 8, b = (part + 1) / 8;
        const sag = (t) => 9.13 - Math.sin(t * Math.PI) * (end - start) * 0.023;
        line(m.blackMetal, [x, sag(a), start + (end - start) * a], [x, sag(b), start + (end - start) * b], 0.017, thinCylinder, false);
      }
    }
  }
  // Pole-mounted transformer, brackets and a conduit terminating at its cabinet.
  cylinder(m.metal, -56.5, 6.9, -36, 0.37, 1.12);
  cylinder(m.pale, -56.5, 7.48, -36, 0.4, 0.07);
  for (const y of [6.5, 7.25]) box(m.blackMetal, -56.8, y, -36, 0.64, 0.08, 0.12);
  line(m.blackMetal, [-56.48, 7.48, -36], [-55.9, 8.91, -36], 0.024, thinCylinder, false);
  line(m.metal, [-56.8, 6.2, -36], [-56.8, 1.0, -36], 0.028, thinCylinder);
  for (const [x, z, w, h] of [[-56.7, -34.7, 0.85, 1.35], [48.8, -15.6, 1.3, 1.65]]) {
    box(m.concrete, x, 0.11, z, w + 0.24, 0.22, 0.82);
    box(m.sage, x, h / 2 + 0.22, z, w, h, 0.64);
    box(m.metal, x, h + 0.24, z, w + 0.06, 0.06, 0.7);
    box(m.dark, x + w * 0.34, 0.9, z + 0.33, 0.035, 0.18, 0.025);
    for (let n = 0; n < 5; n++) box(m.dark, x, 0.5 + n * 0.075, z + 0.324, w * 0.68, 0.018, 0.012, 0, false);
    plaque(3, x, h * 0.72 + 0.2, z + 0.328, w * 0.76, 0.19);
    solid(x, z, w + 0.12, 0.76, h + 0.3);
  }

  // Painted utility wall: a local artist's sun, pelican and rolling surf mural.
  const mural = canvasTexture(1024, 512, (c, w, h) => {
    c.fillStyle = '#c5b697'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#cc8658'; c.beginPath(); c.arc(690, 179, 124, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#75938a'; c.beginPath(); c.moveTo(0, 335);
    for (let x = 0; x <= w; x += 8) c.lineTo(x, 330 + Math.sin(x / 116) * 27);
    c.lineTo(w, h); c.lineTo(0, h); c.fill();
    c.strokeStyle = '#e1d8b9'; c.lineWidth = 10;
    for (let row = 0; row < 3; row++) {
      c.beginPath();
      for (let x = -20; x <= w + 20; x += 8) c.lineTo(x, 375 + row * 54 + Math.sin(x / 112 + row * 0.5) * 23);
      c.stroke();
    }
    c.fillStyle = '#344f4c'; c.beginPath(); c.moveTo(270, 260); c.bezierCurveTo(345, 231, 375, 219, 406, 231);
    c.bezierCurveTo(450, 154, 512, 123, 549, 147); c.bezierCurveTo(500, 167, 476, 198, 469, 223);
    c.lineTo(562, 241); c.lineTo(488, 256); c.bezierCurveTo(450, 294, 366, 307, 270, 260); c.fill();
    c.fillStyle = '#e2c38c'; c.beginPath(); c.moveTo(468, 223); c.lineTo(562, 241); c.lineTo(482, 242); c.fill();
    c.fillStyle = '#e7d9b7'; c.font = 'bold 42px Arial'; c.textAlign = 'left'; c.fillText('THIS COAST IS OUR HOME', 49, 76);
    c.font = '18px Arial'; c.fillText('PACIFIC NEIGHBORHOOD ARTS   /   EST. 1986', 49, 107);
    // Thin cracks and uneven pigment belong to the painted wall itself.
    c.globalAlpha = 0.1; c.strokeStyle = '#453f32'; c.lineWidth = 1;
    for (let y = 54; y < h; y += 67) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    for (let i = 0; i < 650; i++) { c.fillStyle = i % 2 ? '#f8e7c7' : '#514a3e'; c.fillRect(range(0, w), range(0, h), range(1, 5), range(1, 3)); }
    c.globalAlpha = 1;
  });
  const muralMaterial = new THREE.MeshStandardMaterial({ map: mural, roughness: 1 });
  box(m.concrete, -54.2, 1.44, 43.7, 0.32, 2.88, 8.4);
  box(m.trim, -54.2, 2.92, 43.7, 0.44, 0.12, 8.6);
  panel(muralMaterial, -54.035, 1.48, 43.7, 8.0, 2.56, Math.PI / 2);
  solid(-54.2, 43.7, 0.44, 8.6, 2.98);
  plaque(4, -54.025, 1.72, 39.8, 0.54, 0.44, Math.PI / 2);
  plaque(5, -54.021, 1.24, 39.76, 0.48, 0.38, Math.PI / 2);

  // Drainage belongs against the gutter and stays flush with the road surface.
  for (const [x, z] of [[-10.87, 39], [10.87, 51], [-10.87, -38], [10.87, -58], [-10.87, 111], [10.87, -163]]) {
    box(m.metal, x, 0.056, z, 0.58, 0.025, 1.08, 0, false);
    box(m.dark, x, 0.071, z, 0.48, 0.012, 0.96, 0, false);
    for (let slot = -0.4; slot <= 0.4; slot += 0.16) box(m.iron, x, 0.08, z + slot, 0.48, 0.01, 0.055, 0, false);
  }
  for (const [x, z, row, rotation] of [[-12.15, 14.8, 0, 0], [12.15, -14.8, 1, Math.PI], [12.2, 45, 2, -Math.PI / 2], [-12.2, -60, 2, Math.PI / 2]]) {
    cylinder(m.metal, x, 1.9, z, 0.035, 3.4);
    box(m.metal, x, 3.16, z, 1.6, 0.58, 0.05, rotation);
    plaque(row, x + Math.sin(rotation) * 0.03, 3.16, z + Math.cos(rotation) * 0.03, 1.54, 0.52, rotation);
    for (const y of [2.97, 3.35]) cylinder(m.dark, x, y, z, 0.055, 0.06, false);
  }
  // Parking payment terminals leave more than three metres of sidewalk clear.
  for (const [x, z] of [[12.15, 37], [-12.15, -67], [12.15, 116]]) {
    cylinder(m.metal, x, 0.92, z, 0.055, 1.4);
    box(m.dark, x, 1.62, z, 0.33, 0.58, 0.24);
    box(m.metal, x, 1.94, z, 0.37, 0.06, 0.28);
    box(m.glassDark, x, 1.7, z + 0.123, 0.24, 0.15, 0.015, 0, false);
    box(m.blackMetal, x, 1.48, z + 0.13, 0.12, 0.025, 0.025, 0, false);
    plaque(7, x, 1.84, z + 0.132, 0.28, 0.07);
  }

  // Utility work hugs the north curb, leaving both central traffic lanes open.
  box(m.patch || m.asphalt, 52, 0.045, -8.4, 11.4, 0.014, 2.4, 0, false);
  box(m.soil, 52, 0.055, -8.6, 6.8, 0.012, 0.62, 0, false);
  for (const x of [49.2, 51.1, 53]) box(m.metal, x, 0.072, -8.6, 1.6, 0.022, 0.78, 0.015, false);
  for (const [x, z] of [[45.7, -7.1], [49, -7.1], [54, -7.1], [57.6, -7.1]]) {
    box(m.dark, x, 0.1, z, 0.38, 0.08, 0.38);
    instance(cone, orange, [x, 0.42, z], [0.15, 0.57, 0.15]);
    instance(cone, m.paint, [x, 0.46, z], [0.113, 0.12, 0.113]);
  }
  for (const x of [46.1, 57.2]) {
    for (const dz of [-0.45, 0.45]) {
      line(m.pale, [x - 0.6, 0.12, -9.6 + dz], [x - 0.6, 1.05, -9.6], 0.045, thinCylinder);
      line(m.pale, [x + 0.6, 0.12, -9.6 + dz], [x + 0.6, 1.05, -9.6], 0.045, thinCylinder);
    }
    box(m.paint, x, 0.9, -9.6, 1.7, 0.34, 0.08);
    for (let offset = -0.65; offset <= 0.65; offset += 0.42) box(orange, x + offset, 0.9, -9.552, 0.19, 0.31, 0.013, 0, false);
    solid(x, -9.6, 1.7, 1.0, 1.05);
  }
  box(m.metal, 55.8, 1.13, -11.7, 1.9, 0.65, 0.07);
  for (const x of [55.1, 56.5]) cylinder(m.metal, x, 0.6, -11.7, 0.035, 1.1);
  plaque(6, 55.8, 1.13, -11.65, 1.8, 0.58);

  // A few windblown scraps collect at existing bins, not uniformly over roads.
  for (const z of [-150.9, -62.9, 25.1, 113.1]) {
    for (let scrap = 0; scrap < 4; scrap++) {
      instance(panelGeometry, scrap % 2 ? m.paint : m.pale, [-15.1 + range(-0.55, 0.5), 0.232, z + range(0.25, 0.85)], [range(0.1, 0.23), range(0.11, 0.3), 1], [-Math.PI / 2, 0, range(-Math.PI, Math.PI)], false);
    }
  }
}
