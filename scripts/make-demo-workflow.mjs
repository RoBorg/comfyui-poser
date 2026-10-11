// Builds the example workflows in example_workflows/ from ComfyUI's built-in templates, with
// the OpenPose 3D Poser node wired in as the pose source. Runs in a real browser so the
// frontend serialises the subgraphs itself:
//   docker compose run --rm e2e node scripts/make-demo-workflow.mjs [zimage] [krea2]
//
// zimage: "Z-Image-Turbo Fun Union ControlNet" template; image + Canny preprocessing replaced by
//         the poser, ControlNet upgraded to 2.1-2602.
// krea2:  "Krea-2 Int8: Image Style Reference" template, turned into pose control with
//         thedeoxen's Krea 2 OpenPose LoRA and Ostris's Krea 2 edit nodes (kv_cache on).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.COMFY_URL || 'http://localhost:8188';

const NOTE_STEPS = (target) => `1. Pose the skeleton in the poser node. Click a joint and drag the rings (**Rotate**), or
   switch to **Move** and drag an orange handle (wrists/ankles use IK, the ring moves the
   body). Try the **Pose…** and **Hands…** presets, or **+** to add people.
2. Switch to **Camera** to frame the shot. What you see is what ${target} gets.
   Pick camera angles where the pose reads in 2D; only the flat pose map is used
   (e.g. a kneel seen from straight ahead looks like standing).
3. \`width\` / \`height\` on the poser set the output size.
4. Edit the prompt on the subgraph node to match your pose, then **Run**.

The pose map is shown in the preview node next to the poser.`;

// ---------------------------------------------------------------- Z-Image

const Z_OLD_PATCH = 'Z-Image-Turbo-Fun-Controlnet-Union.safetensors';
const Z_OLD_PATCH_LINK = `[${Z_OLD_PATCH}](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union/resolve/main/${Z_OLD_PATCH}) (2.89 GB)`;
const Z_PATCH = 'Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps.safetensors';
const Z_PATCH_LINK = `[${Z_PATCH}](https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1/resolve/main/${Z_PATCH}) (6.25 GB)`;

const ZIMAGE = {
  name: 'zimage',
  template: 'image_z_image_turbo_fun_union_controlnet',
  out: 'example_workflows/openpose_3d_poser_z_image_turbo.json',
  title: 'OpenPose 3D Poser demo',
  promptMarker: 'yellow raincoat',
  prompt: 'Realistic photo, full body shot of a young woman in a bright yellow raincoat and jeans waving hello, '
    + 'standing on a wet cobblestone street in an old European town, light rain, soft overcast light, '
    + 'reflections on the ground, natural colors, a little bit film grain.',
  note: `## OpenPose 3D Poser demo

Built on ComfyUI's **Z-Image-Turbo Fun Union ControlNet** template. The image + Canny
preprocessing is replaced by the **OpenPose 3D Poser** node; the union ControlNet reads the
pose map directly. The ControlNet is upgraded from the template's v1 to **2.1-2602**, which
follows poses noticeably better.

${NOTE_STEPS('the ControlNet')}

---

`,
  poser: { width: 832, height: 1216, preset: 'Waving', size: [560, 980], camera: [[0.9, 1.05, 2.9], [0, 1.0, 0]] },

  // The template ships the v1 union ControlNet (trained on 512px control images only); 2.1-2602
  // loads with the same nodes and follows poses much better.
  prepare(wf) {
    dropTopNodes(wf, (n) => ['LoadImage', 'ImageScaleToMaxDimension', 'Canny'].includes(n.type)
      || (n.type === 'MarkdownNote' && /too large/.test(n.widgets_values?.[0])));
    const sg = wf.definitions.subgraphs[0];
    const patch = sg.nodes.find((n) => n.type === 'ModelPatchLoader');
    patch.widgets_values[0] = Z_PATCH;
    setModelUrl(patch, Z_PATCH, `https://huggingface.co/alibaba-pai/Z-Image-Turbo-Fun-Controlnet-Union-2.1/resolve/main/${Z_PATCH}`, 'model_patches');
    sg.nodes.find((n) => n.type === 'CLIPTextEncode').widgets_values[0] = this.prompt;
    const instance = wf.nodes.find((n) => n.type === sg.id);
    instance.widgets_values = instance.widgets_values.map((v) => (v === Z_OLD_PATCH ? Z_PATCH : v));
    instance.widgets_values[0] = this.prompt;
    const note = wf.nodes.find((n) => n.type === 'MarkdownNote');
    const original = String(note.widgets_values[0]).replace(/^[\s\S]*?(## Report issue)/, '$1');
    if (!original.includes(Z_OLD_PATCH_LINK)) throw new Error('template note changed; update the ControlNet link swap');
    note.widgets_values[0] = this.note + original.replace(Z_OLD_PATCH_LINK, Z_PATCH_LINK).replaceAll(Z_OLD_PATCH, Z_PATCH);
  },

  check(wf) {
    const sg = wf.definitions.subgraphs[0];
    const instance = wf.nodes.find((n) => n.type === sg.id);
    const patch = sg.nodes.find((n) => n.type === 'ModelPatchLoader');
    if (patch.widgets_values[0] !== Z_PATCH || !instance.widgets_values.includes(Z_PATCH)) throw new Error('ControlNet not switched to 2.1-2602');
    if (!String(sg.nodes.find((n) => n.type === 'CLIPTextEncode').widgets_values[0]).includes(this.promptMarker)) throw new Error('prompt missing');
  },
};

// ---------------------------------------------------------------- Krea 2

const K_LORA = 'krea2_turbo_openpose_controlnet.safetensors';
const K_LORA_URL = `https://huggingface.co/thedeoxen/Krea-2-pose-controlnet/resolve/main/${K_LORA}`;
const K_UNET = 'krea2_turbo_fp8_scaled.safetensors';
const K_UNET_URL = `https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/${K_UNET}`;
const K_OLD_UNET = 'krea2_turbo_int8_convrot.safetensors';
const K_OLD_LORA = 'krea2_style_reference.safetensors';
const OSTRIS = { cnr_id: 'comfyui-krea2-ostris-edit', ver: '1.0.1' };

const KREA2 = {
  name: 'krea2',
  template: 'image_krea2_turbo_int8_image_style_reference',
  out: 'example_workflows/openpose_3d_poser_krea2_turbo.json',
  title: 'OpenPose 3D Poser Krea 2 demo',
  promptMarker: 'king pigeon',
  prompt: 'Realistic photo of a young woman with a dark braid doing the one-legged king pigeon yoga pose on a sage green '
    + 'yoga mat, her left hand reaching back to hold her raised left foot, wearing a teal sports bra and black leggings, '
    + 'bright minimalist yoga studio with a pale wooden floor, white walls and large windows, soft morning light, '
    + 'natural colors, shallow depth of field.',
  note: `## OpenPose 3D Poser · Krea 2 demo

Built on ComfyUI's **Krea-2: Image Style Reference** template, turned into pose control:
the **OpenPose 3D Poser** image is fed in as reference image 1 for
[thedeoxen's Krea 2 OpenPose LoRA](https://huggingface.co/thedeoxen/Krea-2-pose-controlnet)
(Apache-2.0), using Ostris's Krea 2 edit nodes with **kv_cache on**, the mode that LoRA was
trained for.

**Requires the custom node pack "Krea 2 Ostris Edit"** (\`comfyui-krea2-ostris-edit\`).
Install it from the ComfyUI Manager (*Install Missing Custom Nodes*), or clone
https://github.com/ostris/ComfyUI-Krea2-Ostris-Edit into \`custom_nodes\`, then restart.
Without it (stock Krea 2 nodes, or kv_cache off) this LoRA gives blotchy images that follow
the pose poorly.

${NOTE_STEPS('the LoRA')}

The pose image is snapped to the nearest Kontext-friendly size (≈1 MP) before use, and the
output follows that size; the poser here is set to 1248×832, which is one of them.

---

`,
  poser: { width: 1248, height: 832, preset: 'One Leg Pigeon', size: [760, 860], camera: [[3.0, 0.75, 1.1], [0, 0.45, 0]] },

  prepare(wf) {
    dropTopNodes(wf, (n) => ['LoadImage', 'ResolutionSelector'].includes(n.type));
    // The template ships GetImageSize bypassed (unused); it now drives the latent size.
    wf.nodes.find((n) => n.type === 'GetImageSize').mode = 0;
    const sg = wf.definitions.subgraphs[0];
    const byType = (t) => sg.nodes.find((n) => n.type === t);

    // Text encoder -> Ostris edit encoder (same input names: clip, vae, image1-3, prompt).
    const enc = byType('TextEncodeQwenImageEditPlus');
    enc.type = 'TextEncodeKrea2OstrisEdit';
    enc.properties = { 'Node name for S&R': enc.type, ...OSTRIS };

    // UNETLoader -> Krea2OstrisEditModelPatch(kv_cache) -> LoraLoaderModelOnly.
    const unet = byType('UNETLoader');
    const lora = byType('LoraLoaderModelOnly');
    const link = sg.links.find((l) => l.origin_id === unet.id && l.target_id === lora.id);
    const id = Math.max(sg.state.lastNodeId, wf.last_node_id) + 1;
    const linkId = Math.max(sg.state.lastLinkId, wf.last_link_id) + 1;
    sg.nodes.push({
      id, type: 'Krea2OstrisEditModelPatch', pos: [unet.pos[0], unet.pos[1] + 150], size: [450, 90], flags: {}, order: unet.order, mode: 0,
      inputs: [{ localized_name: 'model', name: 'model', type: 'MODEL', link: link.id }],
      outputs: [{ localized_name: 'MODEL', name: 'MODEL', type: 'MODEL', links: [linkId] }],
      properties: { 'Node name for S&R': 'Krea2OstrisEditModelPatch', ...OSTRIS },
      widgets_values: [true],
    });
    link.target_id = id;
    link.target_slot = 0;
    sg.links.push({ id: linkId, origin_id: id, origin_slot: 0, target_id: lora.id, target_slot: 0, type: 'MODEL' });
    lora.inputs[0].link = linkId;
    lora.pos = [lora.pos[0], lora.pos[1] + 120];
    sg.state.lastNodeId = wf.last_node_id = id;
    sg.state.lastLinkId = wf.last_link_id = linkId;

    // Sampling as the LoRA was tested: 10 steps, no flux shift (bypass ModelSamplingFlux).
    byType('BasicScheduler').widgets_values[1] = 10;
    byType('ModelSamplingFlux').mode = 4;

    // Models + prompt (inner widgets and the subgraph node's promoted copies).
    unet.widgets_values[0] = K_UNET;
    setModelUrl(unet, K_UNET, K_UNET_URL, 'diffusion_models');
    lora.widgets_values = [K_LORA, 1];
    setModelUrl(lora, K_LORA, K_LORA_URL, 'loras');
    sg.nodes.find((n) => n.type === 'PrimitiveStringMultiline' && sg.links.some((l) => l.origin_id === -10 && l.target_id === n.id)).widgets_values[0] = this.prompt;
    const instance = wf.nodes.find((n) => n.type === sg.id);
    const slot = (name) => sg.inputs.filter((i) => i.type !== 'IMAGE').findIndex((i) => i.name === name);
    const values = instance.widgets_values;
    values[slot('value_2')] = this.prompt;
    values[slot('width_1')] = this.poser.width;
    values[slot('height_1')] = this.poser.height;
    values[slot('lora_name_1')] = K_LORA;
    values[slot('strength_model_1')] = 1;
    values[slot('unet_name_1')] = K_UNET;
    instance.title = 'Pose to Image (Krea-2 Turbo + OpenPose LoRA)';

    const note = wf.nodes.find((n) => n.type === 'MarkdownNote');
    let text = String(note.widgets_values[0]).replace(/^[\s\S]*?(## Model Links)/, '$1');
    for (const [from, to] of [
      [`[${K_OLD_UNET}](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/${K_OLD_UNET}) (12.57 GB)`, `[${K_UNET}](${K_UNET_URL}) (12.24 GB)`],
      [`[${K_OLD_LORA}](https://huggingface.co/Comfy-Org/Krea-2/resolve/main/loras/${K_OLD_LORA}) (435.9 MB)`, `[${K_LORA}](${K_LORA_URL}) (215 MB)`],
      ['- [ostris/krea2_turbo_style_reference](https://huggingface.co/ostris/krea2_turbo_style_reference)', '- [thedeoxen/Krea-2-pose-controlnet](https://huggingface.co/thedeoxen/Krea-2-pose-controlnet)'],
    ]) {
      if (!text.includes(from)) throw new Error(`template note changed; cannot find: ${from}`);
      text = text.replace(from, to);
    }
    note.widgets_values[0] = this.note + text.replaceAll(K_OLD_UNET, K_UNET).replaceAll(K_OLD_LORA, K_LORA);
  },

  check(wf) {
    const sg = wf.definitions.subgraphs[0];
    const has = (t) => sg.nodes.some((n) => n.type === t);
    if (!has('TextEncodeKrea2OstrisEdit') || has('TextEncodeQwenImageEditPlus')) throw new Error('encoder not swapped');
    const patch = sg.nodes.find((n) => n.type === 'Krea2OstrisEditModelPatch');
    if (!patch || patch.widgets_values[0] !== true) throw new Error('model patch missing or kv_cache off');
    const instance = wf.nodes.find((n) => n.type === sg.id);
    if (!instance.widgets_values.includes(K_LORA) || !instance.widgets_values.includes(K_UNET)) throw new Error('models not switched');
    if (!instance.widgets_values.some((v) => String(v).includes(this.promptMarker))) throw new Error('prompt missing');
    const size = wf.nodes.find((n) => n.type === 'GetImageSize');
    if (size.mode !== 0 || !size.outputs[0].links?.length) throw new Error('GetImageSize must be active and drive the latent size');
  },
};

// ---------------------------------------------------------------- helpers (Node side)

function dropTopNodes(wf, predicate) {
  const removed = new Set(wf.nodes.filter(predicate).map((n) => n.id));
  wf.nodes = wf.nodes.filter((n) => !removed.has(n.id));
  const dead = new Set(wf.links.filter((l) => removed.has(l[1]) || removed.has(l[3])).map((l) => l[0]));
  wf.links = wf.links.filter((l) => !dead.has(l[0]));
  for (const n of wf.nodes) {
    for (const i of n.inputs || []) if (dead.has(i.link)) i.link = null;
    for (const o of n.outputs || []) if (o.links) o.links = o.links.filter((id) => !dead.has(id));
  }
}

function setModelUrl(node, name, url, directory) {
  node.properties = { ...node.properties, models: [{ name, url, directory }] };
}

// ---------------------------------------------------------------- build

async function build(page, demo) {
  const res = await page.evaluate(async (t) => (await fetch(`/templates/${t}.json`)).status, demo.template);
  if (res !== 200) throw new Error(`template ${demo.template} not available (${res})`);
  const wf = await page.evaluate(async (t) => (await fetch(`/templates/${t}.json`)).json(), demo.template);
  demo.prepare(wf);

  const workflow = await page.evaluate(async ({ wf, demo }) => {
    const { app } = window.comfyAPI.app;
    await app.loadGraphData(wf, true, true, demo.title);
    const graph = app.graph;
    const byType = (t) => graph._nodes.find((n) => n.type === t || n.comfyClass === t);
    const subgraphNode = graph._nodes.find((n) => n.isSubgraphNode?.());
    const save = byType('SaveImage');
    const note = graph._nodes.find((n) => n.type === 'MarkdownNote');
    const setWidget = (node, name, value) => {
      const w = node.widgets.find((x) => x.name === name);
      w.value = value;
      w.callback?.(value);
    };
    const inputIndex = (node, name) => node.inputs.findIndex((i) => i.name === name);

    const poser = window.LiteGraph.createNode('OpenPose3DPoser');
    graph.add(poser);
    poser.pos = [-400, 360];
    poser.setSize(demo.poser.size);
    setWidget(poser, 'width', demo.poser.width);
    setWidget(poser, 'height', demo.poser.height);
    const right = poser.pos[0] + demo.poser.size[0] + 40;
    note.pos = [-960, 340];

    let preview = byType('PreviewImage');
    if (!preview) {
      preview = window.LiteGraph.createNode('PreviewImage');
      graph.add(preview);
    }
    preview.pos = [right, 360];
    preview.setSize([380, 520]);
    poser.connect(0, preview, 0);

    if (demo.name === 'zimage') {
      poser.connect(0, subgraphNode, 0);
      subgraphNode.pos = [right + 420, 360];
    } else {
      // poser -> FluxKontextImageScale -> image1, and its size -> latent width/height.
      const scale = window.LiteGraph.createNode('FluxKontextImageScale');
      graph.add(scale);
      scale.pos = [right, 920];
      const size = byType('GetImageSize');
      size.pos = [right, 1040];
      poser.connect(0, scale, 0);
      scale.connect(0, subgraphNode, inputIndex(subgraphNode, 'image1'));
      scale.connect(0, size, 0);
      size.connect(0, subgraphNode, inputIndex(subgraphNode, 'width_1'));
      size.connect(1, subgraphNode, inputIndex(subgraphNode, 'height_1'));
      subgraphNode.pos = [right + 420, 360];
    }
    save.pos = [subgraphNode.pos[0] + subgraphNode.size[0] + 40, 360];
    save.setSize([demo.poser.width > demo.poser.height ? 760 : 560, 820]);

    const ed = poser.poserEditor;
    ed.select(ed.people[0], null);
    const sel = ed.ui.presetSelect;
    sel.value = `b:${demo.poser.preset}`;
    sel.dispatchEvent(new Event('change'));
    ed.setView('camera');
    ed.outputCamera.position.set(...demo.poser.camera[0]);
    ed.cameraControls.target.set(...demo.poser.camera[1]);
    ed.cameraControls.update();
    ed.frameAll();
    ed.editorCamera.position.set(2.2, 1.6, 3.4);
    ed.editorControls.target.set(0, 0.6, 0);
    ed.editorControls.update();
    ed.select(null, null);
    ed._serialized = null;

    const group = graph._groups?.[0];
    if (group) {
      group.title = 'Pose';
      group.pos = [-420, 290];
      group.size = [right + 400 - -420, 1080];
    }
    app.canvas.ds.scale = 0.55;
    app.canvas.ds.offset = [1150, -120];
    app.canvas.setDirty(true, true);
    await new Promise((r) => setTimeout(r, 500));
    return app.graph.serialize();
  }, { wf, demo: { name: demo.name, title: demo.title, poser: demo.poser } });

  const poserNode = workflow.nodes.find((n) => n.type === 'OpenPose3DPoser');
  const scene = JSON.parse(poserNode.widgets_values.find((v) => typeof v === 'string' && v.startsWith('{')));
  if (scene.people.length !== 1 || !scene.people[0].keypoints) throw new Error('poser scene missing');
  demo.check(workflow);

  mkdirSync('example_workflows', { recursive: true });
  writeFileSync(demo.out, JSON.stringify(workflow, null, 2) + '\n');
  // Thumbnail for the Templates browser (the frontend looks for <name>.jpg).
  await page.evaluate(() => {
    const { app } = window.comfyAPI.app;
    app.canvas.ds.scale = 1;
    app.canvas.ds.offset = [520, -260];
    app.canvas.setDirty(true, true);
  });
  await page.waitForTimeout(800);
  await page.locator('.poser-stage').screenshot({ path: demo.out.replace(/\.json$/, '.jpg'), type: 'jpeg', quality: 85 });
  console.log(`wrote ${demo.out}`);
}

const demos = [ZIMAGE, KREA2].filter((d) => process.argv.length <= 2 || process.argv.includes(d.name));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.error('pageerror', e));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.comfyAPI?.app?.app?.graph && window.LiteGraph, null, { timeout: 120000 });
await page.waitForTimeout(2500);
for (const demo of demos) await build(page, demo);
await browser.close();
