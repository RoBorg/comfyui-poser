// User pose presets, stored server-side in ComfyUI's per-user data dir (user/<user>/poser/presets.json).

const FILE = 'poser/presets.json';
const url = () => `/userdata/${encodeURIComponent(FILE)}`;

let cache = null;
const listeners = new Set();

export function onUserPresetsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadUserPresets(api) {
  cache ??= api.fetchApi(url())
    .then((r) => (r.ok ? r.json() : {}))
    .then((data) => (data && typeof data === 'object' && !Array.isArray(data) ? data : {}))
    .catch(() => ({}));
  return cache;
}

async function write(api, presets) {
  const res = await api.fetchApi(`${url()}?overwrite=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(presets, null, 1),
  });
  if (!res.ok) throw new Error(`Saving presets failed: ${res.status} ${res.statusText}`);
  cache = Promise.resolve(presets);
  listeners.forEach((fn) => fn(presets));
}

export async function saveUserPreset(api, name, pose) {
  const presets = { ...(await loadUserPresets(api)), [name]: pose };
  await write(api, presets);
}

export async function deleteUserPreset(api, name) {
  const presets = { ...(await loadUserPresets(api)) };
  delete presets[name];
  await write(api, presets);
}
