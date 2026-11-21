# The well awakens in a real browser (public/wellwake.js, docs/briefs/well-awakens.md): before Floor 2 opens, the
# town's well has no prompt, label, glow or warp; the first Warden kill (TEST_HOOKS clear 1) plays the shot: the camera
# cuts to the well, "A bright light emits from the well." shows, the glow fades up, then the camera comes back and
# interact opens the waypoint. Then: the floor2 flag path (TEST_HOOKS unlock 3) with Reduce motion (a still frame) and
# a skip (the key does nothing else; F12 passes), the MVP card held until the shot ends, a shot that waits while the
# Game Menu is open, and one cut short (going down) whose tip waits until you're free.
# Usage: python3 test/wellwake.py   (starts its own server; PORT=xxxx to pick the port, default 4371)
import json, math, os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '4371'))
base = f'http://localhost:{PORT}'
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'START_LEVEL': '10', 'SPAWN_AT': '0,-4',
                       'TEST_HOOKS': '1', 'DATABASE_URL': '', 'NAMED_ENABLED': '0'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
n = 0
def ok(name):
    global n; n += 1; print(f'  ok {n} - {name}', flush=True)

try:
    time.sleep(3)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--enable-unsafe-swiftshader'])
        errors = []
        def page(name, access=None):
            ctx = b.new_context(viewport={'width': 1280, 'height': 800})
            p = ctx.new_page()
            p.on('pageerror', lambda e: errors.append(str(e)))
            init = """window.__sent = []; const s = WebSocket.prototype.send;
              WebSocket.prototype.send = function (d) { try { window.__sent.push(JSON.parse(d)); } catch {} return s.call(this, d); };"""
            if access: init += f"localStorage.setItem('fb_controls', JSON.stringify({{ v: 1, access: {json.dumps(access)} }}));"
            init += "localStorage.setItem('fb_tips', '[]');"
            p.add_init_script(init)
            p.goto(f'{base}/?quality=low')
            p.fill('#name', name); p.click('.cls[data-id=swordsman]'); p.click('#enter')
            p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.inv', timeout=60000)
            return p
        def frames(p, k=2): p.evaluate('k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', k)
        S = lambda p, js: p.evaluate(js)
        wp_label = lambda p: S(p, "() => [...document.querySelectorAll('#labels .lbl.npc')].some(e => e.style.display !== 'none' && /Waypoint/.test(e.textContent))")
        cam_well = lambda p: S(p, "() => Math.hypot(__fb.camera.position.x, __fb.camera.position.z)")
        cam_me = lambda p: S(p, "() => Math.hypot(__fb.camera.position.x - __fb.state.x, __fb.camera.position.z - __fb.state.z)")
        lit = lambda p: S(p, "() => __fb.wellWake.glow().lit[0]")

        # ---- 1. asleep, then the Warden kill and the shot ----
        p = page('Wren')
        frames(p, 6)
        assert S(p, "() => Math.hypot(__fb.state.x, __fb.state.z)") < 4.4, 'standing at the well'
        assert S(p, "() => __fb.interactKind()") != 'warp'
        assert not wp_label(p) and lit(p) == 0
        p.keyboard.press('KeyF'); frames(p, 4)
        assert S(p, "() => document.getElementById('warp').classList.contains('hidden')")
        assert not any(m.get('type') == 'warp' for m in S(p, '() => window.__sent'))
        ok('before Floor 2 opens: no prompt, label, glow or warp at the well')

        S(p, "() => __fb.send({ type: 'test', clear: 1 })")
        p.wait_for_function("() => __fb.state.inv?.life?.floor2", timeout=20000)
        assert S(p, "() => !!__fb.wellWake.pending") and lit(p) == 0, 'the shot waits a moment; the glow stays dark till then'
        p.wait_for_function("() => __fb.wellWake.active", timeout=30000)
        p.wait_for_function("() => __fb.wellWake.view.t > 0.6", timeout=30000)
        frames(p, 2)
        assert cam_well(p) < 20 and S(p, "() => __fb.camera.position.y") > 2, f'camera at the well ({cam_well(p)})'
        p.wait_for_function("() => /A bright light emits from the well\\./.test(document.getElementById('callout').textContent) && document.getElementById('callout').classList.contains('show')", timeout=20000)
        l1 = lit(p); frames(p, 6); l2 = lit(p)
        assert 0 <= l1 <= l2 and S(p, "() => !__fb.wellWake.view.calm")
        S(p, "() => __fb.handleEvent({ t: 'mvp', ids: [__fb.state.myId], d: 0, card: { result: 'kill', boss: 'The Horned Warden', floor: 1, secs: 60, rows: [{ id: __fb.state.myId, name: 'Wren', cls: 'swordsman', lvl: 10 }] } })")
        time.sleep(1); frames(p, 3)
        assert S(p, "() => __fb.wellWake.active && !document.getElementById('mvp')"), 'the MVP card waits for the shot'
        p.keyboard.press('F12'); frames(p, 2)
        assert S(p, "() => __fb.wellWake.active"), 'function keys pass (no skip)'
        ok('the Warden kill: the camera cuts to the well, "A bright light emits from the well." shows, the glow fades up; the MVP card waits; F12 passes')
        p.wait_for_function("() => !__fb.wellWake.active", timeout=60000)
        frames(p, 3)
        assert cam_me(p) < 16, f'camera back on you ({cam_me(p)})'
        p.wait_for_function("() => !!document.getElementById('mvp')", timeout=10000)
        assert not S(p, "() => /Waypoint/.test(document.getElementById('tip').textContent)"), 'no tip under the card'
        S(p, "() => __fb.mvp.close()"); frames(p, 2)
        assert lit(p) == 1 and wp_label(p) and S(p, "() => __fb.interactKind()") == 'warp'
        p.wait_for_function("() => document.getElementById('tip').classList.contains('show') && /Waypoint/.test(document.getElementById('tip').textContent)", timeout=30000)  # (after the card and its own tip)
        p.keyboard.press('KeyF'); frames(p, 4)
        assert S(p, "() => !document.getElementById('warp').classList.contains('hidden') && /Travel/.test(document.getElementById('warp').innerHTML)")
        ok('it ends on its own: camera back on you, then the MVP card, then the waypoint tip; the well glows, interact opens the waypoint')
        p.close()

        # ---- 2. the floor2 flag, Reduce motion, skip ----
        p = page('Juno', access={'reduceMotion': True})
        frames(p, 4)
        assert lit(p) == 0 and S(p, "() => __fb.interactKind()") != 'warp'
        S(p, "() => __fb.send({ type: 'test', unlock: 3 })")
        p.wait_for_function("() => __fb.wellWake.active && __fb.wellWake.view.t > 0.4", timeout=40000)
        assert S(p, "() => __fb.wellWake.view.calm")
        a = S(p, "() => __fb.camera.position.toArray()"); frames(p, 5); b2 = S(p, "() => __fb.camera.position.toArray()")
        assert all(abs(x - y) < 1e-6 for x, y in zip(a, b2)), (a, b2)
        ok('Reduce motion (and the floor2 flag): a still frame of the well, no camera move')
        sent0 = len(S(p, '() => window.__sent'))
        p.keyboard.press('KeyJ'); frames(p, 4)
        assert not S(p, "() => __fb.wellWake.active")
        assert not any(m.get('type') == 'skill' for m in S(p, '() => window.__sent')[sent0:]), 'the skip press does nothing else'
        assert cam_me(p) < 16 and lit(p) == 1
        p.keyboard.down('KeyW'); frames(p, 20); p.keyboard.up('KeyW')
        assert S(p, "() => Math.hypot(__fb.state.x, __fb.state.z + 4)") > 0.3, 'you can move again'
        ok('any key skips it (and does nothing else): control is back at once')
        p.close()

        # ---- 3. busy: it waits ----
        p = page('Tamsin')
        frames(p, 4)
        p.keyboard.press('Escape'); frames(p, 3)
        assert S(p, "() => !document.getElementById('gamemenu').classList.contains('hidden')"), 'Game Menu open'
        S(p, "() => __fb.send({ type: 'test', unlock: 3 })")
        p.wait_for_function("() => __fb.state.inv?.life?.floor2", timeout=20000)
        time.sleep(4); frames(p, 3)
        assert not S(p, "() => __fb.wellWake.active") and S(p, "() => !!__fb.wellWake.pending"), 'waits while the menu is open'
        p.keyboard.press('Escape'); frames(p, 3)
        p.wait_for_function("() => __fb.wellWake.active", timeout=20000)
        ok('while you are busy (the Game Menu here; downed / near a boss the same) the shot waits, then plays')
        t0 = S(p, "() => { __fb.send({ type: 'test', tp: [0, 70] }); setTimeout(() => __fb.send({ type: 'test', down: 1, secs: 4 }), 150); return __fb.wellWake.view.t; }")  # (out of town: no damage in town)
        p.wait_for_function("() => !__fb.wellWake.active", timeout=20000)
        assert S(p, "() => __fb.state.dead || !!__fb.state.downed || performance.now() - __fb.state.lastCombat < 6000"), 'going down cuts it short'
        assert not S(p, "() => document.getElementById('tip').classList.contains('show') && /Waypoint/.test(document.getElementById('tip').textContent)"), 'no tip while down'
        p.wait_for_function("() => !__fb.state.dead && !__fb.state.downed", timeout=60000)
        p.wait_for_function("() => document.getElementById('tip').classList.contains('show') && /Waypoint/.test(document.getElementById('tip').textContent)", timeout=30000)
        ok('a shot cut short (going down here; a disconnect the same) gives the waypoint tip only once you are up and free')
        p.close()

        # ---- 4. spectators: lit; the film view: dark until the director's wake cue ----
        ctx = b.new_context(viewport={'width': 960, 'height': 540})
        for q, want in (('spectate=1', 1), ('spectate=1&film=1', 0)):
            p = ctx.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
            p.goto(f'{base}/?quality=low&{q}')
            p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.spectator', timeout=60000)
            frames(p, 4)
            assert lit(p) == want, (q, lit(p))
            if want == 0:
                S(p, "() => __fb.handleEvent({ t: 'cine', op: 'wake', on: true })"); frames(p, 4)
                l1 = lit(p); time.sleep(3); frames(p, 4)
                assert 0 < l1 < lit(p) == 1, (l1, lit(p))
                S(p, "() => __fb.handleEvent({ t: 'cine', op: 'reset' })"); frames(p, 2)
                assert lit(p) == 0
            p.close()
        ok('spectators see the well lit; the film view keeps it dark until the `wake` cue fades it up (reset: dark again)')

        assert not errors, errors
        b.close()
    print(f'wellwake.py: all {n} checks passed')
finally:
    srv.kill()
