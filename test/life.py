# Life classes in a real browser (public/life.js, docs/briefs/life-classes.md): the Life Hall's label and prompt, the
# Life panel (pad-driven root, Skills tab, Learn), then a gathering spot's label and prompt, the interact key starts
# gathering (the bar shows), herbs land in the bag, and the panel's Garden and Meals tabs render.
# Usage: python3 test/life.py   (starts its own server; PORT=xxxx to pick the port, default 3432)
import os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '3432'))
CHROME = os.environ.get('CHROME') or next((p for p in ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'] if os.path.exists(p)), None)
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'SPAWN_AT': '13,-4', 'TEST_HOOKS': '1', 'DATABASE_URL': '',
                       'NAMED_ENABLED': '0', 'MAX_BOTS': '0'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
n = 0
def ok(name):
    global n; n += 1; print(f'  ok {n} - {name}', flush=True)
try:
    time.sleep(3)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--enable-unsafe-swiftshader'], **({'executable_path': CHROME} if CHROME else {}))
        errors = []
        p = b.new_context(viewport={'width': 1280, 'height': 800}).new_page()
        p.on('pageerror', lambda e: errors.append(str(e)))
        p.add_init_script("localStorage.setItem('fb_tips', '[]');")
        p.goto(f'http://localhost:{PORT}/?quality=low')
        p.fill('#name', 'Fern'); p.click('.cls[data-id=cleric]'); p.click('#enter')
        p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.inv && window.__fb.life', timeout=60000)
        S = lambda js: p.evaluate(js)
        frames = lambda k=3: p.evaluate('k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', k)
        S("() => __fb.send({ type: 'test', ward: 1 })")
        frames(6)
        label = lambda: S("() => [...document.querySelectorAll('#labels .lbl.life')].filter(e => e.style.display !== 'none').map(e => e.textContent).join('|')")
        p.wait_for_function("() => __fb.interactKind() === 'life-hall'", timeout=20000)
        assert 'Life Hall' in label() and 'to learn' in label(), label()
        p.keyboard.press('KeyF'); frames(4)
        assert S("() => !document.getElementById('life').classList.contains('hidden') && document.getElementById('life').dataset.nav === 'life'")
        assert S("() => __fb.panels.isOpen('life')")
        assert 'Herbalist' in S("() => document.querySelector('#life .body').textContent")
        p.click('#life button[data-a=learn][data-id=herbalist]')
        p.wait_for_function("() => document.querySelector('#life .body').textContent.includes('Herbalist Lv 1')", timeout=10000)
        ok('the Life Hall: label, prompt, the Life panel (a pad-driven panel), Learn Herbalist')
        for t in ['garden', 'meals', 'cook']:
            p.click(f'#life .tabs button[data-t={t}]'); frames(2)
            assert S("() => document.querySelectorAll('#life .body .it').length") > 0, t
        p.click('#life button[data-a=close]'); frames(2)
        ok('the Garden, Meals and Cooking tabs render; Close')
        S("() => __fb.send({ type: 'test', life: { tp: [-29, 46] } })")
        p.wait_for_function("() => __fb.interactKind() === 'life-spot'", timeout=20000)
        frames(4)
        assert 'Meadowleaf patch' in label() and 'to gather' in label(), label()
        p.keyboard.press('KeyF')
        p.wait_for_function("() => !document.getElementById('life-bar').classList.contains('hidden') && /Gathering/.test(document.getElementById('life-bar').textContent)", timeout=10000)
        p.wait_for_function("() => (__fb.state.inv.mats?.meadowleaf || 0) >= 1", timeout=15000)
        frames(4)
        assert 'back in' in label(), label()
        ok('a herb patch: label and prompt, F gathers (the bar shows), herbs in the bag, then the spot shows its refill timer')
        assert not errors, errors
    print(f'{n} life browser checks passed')
finally:
    srv.terminate()
