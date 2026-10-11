// node --test tests/js   (npm test)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Person } from '../../src/person.js';
import { BODY_PRESETS } from '../../src/presets.js';

const CONTACT = ['r_ankle', 'l_ankle', 'r_toe', 'l_toe', 'r_knee', 'l_knee', 'r_wrist', 'l_wrist', 'r_elbow', 'l_elbow', 'pelvis',
  'r_index_tip', 'l_index_tip', 'r_middle_tip', 'l_middle_tip', 'r_thumb_tip', 'l_thumb_tip'];

function lowestPoints(p) {
  const kp = p.keypoints();
  const ys = [...kp.body, ...kp.right_hand, ...kp.left_hand].map((v) => v[1]);
  for (const b of CONTACT) ys.push(p.bones[b].getWorldPosition(p.root.position.clone()).y);
  return Math.min(...ys);
}

for (const [name, preset] of Object.entries(BODY_PRESETS)) {
  test(`${name}: rests on the ground without sinking into it`, () => {
    const p = new Person(name);
    p.applyPose(preset);
    const low = lowestPoints(p);
    assert.ok(low > -0.02, `lowest point ${low.toFixed(3)} m is below the ground`);
    assert.ok(low < 0.12, `lowest point ${low.toFixed(3)} m: pose floats above the ground`);
  });
}

test('presets keep the person\'s heading, and upright presets stand them back up', () => {
  const p = new Person('h');
  p.applyPose(BODY_PRESETS.Standing);
  p.setRotation('pelvis', [0, 70, 0]);
  p.update();
  for (const name of ['Lying on Back', 'Cobra', 'Lying on Side', 'Standing']) {
    p.applyPose(BODY_PRESETS[name]);
    assert.ok(Math.abs((p.heading() * 180) / Math.PI - 70) < 1e-6, `${name} changed the heading`);
  }
  assert.ok(p.getRotation('pelvis').every((v, i) => Math.abs(v - [0, 70, 0][i]) < 1e-3), 'Standing is not upright');
});

test('a saved pose (getPose) re-applies to the same keypoints, orientation included', () => {
  for (const name of ['Lying on Side', 'Extended Puppy', 'Walking']) {
    const a = new Person('a');
    a.setRotation('pelvis', [0, -40, 0]);
    a.applyPose(BODY_PRESETS[name]);
    const saved = JSON.parse(JSON.stringify(a.getPose()));
    const b = new Person('b');
    b.setRotation('pelvis', [0, -40, 0]);
    b.applyPose(saved);
    const ka = a.keypoints().body.flat();
    const kb = b.keypoints().body.flat();
    assert.ok(ka.every((v, i) => Math.abs(v - kb[i]) < 2e-3), `${name} did not round-trip`);
  }
});

test('serialised people (toJSON/fromJSON) keep the preset orientation for later presets', () => {
  const a = new Person('a');
  a.setRotation('pelvis', [0, 30, 0]);
  a.applyPose(BODY_PRESETS['Lying on Stomach']);
  const b = new Person('b');
  b.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
  b.applyPose(BODY_PRESETS.Standing);
  assert.ok(Math.abs((b.heading() * 180) / Math.PI - 30) < 1e-3);
});
