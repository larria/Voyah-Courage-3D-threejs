import * as THREE from 'three';

const boolean = value => {
  if (typeof value !== 'boolean') throw new TypeError('开关参数必须为 boolean');
  return value;
};
const matrix = rows => new THREE.Matrix4().set(...rows.flat());
const advance = (current, target, delta) => current + Math.sign(target - current) * Math.min(Math.abs(target - current), delta);

// The geometry stays in its baked world pose. Additional motion is composed
// before the existing door transform, including mirrored right-side instances.
export function createVehicleFeatures({ instances, metadata, materials, onChange }) {
  const state = {
    headlights: true, daytimeRunningLights: true, positionLights: true,
    mirrorsExpanded: true, locked: false,
    chargingPortOpen: false, chargingCableVisible: false, charging: false,
  };
  const lamps = {
    headlights: ['外观_大灯_ON', '外观_尾灯'],
    daytimeRunningLights: ['外观_日行灯', '外观_日行灯转向灯'],
    positionLights: ['外观_前灯_ON', '外观_尾灯示廓灯', '外观_尾灯Logo'],
  };
  const intensities = new Map(Object.values(lamps).flat().map(name => [name, materials[name]?.emissiveIntensity ?? 0]));
  const turnNames = ['外观_日行灯转向灯', '外观_转向灯示廓灯', '外观_转向灯 1'];
  const turnColors = new Map(turnNames.map(name => [name, materials[name]?.emissive.clone()]));
  const mirrors = new Map(instances.filter(i => i.mesh === 'DOOR_HSJ').map(i => {
    const anchor = i.obj.matrix.clone();
    return [i.obj, { anchor, inverse: anchor.clone().invert(), motion: new THREE.Matrix4() }];
  }));
  const port = instances.find(i => i.mesh === 'cdk');
  const portClosed = matrix(metadata.chargingPort.closed), portOpened = matrix(metadata.chargingPort.opened);
  const portRelative = portClosed.clone().invert().multiply(port.obj.matrix);
  const closedQ = new THREE.Quaternion().setFromRotationMatrix(portClosed);
  const openedQ = new THREE.Quaternion().setFromRotationMatrix(portOpened);
  const portPosition = new THREE.Vector3().setFromMatrixPosition(portClosed);
  const cable = instances.filter(i => i.path === 'Charger_LINE' || i.path.startsWith('Charger_LINE/'));
  const plug = cable.find(i => i.mesh === 'LINES_HEAD');
  const portBox = new THREE.Box3().setFromObject(port.obj);
  if (plug && !portBox.isEmpty()) {
    // The exported charger is a separate scene object at the origin. Align its
    // insertion end with the actual right-rear socket, preserving cable geometry.
    const socket = portBox.getCenter(new THREE.Vector3());
    socket.z -= 0.1;
    const offset = socket.sub(new THREE.Vector3().setFromMatrixPosition(plug.obj.matrix));
    const move = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    for (const inst of cable) { inst.obj.matrix.premultiply(move); inst.obj.matrixWorldNeedsUpdate = true; }
  }
  // Clone the cable texture: its animated offset must not affect shared atlases.
  const cableMaterial = materials.Charger_line;
  const flowUniforms = { phase: { value: 0 }, on: { value: 0 } };
  cableMaterial.onBeforeCompile = shader => {
    shader.uniforms.chargePhase = flowUniforms.phase;
    shader.uniforms.chargeOn = flowUniforms.on;
    shader.vertexShader = 'varying vec3 vChargePosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvChargePosition = position;');
    shader.fragmentShader = 'uniform float chargePhase;\nuniform float chargeOn;\nvarying vec3 vChargePosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float band = pow(max(0.0, sin((vChargePosition.x - vChargePosition.y) * 20.0 - chargePhase * 6.283185)), 8.0);
      totalEmissiveRadiance += vec3(0.08, 0.8, 1.0) * band * chargeOn * 2.0;`);
  };
  cableMaterial.customProgramCacheKey = () => 'voyah-charge-flow-v1';
  if (cableMaterial.map) {
    cableMaterial.map = cableMaterial.map.clone();
    cableMaterial.map.wrapS = cableMaterial.map.wrapT = THREE.RepeatWrapping;
    cableMaterial.map.needsUpdate = true;
  }
  const rotation = new THREE.Matrix4(), portQ = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  let mirrorPhase = 0, portPhase = 0, flow = 0, flash = null;

  function applyLights() {
    for (const [key, names] of Object.entries(lamps)) {
      for (const name of names) if (materials[name]) materials[name].emissiveIntensity = state[key] ? intensities.get(name) : 0;
    }
    const amber = flash && Math.floor(flash.elapsed / 0.45) % 2 === 0;
    for (const name of turnNames) {
      const material = materials[name];
      if (!material) continue;
      material.emissive.copy(amber ? new THREE.Color(0xff8800) : turnColors.get(name));
      material.emissiveIntensity = amber ? 2.4 : name === '外观_日行灯转向灯' && state.daytimeRunningLights ? intensities.get(name) : 0;
    }
  }
  function changed() { applyLights(); onChange?.(); }
  function setLight(key, value) { state[key] = boolean(value); changed(); }
  function flashSignals(count, mode) { flash = { elapsed: 0, duration: count * 0.9, mode }; changed(); }

  const api = {
    getState: () => ({ ...state, mirrorPhase, portPhase, signaling: flash?.mode ?? null }),
    setHeadlights: value => setLight('headlights', value),
    setDaytimeRunningLights: value => setLight('daytimeRunningLights', value),
    setPositionLights: value => setLight('positionLights', value),
    setAllLights(value) {
      boolean(value);
      for (const key of Object.keys(lamps)) state[key] = value;
      changed();
    },
    setMirrors(value) { state.mirrorsExpanded = boolean(value); changed(); },
    setLocked(value) {
      state.locked = boolean(value);
      state.mirrorsExpanded = !value;
      for (const key of Object.keys(lamps)) state[key] = !value;
      flashSignals(2, value ? 'lock' : 'unlock');
    },
    flashTurnSignals: () => flashSignals(3, 'turn'),
    findCar: () => flashSignals(5, 'find'),
    setChargingPortOpen(value) {
      boolean(value);
      if (!value && state.chargingCableVisible) throw new Error('请先隐藏充电线缆，再关闭盖板');
      state.chargingPortOpen = value;
      changed();
    },
    setCharging(value) {
      state.charging = boolean(value);
      if (value) state.chargingPortOpen = state.chargingCableVisible = true;
      changed();
    },
    setChargingCableVisible(value) {
      state.chargingCableVisible = boolean(value);
      state.charging = false;
      state.chargingPortOpen = value;
      changed();
    },
    mirrorMatrix(obj) { return mirrors.get(obj)?.motion; },
    update(dt) {
      mirrorPhase = advance(mirrorPhase, state.mirrorsExpanded ? 0 : 1, dt / 3);
      const ease = mirrorPhase * mirrorPhase * (3 - 2 * mirrorPhase);
      // Reference mirror fix: local Unity Z = -70°; right-handed Z = +70°.
      rotation.makeRotationZ(THREE.MathUtils.degToRad(70) * ease);
      for (const mirror of mirrors.values()) mirror.motion.copy(mirror.anchor).multiply(rotation).multiply(mirror.inverse);
      portPhase = advance(portPhase, state.chargingPortOpen ? 1 : 0, dt / 0.8);
      portQ.slerpQuaternions(closedQ, openedQ, portPhase * portPhase * (3 - 2 * portPhase));
      port.obj.matrix.compose(portPosition, portQ, unitScale).multiply(portRelative);
      port.obj.matrixWorldNeedsUpdate = true;
      // A plug appears only after the port has opened, and retracts before closing.
      for (const inst of cable) inst.obj.visible = state.chargingCableVisible && portPhase > 0.98;
      if (state.charging) {
        flow = (flow + dt * 0.6) % 1;
        flowUniforms.phase.value = flow;
        flowUniforms.on.value = 1;
        if (cableMaterial.map) cableMaterial.map.offset.x = -flow;
        cableMaterial.emissive.setHex(0x60cfff);
        cableMaterial.emissiveIntensity = 0.6 + Math.sin(flow * Math.PI * 2) * 0.25;
      } else {
        flowUniforms.on.value = 0;
        cableMaterial.emissiveIntensity = 0;
      }
      if (flash) {
        flash.elapsed += dt;
        if (flash.elapsed >= flash.duration) { flash = null; onChange?.(); }
        applyLights();
      }
    },
  };
  applyLights();
  return api;
}
