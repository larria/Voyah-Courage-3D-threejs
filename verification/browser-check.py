"""Production UI, motion, subpath and offline verification.

PAGES_BASE=/Voyah-Courage-3D-threejs/ npm run build
python3 verification/browser-check.py
Requires Playwright Chromium and Pillow. Optional PLAYWRIGHT_EXECUTABLE.
"""
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification'
PREFIX = '/Voyah-Courage-3D-threejs/'
report = {'checks': [], 'pageErrors': [], 'consoleErrors': [], 'requestFailures': [], 'visualDiffs': {}}


def check(name, condition):
    assert condition, name
    report['checks'].append(name)
    print('PASS', name, flush=True)


def main():
    with tempfile.TemporaryDirectory(prefix='voyah-browser-') as temporary:
        site = Path(temporary) / 'site'
        shutil.copytree(ROOT / 'web/dist', site)
        requests = []

        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(site), **kwargs)

            def do_GET(self):
                requests.append(self.path)
                if not self.path.startswith(PREFIX):
                    self.send_error(404)
                    return
                self.path = '/' + self.path[len(PREFIX):]
                super().do_GET()

            def end_headers(self):
                self.send_header('Cache-Control', 'no-store')
                super().end_headers()

            def log_message(self, *_):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}{PREFIX}'
        try:
            with sync_playwright() as pw:
                launch = {'headless': True, 'args': ['--use-angle=metal']}
                if os.environ.get('PLAYWRIGHT_EXECUTABLE'):
                    launch['executable_path'] = os.environ['PLAYWRIGHT_EXECUTABLE']
                browser = pw.chromium.launch(**launch)
                context = browser.new_context(viewport={'width': 1180, 'height': 820}, reduced_motion='reduce')
                page = context.new_page()
                page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
                page.on('console', lambda msg: report['consoleErrors'].append(msg.text) if msg.type == 'error' else None)
                page.on('requestfailed', lambda request: report['requestFailures'].append(request.url))
                page.goto(url)
                page.wait_for_function('window.carViewer !== undefined', timeout=90000)
                page.wait_for_function("document.getElementById('offline-status').textContent === '离线可用'", timeout=90000)
                check('production subpath and complete offline cache', page.title().startswith('全新岚图知音'))

                def click(label, role='button'):
                    page.get_by_role(role, name=label, exact=True).click()

                def state():
                    return page.evaluate('carViewer.getState()')

                frames = {}

                def shot(name):
                    raw = page.locator('.stage').screenshot()
                    frames[name] = Image.open(io.BytesIO(raw)).convert('RGB')
                    (OUT / f'{name}.png').write_bytes(raw)
                    check('populated frame: ' + name, sum(ImageStat.Stat(frames[name]).stddev) > 20)

                def differs(a, b):
                    delta = sum(ImageStat.Stat(ImageChops.difference(frames[a], frames[b])).mean) / 3
                    report['visualDiffs'][f'{a} -> {b}'] = round(delta, 3)
                    check('visible change: ' + a + ' -> ' + b, delta > 0.05)

                shot('desktop')
                click('动态体验', 'tab')
                click('前大灯与尾灯')
                check('headlight does not disable daytime or position lamps', not state()['headlights'] and state()['daytimeRunningLights'] and state()['positionLights'])
                click('日间行车灯'); click('位置灯')
                shot('lights-off'); differs('desktop', 'lights-off')
                click('全部灯光')
                click('转向闪烁')
                check('turn signals are amber', page.evaluate("__carDebug.matLibrary['外观_转向灯 1'].emissive.getHex()") == 0xff8800)
                page.wait_for_function('carViewer.getState().signaling === null', timeout=30000)
                click('寻车演示')
                check('find-car starts transient signal sequence', state()['signaling'] == 'find')
                page.wait_for_function('carViewer.getState().signaling === null', timeout=30000)

                click('门窗开合', 'tab'); click('左前门')
                page.wait_for_function('Math.abs(__carDebug.doorAnim.LF.cur) > 1.13', timeout=30000)
                click('动态体验', 'tab'); click('折叠后视镜')
                page.wait_for_function('carViewer.getState().mirrorPhase > .9999', timeout=30000)
                shot('door-mirror')
                check('mirror fold preserves open door', state()['doors']['LF'])
                check('both mirrors remain attached to moving doors', page.evaluate("Object.values(__carDebug.doorAnim).flatMap(a=>a.insts.filter(i=>i.mesh==='DOOR_HSJ').map(i=>i.obj.matrix.elements.every(Number.isFinite))).every(Boolean)"))
                click('展开后视镜')
                page.wait_for_function('carViewer.getState().mirrorPhase < .0001', timeout=30000)
                click('锁车演示')
                check('locking folds mirrors and turns lamps off', state()['locked'] and not state()['mirrorsExpanded'] and not state()['positionLights'])
                click('解锁演示')
                check('unlocking expands mirrors and lights lamps', not state()['locked'] and state()['mirrorsExpanded'] and state()['headlights'])
                page.evaluate("carViewer.setDoor('LF', false, {animate:false})")
                point = page.evaluate("""() => {const d=__carDebug;const i=d.instances.find(i=>i.mesh==='DOOL_L_F_001'&&i.path.includes('/Door_LF/'));const g=i.obj.children[0].geometry;g.computeBoundingBox();const p=g.boundingBox.getCenter(d.camera.position.clone()).applyMatrix4(i.obj.matrix).project(d.camera);const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2};}""")
                page.mouse.click(point['x'], point['y'])
                check('model tap toggles the hit door', state()['doors']['LF'])
                before_drag = state()['doors']
                page.mouse.move(point['x'], point['y']); page.mouse.down(); page.mouse.move(point['x']+100, point['y']+25, steps=8); page.mouse.up()
                check('orbit drag does not toggle doors', state()['doors'] == before_drag)
                click('门窗开合', 'tab'); click('开合动画'); click('全部关闭')
                page.wait_for_function('__carDebug.doorAnim.LF.cur === 0')
                click('全部车窗')
                page.wait_for_function('Object.values(__carDebug.doorAnim).every(a => a.winCur === 1)')
                check('all four windows support instant switching', all(state()['windows'].values()))
                click('全部关闭')

                click('外观搭配', 'tab')
                page.locator('#interiors').get_by_role('button', name='深海蓝', exact=True).click()
                before = page.evaluate('({p:__carDebug.camera.position.toArray(),t:__carDebug.controls.target.toArray()})')
                click('进入内饰'); before = page.evaluate('__carDebug.getExteriorPose()'); shot('interior')
                check('interior view retains selected theme', state()['viewMode'] == 'interior' and state()['interior'] == 'P')
                click('返回外观')
                after = page.evaluate('({p:__carDebug.camera.position.toArray(),t:__carDebug.controls.target.toArray()})')
                check('exit interior restores prior orbit and selected color', max(abs(a-b) for k in ['p', 't'] for a, b in zip(before[k], after[k])) < 1e-5 and state()['interior'] == 'P')

                click('动态体验', 'tab'); click('模拟行驶')
                click('充电展示', 'tab'); click('查看充电口'); shot('charging-before')
                click('充电流光')
                page.wait_for_function('carViewer.getState().portPhase > .9999', timeout=30000)
                check('charging connects cable, opens lid and stops driving', state()['charging'] and state()['chargingCableVisible'] and not state()['driving'])
                check('extracted plug is placed at right-rear socket', page.evaluate("Math.abs(__carDebug.instances.find(i=>i.mesh==='LINES_HEAD').obj.matrix.elements[12] - 1.1691) < .02"))
                shot('charging-flow'); differs('charging-before', 'charging-flow')
                phase = page.evaluate('__carDebug.matLibrary.Charger_line.map?.offset.x ?? __carDebug.matLibrary.Charger_line.emissiveIntensity')
                page.wait_for_timeout(650)
                check('charging flow changes with time', page.evaluate('__carDebug.matLibrary.Charger_line.map?.offset.x ?? __carDebug.matLibrary.Charger_line.emissiveIntensity') != phase)
                click('充电流光')
                check('stopping flow retains cable and lid', not state()['charging'] and state()['chargingCableVisible'] and state()['chargingPortOpen'])
                click('充电盖板')
                check('connected cable prevents closing lid', state()['chargingPortOpen'] and '先隐藏充电线缆' in page.locator('#toast').inner_text())
                click('充电线缆')
                page.wait_for_function('carViewer.getState().portPhase < .0001', timeout=30000)
                check('unplugging hides cable and closes lid', not state()['chargingCableVisible'] and not state()['chargingPortOpen'])

                click('沉浸欣赏')
                check('immersion hides configuration', not page.locator('#panel').is_visible())
                click('退出沉浸')
                check('immersion restores configuration', page.locator('#panel').is_visible())

                # Simulate a UI-only release in the disposable served build.
                transfers = requests.count(PREFIX + 'meshes.npz')
                index = site / 'index.html'
                index.write_text(index.read_text().replace('<body>', '<body data-update-probe="new">'))
                sw = site / 'sw.js'
                digest = hashlib.sha256(index.read_bytes()).hexdigest()
                sw.write_text(re.sub(r'("index.html":")[a-f0-9]+', lambda m: m[1] + digest, sw.read_text()))
                page.evaluate('navigator.serviceWorker.getRegistration().then(r=>r.update())')
                page.wait_for_selector('#update-notice', state='visible', timeout=30000)
                check('new release waits for confirmation', page.locator('body').get_attribute('data-update-probe') is None)
                click('稍后')
                check('deferred update preserves vehicle selection', state()['interior'] == 'P')
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                page.wait_for_selector('#update-notice', state='visible')
                click('刷新更新')
                page.wait_for_function("document.body.dataset.updateProbe === 'new' && window.carViewer !== undefined", timeout=90000)
                check('confirmed update activates new page', True)
                check('UI-only update reuses unchanged large model cache', requests.count(PREFIX + 'meshes.npz') == transfers)
                context.set_offline(True)
                page.reload()
                page.wait_for_function('window.carViewer !== undefined', timeout=90000)
                check('complete offline reload works under Pages subpath', state()['paint'] == 'QGJ')
                context.set_offline(False)
                context.close()

                mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, reduced_motion='reduce')
                page = mobile.new_page()
                page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
                page.on('console', lambda msg: report['consoleErrors'].append(msg.text) if msg.type == 'error' else None)
                page.goto(url); page.wait_for_function('window.carViewer !== undefined', timeout=90000)
                check('mobile has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                stage = page.locator('.stage').bounding_box(); panel = page.locator('#panel').bounding_box()
                check('mobile controls do not cover stage', stage['y'] + stage['height'] <= panel['y'] + 1)
                click('充电展示', 'tab'); click('充电盖板')
                page.screenshot(path=str(OUT / 'mobile.png'))
                click('个性化你的知音 收起')
                check('mobile panel collapses', not page.locator('#panel-content').is_visible())
                browser.close()
                check('no JavaScript errors', not report['pageErrors'])
                check('no renderer or shader errors', not report['consoleErrors'])
                check('no failed resource requests', not report['requestFailures'])
        finally:
            server.shutdown(); server.server_close(); thread.join(5)
            (OUT / 'browser-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
