# /// script
# requires-python = ">=3.10"
# dependencies = ["UnityPy", "numpy"]
# ///
"""Export interaction anchors without rewriting calibrated meshes or textures."""
import hashlib
import json
from pathlib import Path

import numpy as np
import UnityPy

ROOT = Path(__file__).resolve().parents[1]


def export_interactions():
    data = ROOT / 'unity-player/Build/ZY.data'
    env = UnityPy.load(str(data))
    transforms, names, meshes = {}, {}, {}
    for obj in env.objects:
        if obj.assets_file.name != 'level0':
            continue
        if obj.type.name == 'Transform':
            transforms[obj.path_id] = obj.read()
        elif obj.type.name == 'GameObject':
            names[obj.path_id] = obj.read().m_Name
        elif obj.type.name == 'MeshFilter':
            d = obj.read()
            meshes[d.m_GameObject.path_id] = d.m_Mesh.deref().read().m_Name

    def rotation(q):
        x, y, z, w = q
        return np.array([
            [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w), 0],
            [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w), 0],
            [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y), 0],
            [0, 0, 0, 1],
        ])

    def local(pid):
        d = transforms[pid]
        q = d.m_LocalRotation
        m = rotation((q.x, q.y, q.z, q.w))
        s, p = d.m_LocalScale, d.m_LocalPosition
        m[:3, :3] *= (s.x, s.y, s.z)
        m[:3, 3] = (p.x, p.y, p.z)
        return m

    worlds = {}

    def world(pid):
        if pid not in worlds:
            parent = transforms[pid].m_Father.path_id
            worlds[pid] = (world(parent) if parent in transforms else np.eye(4)) @ local(pid)
        return worlds[pid]

    def path(pid):
        d = transforms[pid]
        parent = d.m_Father.path_id
        return (path(parent) + '/' if parent in transforms else '') + names[d.m_GameObject.path_id]

    flip = np.diag([1, 1, -1, 1])
    scene_path = ROOT / 'web/public/scene.json'
    nodes = json.loads(scene_path.read_text())['nodes']
    bindings, used = [], set()
    for index, node in enumerate(nodes):
        candidates = [pid for pid, d in transforms.items()
                      if pid not in used and meshes.get(d.m_GameObject.path_id) == node['mesh']]
        pid = min(candidates, key=lambda p: np.max(np.abs(flip @ world(p) @ flip - node['matrix'])))
        if np.max(np.abs(flip @ world(pid) @ flip - node['matrix'])) > 1e-5:
            raise ValueError(f"Scene transform mismatch: {node['name']}; re-export anchors for these assets.")
        used.add(pid)
        bindings.append({'index': index, 'path': path(pid)})

    port = next(pid for pid in transforms if path(pid) == 'ZY/ZY-new/ZY/WG/CDK')
    parent = transforms[port].m_Father.path_id
    # Verified reference bridge: rotate -60° around the parent's Unity Y axis.
    theta = -np.pi / 3
    delta = rotation((0, np.sin(theta/2), 0, np.cos(theta/2)))
    opened = local(port).copy()
    opened[:3, :3] = (delta @ local(port))[:3, :3]
    result = {
        'dataSHA256': hashlib.sha256(data.read_bytes()).hexdigest(),
        'sceneSHA256': hashlib.sha256(scene_path.read_bytes()).hexdigest(),
        'nodes': bindings,
        'chargingPort': {
            'closed': (flip @ world(port) @ flip).tolist(),
            'opened': (flip @ world(parent) @ opened @ flip).tolist(),
        },
    }
    output = ROOT / 'web/public/interactions.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'Exported {len(bindings)} hierarchy bindings and charging-port poses: {output}')


if __name__ == '__main__':
    export_interactions()
