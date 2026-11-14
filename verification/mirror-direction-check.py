"""Verify real mirror direction, door composition and reversal in the production build.

PAGES_BASE=/Voyah-Courage-3D-threejs/ npm run build
python3 verification/mirror-direction-check.py
Requires Playwright Chromium. Optional PLAYWRIGHT_EXECUTABLE.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification'
PREFIX = '/Voyah-Courage-3D-threejs/'
report = {'version': '1.1.1', 'checks': [], 'errors': [], 'poses': {}}


def check(name, condition):
    assert condition, name
    report['checks'].append(name)
    print('PASS', name, flush=True)


def main():
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT / 'web/dist'), **kwargs)

        def do_GET(self):
            if not self.path.startswith(PREFIX):
                self.send_error(404)
                return
            self.path = '/' + self.path[len(PREFIX):]
            super().do_GET()

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as pw:
            launch = {'headless': True, 'args': ['--use-angle=metal']}
            if os.environ.get('PLAYWRIGHT_EXECUTABLE'):
                launch['executable_path'] = os.environ['PLAYWRIGHT_EXECUTABLE']
            browser = pw.chromium.launch(**launch)
            page = browser.new_page(viewport={'width': 1180, 'height': 820}, reduced_motion='reduce')
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.on('console', lambda msg: report['errors'].append(msg.text) if msg.type == 'error' else None)
            page.goto(f'http://127.0.0.1:{server.server_port}{PREFIX}')
            page.wait_for_function('window.carViewer !== undefined', timeout=90000)

            def click(label):
                page.get_by_role('button', name=label, exact=True).click()

            def wait_folded():
                page.wait_for_function('carViewer.getState().mirrorPhase > .9999', timeout=30000)

            def wait_expanded():
                page.wait_for_function('carViewer.getState().mirrorPhase < .0001', timeout=30000)

            def centers(undo_door=False):
                return page.evaluate("""(undo) => {
                  const d=__carDebug;
                  return d.instances.filter(i=>i.mesh==='DOOR_HSJ').map(i=>{
                    const a=i.obj.children[0].geometry.attributes.position;
                    const p=d.camera.position.clone().set(0,0,0);
                    for(let j=0;j<a.count;j++){p.x+=a.getX(j);p.y+=a.getY(j);p.z+=a.getZ(j);}
                    p.divideScalar(a.count).applyMatrix4(i.obj.matrix);
                    if(undo){
                      const id=i.path.match(/Door_(LF|RF)/)[1], anim=d.doorAnim[id];
                      const t=i.obj.matrix.clone().makeTranslation(anim.hinge.x,anim.hinge.y,anim.hinge.z);
                      const r=i.obj.matrix.clone().makeRotationY(anim.cur);
                      p.applyMatrix4(t.clone().multiply(r).multiply(t.clone().invert()).invert());
                    }
                    return {path:i.path,position:p.toArray()};
                  });
                }""", undo_door)

            def inward(expanded, folded):
                return all(abs(b['position'][2]) < abs(a['position'][2]) - 0.05 and b['position'][0] > a['position'][0] + 0.01 for a, b in zip(expanded, folded))

            page.get_by_role('tab', name='动态体验', exact=True).click()
            click('侧身')
            expanded = centers()
            report['poses']['expanded'] = expanded
            page.locator('.stage').screenshot(path=str(OUT / 'mirror-left-expanded.png'))
            click('折叠后视镜'); wait_folded()
            folded = centers()
            report['poses']['folded'] = folded
            check('both closed-door mirrors fold inward and rearward', inward(expanded, folded))
            page.locator('.stage').screenshot(path=str(OUT / 'mirror-left-folded.png'))
            click('展开后视镜'); wait_expanded()
            check('both mirrors restore original expanded pose', max(abs(a-b) for x, y in zip(expanded, centers()) for a, b in zip(x['position'], y['position'])) < 1e-5)

            click('充电口')
            page.locator('.stage').screenshot(path=str(OUT / 'mirror-right-expanded.png'))
            click('锁车演示'); wait_folded()
            check('locking folds both mirrors inward', inward(expanded, centers()))
            page.locator('.stage').screenshot(path=str(OUT / 'mirror-right-folded.png'))
            click('解锁演示'); wait_expanded()
            check('unlocking restores mirrors and lamps', page.evaluate('carViewer.getState().mirrorsExpanded && carViewer.getState().headlights'))

            page.evaluate("carViewer.setDoor('LF',true,{animate:false});carViewer.setDoor('RF',true,{animate:false})")
            click('折叠后视镜'); wait_folded()
            report['poses']['doorsOpenFoldedInDoorFrame'] = centers(True)
            check('fold direction survives both front-door rotations', inward(expanded, centers(True)))
            page.locator('.stage').screenshot(path=str(OUT / 'mirror-doors-open-folded.png'))
            click('展开后视镜'); wait_expanded()
            page.evaluate("carViewer.setDoor('LF',false,{animate:false});carViewer.setDoor('RF',false,{animate:false})")

            click('折叠后视镜')
            page.wait_for_function('carViewer.getState().mirrorPhase > .2 && carViewer.getState().mirrorPhase < .8')
            continuity = page.evaluate("""() => {
              const before=__carDebug.features.getState().mirrorPhase;
              carViewer.setMirrors(false);carViewer.setMirrors(false);
              const repeated=__carDebug.features.getState().mirrorPhase;
              carViewer.setMirrors(true);
              return {before,repeated,reversed:__carDebug.features.getState().mirrorPhase};
            }""")
            check('repeated and reversed commands preserve current progress', continuity['before'] == continuity['repeated'] == continuity['reversed'])
            wait_expanded()
            check('rapid reversal finishes at original pose', max(abs(a-b) for x, y in zip(expanded, centers()) for a, b in zip(x['position'], y['position'])) < 1e-5)
            check('no runtime or shader errors', not report['errors'])
            browser.close()
    finally:
        server.shutdown(); server.server_close(); thread.join(5)
        (OUT / 'mirror-direction-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
