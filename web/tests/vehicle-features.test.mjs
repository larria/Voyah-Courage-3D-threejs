import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createVehicleFeatures } from '../src/vehicle-features.js';

const read = name => JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url)));
const scene = read('scene.json'), metadata = read('interactions.json');
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
    const expected = i.obj.matrix.clone().multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(70)));
    closeMatrix(f.mirrorMatrix(i.obj).clone().multiply(i.obj.matrix), expected);
  }
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
