# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands and runtime

Run commands from the repository root. Vite 8 requires Node 20.19+ (20.x) or 22.12+.

- `npm ci --prefix web`: install frontend dependencies using `web/package-lock.json`; no root dependency installation is required.
- `npm run dev`: start the Vite development server (normally port 5173).
- `npm run build`: build the frontend into `web/dist/`.
- `npm run preview`: serve the production build locally.
- `PAGES_BASE=/Voyah-Courage-3D-threejs/ npm run build`: build for the GitHub Pages subpath.
- `node --check scripts/publish.mjs`: syntax-check the publishing script without publishing.
- `uv run /absolute/path/to/tools/export_final.py`: extract assets with the script's Python 3.10+ / UnityPy / NumPy / Pillow dependency declaration; requires local `unity-player/Build/ZY.data`. Extraction resolves paths relative to the script, not the invoking directory.

There are currently no lint or automated test commands in the frontend package, so no single-test command exists. Build checks alone do not validate animation or appearance; inspect relevant interactions in the running viewer.

## Architecture

This is a static three.js viewer, not the original Unity runtime and not a backend application. `web/index.html` supplies the controls; `web/src/main.js` constructs the scene, recreates materials, assigns extracted instances to movable groups, binds controls, and drives rendering and animations. It consumes `web/public/scene.json` for instance transforms/material references and `meshes.npz` for geometry. `web/src/npz.js` decodes ZIP/NumPy arrays with pako. Public textures and reconstructed PBR materials determine appearance, which is visually calibrated rather than an exact official rendering match.

The offline extraction pipeline in `tools/export_final.py` reads Unity resources, resolves scene transforms and mesh/material references, and emits the static frontend assets. Unity-to-three.js conversion reverses z and triangle winding. The raw `unity-player/` is local-only and ignored; do not add it to source or deployment. Existing extracted assets suffice for normal development and publication.

Preserve the current motion conventions when changing interactions: doors open 65 degrees over 2 seconds linearly; windows take 2 seconds; rear windows drop 0.30m with x -0.033m and side-dependent z ±0.1153m (front drop 0.45m). Unity internal trigger names are not verified public SendMessage APIs. The reconstructed viewer does not implement every original Unity capability.

## Publishing boundaries

`npm run publish` is the unified publishing entry point and performs real pushes. Run it only when publication is requested; never use it as a harmless validation command. It does not commit source changes: clean, committed `main` is required.

The exact HTTPS remotes are `github=https://github.com/larria/Voyah-Courage-3D-threejs.git` and `gitee=https://gitee.com/larria/Voyah-Courage-3D-ThreeJS.git`. Both source branches are `main`. The script validates fetch/push URLs, fetches both main refs and checks fast-forward ancestry before any pushes, builds with the Pages base, and pushes Gitee main then GitHub main then GitHub gh-pages. It prepares only built assets and `.nojekyll` in a temporary clone, preserves existing gh-pages history (or creates an orphan initially), never force-pushes, and cleans temporary files in finally. Deployment commits include the source SHA and Claude co-author trailer. Failures report partial success rather than rolling back successful remote updates.

No GitHub Actions or gh CLI are used. GitHub Pages is manually configured in repository Settings → Pages to deploy `gh-pages` from `/(root)`.

Model, texture, trademark and original Unity resource rights remain with their respective owners. The existing frontend package's ISC metadata is not a grant covering third-party assets; do not describe all repository content as ISC-licensed or promise commercial redistribution rights.
