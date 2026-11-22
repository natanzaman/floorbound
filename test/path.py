# The Path window in a real browser (docs/briefs/path.md): for each class, a level-20 graduate with a subclass opens
# the Path window (K), and each tab draws: the journey and build on Path, the class-shaped tree on Talents (planning a
# rank shows a gold +1, Confirm spends it, the server agrees), and the skill list and detail on Abilities.
# Screenshots go to docs/briefs/path-shots/<class>-<tab>.png.
# Usage: python3 test/path.py   (starts its own server; PORT=xxxx, default 3591; CHROMIUM=<path> optional; ONLY=ranger,bard)
import os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'docs', 'briefs', 'path-shots')
os.makedirs(SHOTS, exist_ok=True)
PORT = int(os.environ.get('PORT', '3591'))
base = f'http://localhost:{PORT}'
SUBS = {'swordsman': 'duelist', 'guardian': 'bulwark', 'cleric': 'lightbringer', 'ranger': 'sharpshooter', 'berserker': 'reaver', 'lancer': 'dragoon', 'bard': 'virtuoso'}
SIGID = {'swordsman': 'flashstep', 'guardian': 'aegisline', 'cleric': 'dawnburst', 'ranger': 'deadeye', 'berserker': 'rampage', 'lancer': 'wyverndive', 'bard': 'encore'}
ONLY = [c for c in os.environ.get('ONLY', '').split(',') if c] or list(SUBS)
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'START_LEVEL': '20', 'SPAWN_AT': '0,150',
                       'TEST_HOOKS': '1', 'DATABASE_URL': '', 'NAMED_ENABLED': '0'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
n = 0
def ok(name):
    global n; n += 1; print(f'  ok {n} - {name}', flush=True)

try:
    time.sleep(3)
    with sync_playwright() as pw:
        exe = os.environ.get('CHROMIUM')
        b = pw.chromium.launch(args=['--enable-unsafe-swiftshader', '--no-sandbox'], **({'executable_path': exe} if exe else {}))
        errors = []
        for cls in ONLY:
            ctx = b.new_context(viewport={'width': 1280, 'height': 800})
            p = ctx.new_page()
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.add_init_script("localStorage.setItem('fb_tips', '[]'); localStorage.removeItem('fb_weapon'); localStorage.removeItem('fb_pick');")
            p.goto(f'{base}/?quality=low')
            p.wait_for_selector('#classes .wpn', timeout=60000)
            p.wait_for_function("() => !document.querySelector('#enter').disabled", timeout=90000)
            p.fill('#name', cls.capitalize()[:10]); p.click('#classes .wpn[data-w=sword]'); p.click('#enter')
            p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.academy', timeout=60000)
            S = lambda js: p.evaluate(js)
            if cls == ONLY[0]: # an Initiate (a sword) plans a Guardian's first talents, then saves the plan
                p.keyboard.press('KeyK')
                p.wait_for_selector('#talentsp:not(.hidden)', timeout=5000)
                S("() => document.querySelector('#talentsp [data-tab=talents]').click()")
                p.wait_for_selector('#talentsp [data-pc=guardian]', timeout=3000)
                S("() => document.querySelector('#talentsp [data-pc=guardian]').click()")
                p.wait_for_timeout(200)
                p.locator('#talentsp .tn.avail').first.click()
                p.wait_for_selector('#talentsp [data-a=confirm]', timeout=3000)
                p.mouse.move(5, 5); p.wait_for_timeout(200)
                p.screenshot(path=os.path.join(SHOTS, 'initiate-plan.png'))
                p.click('#talentsp [data-a=confirm]')
                p.wait_for_function("() => !document.querySelector('#talentsp [data-a=confirm]')", timeout=5000)
                n = S("() => [...document.querySelectorAll('#talentsp .tn')].reduce((a, g) => a + +g.querySelector('.rk').textContent.split('/')[0], 0)")
                assert n == 1, f'the saved plan shows ({n})'
                p.keyboard.press('Escape')
                ok('an Initiate plans and saves a class\'s first talent')
            sk = S(f"() => (async () => {{ const {{ CLASSES }} = await import('/shared/data.js'); return CLASSES['{cls}'].skills.map(s => s.id); }})()")
            S(f"() => __fb.send({{ type: 'test', become: {{ cls: '{cls}', sub: '{SUBS[cls]}', mastery: {{ '{sk[1]}': 700, '{sk[2]}': 420, '{sk[3]}': 160, '{SIGID[cls]}': 700 }} }} }})")
            p.wait_for_function(f"() => __fb.state.cls === '{cls}' && __fb.state.academy?.spec?.sub === '{SUBS[cls]}'", timeout=15000)
            # spend 12 points along the suggested path, in one confirmed plan
            S(f"""() => (async () => {{ const T = await import('/shared/talents.js'), S = await import('/shared/subclasses.js');
                const ids = T.suggestOrder('{cls}', '{SUBS[cls]}', S.SUBCLASSES['{SUBS[cls]}'].branch).slice(0, 12);
                __fb.send({{ type: 'talent', op: 'spendMany', ids }}); }})()""")
            p.wait_for_timeout(800)
            p.keyboard.press('KeyK')
            p.wait_for_selector('#talentsp:not(.hidden)', timeout=5000)
            S("() => document.querySelector('#talentsp [data-tab=path]').click()")
            p.wait_for_timeout(300)
            txt = S("() => document.querySelector('#talentsp').textContent")
            assert 'Your journey' in txt and 'Coming up' in txt and 'Your build' in txt, txt[:300]
            assert 'wanderer' not in txt.lower()
            p.screenshot(path=os.path.join(SHOTS, f'{cls}-path.png'))
            S("() => document.querySelector('#talentsp [data-tab=talents]').click()")
            p.wait_for_timeout(300)
            spent = S("() => [...document.querySelectorAll('#talentsp .tn')].reduce((a, g) => a + +g.querySelector('.rk').textContent.split('/')[0], 0)")
            assert spent == 12, f'{cls}: 12 ranks shown, got {spent}'
            av = p.locator('#talentsp .tn.avail').first
            av.click()
            p.wait_for_selector('#talentsp .tn .plant', timeout=3000)
            p.wait_for_selector('#talentsp [data-a=confirm]', timeout=3000)
            p.mouse.move(5, 5)
            p.wait_for_timeout(200)
            p.screenshot(path=os.path.join(SHOTS, f'{cls}-talents.png'))
            p.click('#talentsp [data-a=confirm]')
            p.wait_for_function("() => !document.querySelector('#talentsp [data-a=confirm]')", timeout=5000)
            spent = S("() => [...document.querySelectorAll('#talentsp .tn')].reduce((a, g) => a + +g.querySelector('.rk').textContent.split('/')[0], 0)")
            assert spent == 13, f'{cls}: the confirmed rank landed ({spent})'
            S(f"() => __fb.send({{ type: 'evolve', sk: '{SIGID[cls]}', br: 'A' }})")
            p.wait_for_function(f"() => __fb.state.academy?.spec?.sig?.br === 'A'", timeout=5000)
            S("() => document.querySelector('#talentsp [data-tab=abilities]').click()")
            p.wait_for_timeout(300)
            S("() => document.querySelector('#talentsp [data-ab=\"4\"]').click()")
            p.wait_for_timeout(300)
            t4 = S("() => document.querySelector('#talentsp .adet').textContent")
            assert 'Mastery 3' in t4 and 'evolved' in t4, t4[:300]
            p.screenshot(path=os.path.join(SHOTS, f'{cls}-signature.png'))
            S("() => document.querySelector('#talentsp [data-ab=\"1\"]').click()")
            p.wait_for_timeout(300)
            p.screenshot(path=os.path.join(SHOTS, f'{cls}-abilities.png'))
            ok(f'{cls}: Path, Talents (plan, confirm) and Abilities draw')
            ctx.close()
        assert not errors, errors
        ok('no page errors')
finally:
    srv.kill()
