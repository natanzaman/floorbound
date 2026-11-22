# Floor towns in a real browser (public/towns.js, docs/briefs/towns.md): the town board's label and prompt, the Town
# panel (pad-driven root): join, the project, the Election tab (stand, vote), the Bounties and Steward tabs, then a raid
# warning shows the raid HUD. Screenshots in docs/briefs/towns-shots/.
# Usage: python3 test/towns.py   (starts its own server; PORT=xxxx to pick the port, default 3363)
import os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '3363'))
SHOTS = os.path.join(ROOT, 'docs', 'briefs', 'towns-shots')
CHROME = os.environ.get('CHROME') or next((p for p in ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'] if os.path.exists(p)), None)
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'SPAWN_AT': '6,16', 'START_LEVEL': '5', 'TEST_HOOKS': '1', 'DATABASE_URL': '',
                       'NAMED_ENABLED': '0', 'MAX_BOTS': '0', 'TOWN_RAIDS': '0'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        p.add_init_script("localStorage.setItem('fb_tips', '[\"town\",\"raid\"]');")
        p.goto(f'http://localhost:{PORT}/?quality=low')
        p.fill('#name', 'Wren'); p.click('.cls[data-id=guardian]'); p.click('#enter')
        p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.inv && window.__fb.towns?.data()', timeout=60000)
        S = lambda js: p.evaluate(js)
        frames = lambda k=3: p.evaluate('k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', k)
        S("() => __fb.send({ type: 'test', ward: 1 })")
        S("() => __fb.send({ type: 'test', life: { tp: [6, 12.5] } })")
        p.wait_for_function("() => __fb.interactKind() === 'town'", timeout=20000)
        frames(4)
        label = lambda: S("() => [...document.querySelectorAll('#labels .lbl.town')].filter(e => e.style.display !== 'none').map(e => e.textContent).join('|')")
        assert 'Town Board' in label() and 'Camp' in label() and 'for the town' in label(), label()
        p.keyboard.press('KeyF'); frames(4)
        assert S("() => !document.getElementById('town').classList.contains('hidden') && document.getElementById('town').dataset.nav === 'town' && __fb.panels.isOpen('town')")
        p.wait_for_function("() => document.querySelector('#town .body')?.textContent.includes('Bounty Board')", timeout=10000)
        ok('the town board: label and prompt, F opens the Town panel (pad-driven) on the current project')
        p.click('#town button[data-a=join]')
        p.wait_for_function("() => __fb.towns.data()?.me?.home === 1 && document.querySelector('#town .body').textContent.includes('You live here')", timeout=10000)
        p.screenshot(path=os.path.join(SHOTS, 'town-tab.png'))
        ok('Join: a citizen of the Town of Beginnings')
        p.click('#town .tabs button[data-t=vote]'); frames(2)
        assert 'after this election opened' in S("() => document.querySelector('#town .body').textContent")
        S("() => __fb.send({ type: 'test', town: { close: 1 } })")  # a new cycle: now a citizen from before it opened
        p.wait_for_function("() => __fb.towns.data().towns[0].why === '' && document.getElementById('town-plat')", timeout=10000)
        p.click('#town .tabs button[data-t=vote]'); frames(2)
        assert S("() => document.querySelectorAll('#town .body .it').length") >= 2
        p.fill('#town-plat', 'Hold the ward, every night.')
        p.click('#town button[data-a=ag][data-ag=defend]'); frames(2)
        p.click('#town button[data-a=stand]')
        p.wait_for_function("() => __fb.towns.data().towns[0].el.cands.some(c => c.me)", timeout=10000)
        frames(4)
        p.click('#town .it.on button[data-a=vote], #town button[data-a=vote][data-k^=s]')
        p.wait_for_function("() => __fb.towns.data().towns[0].el.my && __fb.towns.data().towns[0].el.cands.find(c => c.me).k === __fb.towns.data().towns[0].el.my", timeout=10000)
        frames(4)
        p.screenshot(path=os.path.join(SHOTS, 'election-tab.png'))
        ok('the Election tab: stand with an agenda and a platform, vote for yourself')
        S("() => __fb.send({ type: 'test', town: { close: 1 } })")
        p.wait_for_function("() => __fb.towns.data().towns[0].steward?.me", timeout=10000)
        p.click('#town .tabs button[data-t=steward]'); frames(4)
        assert 'You are the Steward' in S("() => document.querySelector('#town .body').textContent")
        p.fill('#town-msg', 'Bring copper to the board.')
        p.click('#town button[data-a=smsg]')
        p.wait_for_function("() => __fb.towns.data().towns[0].msg === 'Bring copper to the board.'", timeout=10000)
        p.click('#town .tabs button[data-t=bounty]'); frames(2)
        assert 'bounty board' in S("() => document.querySelector('#town .body').textContent").lower()
        p.click('#town .tabs button[data-t=town]'); frames(4)
        frames(30)
        assert 'Steward' in label(), label()
        p.screenshot(path=os.path.join(SHOTS, 'steward.png'))
        ok('elected Steward: the Steward tab pins a message; the board shows the Steward; Bounties tab renders')
        p.click('#town button[data-a=close]'); frames(2)
        S("() => __fb.send({ type: 'test', town: { raid: 1 } })")
        p.wait_for_function("() => !document.getElementById('raid-hud').classList.contains('hidden') && /RAID/.test(document.getElementById('raid-hud').textContent)", timeout=15000)
        p.screenshot(path=os.path.join(SHOTS, 'raid-hud.png'))
        S("() => __fb.send({ type: 'test', town: { raidEnd: [1, 1] } })")
        p.wait_for_function("() => document.getElementById('raid-hud').classList.contains('hidden')", timeout=15000)
        ok('a raid: the HUD shows, and goes when it ends')
        assert not errors, errors
    print(f'{n} town browser checks passed')
finally:
    srv.terminate()
