import * as THREE from 'three';

// Original painted leaflets: a cutout keeps fine silhouettes at a fraction of
// the triangle cost of modeling hundreds of individual needle-like leaves.
// The supporting surface is bent in both axes, never a camera-facing billboard.
export function createPalmAssets(canvasTexture, random) {
  const map = canvasTexture(2048, 512, (c, width, height) => {
    c.clearRect(0, 0, width, height);
    const center = height / 2;
    for (let i = 0; i < 67; i++) {
      const t = i / 67;
      const x = 75 + t * 1830;
      const reach = 220 * Math.pow(Math.sin(t * Math.PI), .56) + 12;
      for (const side of [-1, 1]) {
        const y = center + (random() - .5) * 5;
        const tipX = x + 85 + t * 65 + random() * 23;
        const tipY = y + side * reach * (.83 + random() * .17);
        const baseWidth = 12 + Math.sin(t * Math.PI) * 10;
        const green = Math.round(105 + random() * 55);
        c.fillStyle = `rgb(${Math.round(green * .72)},${green},${Math.round(green * .48)})`;
        c.beginPath(); c.moveTo(x - baseWidth / 2, y);
        c.quadraticCurveTo(x + 14, y + side * reach * .65, tipX, tipY);
        c.quadraticCurveTo(x + 65, y + side * reach * .4, x + baseWidth / 2, y);
        c.closePath(); c.fill();
        c.strokeStyle = 'rgba(182,190,115,.34)'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x + 1, y); c.quadraticCurveTo(x + 34, y + side * reach * .54, tipX, tipY); c.stroke();
        // Golden worn edges are localized to the mature outer leaflets.
        if (i % 11 === 0) {
          c.strokeStyle = 'rgba(157,137,73,.75)'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(tipX - 24, tipY - side * 16); c.lineTo(tipX, tipY); c.stroke();
        }
      }
    }
    c.strokeStyle = '#8d995b'; c.lineWidth = 9; c.lineCap = 'round';
    c.beginPath(); c.moveTo(5, center); c.quadraticCurveTo(900, center + 2, 2018, center); c.stroke();
    c.strokeStyle = '#bec38a'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(10, center - 3); c.lineTo(1990, center - 3); c.stroke();
  });
  const geometry = segments => {
    const positions = [], uvs = [], colors = [], indices = [];
    for (let row = 0; row <= segments; row++) {
      const t = row / segments;
      for (const side of [-1, 0, 1]) {
        positions.push(t * 5.4, Math.sin(t * Math.PI) * 1.4 - t * t * 2.05 - Math.abs(side) * (.17 + t * .22), side * 1.5);
        uvs.push(t, (side + 1) / 2);
        const shade = .78 + Math.sin(t * Math.PI) * .21 - Math.abs(side) * .07;
        colors.push(shade, shade, shade * .95);
      }
    }
    for (let row = 0; row < segments; row++) for (let col = 0; col < 2; col++) {
      const a = row * 3 + col, b = a + 3;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(indices); g.computeVertexNormals();
    return g;
  };
  return { map, near: geometry(12), far: geometry(7) };
}
