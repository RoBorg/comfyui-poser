// 70-point OpenPose face template (68 dlib landmarks + 2 pupils) in head-local
// coordinates (see HEAD_POINTS in rig.js). Point 0 is on the person's right (-X).

const HEAD_HALF_WIDTH = 0.08;

// Push a feature onto the curved front of the head.
const onFace = (x, y, frontZ) => [x, y, frontZ * Math.sqrt(Math.max(0, 1 - (x / HEAD_HALF_WIDTH) ** 2))];

function buildFace() {
  const pts = [];

  // 0-16 jaw line, right ear -> chin -> left ear.
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI;
    const s = Math.sin(t);
    pts.push([-0.068 * Math.cos(t), 0.1 - 0.1 * s ** 1.3, 0.015 + 0.08 * s]);
  }

  // 17-21 right brow (outer -> inner), 22-26 left brow (inner -> outer).
  for (let k = 0; k < 5; k++) {
    const x = -0.056 + k * 0.0105;
    pts.push(onFace(x, 0.128 + 0.007 * Math.sin((Math.PI * (k + 0.5)) / 5), 0.1));
  }
  for (let k = 0; k < 5; k++) {
    const x = 0.014 + k * 0.0105;
    pts.push(onFace(x, 0.128 + 0.007 * Math.sin((Math.PI * (4.5 - k)) / 5), 0.1));
  }

  // 27-30 nose bridge, 31-35 nostrils.
  for (let k = 0; k < 4; k++) pts.push([0, 0.113 - k * 0.0155, 0.096 + k * 0.0075]);
  for (let k = 0; k < 5; k++) {
    const x = -0.016 + k * 0.008;
    pts.push([x, 0.058 + (k === 2 ? -0.002 : 0), 0.1 + 0.01 * (1 - Math.abs(x) / 0.016)]);
  }

  // 36-41 right eye, 42-47 left eye: corner, upper, upper, corner, lower, lower.
  for (const cx of [-0.032, 0.032]) {
    const cy = 0.11;
    for (const [dx, dy] of [[-0.013, 0], [-0.0045, 0.004], [0.0045, 0.004], [0.013, 0], [0.0045, -0.004], [-0.0045, -0.004]]) {
      pts.push(onFace(cx + dx, cy + dy, 0.092));
    }
  }

  // 48-59 outer lips, 60-67 inner lips.
  const outer = [
    [-0.025, 0.03], [-0.016, 0.037], [-0.007, 0.041], [0, 0.039], [0.007, 0.041], [0.016, 0.037],
    [0.025, 0.03], [0.016, 0.022], [0.007, 0.018], [0, 0.017], [-0.007, 0.018], [-0.016, 0.022],
  ];
  const inner = [
    [-0.02, 0.03], [-0.008, 0.033], [0, 0.033], [0.008, 0.033],
    [0.02, 0.03], [0.008, 0.027], [0, 0.027], [-0.008, 0.027],
  ];
  for (const [x, y] of outer) pts.push(onFace(x, y, 0.106));
  for (const [x, y] of inner) pts.push(onFace(x, y, 0.103));

  // 68-69 pupils.
  pts.push(onFace(-0.032, 0.11, 0.094), onFace(0.032, 0.11, 0.094));
  return pts;
}

export const FACE_POINTS = buildFace();
