# /// script
# requires-python = ">=3.10"
# dependencies = ["UnityPy", "numpy", "Pillow"]
# ///
import UnityPy, struct, json, os
import numpy as np
from PIL import Image
from pathlib import Path

# 输入和输出相对项目根目录,不依赖启动脚本的工作目录。
os.chdir(Path(__file__).resolve().parents[1])
env = UnityPy.load("unity-player/Build/ZY.data")

def quat_to_mat(q):
    x,y,z,w = q
    return np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w),   2*(x*z+y*w),   0],
        [2*(x*y+z*w),   1-2*(x*x+z*z), 2*(y*z-x*w),   0],
        [2*(x*z-y*w),   2*(y*z+x*w),   1-2*(x*x+y*y), 0],
        [0,0,0,1]], dtype=np.float64)

def trs_mat(p,q,s):
    M = quat_to_mat(q)
    M[:3,0]*=s[0]; M[:3,1]*=s[1]; M[:3,2]*=s[2]
    M[0,3],M[1,3],M[2,3] = p
    return M

# ---------- level0 场景 ----------
lvl = {}
for obj in env.objects:
    if obj.assets_file and obj.assets_file.name == "level0":
        lvl.setdefault(obj.type.name, {})[obj.path_id] = obj

trs, gos = {}, {}
for pid, obj in lvl["Transform"].items():
    d = obj.read()
    trs[pid] = dict(
        go=d.m_GameObject.path_id,
        father=d.m_Father.path_id if d.m_Father.path_id else 0,
        m=trs_mat(
            (d.m_LocalPosition.x, d.m_LocalPosition.y, d.m_LocalPosition.z),
            (d.m_LocalRotation.x, d.m_LocalRotation.y, d.m_LocalRotation.z, d.m_LocalRotation.w),
            (d.m_LocalScale.x, d.m_LocalScale.y, d.m_LocalScale.z)))
for pid, obj in lvl["GameObject"].items():
    gos[pid] = obj.read().m_Name

# MeshFilter (go -> mesh obj 跨文件 deref)
go_mesh = {}
for pid, obj in lvl.get("MeshFilter", {}).items():
    d = obj.read()
    go_mesh[d.m_GameObject.path_id] = d.m_Mesh.deref()

# MeshRenderer (go -> [material obj])
go_mats = {}
for pid, obj in lvl.get("MeshRenderer", {}).items():
    d = obj.read()
    go_mats[d.m_GameObject.path_id] = [mm.deref() for mm in getattr(d, "m_Materials", [])]

# ---------- 解析 mesh ----------
def parse_mesh(m):
    vd = m.m_VertexData
    vc = vd.m_VertexCount
    strides = {0:4, 2:1}
    ch_info = [(ch.stream, ch.offset, ch.format, ch.dimension) for ch in vd.m_Channels if ch.dimension]
    max_off = {}
    for s,off,fmt,dim in ch_info:
        max_off[s] = max(max_off.get(s,0), off+strides.get(fmt,4)*dim)
    data = bytes(vd.m_DataSize)
    try:
        st = vd.m_Streams
        stride = st[0].stride if st and st[0].stride else 0
    except Exception:
        stride = 0
    if not stride: stride = max_off.get(0,48)
    verts, norms, uvs = [], [], []
    for vi in range(vc):
        base = vi*stride
        for s,off,fmt,dim in ch_info:
            if s: continue
            chunk = data[base+off:base+off+strides.get(fmt,4)*dim]
            if fmt == 0:
                vals = struct.unpack('<%df'%dim, chunk)
            else:
                vals = tuple(b/255.0 for b in chunk)
            if dim==3 and off==0: verts.append(vals)
            elif dim==3 and off==12: norms.append(vals)
            elif dim==2 and off in (40,44): uvs.append(vals)
    idx_data = bytes(m.m_IndexBuffer)
    subs = []
    for sm in m.m_SubMeshes:
        fb, cnt = sm.firstByte, sm.indexCount
        t = None
        if fb % 4 == 0 and cnt>0 and fb+cnt*4 <= len(idx_data)+4:
            t32 = list(struct.unpack_from('<%dI'%cnt, idx_data, fb))
            if t32 and max(t32) < max(vc,1): t = t32
        if t is None:
            t16 = list(struct.unpack_from('<%dH'%cnt, idx_data, fb))
            t = t16 if (t16 and max(t16) < max(vc,1)) else []
        subs.append(t)
    return (np.array(verts,dtype=np.float32),
            np.array(norms,dtype=np.float32) if norms else None,
            np.array(uvs,dtype=np.float32) if uvs else None,
            subs)

# ---------- 材质与纹理 ----------
def get_texture(mat):
    try:
        for k, v in mat.m_SavedProperties.m_TexEnvs:
            if k in ("_MainTex","_BaseMap") and v.m_Texture.path_id:
                tex = v.m_Texture.deref()
                return tex
    except Exception:
        pass
    return None

def get_color(mat):
    try:
        for k, v in mat.m_SavedProperties.m_Colors:
            if k in ("_BaseColor","_Color"):
                return [v.r, v.g, v.b, v.a]
    except Exception:
        pass
    return None

# ---------- 导出: 遍历 ZY 树 ----------
children_map = {}
for pid, t in trs.items():
    children_map.setdefault(t["father"], []).append(pid)

world_cache = {}
def world_of(pid):
    if pid in world_cache: return world_cache[pid]
    t = trs.get(pid)
    W = np.eye(4) if t is None else (t["m"] if t["father"] not in trs else world_of(t["father"]) @ t["m"])
    world_cache[pid] = W
    return W

# ---------- 纹理提取 ----------
os.makedirs("web/public/textures", exist_ok=True)
tex_cache = {}
def save_texture(tex_obj):
    if tex_obj is None: return None
    key = (tex_obj.assets_file.name, tex_obj.path_id)
    if key in tex_cache: return tex_cache[key]
    try:
        img = tex_obj.read()
        pil = img.image
        if pil is None: return None
        # 处理法线贴图 (Unity DXT5nm → RGB)
        name = img.m_Name or f"tex_{tex_obj.path_id}"
        fn = f"{name}.png"
        pil.save(f"web/public/textures/{fn}")
        tex_cache[key] = fn
        return fn
    except Exception as e:
        print("tex fail", e)
        return None

# 收集所有带 mesh 的节点(限 ZY 子树 + Charger_LINE + Road)
def collect(pid, out):
    t = trs.get(pid)
    if not t: return
    g = t["go"]
    if g in go_mesh:
        out.append((pid, g))
    for c in children_map.get(pid, []):
        collect(c, out)

targets = []
for root_name in ("ZY", "Charger_LINE", "Road", "mesh"):
    # 找根
    for pid, t in trs.items():
        if gos.get(t["go"]) == root_name:
            collect(pid, targets)
            break

print(f"收集 {len(targets)} 个渲染节点")

# ---------- 输出自定义 JSON 场景 + 几何 ----------
scene_nodes = []
mesh_data = {}
for tpid, gpid in targets:
    mesh_obj = go_mesh[gpid]
    m = mesh_obj.read()
    name = m.m_Name
    if name not in mesh_data:
        v, n, uv, subs = parse_mesh(m)
        mesh_data[name] = dict(v=v, n=n, uv=uv, subs=subs)
    mats = []
    for mo in go_mats.get(gpid, []):
        try:
            md = mo.read()
            tex_fn = save_texture(get_texture(md))
            mats.append(dict(name=md.m_Name, color=get_color(md), texture=tex_fn))
        except Exception:
            pass
    t = trs[tpid]
    scene_nodes.append(dict(
        name=gos.get(gpid, "?"), mesh=name,
        pos=list(t["m"][:3,3]), quat=[t["m"][1,0],0,0,0],  # 重新读
        parent_transform_id=tpid,
        materials=mats))
    # 直接存矩阵
    scene_nodes[-1]["matrix"] = world_of(tpid).tolist()
    del scene_nodes[-1]["quat"]

print(f"网格 {len(mesh_data)} 个,纹理 {len(tex_cache)} 张")
for n in scene_nodes:
    print(f"  {n['name']:22s} mesh={n['mesh']:20s} mats={[m['name'] for m in n['materials']]}")

# 保存几何
os.makedirs("web/public", exist_ok=True)
out = {}
for name, md in mesh_data.items():
    key = name.replace("/", "_")
    out[f"{key}_v"] = md["v"]
    if md["n"] is not None and len(md["n"]) == len(md["v"]): out[f"{key}_n"] = md["n"]
    if md["uv"] is not None and len(md["uv"]) == len(md["v"]): out[f"{key}_uv"] = md["uv"]
    for si, sub in enumerate(md["subs"]):
        out[f"{key}_i{si}"] = np.array(sub, dtype=np.uint32)
np.savez_compressed("web/public/meshes.npz", **out)
json.dump(dict(nodes=scene_nodes), open("web/public/scene.json","w"), ensure_ascii=False, indent=1)
print("已导出 web/public/meshes.npz + scene.json")
