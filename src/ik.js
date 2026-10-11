// Analytic two-bone IK (shoulder-elbow-wrist / hip-knee-ankle).

import * as THREE from 'three';

const EPS = 1e-4;
const clamp = (v) => Math.min(1, Math.max(-1, v));

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _at = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();

function rotateLocal(bone, worldAxis, angle) {
  if (Math.abs(angle) < 1e-7) return;
  bone.getWorldQuaternion(_qw).invert();
  _axis.copy(worldAxis).applyQuaternion(_qw).normalize();
  bone.quaternion.multiply(_q.setFromAxisAngle(_axis, angle));
  bone.updateMatrixWorld(true);
}

/**
 * Rotate `upper` and `lower` so that `end` reaches `target` (world space).
 * `pole` is the world direction the middle joint should bulge towards when the limb is straight.
 */
export function solveTwoBone(upper, lower, end, target, pole) {
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _t.copy(target);

  const lab = _a.distanceTo(_b);
  const lcb = _b.distanceTo(_c);
  const lat = THREE.MathUtils.clamp(_a.distanceTo(_t), Math.abs(lab - lcb) + EPS, lab + lcb - EPS);

  _ac.subVectors(_c, _a).normalize();
  _ab.subVectors(_b, _a).normalize();
  const acAb0 = Math.acos(clamp(_ac.dot(_ab)));
  const baBc0 = Math.acos(clamp(_ab.clone().negate().dot(_c.clone().sub(_b).normalize())));
  const acAb1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const baBc1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));

  // Bend plane normal; fall back to the pole when the limb is (nearly) straight.
  const bendAxis = new THREE.Vector3().crossVectors(_ac, _ab);
  if (bendAxis.lengthSq() < 1e-6) bendAxis.crossVectors(_ac, pole);
  if (bendAxis.lengthSq() < 1e-10) return;
  bendAxis.normalize();

  rotateLocal(upper, bendAxis, acAb1 - acAb0);
  rotateLocal(lower, bendAxis, baBc1 - baBc0);

  // Swing the whole chain so the end points at the target.
  end.getWorldPosition(_c);
  _ac.subVectors(_c, _a).normalize();
  _at.subVectors(_t, _a).normalize();
  const swing = Math.acos(clamp(_ac.dot(_at)));
  const swingAxis = new THREE.Vector3().crossVectors(_ac, _at);
  if (swingAxis.lengthSq() > 1e-10) rotateLocal(upper, swingAxis.normalize(), swing);
}
