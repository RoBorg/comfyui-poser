// The 3D posing viewport that lives inside the node.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { solveTwoBone } from './ik.js';
import { IK_BONES, Person } from './person.js';
import { BODY_PRESETS, DEFAULT_PRESET, HAND_PRESETS, handRotations } from './presets.js';
import { BONE_MAP, POSABLE_BONES, mirrorEuler, mirrorName, prettyBoneName } from './rig.js';
import { deleteUserPreset, loadUserPresets, onUserPresetsChanged, saveUserPreset } from './storage.js';

const IK_CHAINS = {
  r_wrist: ['r_shoulder', 'r_elbow', 'r_wrist'],
  l_wrist: ['l_shoulder', 'l_elbow', 'l_wrist'],
  r_ankle: ['r_hip', 'r_knee', 'r_ankle'],
  l_ankle: ['l_hip', 'l_knee', 'l_ankle'],
};
const ARM_BONE = /^[rl]_(clavicle|shoulder|elbow|wrist|thumb|index|middle|ring|pinky)/;
const DEFAULT_CAMERA = { position: [0, 1.0, 4.5], target: [0, 0.95, 0], fov: 40 };
const DEFAULT_EDITOR_CAMERA = { position: [1.7, 1.5, 3.0], target: [0, 0.9, 0] };
const HISTORY_LIMIT = 100;
const round = (v) => Math.round(v * 1e4) / 1e4;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.append(c);
  return node;
}

/**
 * host: {
 *   api,                                  ComfyUI api object (fetchApi/apiURL)
 *   getOutputSize(): [w, h],              current width/height widget values
 *   setOutputSize(w, h),
 *   getToggles(): { hands, face },        include_hands / include_face widget values
 *   onChange(),                           called after every committed edit
 *   prompt(title, default), confirm(msg)  async dialogs
 * }
 */
export class PoserEditor {
  constructor(host) {
    this.host = host;
    this.people = [];
    this.selectedPerson = null;
    this.selectedBone = null;
    this.view = 'editor';
    this.mode = 'rotate';
    this.reference = null;
    this.history = [];
    this.future = [];
    this.lastUserPreset = null;
    this._serialized = null;
    this._renderQueued = false;

    this._buildDom();
    this._buildScene();
    this._loadScene(null);
    this._snapshot = this._peopleSnapshot();

    loadUserPresets(host.api).then((p) => this._fillPresetSelect(p));
    this._unsubscribePresets = onUserPresetsChanged((p) => this._fillPresetSelect(p));
  }

  // ---------------------------------------------------------------- DOM

  _buildDom() {
    // After a click, hand focus to the key sink so a following Ctrl+Z stays with the poser.
    const btn = (label, title, onclick) => el('button', {
      textContent: label, title, onclick: (e) => { onclick(e); this.keySink.focus({ preventScroll: true }); },
    });
    this.ui = {};
    const ui = this.ui;

    ui.viewEditor = btn('Editor', 'Free orbit view (shows the output camera as a frustum)', () => this.setView('editor'));
    ui.viewCamera = btn('Camera', 'Look through the output camera; orbit/pan/zoom moves it', () => this.setView('camera'));
    ui.modeRotate = btn('Rotate', 'Click a joint, then drag the rings to rotate it', () => this.setMode('rotate'));
    ui.modeMove = btn('Move', 'Drag wrists/ankles with IK, or move the whole body by its pelvis', () => this.setMode('move'));
    ui.undo = btn('↶ Undo', 'Undo (Ctrl+Z)', () => this.undo());
    ui.redo = btn('Redo ↷', 'Redo (Ctrl+Shift+Z / Ctrl+Y)', () => this.redo());
    ui.mirror = btn('Mirror', 'Mirror the selected person left ↔ right', () => this.mirrorPerson());
    ui.reset = btn('Reset', 'Reset the selected joint (or the whole pose if nothing / the pelvis is selected)', () => this.resetSelection());

    ui.personSelect = el('select', { title: 'Selected person', onchange: (e) => this.select(this.people[+e.target.value] || null, 'pelvis') });
    ui.addPerson = btn('+', 'Add a person', () => this.addPerson());
    ui.removePerson = btn('−', 'Remove the selected person', () => this.removePerson());
    ui.presetSelect = el('select', { title: 'Apply a body pose to the selected person', onchange: (e) => this._onPresetChosen(e.target) });
    ui.handSelect = el('select', { title: 'Apply a hand shape (to the selected hand, or both)', onchange: (e) => this._onHandChosen(e.target) });
    ui.savePreset = btn('Save', 'Save the selected person\'s pose as a preset', () => this.saveCurrentAsPreset());
    ui.deletePreset = btn('🗑', 'Delete the last applied user preset', () => this.deleteLastUserPreset());

    ui.refUpload = btn('Ref image…', 'Show an image behind the skeleton in Camera view', () => ui.fileInput.click());
    ui.refClear = btn('✕', 'Remove the reference image', () => this.setReference(null));
    ui.refOpacity = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: 0.5, title: 'Reference opacity', oninput: (e) => this._setRefOpacity(+e.target.value) });
    ui.refFit = btn('Fit size', 'Set width/height to the reference image\'s aspect ratio', () => this.fitOutputToReference());
    ui.fov = el('input', { type: 'range', min: 10, max: 100, step: 1, value: DEFAULT_CAMERA.fov, title: 'Camera field of view', oninput: (e) => this._setFov(+e.target.value) });
    ui.fovLabel = el('span', { textContent: `${DEFAULT_CAMERA.fov}°` });
    ui.frame = btn('Frame', 'Point the active camera at the people', () => this.frameAll());
    ui.fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: (e) => this._uploadReference(e.target) });

    const sep = () => el('span', { class: 'poser-sep' });
    const toolbar = el('div', { class: 'poser-toolbar' }, [
      el('div', { class: 'poser-row' }, [
        el('span', { class: 'poser-seg' }, [ui.viewEditor, ui.viewCamera]), sep(),
        el('span', { class: 'poser-seg' }, [ui.modeRotate, ui.modeMove]), sep(),
        ui.undo, ui.redo, ui.mirror, ui.reset,
      ]),
      el('div', { class: 'poser-row' }, [
        ui.personSelect, ui.addPerson, ui.removePerson, sep(),
        ui.presetSelect, ui.handSelect, ui.savePreset, ui.deletePreset,
      ]),
      el('div', { class: 'poser-row' }, [
        ui.refUpload, ui.refClear, el('label', {}, ['opacity', ui.refOpacity]), ui.refFit, sep(),
        el('label', {}, ['fov', ui.fov, ui.fovLabel]), ui.frame, ui.fileInput,
      ]),
    ]);

    this.canvas = el('canvas');
    // Keyboard focus target while the viewport is hovered/clicked. ComfyUI's change tracker
    // handles Ctrl+Z on window (capture phase) unless a text field has focus, so a hidden
    // read-only textarea keeps Ctrl+Z for the poser instead of also undoing the graph.
    this.keySink = el('textarea', { class: 'poser-keys', readOnly: true, tabIndex: -1, 'aria-hidden': 'true' });
    this.frameEl = el('div', { class: 'poser-frame' }, [(this.frameImg = el('div', { class: 'poser-frame-img' }))]);
    this.statusEl = el('div', { class: 'poser-status' });
    this.badgeEl = el('div', { class: 'poser-badge' });
    this.stage = el('div', { class: 'poser-stage' }, [this.frameEl, this.canvas, this.statusEl, this.badgeEl, this.keySink]);
    // Nodes 2.0 (Vue) forwards wheel events to the graph unless the target is inside a
    // focused [data-capture-wheel] element.
    this.element = el('div', { class: 'poser-root', 'data-capture-wheel': 'true' }, [toolbar, this.stage]);

    // Keep wheel/keys/context menu inside the viewport instead of the ComfyUI canvas.
    this.stage.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    // Right-drag pans; don't let the release open the browser's or the node's context menu.
    this.element.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    this.element.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const key = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || (e.target !== this.keySink && /^(INPUT|TEXTAREA)$/.test(e.target.tagName))) return;
      if (key === 'z' || key === 'y') {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) this.redo();
        else this.undo();
      }
    });
    // Nodes 2.0 starts a node drag (and takes pointer capture) on pointerdown inside the node.
    this.element.addEventListener('pointerdown', (e) => e.stopPropagation());
    // OrbitControls tracks drags with pointermove/pointerup listeners on document, but
    // Nodes 2.0 stops those events before they get there. Hand them to document ourselves
    // (exactly once, in both renderers) so window-level listeners still see them too.
    for (const type of ['pointermove', 'pointerup']) {
      this.element.addEventListener(type, (e) => {
        e.stopPropagation();
        document.dispatchEvent(new PointerEvent(type, e));
      });
    }

    // Take focus while hovered so wheel zoom works, but never steal it from a text field.
    this.canvas.addEventListener('pointermove', () => {
      const active = document.activeElement;
      if (active === this.keySink) return;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
      this.keySink.focus({ preventScroll: true });
    });
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));

    this._fillHandSelect();
    this._fillPresetSelect({});
  }

  _fillPresetSelect(userPresets) {
    this.userPresets = userPresets || {};
    const sel = this.ui.presetSelect;
    sel.replaceChildren(el('option', { value: '', textContent: 'Pose…' }));
    const builtIn = el('optgroup', { label: 'Built-in' });
    for (const name of Object.keys(BODY_PRESETS)) builtIn.append(el('option', { value: `b:${name}`, textContent: name }));
    sel.append(builtIn);
    const names = Object.keys(this.userPresets).sort();
    if (names.length) {
      const mine = el('optgroup', { label: 'My presets' });
      for (const name of names) mine.append(el('option', { value: `u:${name}`, textContent: name }));
      sel.append(mine);
    }
    this._updateUi();
  }

  _fillHandSelect() {
    const sel = this.ui.handSelect;
    sel.replaceChildren(el('option', { value: '', textContent: 'Hands…' }));
    for (const name of Object.keys(HAND_PRESETS)) sel.append(el('option', { value: name, textContent: name }));
  }

  _updateUi() {
    const { ui } = this;
    if (!ui) return;
    ui.viewEditor.classList.toggle('on', this.view === 'editor');
    ui.viewCamera.classList.toggle('on', this.view === 'camera');
    ui.modeRotate.classList.toggle('on', this.mode === 'rotate');
    ui.modeMove.classList.toggle('on', this.mode === 'move');
    ui.undo.disabled = !this.history.length;
    ui.redo.disabled = !this.future.length;
    const hasPerson = !!this.selectedPerson;
    ui.mirror.disabled = ui.reset.disabled = ui.removePerson.disabled = !hasPerson;
    ui.presetSelect.disabled = ui.handSelect.disabled = ui.savePreset.disabled = !hasPerson;
    ui.deletePreset.disabled = !(this.lastUserPreset && this.lastUserPreset in (this.userPresets || {}));
    ui.deletePreset.title = ui.deletePreset.disabled ? 'Delete a user preset (apply it first)' : `Delete preset "${this.lastUserPreset}"`;
    ui.reset.textContent = this.selectedBone && this.selectedBone !== 'pelvis' ? 'Reset joint' : 'Reset pose';
    ui.refClear.disabled = ui.refFit.disabled = ui.refOpacity.disabled = !this.reference;

    const peopleKey = this.people.map((p) => p.name).join('\n');
    if (peopleKey !== this._peopleKey) {
      this._peopleKey = peopleKey;
      ui.personSelect.replaceChildren(...this.people.map((p, i) => el('option', { value: i, textContent: p.name })));
      if (!this.people.length) ui.personSelect.append(el('option', { value: '', textContent: 'No people' }));
    }
    ui.personSelect.value = String(Math.max(0, this.people.indexOf(this.selectedPerson)));

    const cam = this.outputCamera;
    if (cam) {
      ui.fov.value = cam.fov;
      ui.fovLabel.textContent = `${Math.round(cam.fov)}°`;
    }

    let status;
    if (this.mode === 'move' && (!this.selectedBone || !IK_BONES.includes(this.selectedBone))) {
      status = 'Move: drag an orange handle — wrists/ankles pose the limb (IK), the pelvis ring moves the body';
    } else if (!this.selectedPerson) status = 'Click a joint to select it · drag to orbit · right-drag to pan · wheel to zoom';
    else if (!this.selectedBone) status = `${this.selectedPerson.name}`;
    else {
      const bone = this.selectedBone;
      const what = prettyBoneName(bone);
      let hint;
      if (this.mode === 'move' && bone === 'pelvis') hint = 'drag arrows to move the body';
      else if (this.mode === 'move' && IK_CHAINS[bone]) hint = 'drag arrows to move the limb (IK)';
      else if (this.mode === 'move') hint = 'Move works on pelvis, wrists and ankles; rotating instead';
      else hint = 'drag rings to rotate';
      status = `${this.selectedPerson.name} · ${what} — ${hint}`;
    }
    this.statusEl.textContent = status;
    const [w, h] = this.host.getOutputSize();
    this.badgeEl.textContent = this.view === 'camera' ? `${w}×${h}` : 'editor view';
  }

  // ---------------------------------------------------------------- scene

  _buildScene() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    // Semi-transparent ground drawn after the skeleton (renderOrder) without writing depth, so
    // anything below ground shows through it dimmed instead of vanishing.
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ color: 0x6f7c94, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.renderOrder = 1;
    this.grid = new THREE.GridHelper(10, 20, 0x5a6170, 0x3a404b);
    this.grid.renderOrder = 2;
    this.scene.add(this.ground, this.grid);
    this.peopleGroup = new THREE.Group();
    this.scene.add(this.peopleGroup);

    this.editorCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
    this.outputCamera = new THREE.PerspectiveCamera(DEFAULT_CAMERA.fov, 1, 0.01, 200);
    // Short-range copy of the output camera, used only to draw its frustum in the editor view.
    this.frustumCamera = new THREE.PerspectiveCamera(DEFAULT_CAMERA.fov, 1, 0.05, 0.8);
    this.frustumHelper = new THREE.CameraHelper(this.frustumCamera);
    this.frustumHelper.setColors(
      new THREE.Color(0xffc040), new THREE.Color(0xffc040), new THREE.Color(0x40c0ff),
      new THREE.Color(0xff6060), new THREE.Color(0x808080),
    );
    this.scene.add(this.frustumCamera, this.frustumHelper);

    this.editorControls = new OrbitControls(this.editorCamera, this.canvas);
    this.cameraControls = new OrbitControls(this.outputCamera, this.canvas);
    for (const c of [this.editorControls, this.cameraControls]) {
      c.zoomSpeed = 1.2;
      c.screenSpacePanning = true;
      c.addEventListener('change', () => this.requestRender());
      c.addEventListener('end', () => this._cameraChanged());
    }
    this._applyCamera(this.editorCamera, this.editorControls, DEFAULT_EDITOR_CAMERA);
    this._applyCamera(this.outputCamera, this.cameraControls, DEFAULT_CAMERA);

    this.ikTarget = new THREE.Object3D();
    this.scene.add(this.ikTarget);
    this.transform = new TransformControls(this.editorCamera, this.canvas);
    this.transform.size = 0.8;
    this.transform.addEventListener('dragging-changed', (e) => {
      this.activeControls.enabled = !e.value;
    });
    this.transform.addEventListener('objectChange', () => this._onTransformChange());
    this.transform.addEventListener('mouseUp', () => this._commit());
    this.transform.addEventListener('change', () => this.requestRender());
    this.scene.add(this.transform.getHelper());

    this.raycaster = new THREE.Raycaster();
    this.resizeObserver = new ResizeObserver(() => this._layout());
    this.resizeObserver.observe(this.stage);
    this.setView('editor');
  }

  get activeCamera() { return this.view === 'camera' ? this.outputCamera : this.editorCamera; }
  get activeControls() { return this.view === 'camera' ? this.cameraControls : this.editorControls; }

  _applyCamera(camera, controls, state) {
    camera.position.fromArray(state.position);
    controls.target.fromArray(state.target);
    if (state.fov) camera.fov = state.fov;
    camera.updateProjectionMatrix();
    controls.update();
  }

  _layout() {
    const sw = this.stage.clientWidth;
    const sh = this.stage.clientHeight;
    if (!sw || !sh) return;
    let x = 0, y = 0, w = sw, h = sh;
    if (this.view === 'camera') {
      const [ow, oh] = this.host.getOutputSize();
      const aspect = ow / oh;
      if (sw / sh > aspect) { w = Math.round(sh * aspect); x = Math.round((sw - w) / 2); }
      else { h = Math.round(sw / aspect); y = Math.round((sh - h) / 2); }
    }
    Object.assign(this.canvas.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    Object.assign(this.frameEl.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    this.renderer.setSize(w, h, false);
    this.editorCamera.aspect = w / h;
    this.editorCamera.updateProjectionMatrix();
    this._layoutKey = `${sw}x${sh}:${this.view}:${this.host.getOutputSize().join('x')}`;
    this.requestRender();
  }

  requestRender() {
    if (this._renderQueued || this._disposed) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this._render();
    });
  }

  _render() {
    if (this._disposed) return;
    const [ow, oh] = this.host.getOutputSize();
    const key = `${this.stage.clientWidth}x${this.stage.clientHeight}:${this.view}:${ow}x${oh}`;
    if (key !== this._layoutKey) this._layout();

    this.outputCamera.aspect = ow / oh;
    this.outputCamera.updateProjectionMatrix();
    this.frustumCamera.position.copy(this.outputCamera.position);
    this.frustumCamera.quaternion.copy(this.outputCamera.quaternion);
    this.frustumCamera.fov = this.outputCamera.fov;
    this.frustumCamera.aspect = this.outputCamera.aspect;
    this.frustumCamera.updateProjectionMatrix();
    this.frustumCamera.updateMatrixWorld();
    this.frustumHelper.update();
    this.frustumHelper.visible = this.view === 'editor';

    const { hands, face } = this.host.getToggles();
    const ik = this.mode === 'move';
    for (const p of this.people) p.setDisplay({ hands, face, ik, selected: !this.selectedPerson || p === this.selectedPerson });
    // Lighter ground through the output camera so a reference image stays readable.
    this.ground.material.opacity = this.view === 'camera' ? 0.15 : 0.55;
    if (this._lastToggles !== `${hands}${face}`) {
      // Selected finger may have been hidden.
      this._lastToggles = `${hands}${face}`;
      if (!hands && this.selectedBone && BONE_MAP[this.selectedBone].handle < 0.01) this.select(this.selectedPerson, null);
    }
    this.renderer.render(this.scene, this.activeCamera);
    this._updateUi();
  }

  // ---------------------------------------------------------------- interaction

  _ray(e) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.activeCamera);
    return this.raycaster;
  }

  _pickIkHandle(e) {
    if (this.mode !== 'move') return null;
    const targets = this.people.flatMap((p) => p.ikPickTargets.filter((t) => t.visible));
    return this._ray(e).intersectObjects(targets, false)[0]?.object.userData || null;
  }

  _onPointerDown(e) {
    this._down = { x: e.clientX, y: e.clientY };
    this.keySink.focus({ preventScroll: true });
    if (e.button !== 0 || this.transform.axis !== null) return;

    // Move mode: grab an IK handle and drag it in the screen plane, no prior click needed.
    const hit = this._pickIkHandle(e);
    if (!hit) return;
    e.stopImmediatePropagation(); // keep OrbitControls / TransformControls out of it
    this.select(hit.person, hit.bone);
    const start = hit.person.bones[hit.bone].getWorldPosition(new THREE.Vector3());
    const normal = this.activeCamera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start);
    const grab = this._ray(e).ray.intersectPlane(plane, new THREE.Vector3()) || start.clone();
    this._ikDrag = { person: hit.person, bone: hit.bone, plane, offset: start.clone().sub(grab), pointerId: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
  }

  _onPointerMove(e) {
    const drag = this._ikDrag;
    if (!drag) {
      if (this.mode === 'move' && !e.buttons) this.canvas.style.cursor = this._pickIkHandle(e) ? 'grab' : '';
      return;
    }
    const point = this._ray(e).ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!point) return;
    point.add(drag.offset);
    if (drag.bone === 'pelvis') drag.person.root.position.copy(point);
    else this._solveIk(drag.person, drag.bone, point);
    drag.person.update();
    this._invalidate();
  }

  _endIkDrag() {
    if (!this._ikDrag) return false;
    if (this.canvas.hasPointerCapture(this._ikDrag.pointerId)) this.canvas.releasePointerCapture(this._ikDrag.pointerId);
    this._ikDrag = null;
    this.canvas.style.cursor = 'grab';
    this._attachGizmo();
    this._commit();
    return true;
  }

  _onPointerUp(e) {
    if (this._endIkDrag()) {
      this._down = null;
      return;
    }
    if (!this._down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
    this._down = null;
    // A click that didn't move selects the joint under the cursor even if it landed on the
    // gizmo, so joints hidden behind the rotation rings stay selectable.
    if (moved > 4) return;

    const ikHit = this._pickIkHandle(e);
    const targets = this.people.flatMap((p) => p.pickTargets.filter((t) => t.visible));
    const hit = ikHit ? { object: { userData: ikHit } } : this._ray(e).intersectObjects(targets, false)[0];
    if (hit) this.select(hit.object.userData.person, hit.object.userData.bone);
    else if (this.transform.axis === null) this.select(this.selectedPerson, null);
  }

  select(person, bone) {
    this.selectedPerson = person;
    this.selectedBone = person ? bone : null;
    for (const p of this.people) p.setHighlight(p === person ? bone : null);
    this._attachGizmo();
    this.requestRender();
  }

  setMode(mode) {
    this.mode = mode;
    this.canvas.style.cursor = '';
    this._attachGizmo();
    this.requestRender();
  }

  setView(view) {
    this.view = view;
    this.editorControls.enabled = view === 'editor';
    this.cameraControls.enabled = view === 'camera';
    this.transform.camera = this.activeCamera;
    this.stage.classList.toggle('camera', view === 'camera');
    this._layout();
    this._invalidate();
  }

  _attachGizmo() {
    const t = this.transform;
    t.detach();
    const person = this.selectedPerson;
    const bone = this.selectedBone;
    if (!person || !bone) return;
    const isFinger = BONE_MAP[bone].handle < 0.01;
    t.size = isFinger ? 0.45 : 0.8;
    if (this.mode === 'move' && bone === 'pelvis') {
      t.setMode('translate');
      t.setSpace('world');
      t.attach(person.root);
    } else if (this.mode === 'move' && IK_CHAINS[bone]) {
      person.bones[bone].getWorldPosition(this.ikTarget.position);
      t.setMode('translate');
      t.setSpace('world');
      t.attach(this.ikTarget);
    } else {
      t.setMode('rotate');
      t.setSpace('local');
      t.attach(person.bones[bone]);
    }
  }

  _onTransformChange() {
    const person = this.selectedPerson;
    if (!person) return;
    if (this.transform.object === this.ikTarget) this._solveIk(person, this.selectedBone, this.ikTarget.position);
    person.update();
    this._invalidate();
  }

  _solveIk(person, bone, target) {
    const [a, b, c] = IK_CHAINS[bone].map((n) => person.bones[n]);
    const isArm = bone.endsWith('wrist');
    const frame = person.bones[isArm ? 'chest' : 'pelvis'].getWorldQuaternion(new THREE.Quaternion());
    const pole = (isArm ? new THREE.Vector3(0, -0.3, -1) : new THREE.Vector3(0, 0, 1)).normalize().applyQuaternion(frame);
    solveTwoBone(a, b, c, target, pole);
  }

  _cameraChanged() {
    this._invalidate();
    this.host.onChange();
  }

  // ---------------------------------------------------------------- edits

  _invalidate() {
    this._serialized = null;
    this.requestRender();
  }

  _peopleSnapshot() {
    return JSON.stringify(this.people.map((p) => p.toJSON()));
  }

  // Record an undo step (if anything changed) and notify ComfyUI.
  _commit() {
    if (this.transform.object === this.ikTarget && this.selectedPerson) {
      this.selectedPerson.bones[this.selectedBone].getWorldPosition(this.ikTarget.position);
    }
    const snap = this._peopleSnapshot();
    if (snap !== this._snapshot) {
      this.history.push(this._snapshot);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.future = [];
      this._snapshot = snap;
    }
    this._invalidate();
    this.host.onChange();
  }

  _restorePeople(snapshot) {
    const selIndex = this.people.indexOf(this.selectedPerson);
    const bone = this.selectedBone;
    this._setPeople(JSON.parse(snapshot));
    const person = this.people[selIndex] || this.people[0] || null;
    this.select(person, person ? bone : null);
    this._snapshot = snapshot;
    this._invalidate();
    this.host.onChange();
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(this._peopleSnapshot());
    this._restorePeople(this.history.pop());
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(this._peopleSnapshot());
    this._restorePeople(this.future.pop());
  }

  _setPeople(list) {
    for (const p of this.people) p.dispose();
    this.people = [];
    for (const data of list) {
      const person = new Person(data.name || `Person ${this.people.length + 1}`);
      person.fromJSON(data);
      this.peopleGroup.add(person.group);
      this.people.push(person);
    }
  }

  _nextPersonName() {
    const used = new Set(this.people.map((p) => p.name));
    let i = 1;
    while (used.has(`Person ${i}`)) i++;
    return `Person ${i}`;
  }

  addPerson() {
    const person = new Person(this._nextPersonName());
    person.applyPose(BODY_PRESETS[DEFAULT_PRESET]);
    if (this.people.length) {
      const maxX = Math.max(...this.people.map((p) => p.root.position.x));
      person.root.position.x = maxX + 0.8;
      person.update();
    }
    this.peopleGroup.add(person.group);
    this.people.push(person);
    this.select(person, 'pelvis');
    this._commit();
  }

  removePerson() {
    const person = this.selectedPerson;
    if (!person) return;
    this.transform.detach();
    this.people.splice(this.people.indexOf(person), 1);
    person.dispose();
    this.select(this.people[0] || null, this.people[0] ? 'pelvis' : null);
    this._commit();
  }

  _applyBodyPose(pose) {
    const person = this.selectedPerson;
    if (!person) return;
    person.applyPose(pose);
    this._attachGizmo();
    this._commit();
  }

  _onPresetChosen(select) {
    const value = select.value;
    select.value = '';
    if (!value) return;
    const name = value.slice(2);
    if (value.startsWith('u:')) {
      this.lastUserPreset = name;
      this._applyBodyPose(this.userPresets[name]);
    } else {
      this._applyBodyPose(BODY_PRESETS[name]);
    }
  }

  _onHandChosen(select) {
    const name = select.value;
    select.value = '';
    const person = this.selectedPerson;
    if (!name || !person) return;
    const bone = this.selectedBone || '';
    const sides = ARM_BONE.test(bone) ? [bone[0]] : ['r', 'l'];
    const joints = Object.assign({}, ...sides.map((s) => handRotations(name, s)));
    person.applyPose({ joints }, { partial: true });
    this._commit();
  }

  async saveCurrentAsPreset() {
    const person = this.selectedPerson;
    if (!person) return;
    const name = (await this.host.prompt('Preset name', this.lastUserPreset || ''))?.trim();
    if (!name) return;
    try {
      await saveUserPreset(this.host.api, name, person.getPose());
      this.lastUserPreset = name;
      this._updateUi();
    } catch (err) {
      console.error('[poser]', err);
      window.alert?.(String(err));
    }
  }

  async deleteLastUserPreset() {
    const name = this.lastUserPreset;
    if (!name || !(await this.host.confirm(`Delete pose preset "${name}"?`))) return;
    try {
      await deleteUserPreset(this.host.api, name);
      this.lastUserPreset = null;
      this._updateUi();
    } catch (err) {
      console.error('[poser]', err);
    }
  }

  mirrorPerson() {
    const person = this.selectedPerson;
    if (!person) return;
    const rotations = Object.fromEntries(POSABLE_BONES.map((n) => [n, person.getRotation(n)]));
    for (const name of POSABLE_BONES) person.setRotation(name, mirrorEuler(rotations[mirrorName(name)]));
    person.update();
    if (this.selectedBone) this.select(person, mirrorName(this.selectedBone));
    this._commit();
  }

  resetSelection() {
    const person = this.selectedPerson;
    if (!person) return;
    if (this.selectedBone && this.selectedBone !== 'pelvis') {
      person.setRotation(this.selectedBone, [0, 0, 0]);
      person.update();
    } else {
      person.setRotation('pelvis', [0, 0, 0]);
      person.applyPose(BODY_PRESETS[DEFAULT_PRESET]);
    }
    this._attachGizmo();
    this._commit();
  }

  // ---------------------------------------------------------------- camera & reference

  _setFov(fov) {
    this.outputCamera.fov = fov;
    this.outputCamera.updateProjectionMatrix();
    this._invalidate();
    clearTimeout(this._fovTimer);
    this._fovTimer = setTimeout(() => this.host.onChange(), 300);
  }

  frameAll() {
    const people = this.selectedPerson && this.people.length > 1 ? [this.selectedPerson] : this.people;
    if (!people.length) return;
    const box = new THREE.Box3();
    for (const p of people) {
      const kp = p.keypoints();
      for (const pt of [...kp.body, ...kp.right_hand, ...kp.left_hand]) box.expandByPoint(new THREE.Vector3().fromArray(pt));
      box.expandByPoint(p.bones.head.localToWorld(new THREE.Vector3(0, 0.22, 0)));
      box.expandByPoint(p.bones.r_toe.getWorldPosition(new THREE.Vector3()));
      box.expandByPoint(p.bones.l_toe.getWorldPosition(new THREE.Vector3()));
    }
    const camera = this.activeCamera;
    const controls = this.activeControls;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = this.view === 'camera' ? this.outputCamera.aspect : this.editorCamera.aspect;
    const radius = Math.max(size.y / 2, size.x / 2 / aspect, size.z / 2 / aspect);
    const dist = (radius / Math.tan(vfov / 2)) * 1.15 + size.z / 2;
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(dir, dist);
    controls.update();
    this._cameraChanged();
  }

  async _uploadReference(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('image', file);
    body.append('subfolder', 'poser');
    body.append('type', 'input');
    try {
      const res = await this.host.api.fetchApi('/upload/image', { method: 'POST', body });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      this.setReference({ filename: data.name, subfolder: data.subfolder || '', type: data.type || 'input' });
      if (this.view !== 'camera') this.setView('camera');
    } catch (err) {
      console.error('[poser] reference upload failed', err);
      window.alert?.(`Reference upload failed: ${err}`);
    }
  }

  setReference(ref, { notify = true } = {}) {
    this.reference = ref ? { opacity: this.reference?.opacity ?? 0.5, ...ref } : null;
    if (this.reference) {
      const { filename, subfolder, type } = this.reference;
      const params = new URLSearchParams({ filename, subfolder: subfolder || '', type: type || 'input' });
      const url = this.host.api.apiURL(`/view?${params}`);
      this.frameImg.style.backgroundImage = `url("${url}")`;
      this.frameImg.style.opacity = this.reference.opacity;
      this.ui.refOpacity.value = this.reference.opacity;
      this._refSize = null;
      const img = new Image();
      img.onload = () => { this._refSize = [img.naturalWidth, img.naturalHeight]; };
      img.onerror = () => { this.frameImg.style.backgroundImage = 'none'; };
      img.src = url;
    } else {
      this.frameImg.style.backgroundImage = 'none';
    }
    this._invalidate();
    if (notify) this.host.onChange();
  }

  _setRefOpacity(opacity) {
    if (!this.reference) return;
    this.reference.opacity = opacity;
    this.frameImg.style.opacity = opacity;
    this._serialized = null;
    clearTimeout(this._opacityTimer);
    this._opacityTimer = setTimeout(() => this.host.onChange(), 300);
  }

  fitOutputToReference() {
    if (!this._refSize) return;
    const [iw, ih] = this._refSize;
    const [ow, oh] = this.host.getOutputSize();
    const longest = Math.max(ow, oh);
    const scale = longest / Math.max(iw, ih);
    const snap = (v) => Math.max(64, Math.round((v * scale) / 8) * 8);
    this.host.setOutputSize(snap(iw), snap(ih));
    this._layout();
  }

  // ---------------------------------------------------------------- (de)serialisation

  getValue() {
    if (this._serialized) return this._serialized;
    const cam = this.outputCamera;
    const data = {
      version: 1,
      camera: {
        position: cam.position.toArray().map(round),
        target: this.cameraControls.target.toArray().map(round),
        fov: round(cam.fov),
      },
      editor_camera: {
        position: this.editorCamera.position.toArray().map(round),
        target: this.editorControls.target.toArray().map(round),
      },
      view: this.view,
      reference: this.reference,
      people: this.people.map((p) => ({ ...p.toJSON(), keypoints: p.keypoints() })),
    };
    this._serialized = JSON.stringify(data);
    return this._serialized;
  }

  setValue(value) {
    if (typeof value === 'string' && value === this._serialized) return;
    let data = null;
    if (value && typeof value === 'object') data = value;
    else if (typeof value === 'string' && value.trim()) {
      try { data = JSON.parse(value); } catch (err) { console.warn('[poser] invalid pose_data, using default', err); }
    }
    this._loadScene(data);
    this.history = [];
    this.future = [];
    this._snapshot = this._peopleSnapshot();
  }

  _loadScene(data) {
    this.transform.detach();
    if (data && Array.isArray(data.people)) {
      this._setPeople(data.people);
    } else {
      this._setPeople([]);
      const person = new Person('Person 1');
      person.applyPose(BODY_PRESETS[DEFAULT_PRESET]);
      this.peopleGroup.add(person.group);
      this.people.push(person);
    }
    this._applyCamera(this.outputCamera, this.cameraControls, { ...DEFAULT_CAMERA, ...(data?.camera || {}) });
    this._applyCamera(this.editorCamera, this.editorControls, { ...DEFAULT_EDITOR_CAMERA, ...(data?.editor_camera || {}) });
    this.setReference(data?.reference || null, { notify: false });
    this.setView(data?.view === 'camera' ? 'camera' : 'editor');
    this.select(this.people[0] || null, null);
  }

  dispose() {
    this._disposed = true;
    this._unsubscribePresets?.();
    this.resizeObserver.disconnect();
    this.transform.detach();
    this.transform.dispose();
    this.editorControls.dispose();
    this.cameraControls.dispose();
    for (const p of this.people) p.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
