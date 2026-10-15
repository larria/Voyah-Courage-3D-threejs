// 极简 NPZ 读取器: 支持 Python numpy savez_compressed 输出
// 仅加载 float32 / uint16 / uint32 数组 (本项目所需)
import * as pako from 'pako';

export async function loadNpz(url) {
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(buf.buffer);
  const decoder = new TextDecoder();

  // ZIP 定位: End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('NPZ: EOCD not found');
  const entryCount = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);

  const out = {};
  for (let e = 0; e < entryCount; e++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOff = view.getUint32(ptr + 42, true);
    const name = decoder.decode(buf.slice(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    // local header
    const lhNameLen = view.getUint16(localOff + 26, true);
    const lhExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    const raw = method === 0 ? comp : pako.inflateRaw(comp);

    // .npy 解析
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (dv.getUint32(0, false) !== 0x4e495559 /* "\x93NUM" magic-ish check below */) {}
    // magic: \x93NUMPY
    const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
    let ok = true;
    for (let i = 0; i < 6; i++) if (raw[i] !== magic[i]) ok = false;
    if (!ok) continue;
    const major = raw[6], minor = raw[7];
    let hlen = dv.getUint16(8, true);
    let off = 10;
    if (major >= 2) { hlen = dv.getUint32(8, true); off = 12; }
    const header = decoder.decode(raw.slice(off, off + hlen));
    const m = header.match(/'descr':\s*'([<>|])([a-z0-9]+)'/);
    const shapeM = header.match(/'shape':\s*\(([^)]*)\)/);
    if (!m || !shapeM) continue;
    const endian = m[1] === '<' ? true : false; // little
    const type = m[2];
    const shape = shapeM[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const count = shape.reduce((a, b) => a * b, 1);
    const dataOff = off + hlen;
    let arr;
    if (type === 'f4') {
      arr = new Float32Array(count);
      for (let i = 0; i < count; i++) arr[i] = dv.getFloat32(dataOff + i * 4, true);
    } else if (type === 'i8' || type === 'u4' || type === 'i4') {
      arr = new Uint32Array(count);
      for (let i = 0; i < count; i++) arr[i] = dv.getUint32(dataOff + i * 4, true);
    } else if (type === 'u2' || type === 'i2') {
      arr = new Uint16Array(count);
      for (let i = 0; i < count; i++) arr[i] = dv.getUint16(dataOff + i * 2, true);
    } else if (type === 'u1' || type === 'i1') {
      arr = new Uint8Array(count);
      for (let i = 0; i < count; i++) arr[i] = raw[dataOff + i];
    } else {
      continue;
    }
    out[name.replace(/\.npy$/, '')] = arr;
  }
  return out;
}
