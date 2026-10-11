// A single poseable skeleton: the bone hierarchy plus the meshes that draw it.

import * as THREE from 'three';
import { FACE_POINTS } from './face.js';
import {
  BODY_COLORS, BODY_KEYPOINTS, BODY_LIMBS, BONES, BONE_MAP, DEFAULT_ROOT_HEIGHT, HAND_EDGES,
  HEAD_POINTS, HELPER_SEGMENTS, POSABLE_BONES, handKeypointBones, restQuaternion,
} from './rig.js';

const UP = new THREE.Vector3(0, 1, 0);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
const SPHERE = new THREE.SphereGeometry(1, 12, 8);
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const GREY = 0x9aa3ad;

const rgb = ([r, g, b]) => new THREE.Color(r / 255, g / 255, b / 255);
const handEdgeColor = (i) => new THREE.Color().setHSL(i / HAND_EDGES.length, 1, 0.5);

// Bones whose joint is also an OpenPose body keypoint get that keypoint's colour.
const BONE_KEYPOINT_COLOR = {};
BODY_KEYPOINTS.forEach((kp, i) => { if (kp.bone) BONE_KEYPOINT_COLOR[kp.bone] = BODY_COLORS[i]; });

const round = (v) => Math.round(v * 1e4) / 1e4;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class Person {
  constructor(name) {
    this.name = name;
    this.group = new THREE.Group();
    this.bones = {};
    this.rest = {};
    for (const def of BONES) {
      const bone = new THREE.Object3D();
      bone.name = def.name;
      bone.position.fromArray(def.offset);
      this.rest[def.name] = restQuaternion(def);
      bone.quaternion.copy(this.rest[def.name]);
      this.bones[def.name] = bone;
      (def.parent ? this.bones[def.parent] : this.group).add(bone);
    }
    this.root = this.bones.pelvis;
    this.root.position.set(0, DEFAULT_ROOT_HEIGHT, 0);

    this.materials = [];
    this.handles = [];      // visible joint spheres
    this.pickTargets = [];  // larger invisible spheres used for clicking
    this.limbs = [];        // { mesh, from: () => Vector3, to: () => Vector3, radius }
    this.handObjects = [];
    this._buildVisuals();
    this.update();
  }

  _material(color, kind = 'mesh') {
    const opts = { color, transparent: true, opacity: 1, depthWrite: true };
    const mat = kind === 'points'
      ? new THREE.PointsMaterial({ ...opts, size: 3, sizeAttenuation: false })
      : new THREE.MeshBasicMaterial(opts);
    mat.userData.baseColor = new THREE.Color(color);
    this.materials.push(mat);
    return mat;
  }

  _addLimb(from, to, color, radius, isHand = false) {
    const mesh = new THREE.Mesh(CYLINDER, this._material(color));
    this.group.add(mesh);
    this.limbs.push({ mesh, from, to, radius });
    if (isHand) this.handObjects.push(mesh);
  }

  _buildVisuals() {
    const bonePos = (name) => () => this.bones[name].getWorldPosition(new THREE.Vector3());
    const headPos = (key) => () => this.bones.head.localToWorld(new THREE.Vector3().fromArray(HEAD_POINTS[key]));
    const kpPos = (kp) => (kp.bone ? bonePos(kp.bone) : headPos(kp.head));

    BODY_LIMBS.forEach(([a, b], i) => {
      const color = rgb(BODY_COLORS[i]).multiplyScalar(0.75);
      this._addLimb(kpPos(BODY_KEYPOINTS[a]), kpPos(BODY_KEYPOINTS[b]), color, 0.016);
    });
    for (const [a, b] of HELPER_SEGMENTS) this._addLimb(bonePos(a), bonePos(b), GREY, 0.007);
    for (const side of ['r', 'l']) {
      const names = handKeypointBones(side);
      HAND_EDGES.forEach(([a, b], i) => this._addLimb(bonePos(names[a]), bonePos(names[b]), handEdgeColor(i), 0.0035, true));
    }

    // Head points that are not bones (nose, eyes, ears).
    BODY_KEYPOINTS.forEach((kp, i) => {
      if (!kp.head) return;
      const dot = new THREE.Mesh(SPHERE, this._material(rgb(BODY_COLORS[i])));
      dot.scale.setScalar(0.012);
      dot.position.fromArray(HEAD_POINTS[kp.head]);
      this.bones.head.add(dot);
    });

    // Faint head volume so the facing direction is readable.
    const shellMat = this._material(0xffffff);
    shellMat.userData.baseOpacity = 0.08;
    shellMat.depthWrite = false;
    const shell = new THREE.Mesh(SPHERE, shellMat);
    shell.scale.set(0.085, 0.115, 0.105);
    shell.position.set(0, 0.1, 0.01);
    this.bones.head.add(shell);

    const faceGeom = new THREE.BufferGeometry();
    faceGeom.setAttribute('position', new THREE.Float32BufferAttribute(FACE_POINTS.flat(), 3));
    this.face = new THREE.Points(faceGeom, this._material(0xffffff, 'points'));
    this.bones.head.add(this.face);

    for (const name of POSABLE_BONES) {
      const def = BONE_MAP[name];
      const isFinger = def.handle < 0.01;
      const color = BONE_KEYPOINT_COLOR[name] ? rgb(BONE_KEYPOINT_COLOR[name]) : new THREE.Color(isFinger ? 0x3355ff : 0xd0d4da);
      const handle = new THREE.Mesh(SPHERE, this._material(color));
      handle.scale.setScalar(def.handle);
      if (def.handleOffset) handle.position.fromArray(def.handleOffset);
      handle.userData = { person: this, bone: name };
      this.bones[name].add(handle);
      this.handles.push(handle);

      const pick = new THREE.Mesh(SPHERE, HIDDEN);
      pick.scale.setScalar(def.handle * (isFinger ? 1.6 : 1.8));
      pick.position.copy(handle.position);
      pick.userData = { person: this, bone: name, handle };
      this.bones[name].add(pick);
      this.pickTargets.push(pick);
      if (isFinger) this.handObjects.push(handle, pick);
    }
  }

  setDisplay({ hands = true, face = true, selected = true }) {
    this.face.visible = face;
    for (const obj of this.handObjects) obj.visible = hands;
    for (const mat of this.materials) {
      const base = mat.userData.baseOpacity ?? 1;
      mat.opacity = selected ? base : base * 0.35;
    }
  }

  setHighlight(boneName) {
    for (const h of this.handles) {
      const on = h.userData.bone === boneName;
      h.material.color.copy(on ? new THREE.Color(0xffffff) : h.material.userData.baseColor);
      h.scale.setScalar(BONE_MAP[h.userData.bone].handle * (on ? 1.5 : 1));
    }
  }

  update() {
    this.group.updateMatrixWorld(true);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const limb of this.limbs) {
      a.copy(limb.from());
      b.copy(limb.to());
      const len = a.distanceTo(b);
      limb.mesh.position.addVectors(a, b).multiplyScalar(0.5);
      limb.mesh.scale.set(limb.radius, Math.max(len, 1e-5), limb.radius);
      if (len > 1e-6) limb.mesh.quaternion.setFromUnitVectors(UP, b.sub(a).divideScalar(len));
      limb.mesh.updateMatrixWorld();
    }
  }

  getRotation(name) {
    _q.copy(this.rest[name]).invert().multiply(this.bones[name].quaternion);
    _e.setFromQuaternion(_q, 'XYZ');
    return [_e.x, _e.y, _e.z].map((r) => round(THREE.MathUtils.radToDeg(r)));
  }

  setRotation(name, euler) {
    const bone = this.bones[name];
    if (!bone || !euler) return;
    const d = THREE.MathUtils.degToRad;
    _q.setFromEuler(_e.set(d(euler[0] || 0), d(euler[1] || 0), d(euler[2] || 0), 'XYZ'));
    bone.quaternion.copy(this.rest[name]).multiply(_q);
  }

  // Full pose: resets every bone not mentioned to rest. Partial: only touches listed bones.
  applyPose({ height, joints = {} }, { partial = false } = {}) {
    for (const name of POSABLE_BONES) {
      if (name === 'pelvis' && partial) continue;
      if (name in joints) this.setRotation(name, joints[name]);
      else if (!partial && name !== 'pelvis') this.bones[name].quaternion.copy(this.rest[name]);
    }
    if (height !== undefined) this.root.position.y = height;
    this.update();
  }

  getPose() {
    const joints = {};
    for (const name of POSABLE_BONES) {
      if (name === 'pelvis') continue;
      const r = this.getRotation(name);
      if (r.some((v) => Math.abs(v) > 1e-3)) joints[name] = r;
    }
    return { height: round(this.root.position.y), joints };
  }

  toJSON() {
    const rotation = this.getPose().joints;
    rotation.pelvis = this.getRotation('pelvis');
    return { name: this.name, position: this.root.position.toArray().map(round), rotation };
  }

  fromJSON(data) {
    this.name = data.name || this.name;
    if (Array.isArray(data.position)) this.root.position.fromArray(data.position);
    for (const name of POSABLE_BONES) this.bones[name].quaternion.copy(this.rest[name]);
    for (const [name, e] of Object.entries(data.rotation || {})) this.setRotation(name, e);
    this.update();
  }

  keypoints() {
    const pos = (name) => this.bones[name].getWorldPosition(_v).toArray().map(round);
    const head = this.bones.head;
    const local = (arr) => head.localToWorld(_v.fromArray(arr)).toArray().map(round);
    return {
      body: BODY_KEYPOINTS.map((kp) => (kp.bone ? pos(kp.bone) : local(HEAD_POINTS[kp.head]))),
      right_hand: handKeypointBones('r').map(pos),
      left_hand: handKeypointBones('l').map(pos),
      face: FACE_POINTS.map(local),
    };
  }

  dispose() {
    this.group.removeFromParent();
    this.face.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
