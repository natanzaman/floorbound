# The Weeping Thicket (Floor 2) and the Windrift Causeways (Floor 3) in a real browser (docs/briefs/labyrinths.md):
# each way in shows its label and prompt, interact takes you in (the floor's own air, the field left behind), the tide
# or wind line shows over your head, each layer is reached and drawn, each keeper is there, and the way out leaves you
# before the floor's gate. No page errors.
# Uses TEST_HOOKS: { ward }, { tp }, { labgo }.
# Usage: python3 test/labyrinth23.py   (starts its own server; PORT=xxxx to pick the port, default 4393)
# SHOTS=dir saves a screenshot of each layer there.
import os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '4393'))
SHOTS = os.environ.get('SHOTS')
base = f'http://localhost:{PORT}'
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'START_LEVEL': '20', 'SPAWN_AT': '583,139',
                       'TEST_HOOKS': '1', 'DATABASE_URL': '', 'NAMED_ENABLED': '0'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
n = 0
def ok(name):
    global n; n += 1; print(f'  ok {n} - {name}', flush=True)

try:
    time.sleep(3)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--enable-unsafe-swiftshader'])
        errors = []
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        p = ctx.new_page()
        p.on('pageerror', lambda e: errors.append(str(e)))
        p.add_init_script("localStorage.setItem('fb_tips', '[]');")
        p.goto(f'{base}/?quality=low')
        p.fill('#name', 'Wanderer'); p.click('.cls[data-id=swordsman]'); p.click('#enter')
        p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.inv', timeout=60000)
        S = lambda js: p.evaluate(js)
        def frames(k=2): p.evaluate('k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', k)
        S("() => __fb.send({ type: 'test', ward: 1 })")
        def shot(name):
            if SHOTS: time.sleep(4); os.makedirs(SHOTS, exist_ok=True); p.screenshot(path=os.path.join(SHOTS, f'{name}.png'))
        label = lambda rx: S(f"() => [...document.querySelectorAll('#labels .lbl.npc')].some(e => e.style.display !== 'none' && /{rx}/.test(e.textContent))")
        interact = lambda: (p.keyboard.press('KeyF'), frames(3))
        def wait_layer(name):
            p.wait_for_function(f"() => __fb.state.joined && (window.__labAt?.(__fb.state.x, __fb.state.z)?.id === '{name}')", timeout=20000)
            frames(30)
        def go(layer): S(f"() => __fb.send({{ type: 'test', labgo: '{layer}' }})"); wait_layer(layer)
        S("() => import('/shared/labyrinth.js').then(m => { window.__labAt = m.labAt; window.__LABS = m.LABS; })")
        p.wait_for_function("() => !!window.__labAt", timeout=10000)

        # ---- Floor 2: the root hollow, then each layer ----
        frames(10)
        assert S("() => __fb.interactKind()") == 'lab-stair', S("() => __fb.interactKind()")
        assert label('Weeping Thicket'), 'the way in is labelled'
        fog = S("() => __fb.scene.fog.far")
        ok('the Weeping Thicket: label and prompt in the Mire')
        interact(); wait_layer('reedmarch')
        p.wait_for_function(f"() => __fb.scene.fog.far < {fog} - 5", timeout=10000)
        assert label('tide'), 'the tide line'
        shot('reedmarch')
        ok('the Reedmarch: its own air, the tide clock')
        go('drownedwood'); shot('drownedwood')
        ok('the Drowned Wood')
        go('heartwillow')
        p.wait_for_function("() => [...__fb.mobs.values()].some(m => m.type === 'motherofmire')", timeout=10000)
        shot('heartwillow')
        ok('the Heartwillow: the Mother of Mire is there')
        S("() => __fb.send({ type: 'test', labgo: 'out:2' })")
        p.wait_for_function("() => !__labAt(__fb.state.x, __fb.state.z) && __fb.state.x > 550 && __fb.state.z > 130", timeout=20000)
        ok('out before the Sunken Gate')

        # ---- Floor 3 ----
        S("() => __fb.send({ type: 'test', tp: [1172, 136] })")
        p.wait_for_function("() => Math.abs(__fb.state.x - 1172) < 3", timeout=20000); frames(20)
        assert label('Windrift'), 'the cloud landing is labelled'
        ok('the Windrift Causeways: label in the Gale Spires')
        go('kitesteps')
        assert label('Wind'), 'the wind line'
        shot('kitesteps')
        ok('the Kite Steps: the wind line')
        go('turningisles'); shot('turningisles')
        ok('the Turning Isles')
        go('eyespire')
        p.wait_for_function("() => [...__fb.mobs.values()].some(m => m.type === 'galematriarch')", timeout=10000)
        shot('eyespire')
        ok('the Eye-Spire: the Gale Matriarch is there')
        S("() => __fb.send({ type: 'test', labgo: 'out:3' })")
        p.wait_for_function("() => !__labAt(__fb.state.x, __fb.state.z) && __fb.state.x > 1150 && __fb.state.z > 130", timeout=20000)
        ok('out before the Storm Gate')

        assert not errors, errors
        ok('no page errors')
        b.close()
    print(f'labyrinth23.py: {n} checks passed')
finally:
    srv.kill()
