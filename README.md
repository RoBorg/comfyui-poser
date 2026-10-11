# OpenPose 3D Poser for ComfyUI

A ComfyUI custom node with a 3D viewport built into the node. You pose one or more
OpenPose skeletons (body, hands and face) and place a camera. The node outputs an
OpenPose control image that you can feed straight into an OpenPose ControlNet.

Requires ComfyUI **v0.32.0 or newer** (frontend 1.48+). Tested on v0.32.0 and v0.39.2,
with both the classic canvas and the "Nodes 2.0" (Vue) renderer.

## Install

Copy or clone this folder into `ComfyUI/custom_nodes/` and restart ComfyUI. It has no
Python dependencies beyond what ComfyUI already ships. The frontend is prebuilt in
`web/js/poser.js`, so you don't need npm.

## Demo workflows

Open **Templates → Extensions → comfyui-poser**, or drag a file from `example_workflows/`
onto the canvas. Each demo is built on one of ComfyUI's built-in templates, with the poser
as the pose source and a preview of the pose map. The notes in each workflow link every
model file it needs.

### `openpose_3d_poser_z_image_turbo`: Z-Image Turbo + Fun Union ControlNet (~26 GB of models)

Based on the **Z-Image-Turbo Fun Union ControlNet** template. The image + Canny
preprocessing is replaced by the poser, and the union ControlNet is upgraded to
`Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps`, which follows poses noticeably better
than the template's v1. In a 12-image-per-setting test scored with DWPose, about half as many
body keypoints landed far off target (6.9% vs 14.8%), and no image ignored the pose. Keep its
strength at 1.0; at 0.8 it was barely better than v1. No extra custom nodes needed.

### `openpose_3d_poser_krea2_turbo`: Krea 2 Turbo + OpenPose LoRA (~17.6 GB of models)

Based on the **Krea-2: Image Style Reference** template. The poser image goes in as
reference image 1 for [thedeoxen's Krea 2 OpenPose LoRA](https://huggingface.co/thedeoxen/Krea-2-pose-controlnet)
(Apache-2.0), using the fp8 Turbo model, 10 steps.

**Requires the "Krea 2 Ostris Edit" custom node pack** (`comfyui-krea2-ostris-edit`).
Install it with ComfyUI-Manager's *Install Missing Custom Nodes*, or clone
https://github.com/ostris/ComfyUI-Krea2-Ostris-Edit into `custom_nodes`. The LoRA was
trained for its **kv_cache** reference mode, and the demo uses that mode. In the same DWPose
test this setup scored best of everything tried:

| Krea 2 setup | keypoints on target | median error |
|---|---|---|
| core nodes only (built-in template path) | 74% | 41 px |
| Ostris nodes, kv_cache **on** (used) | **97.5%** | **13 px** |
| Ostris nodes, kv_cache off | 75% | 27 px |

The core-only and kv_cache-off variants also produced blotchy artifacts. The pose image is
snapped to the nearest Kontext-friendly size (≈1 MP) and the output follows it; 1248×832
(used in the demo) is one of those sizes.

Even without the models installed, **Run** still renders the pose preview, because ComfyUI
skips only the branch with missing models.

## The node: `OpenPose 3D Poser` (category `image/pose`)

| Input | |
|---|---|
| `width`, `height` | Output size. Also sets the aspect ratio of the camera view. |
| `include_hands` | Draw the 21-point hands (and show them in the viewport). |
| `include_face` | Draw the 70-point face (and show it in the viewport). |
| `line_thickness` | Stroke multiplier. Strokes already scale with resolution to match the standard 512px OpenPose look. |
| `reference_image` (optional) | Any IMAGE. After the node runs, it's shown behind the skeleton in Camera view. |

| Output | |
|---|---|
| `pose_image` | OpenPose image (standard controlnet_aux colours) → **Apply ControlNet** with an OpenPose model. |
| `pose_keypoint` | `POSE_KEYPOINT` (OpenPose JSON, same format as comfyui_controlnet_aux). |

## Using the viewport

* **Editor / Camera**: Editor is a free orbit view that shows the output camera as a yellow
  frustum. Camera looks through the output camera, letterboxed to the output size, so you
  see exactly what will be rendered. Orbiting, panning or zooming in Camera view moves the
  output camera.
* **Preview**: in Editor view, a small inset in the bottom-right corner shows what the output
  camera sees, updating live as you pose. Click the inset to switch to Camera view. The
  **Preview** button turns it on or off, and the setting is saved with the workflow.
* **Mouse**: left-drag orbits, right-drag pans, the wheel zooms. Click a joint to select it.
  The ground is semi-transparent, so anything that sinks below it shows through, dimmed.
* **Rotate**: drag the gizmo rings to rotate the selected joint. Every joint can be rotated,
  including each finger segment, the spine, neck and head.
* **Move**: shows orange IK handles that stay visible through the body. Drag a **diamond**
  on a wrist or ankle to pose the whole limb with IK, or drag the **ring** around the pelvis
  to move the person. You don't need to select a handle first; after a drag, gizmo arrows
  appear for axis-locked moves.
* **Undo / Redo**: undo and redo inside the poser. While the mouse is over the viewport,
  **Ctrl+Z** and **Ctrl+Shift+Z / Ctrl+Y** do the same without touching ComfyUI's graph
  undo. Elsewhere, ComfyUI's own undo also covers the poser.
* **Mirror**: swaps the left and right sides of the selected person's pose.
* **Reset joint / Reset pose**: resets the selected joint, or the whole person if the pelvis
  or nothing is selected.
* **Person ▾, +, −**: select, add or remove people.
* **Pose…**: built-in body poses plus your own:
  * **Standing/moving:** T-Pose, A-Pose, Standing, Walking, Running, Waving, Arms Up,
    Hands on Hips
  * **Sitting/kneeling:** Sitting, Kneeling, Crouching, W-Sitting
  * **Floor:** All Fours, Lying on Back, Lying on Side (propped on an elbow), Lying on
    Stomach (on elbows, feet up)
  * **Yoga:** Cobra, Extended Puppy, One Leg Pigeon (back foot raised and held by the hand
    reaching back)

  Poses keep the person's facing direction, so a person you've turned stays turned, even
  when lying down. Upright poses stand them back up. Floor poses lie side-on to the default
  camera.
* **Hands…**: Open, Relaxed, Fist, Point, Peace, Thumbs Up. Applies to the selected hand
  (select any arm or finger joint), otherwise to both hands.
* **Save / 🗑**: save the selected person's pose as a named preset, or delete the last user
  preset you applied. User presets are stored in `ComfyUI/user/<user>/poser/presets.json`.
* **Ref image… / ✕ / opacity / Fit size**: upload a reference image (it goes to
  `input/poser/`) and show it behind the skeleton in Camera view. **Fit size** sets
  width/height to the image's aspect ratio. The image is stretched to the output frame,
  so match the aspect ratio to line things up.
* **fov / Frame**: the output camera's field of view, and a button that points the active
  camera at the selected person (or everyone).

The full scene (people, camera, reference) is saved in the workflow inside the hidden
`pose_data` widget.

## How it works

* The browser holds the rig: a bone hierarchy for each person, posed with three.js. It
  serialises each person's **3D keypoints** together with the camera (position, target,
  vertical FOV).
* Python (`openpose_render.py`) projects those points through the same pinhole model as a
  three.js `PerspectiveCamera`, then draws them with the controlnet_aux OpenPose colours and
  stroke styles. Farther people are drawn first. Because projection happens on the server,
  linking `width`/`height` from other nodes still gives the right framing.

## Development

The frontend source is in `src/` and is bundled into `web/js/poser.js` with esbuild:

```sh
nvm use 26
npm install
npm run build        # or: npm run watch
npm test             # rig/preset tests (every preset touches the ground, headings, saving)
```

A Docker dev environment runs both supported ComfyUI versions with this folder mounted as
a custom node:

```sh
docker compose up -d comfy-latest comfy-min   # http://localhost:18188 (v0.39.2), :18189 (v0.32.0)
docker compose run --rm test                  # Python tests (inside the ComfyUI image)
docker compose run --rm e2e                   # Playwright smoke test against comfy-latest
COMFY_URL=http://comfy-min:8188 TAG=min docker compose run --rm e2e
VUE_NODES=1 TAG=vue docker compose run --rm e2e
```

The e2e test saves screenshots and the rendered output to `tests/e2e/out/`.

The demo workflows are generated from the built-in templates inside a real browser, so the
frontend serialises the subgraphs itself. The dev images include a pinned copy of the Krea 2
Ostris Edit node pack (see `docker/Dockerfile`) so the Krea 2 demo can run there. Re-run this after changing the node's inputs:

```sh
docker compose run --rm e2e node scripts/make-demo-workflow.mjs   # writes example_workflows/ (both demos)
docker compose run --rm e2e node tests/e2e/demo-workflow.mjs      # loads + validates them
```
`npm run export-presets` regenerates `tests/fixtures/presets.json` from the JS rig. It
holds one person per built-in preset and is used by the Python tests.

Set `POSER_PORT_LATEST` / `POSER_PORT_MIN` to change the host ports.

### GPU

The dev containers use CUDA 13.0 PyTorch with `gpus: all`, which supports RTX 50xx (sm_120)
and needs an NVIDIA driver that supports CUDA 13.0 or newer, plus the NVIDIA container
runtime (Docker Desktop on WSL2 has it built in). Check with:

```sh
docker compose exec comfy-latest python -c "import torch; print(torch.cuda.get_device_name())"
```

Model folders are mounted from `docker/<folder>` (for example `docker/diffusion_models`).
To run without a GPU, rebuild with `--build-arg TORCH_INDEX=https://download.pytorch.org/whl/cpu`,
start with `COMFY_ARGS=--cpu`, and remove `gpus: all`.
