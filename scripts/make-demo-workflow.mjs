// Builds example_workflows/openpose_3d_poser_z_image_turbo.json from ComfyUI's built-in
// "Z-Image-Turbo Fun Union ControlNet" template, replacing its image + Canny preprocessing
// with the OpenPose 3D Poser node. Runs in a real browser so the frontend serialises the
// subgraph itself:
//   docker compose run --rm e2e node scripts/make-demo-workflow.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.COMFY_URL || 'http://localhost:8188';
const TEMPLATE = 'image_z_image_turbo_fun_union_controlnet';
const OUT_FILE = 'example_workflows/openpose_3d_poser_z_image_turbo.json';

// The template ships the v1 union ControlNet (trained on 512px control images only). 2.1-2602
// follows poses noticeably better (multi-resolution training); it loads with the same nodes.
const OLD_PATCH = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const OLD_PATCH_LINK = `[${OLD_PATCH}](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union/resolve/main/${OLD_PATCH}) (2.89 GB)`;
const PATCH = 'Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors';
const PATCH_LINK = `[${PATCH}](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1/resolve/main/${PATCH}) (6.25 GB)`;

const PROMPT = 'Realistic photo, full body shot of a young woman in a bright yellow raincoat and jeans waving hello, '
  + 'standing on a wet cobblestone street in an old European town, light rain, soft overcast light, '
  + 'reflections on the ground, natural colors, a little bit film grain.';

const NOTE_INTRO = `## OpenPose 3D Poser demo

Built on ComfyUI's **Z-Image-Turbo Fun Union ControlNet** template. The image + Canny
preprocessing is replaced by the **OpenPose 3D Poser** node; the union ControlNet reads the
pose map directly.

1. Pose the skeleton in the poser node. Click a joint and drag the rings (**Rotate**), or
   switch to **Move** and drag a wrist/ankle (IK) or the pelvis. Try the **Pose…** and
   **Hands…** presets, or **+** to add people.
2. Switch to **Camera** to frame the shot. What you see is what the ControlNet gets.
3. \`width\` / \`height\` on the poser set the output size.
   Pick camera angles where the pose reads in 2D; the ControlNet only sees the flat pose map
   (e.g. a kneel seen from straight ahead looks like standing).
4. Edit the prompt on the subgraph node to match your pose, then **Run**.

The pose map is shown in the preview node next to the poser.

---

`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.error('pageerror', e));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.comfyAPI?.app?.app?.graph && window.LiteGraph, null, { timeout: 120000 });
await page.waitForTimeout(2500);

const workflow = await page.evaluate(async ({ TEMPLATE, PROMPT, NOTE_INTRO, OLD_PATCH, OLD_PATCH_LINK, PATCH, PATCH_LINK }) => {
  const { app } = window.comfyAPI.app;
  const res = await fetch(`/templates/${TEMPLATE}.json`);
  if (!res.ok) throw new Error(`template fetch failed: ${res.status}`);
  const wf = await res.json();

  // Drop the input image, resize, Canny and the "image too large" note.
  const drop = new Set(['LoadImage', 'ImageScaleToMaxDimension', 'Canny']);
  const removed = new Set(wf.nodes.filter((n) => drop.has(n.type) || (n.type === 'MarkdownNote' && /too large/.test(n.widgets_values?.[0]))).map((n) => n.id));
  wf.nodes = wf.nodes.filter((n) => !removed.has(n.id));
  const deadLinks = new Set(wf.links.filter((l) => removed.has(l[1]) || removed.has(l[3])).map((l) => l[0]));
  wf.links = wf.links.filter((l) => !deadLinks.has(l[0]));
  for (const n of wf.nodes) {
    for (const i of n.inputs || []) if (deadLinks.has(i.link)) i.link = null;
    for (const o of n.outputs || []) if (o.links) o.links = o.links.filter((id) => !deadLinks.has(id));
  }

  await app.loadGraphData(wf, true, true, 'OpenPose 3D Poser demo');
  const graph = app.graph;
  const byType = (t) => graph._nodes.find((n) => n.type === t || n.comfyClass === t);
  const subgraphNode = graph._nodes.find((n) => n.isSubgraphNode?.());
  const preview = byType('PreviewImage');
  const save = byType('SaveImage');
  const note = graph._nodes.find((n) => n.type === 'MarkdownNote');

  // Layout: note | poser | preview / subgraph | save
  const poser = window.LiteGraph.createNode('OpenPose3DPoser');
  graph.add(poser);
  poser.pos = [-400, 360];
  poser.setSize([560, 980]);
  const setWidget = (node, name, value) => {
    const w = node.widgets.find((x) => x.name === name);
    w.value = value;
    w.callback?.(value);
  };
  setWidget(poser, 'width', 832);
  setWidget(poser, 'height', 1216);

  preview.pos = [200, 360];
  preview.setSize([380, 560]);
  subgraphNode.pos = [640, 360];
  save.pos = [1180, 360];
  save.setSize([560, 820]);
  note.pos = [-960, 340];

  poser.connect(0, preview, 0);
  poser.connect(0, subgraphNode, 0);

  // Scene: waving, framed through the output camera at a slight three-quarter angle.
  const ed = poser.poserEditor;
  const person = ed.people[0];
  ed.select(person, null);
  const sel = ed.ui.presetSelect;
  sel.value = 'b:Waving';
  sel.dispatchEvent(new Event('change'));
  ed.setView('camera');
  ed.outputCamera.position.set(0.9, 1.05, 2.9);
  ed.cameraControls.target.set(0, 1.0, 0);
  ed.cameraControls.update();
  ed.frameAll();
  ed.editorCamera.position.set(2.2, 1.6, 3.4);
  ed.editorControls.target.set(0, 0.95, 0);
  ed.editorControls.update();
  ed.select(null, null);
  ed._serialized = null;

  // The prompt lives on the CLIPTextEncode inside the subgraph, and the subgraph node keeps its
  // own copy for the promoted widget (that copy wins when the workflow is loaded): set both.
  const inner = subgraphNode.subgraph.nodes.find((n) => n.type === 'CLIPTextEncode');
  setWidget(inner, 'text', PROMPT);
  setWidget(subgraphNode, 'text', PROMPT);
  setWidget(subgraphNode.subgraph.nodes.find((n) => n.type === 'ModelPatchLoader'), 'name', PATCH);
  setWidget(subgraphNode, 'name', PATCH);
  const noteWidget = note.widgets[0];
  const original = String(noteWidget.value).replace(/^[\s\S]*?(## Report issue)/, '$1');
  if (!original.includes(OLD_PATCH_LINK)) throw new Error('template note changed; update the ControlNet link swap');
  noteWidget.value = NOTE_INTRO + original.replace(OLD_PATCH_LINK, PATCH_LINK).replaceAll(OLD_PATCH, PATCH);

  const group = graph._groups?.[0];
  if (group) {
    group.title = 'Pose';
    group.pos = [-420, 290];
    group.size = [1020, 1080];
  }
  app.canvas.ds.scale = 0.55;
  app.canvas.ds.offset = [1150, -120];
  app.canvas.setDirty(true, true);
  await new Promise((r) => setTimeout(r, 500));
  return app.graph.serialize();
}, { TEMPLATE, PROMPT, NOTE_INTRO, OLD_PATCH, OLD_PATCH_LINK, PATCH, PATCH_LINK });

// Sanity checks on what we are about to write.
const poserNode = workflow.nodes.find((n) => n.type === 'OpenPose3DPoser');
const scene = JSON.parse(poserNode.widgets_values.find((v) => typeof v === 'string' && v.startsWith('{')));
if (scene.people.length !== 1 || !scene.people[0].keypoints) throw new Error('poser scene missing');
const promptNode = workflow.definitions.subgraphs[0].nodes.find((n) => n.type === 'CLIPTextEncode');
if (!String(promptNode.widgets_values[0]).includes('yellow raincoat')) throw new Error('prompt not written into subgraph');
const subgraphInstance = workflow.nodes.find((n) => n.type === workflow.definitions.subgraphs[0].id);
if (!subgraphInstance.widgets_values?.some((v) => String(v).includes('yellow raincoat'))) throw new Error('prompt not written to the subgraph node');
const patchNode = workflow.definitions.subgraphs[0].nodes.find((n) => n.type === 'ModelPatchLoader');
if (patchNode.widgets_values[0] !== PATCH || !subgraphInstance.widgets_values.includes(PATCH)) throw new Error('ControlNet not switched to 2.1-2602');

mkdirSync('example_workflows', { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(workflow, null, 2) + '\n');
// Thumbnail for the Templates browser (the frontend looks for <name>.jpg).
await page.evaluate(() => {
  const { app } = window.comfyAPI.app;
  app.canvas.ds.scale = 1;
  app.canvas.ds.offset = [520, -260];
  app.canvas.setDirty(true, true);
});
await page.waitForTimeout(800);
await page.locator('.poser-stage').screenshot({ path: OUT_FILE.replace(/\.json$/, '.jpg'), type: 'jpeg', quality: 85 });
console.log(`wrote ${OUT_FILE}`);
await browser.close();
