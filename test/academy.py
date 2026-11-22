# The Academy in a real browser (docs/briefs/academy.md): the creation screen picks a weapon (an Initiate starts with
# the base class, plain skill names and a locked level-3 skill), F at the Academy opens the panel, a class trial loans
# the kit and runs in a yard pen with its HUD, a passed trial (TEST_HOOKS trialWin) lets you graduate: the class, its
# names, the level-3 skill. Screenshots go to docs/briefs/academy-shots/.
# Usage: python3 test/academy.py   (starts its own server; PORT=xxxx, default 3931)
import os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'docs', 'briefs', 'academy-shots')
os.makedirs(SHOTS, exist_ok=True)
PORT = int(os.environ.get('PORT', '3931'))
base = f'http://localhost:{PORT}'
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'START_LEVEL': '5', 'SPAWN_AT': '-15,-1',
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
        assert p.locator('#classes .wpn').count() == 5
        ok('the creation screen offers five weapons')
        p.fill('#name', 'Pupil'); p.click('#classes .wpn[data-w=staff]')
        p.screenshot(path=os.path.join(SHOTS, 'creation.png'))
        p.click('#enter')
        p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.academy', timeout=60000)
        S = lambda js: p.evaluate(js)
        assert S('() => __fb.state.cls') == 'cleric' and S('() => __fb.state.academy.ini') == 1
        bar = S("() => document.querySelector('#skills').textContent")
        assert 'Mend' in bar and 'Academy' in bar, bar
        assert 'Initiate' in S("() => document.querySelector('#me-lvl').textContent")
        ok('a staff Initiate: the Cleric base, plain names (Mend), the level-3 skill locked, "Initiate" on the frame')
        S("() => __fb.send({ type: 'test', tp: [-17, -2] })")
        p.wait_for_function("() => __fb.interactKind() === 'academy'", timeout=15000)
        S("() => __fb.academy.toggle(true)")
        p.wait_for_selector('#academy .row button[data-a=trial]', timeout=10000)
        p.wait_for_timeout(500)
        p.screenshot(path=os.path.join(SHOTS, 'panel.png'))
        assert p.locator('#academy .row button[data-a=trial]').count() == 2 # staff: Cleric and Bard
        assert p.locator('#academy .wpns button').count() == 5
        ok('F at the Academy: the panel lists the staff\'s two trials, the armory, the drills')
        p.click('#academy button[data-a=trial][data-id=cleric]')
        p.wait_for_function("() => __fb.state.academy?.trial && __fb.state.academy.loan && !document.querySelector('#trialhud').classList.contains('hidden')", timeout=15000)
        p.wait_for_function("() => __fb.state.x > 200", timeout=10000)
        p.wait_for_timeout(4000)
        p.screenshot(path=os.path.join(SHOTS, 'trial.png'))
        assert 'Sanctuary' in S("() => document.querySelector('#skills').textContent")
        ok('the trial: into a yard pen, the full Cleric kit on loan (Sanctuary), the trial HUD')
        S("() => __fb.send({ type: 'test', trialWin: 2 })")
        p.wait_for_function("() => !__fb.state.academy.trial && __fb.state.x < 0", timeout=15000)
        assert S('() => __fb.state.academy.path.trials.cleric') == 2 and S('() => __fb.state.academy.ini') == 1
        ok('a silver medal, back at the Academy as an Initiate')
        S("() => __fb.academy.toggle(true)")
        p.wait_for_selector('#academy button[data-a=askgrad][data-id=cleric]', timeout=10000)
        p.click('#academy button[data-a=askgrad][data-id=cleric]')
        p.click('#academy button[data-a=graduate][data-id=cleric]')
        p.wait_for_function("() => __fb.state.academy.ini === 0 && __fb.state.academy.path.stage === 'class'", timeout=15000)
        bar = S("() => document.querySelector('#skills').textContent")
        assert 'Heal' in bar and 'Sanctuary' in bar and 'Academy' not in bar, bar
        p.wait_for_timeout(600)
        p.screenshot(path=os.path.join(SHOTS, 'graduated.png'))
        ok('graduated: the Cleric names, Sanctuary open')
        assert not errors, errors
        ok('no page errors')
        b.close()
finally:
    srv.terminate()
print(f'1..{n}')
