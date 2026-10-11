// Checks that the bundled example workflows are listed under Templates, load, expand into the
// expected pipelines, and only fail validation on model files that aren't installed.
//   docker compose run --rm e2e node tests/e2e/demo-workflow.mjs
import { chromium } from 'playwright';

const BASE = process.env.COMFY_URL || 'http://localhost:8188';
const OUT = process.env.OUT_DIR || 'tests/e2e/out';
const TAG = process.env.TAG || 'run';
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };

const DEMOS = [
  {
    name: 'openpose_3d_poser_z_image_turbo',
    size: [832, 1216],
    nodes: ['OpenPose3DPoser', 'QwenImageDiffsynthControlnet', 'ModelPatchLoader'],
  },
  {
    name: 'openpose_3d_poser_krea2_turbo',
    size: [1248, 832],
    nodes: ['OpenPose3DPoser', 'TextEncodeKrea2OstrisEdit', 'Krea2OstrisEditModelPatch', 'FluxKontextImageScale', 'GetImageSize'],
    // Latent size must follow the (Kontext-scaled) pose image, not the template's 1024 defaults.
    extra: (prompt) => {
      const latents = Object.values(prompt).filter((n) => n.class_type === 'EmptyLatentImage');
      const sizeNode = Object.entries(prompt).find(([, n]) => n.class_type === 'GetImageSize')?.[0];
      check(latents.length > 0 && latents.every((n) => Array.isArray(n.inputs.width) && n.inputs.width[0] === sizeNode),
        'latent size is driven by the pose image');
      const patch = Object.values(prompt).find((n) => n.class_type === 'Krea2OstrisEditModelPatch');
      check(patch.inputs.kv_cache === true, 'Ostris model patch runs with kv_cache on');
      const lora = Object.values(prompt).find((n) => n.class_type === 'LoraLoaderModelOnly');
      check(lora.inputs.lora_name === 'krea2_turbo_openpose_controlnet.safetensors', 'pose LoRA is loaded');
    },
  },
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.comfyAPI?.app?.app?.graph && window.LiteGraph, null, { timeout: 120000 });
await page.waitForTimeout(2500);

const listed = await page.evaluate(async () => (await (await fetch('/api/workflow_templates')).json())['comfyui-poser'] || []);
for (const demo of DEMOS) {
  console.log(`# ${demo.name}`);
  check(listed.includes(demo.name), 'listed under Templates');
  const thumb = await page.evaluate(async (n) => (await fetch(`/api/workflow_templates/comfyui-poser/${n}.jpg`)).status, demo.name);
  check(thumb === 200, 'thumbnail is served');

  const result = await page.evaluate(async (n) => {
    const { app } = window.comfyAPI.app;
    const { api } = window.comfyAPI.api;
    const wf = await (await fetch(`/api/workflow_templates/comfyui-poser/${n}.json`)).json();
    await app.loadGraphData(wf, true, true, n);
    await new Promise((r) => setTimeout(r, 1500));
    const poser = app.graph._nodes.find((x) => x.comfyClass === 'OpenPose3DPoser');
    const prompt = await app.graphToPrompt();
    // Invalid outputs are dropped and reported in node_errors; valid branches still run.
    let validation;
    try {
      validation = await api.queuePrompt(0, prompt);
    } catch (e) {
      validation = e.response ?? { message: String(e) };
    }
    return {
      people: poser?.poserEditor?.people.length,
      view: poser?.poserEditor?.view,
      size: ['width', 'height'].map((k) => poser?.widgets.find((w) => w.name === k)?.value),
      prompt: prompt.output,
      validation,
    };
  }, demo.name);
  const types = Object.values(result.prompt).map((x) => x.class_type);
  check(result.people === 1 && result.view === 'camera', 'poser scene restored');
  check(result.size[0] === demo.size[0] && result.size[1] === demo.size[1], `output size ${demo.size.join('x')}`);
  check(demo.nodes.every((t) => types.includes(t)), `expands into ${demo.nodes.join(', ')}`);
  demo.extra?.(result.prompt);

  // Any validation errors must be model files that aren't installed (none if they are).
  const nodeErrors = Object.values(result.validation?.node_errors || {}).flatMap((e) => e.errors);
  const bad = nodeErrors.filter((e) => !(e.type === 'value_not_in_list' && /unet_name|clip_name|vae_name|lora_name|name/.test(e.extra_info?.input_name)));
  console.log('  validation errors:', nodeErrors.map((e) => `${e.type}:${e.extra_info?.input_name}`).join(', ') || 'none');
  check(bad.length === 0 && !result.validation?.error, 'only missing model files (if any) fail validation');
  await page.screenshot({ path: `${OUT}/${TAG}-${demo.name}.png` });
}
check(!errors.length, `no page errors ${errors.join('; ')}`);
await browser.close();
console.log('ALL PASSED');
