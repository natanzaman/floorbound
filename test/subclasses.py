# Subclasses in a real browser (docs/briefs/subclasses.md): a bow Initiate at level 16 graduates as a Ranger, the
# Academy panel shows the Specialise section with the Ranger's two subclasses, a confirmed pick puts the signature
# skill on the HUD's fifth button, and G fires it (slot 5 cools down). Screenshots go to docs/briefs/subclass-shots/.
# Usage: python3 test/subclasses.py   (starts its own server; PORT=xxxx, default 3581; CHROMIUM=<path> optional)
import os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'docs', 'briefs', 'subclass-shots')
os.makedirs(SHOTS, exist_ok=True)
PORT = int(os.environ.get('PORT', '3581'))
base = f'http://localhost:{PORT}'
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'START_LEVEL': '16', 'SPAWN_AT': '-15,-1',
                       'TEST_HOOKS': '1', 'DATABASE_URL': '', 'NAMED_ENABLED': '0'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
n = 0
def ok(name):
    global n; n += 1; print(f'  ok {n} - {name}', flush=True)

try:
    time.sleep(3)
    with sync_playwright() as pw:
        exe = os.environ.get('CHROMIUM')
        b = pw.chromium.launch(args=['--enable-unsafe-swiftshader'], **({'executable_path': exe} if exe else {}))
        errors = []
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        p = ctx.new_page()
        p.on('pageerror', lambda e: errors.append(str(e)))
        p.add_init_script("localStorage.setItem('fb_tips', '[]'); localStorage.removeItem('fb_weapon'); localStorage.removeItem('fb_pick');")
        p.goto(f'{base}/?quality=low')
        p.wait_for_selector('#classes .wpn', timeout=60000)
        p.wait_for_function("() => !document.querySelector('#enter').disabled", timeout=90000)
        p.fill('#name', 'Archer'); p.click('#classes .wpn[data-w=bow]'); p.click('#enter')
        p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.academy', timeout=60000)
        S = lambda js: p.evaluate(js)
        assert S('() => __fb.state.academy.ini') == 1
        assert p.locator('#skills .sk.sig').count() == 0, 'no fifth button for an Initiate'
        S("() => __fb.send({ type: 'test', tp: [-17, -2] })")
        p.wait_for_function("() => __fb.interactKind() === 'academy'", timeout=15000)
        S("() => __fb.academy.toggle(true)")
        p.wait_for_selector('#academy button[data-a=trial][data-id=ranger]', timeout=10000)
        assert p.locator('#academy button[data-a=askspec]').count() == 0, 'no Specialise section for an Initiate'
        p.click('#academy button[data-a=trial][data-id=ranger]')
        p.wait_for_function("() => __fb.state.academy?.trial && __fb.state.academy.loan", timeout=15000)
        p.wait_for_timeout(3500)
        S("() => __fb.send({ type: 'test', trialWin: 2 })")
        p.wait_for_function("() => !__fb.state.academy.trial && __fb.state.x < 0", timeout=15000)
        S("() => __fb.academy.toggle(true)")
        p.wait_for_selector('#academy button[data-a=askgrad][data-id=ranger]', timeout=10000)
        p.click('#academy button[data-a=askgrad][data-id=ranger]')
        p.click('#academy button[data-a=graduate][data-id=ranger]')
        p.wait_for_function("() => __fb.state.academy.ini === 0 && __fb.state.academy.path.stage === 'class'", timeout=15000)
        ok('a bow Initiate at level 16 graduates as a Ranger')
        S("() => __fb.academy.toggle(true)")
        p.wait_for_selector('#academy button[data-a=askspec]', timeout=10000)
        assert p.locator('#academy button[data-a=askspec]').count() == 2
        txt = S("() => document.querySelector('#academy').textContent")
        assert 'Sharpshooter' in txt and 'Trapmaster' in txt and 'Deadeye Shot' in txt, txt[:400]
        assert 'wanderer' not in txt.lower() and 'own road' not in txt.lower()
        p.locator('#academy button[data-a=askspec][data-id=sharpshooter]').scroll_into_view_if_needed()
        p.wait_for_timeout(400)
        p.screenshot(path=os.path.join(SHOTS, 'specialise.png'))
        ok('the Specialise section lists Sharpshooter and Trapmaster with their skills (and nothing else)')
        p.click('#academy button[data-a=askspec][data-id=sharpshooter]')
        p.click('#academy button[data-a=spec][data-id=sharpshooter]')
        p.wait_for_function("() => __fb.state.academy.spec?.sub === 'sharpshooter'", timeout=10000)
        p.wait_for_selector('#skills .sk.sig', timeout=10000)
        assert 'Deadeye Shot' in S("() => document.querySelector('#skills .sk.sig').textContent")
        p.wait_for_function("() => document.querySelector('#me-lvl').textContent.includes('Sharpshooter')", timeout=5000)
        ok('specialised: the fifth button holds Deadeye Shot; the frame says Sharpshooter')
        S("() => __fb.academy.toggle(false)")
        S("() => __fb.send({ type: 'test', tp: [0, 60] })")
        p.wait_for_timeout(6000) # the 5 s cooldown after picking
        p.mouse.click(640, 400)
        p.keyboard.press('KeyG')
        p.wait_for_function("() => __fb.state.ready?.[4] > performance.now() + 5000", timeout=10000)
        p.wait_for_timeout(800)
        p.screenshot(path=os.path.join(SHOTS, 'slot5.png'))
        ok('G fires the signature skill: slot 5 cools down on the HUD')
        assert not errors, errors
        ok('no page errors')
        b.close()
finally:
    srv.terminate()
print(f'1..{n}')
