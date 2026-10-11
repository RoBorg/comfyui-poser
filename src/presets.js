// Built-in pose presets. Rotations are XYZ euler angles in degrees relative to the
// T-pose rest. Right-side conventions (left side is mirrored by `sym`):
//   shoulder: +z lowers the arm, +y swings it forward (from T-pose), +x swings a lowered arm back
//   elbow:    +y bends the forearm forward
//   hip:      -x lifts the thigh forward, -z spreads the leg outward
//   knee:     +x bends the shin back
//   spine/chest/neck/head: +x leans forward, +y turns to the person's left
//   fingers:  +z curls towards the palm, +y on the first bone spreads towards the thumb

import { mirrorEuler, mirrorName } from './rig.js';

// Copy right-side entries to the left, mirrored. Explicit l_ entries win.
export function sym(joints) {
  const out = {};
  for (const [name, e] of Object.entries(joints)) {
    if (name.startsWith('r_') && !(mirrorName(name) in joints)) out[mirrorName(name)] = mirrorEuler(e);
    out[name] = e;
  }
  return out;
}

function curl(finger, a, b, c, spread = 0) {
  return { [`r_${finger}1`]: [0, spread, a], [`r_${finger}2`]: [0, 0, b], [`r_${finger}3`]: [0, 0, c] };
}

const FIST_FINGERS = { ...curl('index', 85, 100, 60), ...curl('middle', 88, 100, 60), ...curl('ring', 90, 100, 60), ...curl('pinky', 92, 100, 60) };
const THUMB_ACROSS = { r_thumb1: [0, -15, 25], r_thumb2: [0, 0, 35], r_thumb3: [0, 0, 30] };

// Right-hand finger rotations; applied to either hand (mirrored for the left).
export const HAND_PRESETS = {
  Open: { ...curl('index', 0, 0, 0, 6), ...curl('middle', 0, 0, 0), ...curl('ring', 0, 0, 0, -4), ...curl('pinky', 0, 0, 0, -9), r_thumb1: [0, 0, 0], r_thumb2: [0, 0, 0], r_thumb3: [0, 0, 0] },
  Relaxed: { ...curl('index', 15, 20, 10, 3), ...curl('middle', 20, 25, 12), ...curl('ring', 25, 30, 15, -3), ...curl('pinky', 30, 30, 15, -6), r_thumb1: [0, 0, 8], r_thumb2: [0, 0, 10], r_thumb3: [0, 0, 10] },
  Fist: { ...FIST_FINGERS, ...THUMB_ACROSS },
  Point: { ...FIST_FINGERS, ...curl('index', 0, 0, 0), ...THUMB_ACROSS },
  Peace: { ...FIST_FINGERS, ...curl('index', 0, 0, 0, 10), ...curl('middle', 0, 0, 0, -8), ...THUMB_ACROSS },
  'Thumbs Up': { ...FIST_FINGERS, r_thumb1: [0, 0, -10], r_thumb2: [0, 0, 0], r_thumb3: [0, 0, 0] },
};

export function handRotations(presetName, side) {
  const preset = HAND_PRESETS[presetName];
  const out = {};
  for (const [name, e] of Object.entries(preset)) {
    out[side === 'r' ? name : mirrorName(name)] = side === 'r' ? e : mirrorEuler(e);
  }
  return out;
}

const RELAXED_HANDS = { ...handRotations('Relaxed', 'r'), ...handRotations('Relaxed', 'l') };
const OPEN_HANDS = { ...handRotations('Open', 'r'), ...handRotations('Open', 'l') };
const FIST_HANDS = { ...handRotations('Fist', 'r'), ...handRotations('Fist', 'l') };

const STAND_ARMS = { r_shoulder: [0, 0, 78], r_elbow: [0, 12, 0] };
const STAND_LEGS = { r_hip: [0, 0, -3], r_knee: [2, 0, 0], r_ankle: [-2, 0, 0] };

// Each preset: { height: pelvis height (m), joints: { bone: [x, y, z] } }
export const BODY_PRESETS = {
  'T-Pose': { height: 0.95, joints: { ...OPEN_HANDS } },
  'A-Pose': { height: 0.95, joints: { ...sym({ r_shoulder: [0, 0, 45] }), ...OPEN_HANDS } },
  Standing: { height: 0.95, joints: { ...sym({ ...STAND_ARMS, ...STAND_LEGS }), ...RELAXED_HANDS } },
  Walking: {
    height: 0.94,
    joints: {
      spine: [3, 0, 0],
      r_shoulder: [15, 0, 78], l_shoulder: [-15, 0, -78],
      r_elbow: [0, 12, 0], l_elbow: [0, -25, 0],
      r_hip: [-25, 0, -2], r_knee: [8, 0, 0], r_ankle: [-8, 0, 0],
      l_hip: [15, 0, 2], l_knee: [25, 0, 0], l_ankle: [8, 0, 0],
      ...RELAXED_HANDS,
    },
  },
  Running: {
    height: 0.92,
    joints: {
      spine: [12, 0, 0], neck: [-8, 0, 0],
      r_shoulder: [35, 0, 75], r_elbow: [0, 95, 0],
      l_shoulder: [-40, 0, -75], l_elbow: [0, -95, 0],
      r_hip: [-60, 0, 0], r_knee: [70, 0, 0], r_ankle: [-10, 0, 0],
      l_hip: [25, 0, 0], l_knee: [60, 0, 0], l_ankle: [25, 0, 0],
      ...FIST_HANDS,
    },
  },
  Sitting: {
    height: 0.52,
    joints: { ...sym({ r_shoulder: [-30, 0, 78], r_elbow: [0, 50, 0], r_hip: [-90, 0, -4], r_knee: [90, 0, 0] }), spine: [-3, 0, 0], ...RELAXED_HANDS },
  },
  Kneeling: {
    height: 0.54,
    joints: { ...sym({ ...STAND_ARMS, r_hip: [0, 0, -4], r_knee: [90, 0, 0], r_ankle: [40, 0, 0] }), ...RELAXED_HANDS },
  },
  Crouching: {
    height: 0.42,
    joints: {
      ...sym({ r_shoulder: [-50, 0, 80], r_elbow: [0, 30, 0], r_hip: [-100, 0, -15], r_knee: [125, 0, 0], r_ankle: [-25, 0, 0] }),
      spine: [30, 0, 0], chest: [10, 0, 0], neck: [-20, 0, 0], head: [-10, 0, 0],
      ...RELAXED_HANDS,
    },
  },
  Waving: {
    height: 0.95,
    joints: {
      ...sym({ ...STAND_ARMS, ...STAND_LEGS }),
      r_shoulder: [0, 0, -30], r_elbow: [0, 0, -70], head: [0, 0, -6],
      ...RELAXED_HANDS, ...handRotations('Open', 'r'),
    },
  },
  'Arms Up': {
    height: 0.95,
    joints: { ...sym({ r_shoulder: [0, 0, -60], r_elbow: [0, 0, -20], ...STAND_LEGS }), head: [-10, 0, 0], ...OPEN_HANDS },
  },
  'Hands on Hips': {
    height: 0.95,
    joints: { ...sym({ r_shoulder: [15, 0, 44], r_elbow: [-23, 0, 90], r_hip: [0, 0, -6] }), ...RELAXED_HANDS },
  },
};

export const DEFAULT_PRESET = 'Standing';
