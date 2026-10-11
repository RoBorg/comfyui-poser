// Checks that the bundled example workflow is listed under Templates, loads, and only fails
// validation on model files that aren't installed.
//   docker compose run --rm e2e node tests/e2e/demo-workflow.mjs
import { chromium } from 'playwright';

const BASE = process.env.COMFY_URL || 'http://localhost:8188';
const OUT = process.env.OUT_DIR || 'tests/e2e/out';
const TAG = process.env.TAG || 'run';
const NAME = 'openpose_3d_poser_z_image_turbo';
const check = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.comfyAPI?.app?.app?.graph && window.LiteGraph, null, { timeout: 120000 });
await page.waitForTimeout(2500);

const listed = await page.evaluate(async () => (await (await fetch('/api/workflow_templates')).json())['comfyui-poser'] || []);
check(listed.includes(NAME), 'example workflow is listed under Templates');
const thumb = await page.evaluate(async (n) => (await fetch(`/api/workflow_templates/comfyui-poser/${n}.jpg`)).status, NAME);
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
    types: Object.values(prompt.output).map((x) => x.class_type).sort(),
    validation,
  };
}, NAME);
console.log('  prompt nodes:', result.types.join(', '));
check(result.people === 1 && result.view === 'camera', 'poser scene restored');
check(result.size[0] === 832 && result.size[1] === 1216, 'output size 832x1216');
check(result.types.includes('OpenPose3DPoser') && result.types.includes('QwenImageDiffsynthControlnet'), 'subgraph expands into the ControlNet pipeline');

// Any validation errors must be model files that aren't installed (none if they are).
const nodeErrors = Object.values(result.validation?.node_errors || {}).flatMap((e) => e.errors);
const bad = nodeErrors.filter((e) => !(e.type === 'value_not_in_list' && /unet_name|clip_name|vae_name|name/.test(e.extra_info?.input_name)));
console.log('  validation errors:', nodeErrors.map((e) => `${e.type}:${e.extra_info?.input_name}`).join(', ') || 'none');
check(bad.length === 0, 'only missing model files (if any) fail validation');
await page.screenshot({ path: `${OUT}/${TAG}-demo-workflow.png` });
check(!errors.length, `no page errors ${errors.join('; ')}`);
await browser.close();
console.log('ALL PASSED');
