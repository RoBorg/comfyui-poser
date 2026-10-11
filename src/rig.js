// Skeleton definition: bone hierarchy, rest offsets and the OpenPose keypoint mapping.
//
// World units are metres, +Y is up and a person at rest faces +Z (towards the default
// camera). The person's right side is therefore at -X. The rest pose is a T-pose with
// palms facing down. Right-side bones are defined here; left-side bones are mirrored.

import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;

// [name, parent, offset from parent, { rest: [x, y, z, order] (degrees), handle: radius }]
const CENTER_BONES = [
  ['pelvis', null, [0, 0, 0], { handle: 0.035 }],
  ['spine', 'pelvis', [0, 0.1, 0], { handle: 0.022 }],
  ['chest', 'spine', [0, 0.25, 0], { handle: 0.025 }],
  ['neck', 'chest', [0, 0.15, 0], { handle: 0.022 }],
  ['head', 'neck', [0, 0.08, 0], { handle: 0.03, handleOffset: [0, 0.13, 0.02] }],
];

const SIDE_BONES = [
  ['r_clavicle', 'chest', [-0.02, 0.13, 0], { handle: 0.018, handleOffset: [-0.08, 0, 0] }],
  ['r_shoulder', 'r_clavicle', [-0.16, 0, 0], { handle: 0.025 }],
  ['r_elbow', 'r_shoulder', [-0.28, 0, 0], { handle: 0.025 }],
  ['r_wrist', 'r_elbow', [-0.25, 0, 0], { handle: 0.022 }],
  ['r_hip', 'pelvis', [-0.1, -0.03, 0], { handle: 0.025 }],
  ['r_knee', 'r_hip', [0, -0.43, 0], { handle: 0.025 }],
  ['r_ankle', 'r_knee', [0, -0.42, 0], { handle: 0.022 }],
  ['r_toe', 'r_ankle', [0, -0.055, 0.14], { end: true }],
];

// Fingers in the right hand's rest frame: extending along -X, palm down, thumb towards +Z.
const FINGERS = {
  index: { base: [-0.095, 0, 0.028], lengths: [0.042, 0.025, 0.022] },
  middle: { base: [-0.098, 0, 0.007], lengths: [0.046, 0.028, 0.024] },
  ring: { base: [-0.092, 0, -0.013], lengths: [0.043, 0.027, 0.022] },
  pinky: { base: [-0.083, 0, -0.031], lengths: [0.033, 0.021, 0.019] },
  thumb: { base: [-0.024, -0.012, 0.022], lengths: [0.04, 0.032, 0.027], rest: [80, 40, 15, 'YXZ'] },
};
export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

for (const finger of FINGER_NAMES) {
  const { base, lengths, rest } = FINGERS[finger];
  SIDE_BONES.push([`r_${finger}1`, 'r_wrist', base, { handle: 0.008, rest }]);
  SIDE_BONES.push([`r_${finger}2`, `r_${finger}1`, [-lengths[0], 0, 0], { handle: 0.007 }]);
  SIDE_BONES.push([`r_${finger}3`, `r_${finger}2`, [-lengths[1], 0, 0], { handle: 0.007 }]);
  SIDE_BONES.push([`r_${finger}_tip`, `r_${finger}3`, [-lengths[2], 0, 0], { end: true }]);
}

export const mirrorName = (name) =>
  name.startsWith('r_') ? 'l_' + name.slice(2) : name.startsWith('l_') ? 'r_' + name.slice(2) : name;

// Mirroring across the YZ plane maps an XYZ euler (x, y, z) to (x, -y, -z).
export const mirrorEuler = (e) => [e[0], -e[1], -e[2]];

function mirrorDef([name, parent, offset, opts]) {
  return [
    mirrorName(name),
    parent && mirrorName(parent),
    [-offset[0], offset[1], offset[2]],
    {
      ...opts,
      rest: opts.rest && [opts.rest[0], -opts.rest[1], -opts.rest[2], opts.rest[3]],
      handleOffset: opts.handleOffset && [-opts.handleOffset[0], opts.handleOffset[1], opts.handleOffset[2]],
    },
  ];
}

export const BONES = [...CENTER_BONES, ...SIDE_BONES, ...SIDE_BONES.map(mirrorDef)].map(
  ([name, parent, offset, opts]) => ({ name, parent, offset, ...opts }),
);
export const BONE_MAP = Object.fromEntries(BONES.map((b) => [b.name, b]));
export const POSABLE_BONES = BONES.filter((b) => !b.end).map((b) => b.name);

export function restQuaternion(bone) {
  const q = new THREE.Quaternion();
  if (bone.rest) {
    const [x, y, z, order] = bone.rest;
    q.setFromEuler(new THREE.Euler(deg(x), deg(y), deg(z), order || 'XYZ'));
  }
  return q;
}

// Points fixed to the head bone (head-local coordinates).
export const HEAD_POINTS = {
  nose: [0, 0.065, 0.118],
  r_eye: [-0.032, 0.11, 0.083],
  l_eye: [0.032, 0.11, 0.083],
  r_ear: [-0.075, 0.095, 0.0],
  l_ear: [0.075, 0.095, 0.0],
};

// OpenPose COCO-18 order: each entry is a bone name or a head point.
export const BODY_KEYPOINTS = [
  { head: 'nose' }, { bone: 'neck' },
  { bone: 'r_shoulder' }, { bone: 'r_elbow' }, { bone: 'r_wrist' },
  { bone: 'l_shoulder' }, { bone: 'l_elbow' }, { bone: 'l_wrist' },
  { bone: 'r_hip' }, { bone: 'r_knee' }, { bone: 'r_ankle' },
  { bone: 'l_hip' }, { bone: 'l_knee' }, { bone: 'l_ankle' },
  { head: 'r_eye' }, { head: 'l_eye' }, { head: 'r_ear' }, { head: 'l_ear' },
];

export function handKeypointBones(side) {
  const names = [`${side}_wrist`];
  for (const finger of FINGER_NAMES) {
    names.push(`${side}_${finger}1`, `${side}_${finger}2`, `${side}_${finger}3`, `${side}_${finger}_tip`);
  }
  return names;
}

// Same tables as openpose_render.py, used to colour the 3D view like the output.
export const BODY_LIMBS = [
  [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10],
  [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17],
];
export const BODY_COLORS = [
  [255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0],
  [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255],
  [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255],
  [255, 0, 255], [255, 0, 85], [255, 0, 85],
];
export const HAND_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

// Extra grey segments that are not part of OpenPose but help read the pose.
export const HELPER_SEGMENTS = [
  ['pelvis', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'],
  ['chest', 'r_clavicle'], ['chest', 'l_clavicle'], ['r_clavicle', 'r_shoulder'], ['l_clavicle', 'l_shoulder'],
  ['pelvis', 'r_hip'], ['pelvis', 'l_hip'], ['r_ankle', 'r_toe'], ['l_ankle', 'l_toe'],
];

export const DEFAULT_ROOT_HEIGHT = 0.95;

export function prettyBoneName(name) {
  const side = name.startsWith('r_') ? 'Right ' : name.startsWith('l_') ? 'Left ' : '';
  const base = side ? name.slice(2) : name;
  const pretty = base.replace(/(\d)$/, ' $1').replace(/^./, (c) => c.toUpperCase());
  return side + pretty;
}
