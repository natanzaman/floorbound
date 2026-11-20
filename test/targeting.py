# Controls → Combat in a real browser (public/controlsui.js, shared/targeting.js): the targeting modes, Cleave and max
# targets appear on the Controls screen, save to fb_controls.combat, go to the server as { type: 'tprefs' } (on join
# and on every change), survive a reload; in Aimed mode an attack goes where the camera looks.
# Usage: python3 test/targeting.py   (starts its own server; PORT=xxxx to pick the port, default 3934)
import json, os, signal, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '3934'))
base = f'http://localhost:{PORT}'
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'START_LEVEL': '10', 'DATABASE_URL': ''},
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
n = 0
def ok(name):
    global n; n += 1; print(f'  ok {n} - {name}')

try:
    time.sleep(3)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--enable-unsafe-swiftshader'])
        p = b.new_page(viewport={'width': 1280, 'height': 800})
        errors = []
        p.on('pageerror', lambda e: errors.append(str(e)))
        p.add_init_script("""window.__sent = []; const s = WebSocket.prototype.send;
          WebSocket.prototype.send = function (d) { try { window.__sent.push(JSON.parse(d)); } catch {} return s.call(this, d); };""")
        S = lambda js, arg=None: p.evaluate(js, arg)
        def frames(k=2): S('k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', k)
        def join():
            p.goto(f'{base}/?quality=low')
            p.fill('#name', 'Aimer'); p.click('.cls[data-id=ranger]'); p.click('#enter')
            p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.inv', timeout=60000)
            frames(3)
        tprefs = lambda: S("() => window.__sent.filter(m => m.type === 'tprefs')")
        def open_controls():
            p.keyboard.press('Escape'); frames(3)
            p.click('#gamemenu [data-a=bindings]'); frames(3)
            assert S("() => !document.getElementById('controlsui').classList.contains('hidden')")

        join()
        t = tprefs()
        assert t and t[-1] == {'type': 'tprefs', 'mode': 'lock', 'cleave': True, 'max': 8}, t
        ok('on join the client sends the defaults: Locked or nearest, cleave on, max 8')

        open_controls()
        modes = S("() => [...document.querySelectorAll('input[name=cu-tmode]')].map(i => [i.value, i.checked])")
        assert modes == [['nearest', False], ['lock', True], ['cone', False], ['aimed', False]], modes
        assert S("() => !!document.querySelector('#controlsui #cu-combat') && [...document.querySelectorAll('#controlsui h4')].some(h => h.textContent === 'Combat')")
        assert S("() => document.getElementById('cu-cleave').checked") and S("() => document.getElementById('cu-max-v').textContent") == '8'
        ok('Controls screen: a Combat section with the four modes, Cleave and max targets')

        p.check('input[name=cu-tmode][value=cone]'); frames(2)
        assert 'Cone' in S("() => document.getElementById('cu-tdesc').textContent + document.querySelector('.cu-msg').textContent")
        p.uncheck('#cu-cleave'); frames(2)
        assert S("() => document.querySelector('[data-max=\"-1\"]').disabled"), 'max is off while cleave is off'
        p.check('#cu-cleave'); frames(2)
        for _ in range(3): p.click('[data-max="-1"]'); frames(1)
        assert S("() => document.getElementById('cu-max-v').textContent") == '5'
        saved = S("() => JSON.parse(localStorage.getItem('fb_controls')).combat")
        assert saved == {'target': 'cone', 'cleave': True, 'max': 5}, saved
        assert tprefs()[-1] == {'type': 'tprefs', 'mode': 'cone', 'cleave': True, 'max': 5}, tprefs()[-1]
        ok('changes save to fb_controls.combat and go to the server at once')

        p.check('input[name=cu-tmode][value=aimed]'); frames(2)
        p.keyboard.press('Escape'); frames(3)
        S("() => { window.__fb.state.yaw = 1.0; window.__fb.state.face = -2; }")
        p.keyboard.down('KeyJ'); frames(3); p.keyboard.up('KeyJ'); frames(2)
        sk = S("() => window.__sent.filter(m => m.type === 'skill').pop()")
        assert sk and abs(sk['face'] - 1.0) < 0.02, sk
        ok('Aimed: the attack goes where the camera looks')

        p.reload(); join()
        assert tprefs()[-1] == {'type': 'tprefs', 'mode': 'aimed', 'cleave': True, 'max': 5}, tprefs()
        open_controls()
        assert S("() => document.querySelector('input[name=cu-tmode][value=aimed]').checked") and S("() => document.getElementById('cu-max-v').textContent") == '5'
        ok('settings survive a reload and are sent on the next join')

        assert not errors, errors
        b.close()
    print(f'targeting.py: all {n} checks passed')
finally:
    srv.send_signal(signal.SIGTERM)
