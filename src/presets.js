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

// Each preset: { height: pelvis height (m), joints: { bone: [x, y, z] }, orient? }
// orient: body orientation [pitch, heading offset, roll] in degrees (applied Y, X, Z). The
// person's own heading is kept. pitch 90 = face down, -90 = face up; roll -90 = on left side.
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
    height: 0.74,
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

  // Floor poses. Lying/prone poses lie along the heading's X axis so they read side-on from
  // the default camera.
  'All Fours': {
    height: 0.52, orient: [80, 90, 0],
    joints: { ...sym({ r_shoulder: [0, 90, 10], r_wrist: [0, 0, -90], r_hip: [-80, 0, -3], r_knee: [90, 0, 0], r_ankle: [50, 0, 0] }), neck: [-35, 0, 0], head: [-15, 0, 0], ...OPEN_HANDS },
  },
  'Lying on Back': {
    height: 0.11, orient: [-90, 90, 0],
    joints: { ...sym({ r_shoulder: [0, 0, 80], r_hip: [0, 0, -2], r_ankle: [20, 0, 0] }), ...RELAXED_HANDS },
  },
  'Lying on Side': {
    height: 0.16, orient: [0, 0, -90],
    joints: {
      spine: [0, 0, 35], chest: [0, 0, 25], neck: [0, 0, -25], head: [0, 0, -10],
      l_shoulder: [90, -13, 94], l_elbow: [0, 0, 148], l_wrist: [0, 0, 20],
      r_shoulder: [43, -13, 67], r_elbow: [0, 123, 0],
      l_hip: [-15, 0, 0], l_knee: [20, 0, 0],
      r_hip: [-70, 0, 15], r_knee: [100, 0, 0],
      ...RELAXED_HANDS,
    },
  },
  'Lying on Stomach': {
    height: 0.14, orient: [90, 90, 0],
    joints: {
      ...sym({ r_shoulder: [0, 90, 35], r_elbow: [0, 0, -90], r_wrist: [0, 0, -15] }),
      spine: [-15, 0, 0], chest: [-24, 0, 0], neck: [-20, 0, 0], head: [-10, 0, 0],
      r_knee: [80, 0, 0], l_knee: [110, 0, 0], r_ankle: [-10, 0, 0], l_ankle: [-10, 0, 0],
      ...RELAXED_HANDS,
    },
  },
  'W-Sitting': {
    height: 0.12,
    joints: { ...sym({ r_hip: [-13, 41, -89], r_knee: [145, 0, 0], r_ankle: [40, 0, 0], r_shoulder: [0, 30, 70], r_elbow: [0, 40, 0] }), ...RELAXED_HANDS },
  },
  Cobra: {
    height: 0.11, orient: [90, 90, 0],
    joints: { ...sym({ r_shoulder: [-92, 77, -158], r_elbow: [-19, -17, -98], r_wrist: [0, 0, -90], r_hip: [0, 0, -3], r_ankle: [60, 0, 0] }), spine: [-40, 0, 0], chest: [-35, 0, 0], neck: [-10, 0, 0], ...OPEN_HANDS },
  },
  'Extended Puppy': {
    height: 0.52, orient: [125, 90, 0],
    joints: { ...sym({ r_shoulder: [-105, 90, 0], r_hip: [-125, 0, -3], r_knee: [90, 0, 0], r_ankle: [50, 0, 0] }), neck: [10, 0, 0], ...OPEN_HANDS },
  },
  'One Leg Pigeon': {
    // Front shin across the body; back foot raised and held by the left hand reaching back.
    height: 0.22,
    joints: {
      r_shoulder: [0, 10, 78],
      l_shoulder: [67, 11, -8], l_elbow: [24, 15, -118],
      spine: [-8, 15, 0], chest: [-8, 15, 0],
      r_hip: [-138, -64, -55], r_knee: [120, 0, 0],
      l_hip: [80, 0, 5], l_knee: [100, 0, 0], l_ankle: [30, 0, 0],
      ...OPEN_HANDS, ...handRotations('Fist', 'l'),
    },
  },
};

export const DEFAULT_PRESET = 'Standing';
