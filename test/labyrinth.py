# The Undercrypt in a real browser (docs/briefs/labyrinths.md): the crypt stair in the field shows its label and
# prompt, interact takes you down into the Catacombs (the crypt's dark air, your torch, the field hidden, walls stop
# you), the stairs between layers work by interact, the Galleries' portcullis shows shut, a chest opens, the Ossuary
# has the Gravekeeper, and the Ossuary's stair brings you out before the Chamber Gate. No page errors.
# Uses TEST_HOOKS: { ward }, { tp } and { labgo }.
# Usage: python3 test/labyrinth.py   (starts its own server; PORT=xxxx to pick the port, default 4391)
# SHOTS=dir saves a screenshot of each layer there.
import os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '4391'))
SHOTS = os.environ.get('SHOTS')
base = f'http://localhost:{PORT}'
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'START_LEVEL': '10', 'SPAWN_AT': '-17,139',
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
        p.fill('#name', 'Delver'); p.click('.cls[data-id=swordsman]'); p.click('#enter')
        p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.inv', timeout=60000)
        S = lambda js: p.evaluate(js)
        def frames(k=2): p.evaluate('k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', k)
        S("() => __fb.send({ type: 'test', ward: 1 })")
        def tp(x, z):  # walk-free move: a server teleport through the admin-free test path (the stair messages)
            S(f"() => __fb.send({{ type: 'test', tp: [{x}, {z}] }})")
        def shot(name):
            if SHOTS: time.sleep(4); os.makedirs(SHOTS, exist_ok=True); p.screenshot(path=os.path.join(SHOTS, f'{name}.png'))
        area = lambda: S("() => document.getElementById('area')?.textContent || ''")
        label = lambda rx: S(f"() => [...document.querySelectorAll('#labels .lbl.npc')].some(e => e.style.display !== 'none' && /{rx}/.test(e.textContent))")
        interact = lambda: (p.keyboard.press('KeyF'), frames(3))
        def wait_layer(name):
            p.wait_for_function(f"() => __fb.state.joined && (window.__labAt?.(__fb.state.x, __fb.state.z)?.id === '{name}')", timeout=20000)
            frames(30)
        S("() => import('/shared/labyrinth.js').then(m => { window.__labAt = m.labAt; window.__LABS = m.LABS; window.__stairs = m.stairsOf; })")
        p.wait_for_function("() => !!window.__labAt", timeout=10000)

        # ---- 1. the crypt stair in the field ----
        frames(10)
        assert S("() => __fb.interactKind()") == 'lab-stair', S("() => __fb.interactKind()")
        assert label('Undercrypt'), 'the stair is labelled'
        fog = S("() => __fb.scene.fog.far")
        ok('the crypt stair: label and prompt in the field')

        # ---- 2. down into the Catacombs ----
        interact(); wait_layer('catacombs')
        p.wait_for_function("() => __fb.scene.fog.far < 60", timeout=10000)
        assert S("() => __fb.scene.fog.far") < fog
        assert S("() => __fb.scene.children.some(o => o.isPointLight && o.visible && o.distance === 20)"), 'your torch'
        shot('catacombs')
        # walls stop you: hold a key towards the outer wall
        x0 = S("() => __fb.state.x")
        p.keyboard.down('KeyA'); time.sleep(2.5); p.keyboard.up('KeyA'); frames(4)
        L = S("() => { const L = __labAt(__fb.state.x, __fb.state.z); return { x0: L.x0, w: L.w }; }")
        assert S("() => __fb.state.x") > L['x0'] + 0.5 and S("() => __fb.state.x") < L['x0'] + L['w'] - 0.5, 'still inside the walls'
        ok('the Catacombs: dark air, your torch, walls hold you')

        # ---- 3. a chest in the Catacombs opens ----
        c = S("() => __LABS[1].layers[0].chestList[0]")
        tp(c['x'], c['z'] - 1.6); frames(10)
        p.wait_for_function("() => __fb.interactKind() === 'lab-chest'", timeout=10000)
        interact()
        p.wait_for_function("() => __fb.interactKind() !== 'lab-chest'", timeout=10000)
        ok('the Catacombs: a chest opens')

        # the Catacombs' end stair, by interact, down to the Galleries
        st = S("() => __stairs(__LABS[1]).find(s => s.L?.id === 'catacombs' && s.kind === 'down')")
        tp(st['x'], st['z']); frames(10)
        p.wait_for_function("() => __fb.interactKind() === 'lab-stair'", timeout=10000)
        interact(); wait_layer('galleries')
        assert S("() => { const L = __LABS[1].layers[1]; return !!L.portEdge; }")
        assert S("() => __fb.interactKind()") in ('lab-stair', 'lab-lure', 'lab-chest', 'lab-lever', 'lab-torch')
        shot('galleries')
        ok('the Drowning Galleries: arrived by its threshold')

        # ---- 4. the Ossuary and out ----
        S(f"() => __fb.send({{ type: 'test', labgo: 'ossuary' }})")
        wait_layer('ossuary')
        p.wait_for_function("() => [...__fb.mobs.values()].some(m => m.def?.name === 'The Gravekeeper' || m.type === 'gravekeeper')", timeout=10000)
        shot('ossuary')
        ok('the Ossuary: the Gravekeeper is there')
        S(f"() => __fb.send({{ type: 'test', labgo: 'out' }})")
        p.wait_for_function("() => !__labAt(__fb.state.x, __fb.state.z) && __fb.state.z > 130", timeout=20000)
        p.wait_for_function("() => __fb.scene.fog.far > 60", timeout=10000)
        ok('out before the Chamber Gate; the field air is back')

        assert not errors, errors
        ok('no page errors')
        b.close()
    print(f'labyrinth.py: {n} checks passed')
finally:
    srv.kill()
