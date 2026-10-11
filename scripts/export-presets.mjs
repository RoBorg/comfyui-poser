// Writes tests/fixtures/presets.json: one person per built-in body preset, laid out in a row,
// serialised exactly like the node widget does. Used by the Python tests and for eyeballing presets.
//   node scripts/export-presets.mjs
import { writeFileSync } from 'node:fs';
import { Person } from '../src/person.js';
import { BODY_PRESETS } from '../src/presets.js';

const names = Object.keys(BODY_PRESETS);
const spacing = 1.0;
const people = names.map((name, i) => {
  const p = new Person(name);
  p.applyPose(BODY_PRESETS[name]);
  p.root.position.x = (i - (names.length - 1) / 2) * spacing;
  p.update();
  return { ...p.toJSON(), keypoints: p.keypoints() };
});
const scene = {
  version: 1,
  camera: { position: [0, 1.0, 9.5], target: [0, 0.9, 0], fov: 40 },
  people,
};
writeFileSync(new URL('../tests/fixtures/presets.json', import.meta.url), JSON.stringify(scene));
console.log(`wrote ${people.length} people`);
