import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createVehicleFeatures } from '../src/vehicle-features.js';
import { loadNpz } from '../src/npz.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url)));
const scene = read('scene.json'), metadata = read('interactions.json');
const npz = await loadNpz(`data:application/octet-stream;base64,${readFileSync(new URL('../public/meshes.npz', import.meta.url)).toString('base64')}`);
const mirrorCenter = new THREE.Vector3();
const mirrorVertices = npz.DOOR_HSJ_v;
for (let i = 0; i < mirrorVertices.length; i += 3) mirrorCenter.add(new THREE.Vector3(...mirrorVertices.subarray(i, i + 3)));
mirrorCenter.divideScalar(mirrorVertices.length / 3);
const matrix = rows => new THREE.Matrix4().set(...rows.flat());
const closeMatrix = (a, b) => assert.ok(a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-5));
function fixture() {
  const materials = {};
  for (const name of ['外观_大灯_ON', '外观_尾灯', '外观_日行灯', '外观_日行灯转向灯', '外观_前灯_ON', '外观_尾灯示廓灯', '外观_尾灯Logo', '外观_转向灯示廓灯', '外观_转向灯 1', 'Charger_line']) {
    materials[name] = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 1.6 });
  }
  materials.Charger_line.map = new THREE.Texture();
  const instances = scene.nodes.map((n, i) => {
    const obj = new THREE.Group(); obj.matrix.copy(matrix(n.matrix));
    return { obj, mesh: n.mesh, path: metadata.nodes[i].path };
  });
  const features = createVehicleFeatures({ instances, metadata, materials });
  const tick = (seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) features.update(dt); };
  return { features, instances, materials, tick };
}

test('mirrors use three-second reversible motion and restore both mirrored bases', () => {
  const { features: f, instances, tick } = fixture();
  const mirrors = instances.filter(i => i.mesh === 'DOOR_HSJ');
  f.setMirrors(false); tick(1.5);
  assert.ok(Math.abs(f.getState().mirrorPhase - 0.5) < 1e-6);
  const half = mirrors.map(i => f.mirrorMatrix(i.obj).clone());
  f.setMirrors(true); f.update(0);
  mirrors.forEach((i, n) => closeMatrix(f.mirrorMatrix(i.obj), half[n]));
  tick(1.5);
  mirrors.forEach(i => closeMatrix(f.mirrorMatrix(i.obj), new THREE.Matrix4()));
  f.setMirrors(false); tick(3);
  for (const i of mirrors) {
    assert.ok(Math.abs(f.mirrorMatrix(i.obj).determinant() - 1) < 1e-5);
  }
});

test('both real mirror housings fold inward toward the body and rearward', () => {
  const { features: f, instances, tick } = fixture();
  const mirrors = instances.filter(i => i.mesh === 'DOOR_HSJ');
  assert.equal(mirrors.length, 2);
  const expanded = mirrors.map(i => mirrorCenter.clone().applyMatrix4(i.obj.matrix));
  f.setMirrors(false); tick(3.1);
  mirrors.forEach((i, index) => {
    const folded = mirrorCenter.clone().applyMatrix4(i.obj.matrix).applyMatrix4(f.mirrorMatrix(i.obj));
    assert.ok(Math.abs(folded.z) < Math.abs(expanded[index].z) - 0.05, `${i.path}: mirror must move inward`);
    assert.ok(folded.x > expanded[index].x + 0.01, `${i.path}: mirror must move toward the rear`);
  });
  f.setMirrors(true); tick(3.1);
  mirrors.forEach((i, index) => {
    const reopened = mirrorCenter.clone().applyMatrix4(i.obj.matrix).applyMatrix4(f.mirrorMatrix(i.obj));
    assert.ok(reopened.distanceTo(expanded[index]) < 1e-6);
  });
});

test('charging has separate lid, cable and flow; stopping preserves plug and open pose', () => {
  const { features: f, instances, materials, tick } = fixture();
  const port = instances.find(i => i.mesh === 'cdk');
  const cable = instances.filter(i => i.path.startsWith('Charger_LINE'));
  f.setCharging(true); f.update(0);
  assert.ok(cable.every(i => !i.obj.visible));
  tick(1);
  assert.ok(cable.every(i => i.obj.visible));
  closeMatrix(port.obj.matrix, matrix(metadata.chargingPort.opened));
  const offset = materials.Charger_line.map.offset.x;
  f.setCharging(false); tick(1);
  assert.equal(materials.Charger_line.map.offset.x, offset);
  assert.equal(f.getState().chargingCableVisible, true);
  assert.equal(f.getState().chargingPortOpen, true);
  assert.throws(() => f.setChargingPortOpen(false), /线缆/);
  f.setChargingCableVisible(false); f.update(0);
  assert.ok(cable.every(i => !i.obj.visible));
  tick(1); closeMatrix(port.obj.matrix, matrix(metadata.chargingPort.closed));
  f.setChargingPortOpen(true); tick(1);
  assert.equal(f.getState().chargingCableVisible, false);
});

test('independent lights and transient amber restore the latest requested daytime state', () => {
  const { features: f, materials: m, tick } = fixture();
  f.setHeadlights(false);
  assert.equal(m['外观_大灯_ON'].emissiveIntensity, 0);
  assert.equal(m['外观_日行灯'].emissiveIntensity, 1.6);
  assert.equal(m['外观_尾灯示廓灯'].emissiveIntensity, 1.6);
  f.flashTurnSignals(); tick(0.1);
  assert.equal(m['外观_转向灯 1'].emissiveIntensity, 2.4);
  f.setDaytimeRunningLights(false); tick(3);
  assert.equal(f.getState().signaling, null);
  assert.equal(m['外观_日行灯转向灯'].emissiveIntensity, 0);
  assert.equal(m['外观_转向灯 1'].emissiveIntensity, 0);
  f.setLocked(true); tick(3);
  assert.ok(Math.abs(f.getState().mirrorPhase - 1) < 1e-6);
  assert.equal(f.getState().positionLights, false);
  f.setLocked(false); tick(3);
  assert.ok(f.getState().mirrorPhase < 1e-6);
  assert.equal(f.getState().headlights, true);
});

test('invalid switches cannot mutate a valid configuration', () => {
  const { features: f } = fixture();
  for (const method of ['setHeadlights', 'setDaytimeRunningLights', 'setPositionLights', 'setMirrors', 'setLocked', 'setChargingPortOpen', 'setChargingCableVisible', 'setCharging']) {
    for (const value of [0, 1, 'true', null, undefined, {}]) {
      const before = f.getState();
      assert.throws(() => f[method](value), TypeError);
      assert.deepEqual(f.getState(), before);
    }
  }
});
