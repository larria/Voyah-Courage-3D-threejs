import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { loadNpz } from './npz.js';

/* =========================================================
 * 全新岚图知音 · three.js 交互展示
 * 数据来源: 官方 Unity WebGL 包 (voyah-app-h37b) 提取的
 * 网格 / 层级 / 材质名,动画为 three.js 重实现
 * ========================================================= */

// ---------- 官方颜色 (官网实测 exteriorTab 代码 + 视觉采样) ----------
const PAINTS = [
  { code: 'QGJ', name: '香槟金', color: 0xb8a284 },
  { code: 'XYH', name: '玄英黑', color: 0x14161a },
  { code: 'JSH', name: '宸星灰', color: 0x5e6470 },
  { code: 'NUB', name: '杜若白', color: 0xd8dce0 },
  { code: 'XRH', name: '旭日红', color: 0x8c2430 },
  { code: 'SHL', name: '深海蓝', color: 0x1c3a5e },
  { code: 'HYB', name: '皓月白', color: 0xe9ecef },
];

// ---------- 基础渲染器 ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.localClippingEnabled = true;   // 车窗下降时裁剪门框线以下的玻璃
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f6f8);
scene.fog = new THREE.Fog(0xf5f6f8, 30, 80);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
camera.position.set(-8.5, 4.2, 9.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 4.5;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI * 0.52;
controls.target.set(0, 1, 0);

// ---------- 灯光 ----------
const hemi = new THREE.HemisphereLight(0xffffff, 0xd8dde4, 1.0);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(-8, 12, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -12; key.shadow.camera.right = 12;
key.shadow.camera.top = 12; key.shadow.camera.bottom = -12;
key.shadow.bias = -0.0004;
scene.add(key);

const rim = new THREE.DirectionalLight(0xffffff, 0.8);
rim.position.set(9, 6, -7);
scene.add(rim);

const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(2, 3, 10);
scene.add(fill);

// 车内补光(开门/开窗后内部可见,模拟室内灯)
const cabinLight = new THREE.PointLight(0xfff4e0, 0.35, 2.5, 2);
cabinLight.position.set(-0.3, 1.55, 0);
scene.add(cabinLight);

// ---------- 地面(日间浅灰) ----------
const groundGeo = new THREE.CircleGeometry(40, 64);
const groundMat = new THREE.MeshStandardMaterial({ color: 0xe4e7ec, roughness: 0.96, metalness: 0.0 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// 展台光环
const ringGeo = new THREE.RingGeometry(5.6, 5.75, 128);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x2b5ce6, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.012;
scene.add(ring);

// ---------- 材质库 (基于官方材质名重建 PBR) ----------
function makeMaterials(paintColor) {
  return {
    // 外观
    '外观_车漆': new THREE.MeshPhysicalMaterial({ color: paintColor, metalness: 0.35, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.06 }),
    '外观_亮黑': new THREE.MeshPhysicalMaterial({ color: 0x101216, metalness: 0.55, roughness: 0.22, clearcoat: 0.8 }),
    '外观_亮黑 1': new THREE.MeshPhysicalMaterial({ color: 0x15171c, metalness: 0.55, roughness: 0.28, clearcoat: 0.8 }),
    '外观_磨砂黑 2': new THREE.MeshStandardMaterial({ color: 0x1c1e22, metalness: 0.35, roughness: 0.62 }),
    '外观_亮金属': new THREE.MeshStandardMaterial({ color: 0xb9bfc9, metalness: 1.0, roughness: 0.25 }),
    '外观_雷達': new THREE.MeshPhysicalMaterial({ color: 0x0e0f12, metalness: 0.4, roughness: 0.15, clearcoat: 1 }),
    '外观_车牌': new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }),
    // 灯光 — 官方 EmissionColor (HDR) + 默认点亮状态(_LightColor2=1)
    // 大灯: BaseColor(0.522) Emission(1.02,1.35,2.80) Smoothness 0.78
    '外观_大灯_ON': new THREE.MeshStandardMaterial({ color: 0x858585, emissive: 0xf5f8ff, emissiveIntensity: 1.35, roughness: 0.22, metalness: 0.5 }),
    // 前脸灯幕(WG_Light_FDIAN): 白色 Emission(1.02,1.35,2.80) — 官网默认亮
    '外观_前灯_ON': new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf5f8ff, emissiveIntensity: 1.6, roughness: 0.22, metalness: 0.0 }),
    // 日行灯: BaseColor(0.216) Emission(2.18,2.90,5.99) — 高亮
    '外观_日行灯': new THREE.MeshStandardMaterial({ color: 0x373737, emissive: 0xffffff, emissiveIntensity: 2.0, roughness: 0.22, metalness: 0.3 }),
    '外观_日行灯转向灯': new THREE.MeshStandardMaterial({ color: 0x373737, emissive: 0xffffff, emissiveIntensity: 2.0, roughness: 0.2 }),
    '外观_转向灯示廓灯': new THREE.MeshStandardMaterial({ color: 0x878787, emissive: 0xff6600, emissiveIntensity: 0.0, roughness: 0.2 }),
    // 高位灯/下部红色灯件: 按参考图校正为红色,避免旧橙色发光值在色调映射后泛黄。
    '外观_尾灯': new THREE.MeshStandardMaterial({ color: 0x980008, emissive: 0xff0000, emissiveIntensity: 1.4, toneMapped: false, roughness: 0.25 }),
    // 中部贯穿尾灯保持相同红色光谱,关灯仍保留深红灯体。
    '外观_尾灯示廓灯': new THREE.MeshStandardMaterial({ color: 0x900008, emissive: 0xff0000, emissiveIntensity: 1.6, toneMapped: false, roughness: 0.25 }),
    '外观_尾灯Logo': new THREE.MeshStandardMaterial({ color: 0xbfbfbf, emissive: 0xff3344, emissiveIntensity: 0.8, roughness: 0.3 }),
    // 玻璃 — 官方 BaseColor + 反射 (IOR 1.52 / Smoothness 1.0)。
    // 官网视觉: 前排玻璃透明度高(反射天空为主,直视通透),后排隐私深色
    // 前门玻璃: 官方 RGB(22,33,45) — 高透视觉
    '3_玻璃_前门': new THREE.MeshPhysicalMaterial({ color: 0x2a3a4a, metalness: 0.0, roughness: 0.02, transmission: 0.78, transparent: true, opacity: 0.38, ior: 1.52, reflectivity: 0.55, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    // 前侧窗: 官方 RGB(27,29,38) — 高透视觉
    '3_玻璃_前车窗': new THREE.MeshPhysicalMaterial({ color: 0x2e3646, metalness: 0.0, roughness: 0.02, transmission: 0.78, transparent: true, opacity: 0.38, ior: 1.52, reflectivity: 0.55, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    // 前风挡: 官方 RGB(11,14,36) a=0.72 — 最透
    '3_玻璃_前车窗b': new THREE.MeshPhysicalMaterial({ color: 0x2a3348, metalness: 0.0, roughness: 0.01, transmission: 0.85, transparent: true, opacity: 0.28, ior: 1.52, reflectivity: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.3 }),
    // 后排/固定侧窗/天幕共用源材质;以下为 three.js 视觉校正值,不是 Unity alpha 的直接映射。
    '3_玻璃_后门': new THREE.MeshPhysicalMaterial({ color: 0x39404a, metalness: 0.0, roughness: 0.03, transmission: 0.34, transparent: true, opacity: 0.70, ior: 1.52, reflectivity: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    // 后挡保持略深,但避免低透射与高不透明度叠加成为黑板。
    '3_玻璃_后车窗': new THREE.MeshPhysicalMaterial({ color: 0x303640, metalness: 0.0, roughness: 0.03, transmission: 0.29, transparent: true, opacity: 0.75, ior: 1.52, reflectivity: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    // 车灯玻璃罩: 白色 alpha=0 — 纯透明高光
    '3_玻璃_车灯': new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.02, transparent: true, opacity: 0.22, ior: 1.52, reflectivity: 0.6, side: THREE.DoubleSide, envMapIntensity: 1.5 }),
    // 轮胎
    '轮胎_胎面': new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    '轮胎_纯黑': new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.88 }),
    '轮胎_暗金属': new THREE.MeshStandardMaterial({ color: 0x8f959e, metalness: 1.0, roughness: 0.35 }),
    // 内饰 — 官网"旭日红"主题: 米白座椅 + 红色拼色/安全带 + 深色顶棚地板
    // (官方 BaseColor 为深色基底×顶点色,此处按官网视觉效果取色)
    '内饰_浅色皮革 1': new THREE.MeshStandardMaterial({ color: 0xd1c7b5, roughness: 0.72, side: THREE.DoubleSide }),
    '内饰_亮色': new THREE.MeshStandardMaterial({ color: 0xb8b2a8, roughness: 0.55, side: THREE.DoubleSide }),
    '内饰_黑色': new THREE.MeshStandardMaterial({ color: 0x141519, roughness: 0.7, side: THREE.DoubleSide }),
    '内饰_皮革拼色 1': new THREE.MeshStandardMaterial({ color: 0x6e3238, roughness: 0.7, side: THREE.DoubleSide }),
    '内饰_地板': new THREE.MeshStandardMaterial({ color: 0x191b20, roughness: 0.92 }),
    '内飾_red': new THREE.MeshStandardMaterial({ color: 0x8c2630, roughness: 0.68, side: THREE.DoubleSide }),
    '内饰_安全带': new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.85, side: THREE.DoubleSide }),
    '内饰_頂棚': new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.95 }),
    '内饰_车门音箱': new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.85, side: THREE.DoubleSide }),
    '内饰_黑色塑料紋理': new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.85, side: THREE.DoubleSide }),
    '内饰_皮革色塑料紋理': new THREE.MeshStandardMaterial({ color: 0xa8a196, roughness: 0.8, side: THREE.DoubleSide }),
    '内饰_充电器纹理': new THREE.MeshStandardMaterial({ color: 0x34373e, roughness: 0.6, side: THREE.DoubleSide }),
    '内饰_拉丝金属': new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.9, roughness: 0.4 }),
    '内饰_屏幕': new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0x16223a, emissiveIntensity: 0.9, roughness: 0.2 }),
    // 充电线 / 道路
    'Charger_Head': new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 }),
    'Charger_line': new THREE.MeshStandardMaterial({ color: 0xd8b24a, roughness: 0.5 }),
    'Road': new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.95 }),
    'Inner': new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 1.0 }),
    'SD': new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9 }),
  };
}
const FALLBACK = new THREE.MeshStandardMaterial({ color: 0x606874, roughness: 0.6 });

// ---------- 加载几何 ----------
const assetBase = import.meta.env.BASE_URL;
const npz = await loadNpz(`${assetBase}meshes.npz`);
const sceneResp = await fetch(`${assetBase}scene.json`);
const sceneData = await sceneResp.json();

const loaderBar = document.getElementById('load-bar');
const loaderPct = document.getElementById('load-pct');
function setProgress(p) {
  loaderBar.style.width = `${Math.round(p * 100)}%`;
  loaderPct.textContent = `${Math.round(p * 100)}%`;
}
setProgress(0.6);

// ---------- 构建整车 ----------
const carRoot = new THREE.Group();   // 整车(行驶时移动)
scene.add(carRoot);

const named = {};      // 节点名 -> THREE.Group (动画锚点)
const paintTargets = [];  // 车漆网格列表
const emissiveTargets = { headlight: [], taillight: [], drl: [] };

// 车窗玻璃裁剪平面: 低于门板窗框线的玻璃被裁掉(开窗时玻璃"降入门内"而不外露)
// 窗框线 = 门板上沿(前门 1.28 / 后门 1.31, 留密封条余量)
const glassClipPlanes = {
  front: new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.28),   // 保留 y > 1.28
  rear: new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.18),    // 裁剪线藏入门板,避免残留玻璃与窗沿之间悬空
};

function buildMesh(meshName, materials) {
  const key = meshName.replace('/', '_');
  const v = npz[`${key}_v`];
  if (!v) return null;
  const n = npz[`${key}_n`];
  const uv = npz[`${key}_uv`];
  const group = new THREE.Group();
  let si = 0;
  while (npz[`${key}_i${si}`] !== undefined) {
    const idx = npz[`${key}_i${si}`];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    if (n && n.length === v.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    if (uv && uv.length * 3 === v.length * 2) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // 索引位宽由顶点编号决定,不能按当前子网格的索引数量判断。
    // 前标识与日行灯共用材质槽,但标识不能随灯光开关熄灭。
    const emblemIndices = [], lightIndices = [];
    if (meshName === 'Light_RXD_F') {
      for (let i = 0; i < idx.length; i += 3) {
        const isEmblem = [idx[i], idx[i + 1], idx[i + 2]].every(j => Math.abs(v[j * 3 + 2]) < 0.06);
        (isEmblem ? emblemIndices : lightIndices).push(idx[i], idx[i + 1], idx[i + 2]);
      }
    }
    geo.setIndex(new THREE.BufferAttribute(emblemIndices.length ? new idx.constructor(lightIndices) : idx, 1));
    if (!n || n.length !== v.length) geo.computeVertexNormals();
    const matName = materials[si]?.name;
    let mat = matLibrary[matName] ?? FALLBACK;
    // 尾门第7槽为右下方小标识,与尾灯共用源材质,但不是发光灯件。
    const isRearBadge = meshName === 'TURNK_003' && si === 7;
    if (isRearBadge) mat = new THREE.MeshPhysicalMaterial({ color: 0xb71925, roughness: 0.32, metalness: 0, clearcoat: 0.65 });
    // ADS 白色字面包含在第6槽金属饰件中,按底牌范围分离,保留其它镀铬字标。
    let badgeLetters = null;
    if (meshName === 'TURNK_003' && si === 6) {
      const badge = npz[`${key}_i7`];
      const minY = Math.min(...Array.from(badge, j => v[j * 3 + 1])) - 0.003;
      const maxY = Math.max(...Array.from(badge, j => v[j * 3 + 1])) + 0.003;
      const minZ = Math.min(...Array.from(badge, j => v[j * 3 + 2])) - 0.003;
      const maxZ = Math.max(...Array.from(badge, j => v[j * 3 + 2])) + 0.003;
      const letters = [], trim = [];
      for (let i = 0; i < idx.length; i += 3) {
        const triangle = [idx[i], idx[i + 1], idx[i + 2]];
        const onBadge = triangle.every(j => v[j * 3 + 1] >= minY && v[j * 3 + 1] <= maxY && v[j * 3 + 2] >= minZ && v[j * 3 + 2] <= maxZ);
        (onBadge ? letters : trim).push(...triangle);
      }
      badgeLetters = geo.clone();
      badgeLetters.setIndex(new THREE.BufferAttribute(new idx.constructor(letters), 1));
      geo.setIndex(new THREE.BufferAttribute(new idx.constructor(trim), 1));
    }
    // 记录动画目标
    if (matName === '外观_车漆') paintTargets.push({ mesh: null, geoSub: si });
    if (matName === '外观_大灯_ON' || matName === '外观_前灯_ON' || matName === '外观_日行灯' || matName === '外观_日行灯转向灯') emissiveTargets.headlight.push(matName);
    if (matName?.startsWith('外观_尾灯')) emissiveTargets.taillight.push(matName);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 车窗玻璃: 启用裁剪(材质克隆以免影响其他共享件)
    if (matName === '3_玻璃_前门' || matName === '3_玻璃_前车窗' || matName === '3_玻璃_后门') {
      const isFrontGlass = matName !== '3_玻璃_后门';
      mesh.material = mat.clone();
      mesh.material.clippingPlanes = [isFrontGlass ? glassClipPlanes.front : glassClipPlanes.rear];
      mesh.material.clipShadows = true;
    }
    if (matName === '外观_车漆') paintTargets[paintTargets.length - 1].mesh = mesh;
    group.add(mesh);
    if (badgeLetters) {
      const letters = new THREE.Mesh(badgeLetters, new THREE.MeshStandardMaterial({ color: 0xf3f3ef, roughness: 0.45, metalness: 0 }));
      letters.castShadow = true;
      letters.receiveShadow = true;
      group.add(letters);
    }
    if (emblemIndices.length) {
      const emblemGeo = geo.clone();
      emblemGeo.setIndex(new THREE.BufferAttribute(new idx.constructor(emblemIndices), 1));
      const emblem = new THREE.Mesh(emblemGeo, new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xffffff, emissiveIntensity: 2.0, metalness: 0.1, roughness: 0.32 }));
      emblem.castShadow = true;
      emblem.receiveShadow = true;
      group.add(emblem);
    }
    si++;
  }
  return group;
}

let matLibrary = makeMaterials(PAINTS[0].color);
const builtNodes = {};

// 使用导出记录中的贴图引用;共享图集依靠各网格 UV 选取区域。
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
for (const node of sceneData.nodes) {
  for (const source of node.materials) {
    const material = matLibrary[source.name];
    if (!source.texture || !material || material.map) continue;
    let texture = textureCache.get(source.texture);
    if (!texture) {
      texture = await textureLoader.loadAsync(`${assetBase}textures/${encodeURIComponent(source.texture)}`);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = true;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      textureCache.set(source.texture, texture);
    }
    material.map = texture;
    if (source.name === '内饰_屏幕') {
      material.color.setHex(0xffffff);
      material.emissive.setHex(0xffffff);
      material.emissiveMap = texture;
      material.emissiveIntensity = 0.3;
      material.roughness = 0.65;
    }
    material.needsUpdate = true;
  }
}

// Unity 场景辅助网格(遮罩球/平面阴影/路面标线/充电线),日间展示中隐藏,由 three.js 场景替代
const HIDDEN_SCENE_NODES = new Set(['SD', 'Line', 'Line#2', 'mesh', 'Charger_LINE', 'Shape001']);

for (const node of sceneData.nodes) {
  const g = buildMesh(node.mesh, node.materials);
  if (!g) continue;
  // 矩阵已在导出时完成 Unity->three 坐标转换 (z 取反 + 绕序反转), 直接使用
  const M = new THREE.Matrix4();
  M.set(
    node.matrix[0][0], node.matrix[0][1], node.matrix[0][2], node.matrix[0][3],
    node.matrix[1][0], node.matrix[1][1], node.matrix[1][2], node.matrix[1][3],
    node.matrix[2][0], node.matrix[2][1], node.matrix[2][2], node.matrix[2][3],
    node.matrix[3][0], node.matrix[3][1], node.matrix[3][2], node.matrix[3][3]
  );
  g.matrixAutoUpdate = false;
  g.matrix.copy(M);
  g.matrixWorldNeedsUpdate = true;
  carRoot.add(g);
  if (HIDDEN_SCENE_NODES.has(node.name)) g.visible = false;
  if (!builtNodes[node.name]) builtNodes[node.name] = g;
  else { // 重名 GO (左右门共用 mesh 名): 用 mesh+index 唯一化
    let i = 2;
    while (builtNodes[`${node.name}#${i}`]) i++;
    builtNodes[`${node.name}#${i}`] = g;
    node.name = `${node.name}#${i}`;
  }
}
setProgress(0.85);

/* =========================================================
 * 动画系统: 依据官方 API 结构 (triggerDoorLF/LB/RF/RB,
 * triggerDoorWindow*, triggerTrunk, setWheelRoll,
 * carDrivingStatus) 在 three.js 中重实现
 * ========================================================= */

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ---- 门锚点: 找到 Door_LF/Door_RF/Door_LB/Door_RB 组 ----
// 场景树中四个门组各自包含门板+玻璃子件,开门 = 绕铰链旋转
// 我们直接操作对应 GO 组的局部矩阵
function findDoorGroups() {
  // scene.json 的 name 是 GO 名;门组的 mesh 名集合在 Door_LB/Door_RB/Door_RF/Door_LF 下
  // 由于导出时每个 mesh 是独立节点,我们按节点 name 分组(Door 组名即 GO 名)
  const groups = {};
  // 从 sceneData 里无法拿到父子 — 但矩阵已经烘进世界坐标。
  // 改用几何包围盒估计门位置,直接构建旋转锚点。
  return groups;
}

// ---- 自建动画锚点(基于世界包围盒定位) ----
function nodeBBox(obj) {
  const box = new THREE.Box3();
  obj.traverse(o => { if (o.isMesh) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); box.union(b); } });
  return box;
}

// 找到网格节点: 门板/玻璃 mesh 名 -> GO
const doorParts = {
  LF: { panel: 'DOOL_L_F_001', trim: ['DOOL_L_F_002', 'DOOL_L_F_005', 'DOOL_R_F_004', 'DOOL_L_F_003', 'DOOR_HSJ'], glass: 'DOOL_L_F_GLASS', hinge: new THREE.Vector3() },
  RF: { panel: 'DOOL_R_F_004', trim: [], glass: null, hinge: new THREE.Vector3() },
  LB: { panel: 'DOOL_L_B_001', trim: ['DOOL_L_B_002', 'DOOL_L_B_003'], glass: 'DOOL_L_B_GLASS', hinge: new THREE.Vector3() },
  RB: { panel: 'DOOL_L_B_002', trim: [], glass: null, hinge: new THREE.Vector3() },
};

// scene.json 中每条记录 = 一个 GO 实例(含已转换的世界矩阵)
// builtNodes 键已做重名唯一化 (name#N),instances 与 sceneData.nodes 一一对应
const instances = sceneData.nodes.map((n, i) => {
  const key = n.name;
  return { name: key, mesh: n.mesh, obj: builtNodes[key] || null };
});

// ---------- 门分组(基于世界包围盒, three 坐标) ----------
// 车头朝 -x, 车长 x∈(-2.74,2.03); 侧向 z: 左 z>0, 右 z<0 (three.z = -unity.z)
const doorGroups = { LF: [], RF: [], LB: [], RB: [] };
for (const inst of instances) {
  if (!inst.obj) continue;
  const m = inst.mesh;
  // 全部门件(含 DOOL_R_F_004 门把手内侧饰板 — 注意 R 前缀也要匹配)
  const isDoorPart = /^DOOL_[LR]_[FB]_/.test(m) || m === 'DOOR_HSJ';
  if (!isDoorPart) continue;
  inst.obj.updateMatrixWorld();
  const b = new THREE.Box3().setFromObject(inst.obj);
  if (b.isEmpty()) continue;
  const c = b.getCenter(new THREE.Vector3());
  const side = c.z > 0.2 ? 'L' : c.z < -0.2 ? 'R' : null;
  const front = c.x < -0.35 ? 'F' : 'B';   // 前门件中心 x≈-0.78, 后门件中心 x≈+0.3
  if (!side) continue;
  const key = side + front;
  if (doorGroups[key]) doorGroups[key].push(inst);
}

// 车门开合状态机
const doorState = { LF: 0, RF: 0, LB: 0, RB: 0 };  // 0..1
const windowState = { LF: 0, RF: 0, LB: 0, RB: 0 };
const trunkState = { v: 0 };
let doorSpeed = 1.0;   // 官方实测 2.0s 全程

// 每门的动画: 绕竖直轴(three Y 轴)旋转 = 常规顺开门(左右开)
// 车头朝 -x。铰链在门的前缘(x 小端),左侧门向 +z 外摆,右侧门向 -z 外摆
const doorAnim = {};
for (const [k, insts] of Object.entries(doorGroups)) {
  if (!insts.length) continue;
  const box = new THREE.Box3();
  for (const inst of insts) {
    inst.obj.updateMatrixWorld();
    const b = new THREE.Box3().setFromObject(inst.obj);
    box.union(b);
  }
  const center = box.getCenter(new THREE.Vector3());
  const isLeft = k[0] === 'L';
  // 铰链: 竖直轴,在门的前缘(x 小端 = A柱/B柱处)、车身侧面(门板厚中心 z≈±0.90)
  const hinge = new THREE.Vector3(box.min.x + 0.04, center.y, isLeft ? 0.90 : -0.90);
  doorAnim[k] = { insts, hinge, base: insts.map(i => i.obj.matrix.clone()), box, isLeft, cur: 0, winCur: 0 };
}
setProgress(0.95);

// ---------- 车轮 ----------
const wheelInstances = instances.filter(i => i.obj && (i.mesh === 'Trie_A' || i.mesh === 'Trie_B'));
// 轮胎旋转: 行驶时绕轮轴(three Z 轴)滚动
// 右侧轮实例含 z 镜像 (det<0),但镜像轴 = 轮轴方向,z-flip 不改变 xy 轮平面内的旋转方向 → 四轮同号即可
const wheels = wheelInstances.map(i => ({ obj: i.obj, mesh: i.mesh, base: i.obj.matrix.clone(), center: new THREE.Vector3().setFromMatrixPosition(i.obj.matrix), spin: 0 }));

// ---------- 后备箱 ----------
const trunkInstances = instances.filter(i => i.obj && ['TURNK_003', 'TURNK_GLASS', 'TURNK_Light_GLASS', 'TURRNK_SKD_B', 'CHEPEI_02', 'LaGan_000', 'LaGan_001'].includes(i.mesh));
let trunkBase = null, trunkPivot = null;
if (trunkInstances.length) {
  const box = new THREE.Box3();
  for (const inst of trunkInstances) {
    inst.obj.updateMatrixWorld();
    box.union(new THREE.Box3().setFromObject(inst.obj));
  }
  // SUV 尾门: 绕后风窗顶边铰链线(实测 TURNK_GLASS 顶边 x≈1.30, y≈1.63)向外上掀
  // 用玻璃网格顶边精确定位铰链,而非整个后备箱包围盒(避免牌照等低件干扰)
  const glassInst = trunkInstances.find(i => i.mesh === 'TURNK_GLASS');
  let pivotY = box.max.y - 0.06, pivotX = box.min.x + 0.17;
  if (glassInst) {
    const gb = new THREE.Box3().setFromObject(glassInst.obj);
    pivotY = gb.max.y - 0.02;   // 玻璃顶边
    pivotX = gb.min.x + 0.01;   // 顶边靠车内一侧(x 小端)
  }
  trunkPivot = new THREE.Vector3(pivotX, pivotY, (box.min.z + box.max.z) / 2);
  trunkBase = trunkInstances.map(i => i.obj.matrix.clone());
}

// ---------- 行驶系统 ----------
let driving = false;
let driveSpeed = 1.0;
let driveDist = 0;

// 路面虚线
const dashes = [];
{
  const dashGeo = new THREE.PlaneGeometry(1.4, 0.18);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xc3c9d3 });
  for (let i = 0; i < 26; i++) {
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(i * 3.2 - 40, 0.013, 0);
    scene.add(d);
    dashes.push(d);
  }
}

/* =========================================================
 * UI
 * ========================================================= */
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

// --- 颜色 ---
const colorsEl = document.getElementById('colors');
let activePaint = 0;
PAINTS.forEach((p, i) => {
  const chip = document.createElement('div');
  chip.className = 'color-chip' + (i === 0 ? ' active' : '');
  chip.style.background = `radial-gradient(circle at 32% 30%, #fff3 0%, transparent 42%), #${p.color.toString(16).padStart(6, '0')}`;
  chip.innerHTML = `<span class="name">${p.name}</span>`;
  chip.onclick = () => {
    activePaint = i;
    document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    applyPaint(p);
    toast(`外观颜色 · ${p.name}`);
  };
  colorsEl.appendChild(chip);
});

// --- 内饰主题 (官方 interior: R旭日红 / P深海蓝 / Q皓月白) ---
const INTERIORS = [
  { code: 'R', name: '旭日红', leather: 0xd1c7b5, accent: 0x6e3238, red: 0x8c2630, belt: 0x6e2429 },
  { code: 'P', name: '深海蓝', leather: 0x46596e, accent: 0x253b54, red: 0x28405e, belt: 0x24344a },
  { code: 'Q', name: '皓月白', leather: 0xe2ddd4, accent: 0xb8b2a8, red: 0xa8a29a, belt: 0x8e8a82 },
];
const interiorsEl = document.createElement('div');
interiorsEl.className = 'btns';
interiorsEl.style.marginTop = '10px';
colorsEl.parentNode.insertBefore(interiorsEl, colorsEl.nextSibling);
let activeInterior = 0;
INTERIORS.forEach((it, i) => {
  const b = mkBtn(interiorsEl, it.name, () => {
    activeInterior = i;
    interiorsEl.querySelectorAll('.btn').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const l = matLibrary;
    const fade = (mat, hex) => { const from = mat.color.clone(), to = new THREE.Color(hex); const t0 = performance.now();
      (function step(now){ const t = clamp((now - t0) / 400, 0, 1); mat.color.copy(from).lerp(to, t); if (t < 1) requestAnimationFrame(step); })(performance.now()); };
    fade(l['内饰_浅色皮革 1'], it.leather);
    fade(l['内饰_亮色'], it.leather);
    fade(l['内饰_皮革拼色 1'], it.accent);
    fade(l['内飾_red'], it.red);
    // 安全带固定深灰,融入 B 柱内饰
    // (官方安全带几何为 B 柱卷绕带,随主题变色会显得突兀)
    fade(l['内饰_皮革色塑料紋理'], it.leather);
    toast(`内饰 · ${it.name}`);
  }, 'small');
  if (i === 0) {
    b.classList.add('on');
    matLibrary['内饰_亮色'].color.setHex(it.leather);
    matLibrary['内饰_皮革色塑料紋理'].color.setHex(it.leather);
  }
});

// --- 轮毂 (官方 setWheelType: Trie_A/Trie_B 两款, 四轮同步切换) ---
let activeWheel = 0;
const WHEELS = [
  { name: '低风阻轮毂', mesh: 'Trie_A' },
  { name: '运动轮毂', mesh: 'Trie_B' },
];
const wheelsEl = document.createElement('div');
wheelsEl.className = 'btns';
wheelsEl.style.marginTop = '10px';
colorsEl.parentNode.insertBefore(wheelsEl, interiorsEl.nextSibling);
WHEELS.forEach((w, i) => {
  const b = mkBtn(wheelsEl, w.name, () => {
    activeWheel = i;
    wheelsEl.querySelectorAll('.btn').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    for (const wl of wheels) {
      wl.obj.visible = wl.mesh === w.mesh;
    }
    toast(`轮毂 · ${w.name}`);
  }, 'small');
  if (i === 0) b.classList.add('on');
});
// 初始: 只显示 Trie_A
for (const wl of wheels) wl.obj.visible = wl.mesh === 'Trie_A';

function applyPaint(p) {
  const mat = matLibrary['外观_车漆'];
  const target = new THREE.Color(p.color);
  // 渐变过渡
  const from = mat.color.clone();
  const t0 = performance.now();
  function step(now) {
    const t = clamp((now - t0) / 450, 0, 1);
    mat.color.copy(from).lerp(target, t);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// --- 按钮 ---
function mkBtn(parent, label, onclick, cls = '') {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.onclick = onclick;
  parent.appendChild(b);
  return b;
}

const doorsEl = document.getElementById('doors');
const btnOpenAll = mkBtn(doorsEl, '全部开门', () => {
  const target = !(doorState.LF > 0.5) ? 1 : 0;
  Object.keys(doorState).forEach(k => doorState[k] = target);
  updateDoorBtns();
});
const btnTrunk = mkBtn(doorsEl, '后备箱', () => {
  trunkState.v = trunkState.v > 0.5 ? 0 : 1;
  btnTrunk.classList.toggle('on', trunkState.v > 0.5);
});
const btnWinAll = mkBtn(doorsEl, '全部车窗', () => {
  const target = !(windowState.LF > 0.5) ? 1 : 0;
  Object.keys(windowState).forEach(k => windowState[k] = target);
  updateWinBtns();
});
const btnReset = mkBtn(doorsEl, '复位', () => {
  Object.keys(doorState).forEach(k => doorState[k] = 0);
  Object.keys(windowState).forEach(k => windowState[k] = 0);
  trunkState.v = 0;
  updateAllBtns();
  resetLights();
  toast('已复位');
});

// 单门按钮
mkBtn(doorsEl, '左前门', () => toggleDoor('LF'), 'small');
mkBtn(doorsEl, '右前门', () => toggleDoor('RF'), 'small');
mkBtn(doorsEl, '左后门', () => toggleDoor('LB'), 'small');
mkBtn(doorsEl, '右后门', () => toggleDoor('RB'), 'small');
mkBtn(doorsEl, '左前窗', () => toggleWin('LF'), 'small');
mkBtn(doorsEl, '右前窗', () => toggleWin('RF'), 'small');
mkBtn(doorsEl, '左后窗', () => toggleWin('LB'), 'small');
mkBtn(doorsEl, '右后窗', () => toggleWin('RB'), 'small');

function toggleDoor(k) { doorState[k] = doorState[k] > 0.5 ? 0 : 1; updateDoorBtns(); }
function toggleWin(k) { windowState[k] = windowState[k] > 0.5 ? 0 : 1; updateWinBtns(); }
function updateDoorBtns() { btnOpenAll.classList.toggle('on', doorState.LF > 0.5); }
function updateWinBtns() { btnWinAll.classList.toggle('on', windowState.LF > 0.5); }
function updateAllBtns() { updateDoorBtns(); updateWinBtns(); btnTrunk.classList.remove('on'); }
// 灯光复位恢复默认点亮
function resetLights() {
  lightsOn = true;
  btnLights.classList.add('on');
  for (const mn of emissiveTargets.headlight) matLibrary[mn].emissiveIntensity = LIGHT_ON[mn];
  for (const mn of emissiveTargets.taillight) matLibrary[mn].emissiveIntensity = LIGHT_ON[mn];
}

// --- 灯光/行驶 (官网默认: 灯幕/日行灯/尾灯常亮, 可开关) ---
const driveEl = document.getElementById('drive');
let lightsOn = true, drlOn = true;   // 官方 _LightColor2=1 默认点亮
const LIGHT_ON = Object.fromEntries([...new Set([...emissiveTargets.headlight, ...emissiveTargets.taillight])].map(name => [name, matLibrary[name].emissiveIntensity]));
const LIGHT_OFF = { headlight: 0, taillight: 0, drl: 0 };
const btnLights = mkBtn(driveEl, '灯光', () => {
  lightsOn = !lightsOn;
  btnLights.classList.toggle('on', lightsOn);
  for (const mn of emissiveTargets.headlight) matLibrary[mn].emissiveIntensity = lightsOn ? LIGHT_ON[mn] : 0;
  for (const mn of emissiveTargets.taillight) matLibrary[mn].emissiveIntensity = lightsOn ? LIGHT_ON[mn] : 0;
  toast(lightsOn ? '灯光已开启' : '灯光已关闭');
});
btnLights.classList.add('on');
const btnDrive = mkBtn(driveEl, '行驶', () => {
  driving = !driving;
  btnDrive.classList.toggle('on', driving);
  if (driving && !lightsOn) btnLights.click();
  toast(driving ? '行驶中 · 拖动鼠标可环绕视角' : '已停车');
});

// 速度滑条
const speedRow = document.createElement('div');
speedRow.className = 'speed-row';
speedRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:10px;width:100%';
speedRow.innerHTML = `<span style="color:#7f8ea3;font-size:11px;letter-spacing:2px">车速</span><input type="range" min="0.2" max="3" step="0.1" value="1" id="speed"><span class="val" id="speed-val">1.0x</span>`;
driveEl.appendChild(speedRow);
const speedInput = speedRow.querySelector('#speed');
const speedVal = speedRow.querySelector('#speed-val');
speedInput.oninput = () => { driveSpeed = parseFloat(speedInput.value); speedVal.textContent = driveSpeed.toFixed(1) + 'x'; };

// --- 视角 ---
const viewsEl = document.getElementById('views');
const VIEWS = {
  '前侧': { pos: [-8.5, 4.2, 9.5], tgt: [0, 1, 0] },
  '正前': { pos: [-13, 2.2, 0.01], tgt: [0, 1.1, 0] },
  '侧身': { pos: [0.01, 2.2, 12.5], tgt: [0, 1.1, 0] },
  '后45°': { pos: [9.5, 4.0, 8.5], tgt: [0, 1, 0] },
  '俯瞰': { pos: [-2, 13, 7], tgt: [0, 0.5, 0] },
  '内饰': { pos: [-0.35, 1.45, 0], tgt: [-1.35, 1.1, 0] },
};
let viewTween = null;
for (const [name, v] of Object.entries(VIEWS)) {
  mkBtn(viewsEl, name, () => {
    controls.minDistance = name === '内饰' ? 0.4 : 4.5;
    viewTween = {
      t: 0,
      fromP: camera.position.clone(), toP: new THREE.Vector3(...v.pos),
      fromT: controls.target.clone(), toT: new THREE.Vector3(...v.tgt),
    };
    toast(`视角 · ${name}`);
  }, 'small');
}

setProgress(1);
setTimeout(() => document.getElementById('loader').classList.add('hide'), 400);

/* =========================================================
 * 渲染循环
 * ========================================================= */
// 调试暴露
window.__carDebug = { scene, carRoot, instances, doorAnim, doorGroups, wheels, trunkInstances, matLibrary, camera, controls };

const clock = new THREE.Clock();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const rotM = new THREE.Matrix4();
const transM = new THREE.Matrix4();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // 平滑插值: 门/窗/后备箱
  // 官方动画实测(原版 Unity WASM 桥 phase 采样): 门/窗均为 0→2 线性插值,恒定 2.0s,无缓动
  // 门窗联动管线: 每帧从"装配基准矩阵"重新组合 = 门旋转 ∘ 窗下降,避免两路动画互相覆盖
  const spd = doorSpeed;
  for (const k of Object.keys(doorState)) {
    const anim = doorAnim[k];
    if (!anim) continue;
    // --- 门旋转进度(线性 2.0s) ---
    const sideSign = k[0] === 'L' ? -1 : 1;
    const doorTarget = doorState[k] * THREE.MathUtils.degToRad(65) * sideSign;
    anim.cur += Math.sign(doorTarget - anim.cur) * Math.min(Math.abs(doorTarget - anim.cur), dt * spd * 0.5 * (Math.PI * 65 / 180));
    // --- 车窗下降进度(线性 2.0s) ---
    const winTarget = windowState[k];
    anim.winCur += Math.sign(winTarget - anim.winCur) * Math.min(Math.abs(winTarget - anim.winCur), dt * spd * 0.5);
    const isRear = k[1] === 'B';
    // 后窗可见高度约0.374m,保留约1/5(0.075m),避免裁剪后仅剩顶边。
    const maxDrop = isRear ? 0.30 : 0.45;
    const drop = anim.winCur * maxDrop;

    // --- 组合应用: 每件 = 门旋转 × (窗下降 × 装配基准) ---
    transM.makeTranslation(anim.hinge.x, anim.hinge.y, anim.hinge.z);
    rotM.makeRotationY(anim.cur);
    const doorMat = tmpM.copy(transM).multiply(rotM).multiply(transM.clone().invert()); // T·R·T⁻¹
    for (let i = 0; i < anim.insts.length; i++) {
      const inst = anim.insts[i];
      const obj = inst.obj;
      // 玻璃: 先在门坐标系内下降,再随门旋转
      if (inst.mesh.includes('GLASS')) {
        // 后玻璃向内倾斜约21°,下降须沿玻璃平面向外补偿,再随门旋转。
        // 前沿 x 随高度约增加0.11m/m;下降时向车头补偿,维持与B柱导槽贴合。
        const forward = isRear ? -drop * 0.11 : 0;
        const outward = isRear ? drop * (0.387 - 0.02346 * 0.11) * (k[0] === 'L' ? 1 : -1) : 0;
        const down = new THREE.Matrix4().makeTranslation(forward, -drop, outward);
        obj.matrix.copy(doorMat).multiply(down).multiply(anim.base[i]);
      } else {
        obj.matrix.copy(doorMat).multiply(anim.base[i]);
      }
      obj.matrixWorldNeedsUpdate = true;
    }
  }

  // 后备箱: 尾门绕侧向轴(three Z 轴)上掀 — 电动尾门节奏 ~2.4s 全开
  if (trunkBase) {
    const cur = trunkAnim.cur;
    const next = cur + Math.sign(trunkState.v - cur) * Math.min(Math.abs(trunkState.v - cur), dt * 0.42);
    trunkAnim.cur = next;
    const ang = next * THREE.MathUtils.degToRad(76);
    rotM.makeRotationZ(ang);
    transM.makeTranslation(trunkPivot.x, trunkPivot.y, trunkPivot.z);
    tmpM.copy(transM).multiply(rotM).multiply(transM.clone().invert());
    for (let i = 0; i < trunkInstances.length; i++) {
      trunkInstances[i].obj.matrix.copy(tmpM).multiply(trunkBase[i]);
      trunkInstances[i].obj.matrixWorldNeedsUpdate = true;
    }
  }

  // 行驶: 车轮绕侧向轴(three Z 轴)滚动, 道路沿 X 循环
  if (driving) {
    driveDist += dt * driveSpeed * 9;
    for (const w of wheels) {
      w.spin += dt * driveSpeed * 9;
      rotM.makeRotationZ(w.spin);
      transM.makeTranslation(w.center.x, w.center.y, w.center.z);
      tmpM.copy(transM).multiply(rotM).multiply(transM.clone().invert());
      w.obj.matrix.copy(tmpM).multiply(w.base);
      w.obj.matrixWorldNeedsUpdate = true;
    }
    for (const d of dashes) {
      d.position.x -= dt * driveSpeed * 9;
      if (d.position.x < -42) d.position.x += 83.2;
    }
    carRoot.position.y = Math.sin(t * 0.6) * 0.008;
    ring.material.opacity = 0.2 + Math.sin(t * 2.4) * 0.08;
  } else {
    carRoot.position.y = 0;
    ring.material.opacity = 0.35;
  }

  // 视角补间
  if (viewTween) {
    viewTween.t = clamp(viewTween.t + dt / 0.9, 0, 1);
    const e = 1 - Math.pow(1 - viewTween.t, 3);
    camera.position.lerpVectors(viewTween.fromP, viewTween.toP, e);
    controls.target.lerpVectors(viewTween.fromT, viewTween.toT, e);
    if (viewTween.t >= 1) viewTween = null;
  }

  controls.update();
  renderer.render(scene, camera);
}

const trunkAnim = { cur: 0 };
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
