// End-to-end smoke test against a running ComfyUI (see docker-compose.yml, service "e2e").
//   COMFY_URL=http://comfy-latest:8188 OUT_DIR=tests/e2e/out node tests/e2e/smoke.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.COMFY_URL || 'http://localhost:8188';
const OUT = process.env.OUT_DIR || 'tests/e2e/out';
const TAG = process.env.TAG || 'run';
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const shot = (name) => page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.comfyAPI?.app?.app?.graph && window.LiteGraph, null, { timeout: 120000 });
await page.waitForTimeout(3000);
// Dismiss any first-run dialogs.
await page.keyboard.press('Escape');

const version = await page.evaluate(() => window.__COMFYUI_FRONTEND_VERSION__ || 'unknown');
console.log(`frontend ${version}`);

// VUE_NODES=1 runs the test with the "Nodes 2.0" (Vue) node renderer.
const vueNodes = process.env.VUE_NODES === '1';
await page.evaluate((on) => window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', on), vueNodes);
await page.waitForTimeout(1000);
console.log(`vue nodes: ${vueNodes}`);

// Build a graph: poser -> preview image.
await page.evaluate(() => {
  const { app } = window.comfyAPI.app;
  app.graph.clear();
  const poser = window.LiteGraph.createNode('OpenPose3DPoser');
  poser.pos = [60, 60];
  app.graph.add(poser);
  const preview = window.LiteGraph.createNode('PreviewImage');
  preview.pos = [620, 60];
  app.graph.add(preview);
  poser.connect(0, preview, 0);
  app.canvas.ds.offset = [0, 0];
  app.canvas.ds.scale = 1;
  app.canvas.setDirty(true, true);
  window.__poser = poser;
});
await page.waitForTimeout(1500);
check(await page.evaluate(() => !!window.__poser.poserEditor), 'node has a 3D editor');
check(await page.locator('.poser-root canvas').isVisible(), 'viewport canvas is visible');
await shot('01-node');

// Screen position of a bone, through the editor's active camera.
const boneScreen = (bone) => page.evaluate((bone) => {
  const ed = window.__poser.poserEditor;
  const p = ed.people[0].bones[bone].getWorldPosition(ed.ikTarget.position.clone());
  p.project(ed.activeCamera);
  const r = ed.canvas.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
}, bone);

const nodePos = await page.evaluate(() => [...window.__poser.pos]);

// Camera preview inset in Editor view: on by default, toggleable, saved, click switches view.
const pip = page.locator('.poser-pip');
check(await pip.isVisible(), 'camera preview is shown in Editor view');
const pipBox = await pip.boundingBox();
const pipPixel = await page.evaluate(({ x, y }) => {
  // The inset is drawn into the WebGL canvas: sample it via a fresh render + readPixels.
  const ed = window.__poser.poserEditor;
  ed._render();
  const gl = ed.renderer.getContext();
  const r = ed.canvas.getBoundingClientRect();
  const dpr = ed.renderer.getPixelRatio();
  const px = new Uint8Array(4);
  gl.readPixels(Math.round((x - r.left) * dpr), Math.round((r.bottom - y) * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return Array.from(px);
}, { x: pipBox.x + 4, y: pipBox.y + pipBox.height - 4 });
check(pipPixel[3] === 255, `preview inset is rendered opaque (${pipPixel})`);
await page.getByRole('button', { name: 'Preview', exact: true }).click();
check(!(await pip.isVisible()), 'Preview button hides the inset');
check(JSON.parse(await page.evaluate(() => window.__poser.poserEditor.getValue())).preview === false, 'preview setting is saved with the scene');
await page.getByRole('button', { name: 'Preview', exact: true }).click();
check(await pip.isVisible(), 'Preview button shows it again');
await shot('01b-preview');
// A double click in the viewport must not open panels or resize the node.
const uiState = () => page.evaluate(() => ({
  panels: [...document.querySelectorAll('[class*="properties"], [class*="right-side"], [data-testid*="properties"]')]
    .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 100).length,
  width: Math.round(document.querySelector('.poser-root').getBoundingClientRect().width),
}));
const beforeDbl = await uiState();
await page.locator('.poser-root canvas').dblclick({ position: { x: 20, y: 20 } });
await page.waitForTimeout(400);
const afterDbl = await uiState();
check(afterDbl.panels === beforeDbl.panels && afterDbl.width === beforeDbl.width, 'double-clicking in the viewport does not open panels');
await pip.click();
check(await page.evaluate(() => window.__poser.poserEditor.view) === 'camera', 'clicking the preview switches to Camera view');
check(!(await pip.isVisible()), 'no preview inset in Camera view');
await page.getByRole('button', { name: 'Editor', exact: true }).click();
await page.waitForTimeout(200);

// Click the right elbow.
let pt = await boneScreen('r_elbow');
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__poser.poserEditor.selectedBone) === 'r_elbow', 'clicking a joint selects it');
await shot('02-selected');

// Move mode + drag the right wrist (IK) using the gizmo's centre handle.
await page.getByRole('button', { name: 'Move', exact: true }).click();
pt = await boneScreen('r_wrist');
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__poser.poserEditor.selectedBone) === 'r_wrist', 'wrist selected in move mode');
const before = await page.evaluate(() => window.__poser.poserEditor.people[0].keypoints().body[4]);
const elbowRotBefore = await page.evaluate(() => window.__poser.poserEditor.people[0].getRotation('r_shoulder'));
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(pt.x - 4 * i, pt.y - 8 * i);
await page.mouse.up();
await page.waitForTimeout(300);
const after = await page.evaluate(() => window.__poser.poserEditor.people[0].keypoints().body[4]);
const elbowRotAfter = await page.evaluate(() => window.__poser.poserEditor.people[0].getRotation('r_shoulder'));
const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
console.log(`  wrist moved ${moved.toFixed(3)} m; shoulder ${elbowRotBefore} -> ${elbowRotAfter}`);
check(moved > 0.05, 'dragging the wrist moves it via IK');
const nodePosAfter = await page.evaluate(() => [...window.__poser.pos]);
check(nodePosAfter[0] === nodePos[0] && nodePosAfter[1] === nodePos[1], 'dragging in the viewport does not move the node');
check(await page.evaluate(() => window.__poser.poserEditor.editorControls.state) === -1, 'orbit controls are idle after the drag');
check(await page.evaluate(() => window.__poser.poserEditor.history.length) >= 1, 'edit was recorded for undo');
await shot('03-ik');

// Undo restores.
await page.getByRole('button', { name: 'Undo' }).click();
const undone = await page.evaluate(() => window.__poser.poserEditor.people[0].keypoints().body[4]);
check(Math.hypot(undone[0] - before[0], undone[1] - before[1], undone[2] - before[2]) < 1e-3, 'undo button restores the pose');

// Move mode: IK handles are shown, and an ankle can be dragged directly without selecting it first.
await page.evaluate(() => window.__poser.poserEditor.select(window.__poser.poserEditor.people[0], null));
await page.waitForTimeout(200);
check(await page.evaluate(() => window.__poser.poserEditor.people[0].ikMarkers.every((m) => m.visible)), 'IK handles visible in Move mode');
await shot('03b-ik-handles');
const anklePt = await boneScreen('l_ankle');
const ankleBefore = await page.evaluate(() => window.__poser.poserEditor.people[0].keypoints().body[13]);
await page.mouse.move(anklePt.x, anklePt.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(anklePt.x + 3 * i, anklePt.y - 6 * i);
await page.mouse.up();
await page.waitForTimeout(200);
const ankleAfter = await page.evaluate(() => window.__poser.poserEditor.people[0].keypoints().body[13]);
check(Math.hypot(...ankleAfter.map((v, i) => v - ankleBefore[i])) > 0.05, 'dragging an IK handle moves the ankle directly');
check(await page.evaluate(() => window.__poser.poserEditor.selectedBone) === 'l_ankle', 'dragged handle becomes selected');

// Ctrl+Z over the viewport undoes the poser edit.
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
const ankleUndone = await page.evaluate(() => window.__poser.poserEditor.people[0].keypoints().body[13]);
check(Math.hypot(...ankleUndone.map((v, i) => v - ankleBefore[i])) < 1e-3, 'Ctrl+Z undoes in the viewport');
await page.waitForTimeout(300);
check(await page.evaluate(() => !window.__poser.poserEditor._disposed && window.comfyAPI.app.app.graph._nodes.includes(window.__poser)),
  'Ctrl+Z in the viewport does not also undo the ComfyUI graph');
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(200);
const ankleRedone = await page.evaluate(() => window.__poser.poserEditor.people[0].keypoints().body[13]);
check(Math.hypot(...ankleRedone.map((v, i) => v - ankleAfter[i])) < 1e-3, 'Ctrl+Shift+Z redoes');
await page.keyboard.press('Control+z');

// Presets, second person, hands.
await page.locator('.poser-root select').nth(1).selectOption('b:Waving');
await page.getByRole('button', { name: '+', exact: true }).click();
await page.locator('.poser-root select').nth(1).selectOption('b:Sitting');
await page.locator('.poser-root select').nth(2).selectOption('Peace');
check(await page.evaluate(() => window.__poser.poserEditor.people.length) === 2, 'second person added');
await page.getByRole('button', { name: 'Rotate', exact: true }).click();
await page.getByRole('button', { name: 'Frame' }).click();
await page.waitForTimeout(300);
await shot('04-two-people');

// Mouse wheel zooms the viewport, not the ComfyUI canvas.
const zoomBefore = await page.evaluate(() => {
  const ed = window.__poser.poserEditor;
  return { scale: window.comfyAPI.app.app.canvas.ds.scale, dist: ed.editorCamera.position.distanceTo(ed.editorControls.target) };
});
const box = await page.locator('.poser-root canvas').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(300);
const zoomAfter = await page.evaluate(() => {
  const ed = window.__poser.poserEditor;
  return { scale: window.comfyAPI.app.app.canvas.ds.scale, dist: ed.editorCamera.position.distanceTo(ed.editorControls.target) };
});
check(zoomAfter.scale === zoomBefore.scale && zoomAfter.dist < zoomBefore.dist, 'wheel zooms the 3D view only');

// Dragging empty space orbits the editor camera.
const camBefore = await page.evaluate(() => window.__poser.poserEditor.editorCamera.position.toArray());
await page.mouse.move(box.x + 30, box.y + box.height - 40);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 30 + 12 * i, box.y + box.height - 40);
await page.mouse.up();
await page.waitForTimeout(200);
const camAfter = await page.evaluate(() => window.__poser.poserEditor.editorCamera.position.toArray());
check(Math.hypot(...camAfter.map((v, i) => v - camBefore[i])) > 0.1, 'dragging empty space orbits the camera');
check(await page.evaluate(() => window.__poser.poserEditor.editorControls.state) === -1, 'orbit controls are idle after orbiting');

// Keyboard while the viewport has focus: Delete must not remove the node, but ComfyUI
// shortcuts like Ctrl+Enter (queue prompt) must still work.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5);
check(await page.evaluate(() => document.activeElement === window.__poser.poserEditor.keySink), 'hovering the viewport gives it keyboard focus');
await page.evaluate(() => { const { app } = window.comfyAPI.app; app.canvas.selectNode(window.__poser); });
await page.keyboard.press('Delete');
await page.waitForTimeout(300);
check(await page.evaluate(() => window.comfyAPI.app.app.graph._nodes.includes(window.__poser)), 'Delete over the viewport does not delete the node');
const queuedBefore = await page.evaluate(async () => Object.keys(await (await fetch('/history?max_items=200')).json()).length);
await page.keyboard.press('Control+Enter');
let queuedAfter = queuedBefore;
for (let i = 0; i < 30 && queuedAfter === queuedBefore; i++) {
  await page.waitForTimeout(500);
  queuedAfter = await page.evaluate(async () => Object.keys(await (await fetch('/history?max_items=200')).json()).length);
}
check(queuedAfter > queuedBefore, 'Ctrl+Enter with the viewport focused queues the prompt');

// Right-drag pans the camera and must not open a ComfyUI context menu on release.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + 6 * i, box.y + box.height / 2 + 3 * i);
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(400);
const menus = await page.evaluate(() => [...document.querySelectorAll('.litecontextmenu, .p-contextmenu, [role="menu"]')]
  .filter((m) => m.offsetParent !== null && getComputedStyle(m).visibility !== 'hidden').map((m) => m.className || m.getAttribute('role')));
check(menus.length === 0, `right-drag does not open a context menu ${menus.join(', ')}`);
await page.keyboard.press('Escape');

// include_hands / include_face toggles hide those parts in the viewport.
const hidden = await page.evaluate(async () => {
  const node = window.__poser;
  const set = (name, v) => { const w = node.widgets.find((x) => x.name === name); w.value = v; w.callback?.(v); };
  set('include_hands', false); set('include_face', false);
  await new Promise((r) => setTimeout(r, 600));
  const p = node.poserEditor.people[0];
  const res = { face: p.face.visible, hands: p.handObjects.some((o) => o.visible) };
  set('include_hands', true); set('include_face', true);
  await new Promise((r) => setTimeout(r, 600));
  return res;
});
check(!hidden.face && !hidden.hands, 'hands/face toggles hide them in the viewport');

// Reference image upload.
const png = Buffer.from(await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 400;
  const g = c.getContext('2d'); g.fillStyle = '#446'; g.fillRect(0, 0, 300, 400); g.fillStyle = '#c84'; g.fillRect(100, 50, 100, 300);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}));
await page.locator('.poser-root input[type=file]').setInputFiles({ name: 'ref.png', mimeType: 'image/png', buffer: png });
await page.waitForFunction(() => window.__poser.poserEditor.reference && window.__poser.poserEditor._refSize, null, { timeout: 10000 });
check(await page.evaluate(() => window.__poser.poserEditor.view) === 'camera', 'reference upload switches to camera view');
await page.getByRole('button', { name: 'Fit size' }).click();
const size = await page.evaluate(() => ['width', 'height'].map((n) => window.__poser.widgets.find((w) => w.name === n).value));
check(size[0] === 576 && size[1] === 768, `fit size matches reference aspect (${size})`);
await page.waitForTimeout(400);
await page.locator('.poser-root').screenshot({ path: `${OUT}/${TAG}-04b-reference.png` });
await page.getByRole('button', { name: '✕' }).click();
check(await page.evaluate(() => window.__poser.poserEditor.reference) === null, 'reference can be cleared');

// Camera view.
await page.getByRole('button', { name: 'Camera', exact: true }).click();
await page.getByRole('button', { name: 'Frame' }).click();
await page.waitForTimeout(500);
await page.locator('.poser-root').screenshot({ path: `${OUT}/${TAG}-05-camera-view.png` });

// Serialised value round-trips through the workflow.
const roundTrip = await page.evaluate(() => {
  const { app } = window.comfyAPI.app;
  const wf = app.graph.serialize();
  const node = wf.nodes.find((n) => n.type === 'OpenPose3DPoser');
  const value = node.widgets_values.find((v) => typeof v === 'string' && v.startsWith('{'));
  return JSON.parse(value);
});
check(roundTrip.people.length === 2 && roundTrip.people[0].keypoints.face.length === 70, 'widget value contains both people with keypoints');

// Queue and fetch the rendered image.
const promptId = await page.evaluate(async () => {
  const { app } = window.comfyAPI.app;
  const { api } = window.comfyAPI.api;
  const p = await app.graphToPrompt();
  const res = await api.queuePrompt(0, p);
  return res.prompt_id;
});
let outputs = null;
for (let i = 0; i < 120 && !outputs; i++) {
  await page.waitForTimeout(1000);
  outputs = await page.evaluate(async (id) => {
    const r = await fetch(`/history/${id}`);
    const h = await r.json();
    const entry = h[id];
    if (!entry) return null;
    if (entry.status?.status_str === 'error') return { error: entry.status };
    return entry.outputs && Object.keys(entry.outputs).length ? entry.outputs : null;
  }, promptId);
}
check(outputs && !outputs.error, `prompt executed ${outputs?.error ? JSON.stringify(outputs.error).slice(0, 2000) : ''}`);
const img = Object.values(outputs).flatMap((o) => o.images || [])[0];
const bytes = await page.evaluate(async (img) => {
  const r = await fetch(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder)}`);
  return Array.from(new Uint8Array(await r.arrayBuffer()));
}, img);
writeFileSync(`${OUT}/${TAG}-06-output.png`, Buffer.from(bytes));
check(bytes.length > 1000, 'output image fetched');

// Toggle hands/face off and reload the workflow from JSON.
await page.evaluate(async () => {
  const { app } = window.comfyAPI.app;
  const wf = app.graph.serialize();
  app.graph.clear();
  await app.loadGraphData(wf);
});
await page.waitForTimeout(1500);
const reloaded = await page.evaluate(() => {
  const node = window.comfyAPI.app.app.graph._nodes.find((n) => n.comfyClass === 'OpenPose3DPoser');
  return node?.poserEditor ? { people: node.poserEditor.people.length, view: node.poserEditor.view } : null;
});
check(reloaded && reloaded.people === 2 && reloaded.view === 'camera', 'workflow reload restores the scene');
await shot('07-reloaded');

const relevant = errors.filter((e) => !/favicon|Failed to load resource.*(404|manager)|websocket/i.test(e));
if (relevant.length) console.log('console errors:\n  ' + relevant.join('\n  '));
check(!relevant.some((e) => /poser|three/i.test(e)), 'no poser-related console errors');
await browser.close();
console.log('ALL PASSED');
