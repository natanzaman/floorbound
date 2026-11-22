# Guilds in a real browser (public/guilds.js, docs/briefs/guilds.md), no database: the Guild Registrar's label and
# prompt in town, interact opens the Players window on the Guild tab, found a guild, invite a second player (the card),
# accept, /g chat (only members see it), the [TAG] on the HUD name, the Players list and the nameplate, /g chat (only members see it), the bank and
# the vault from the tab, leave.
# Usage: python3 test/guilds.py   (starts its own server; PORT=xxxx to pick the port, default 3871)
import os, subprocess, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '3871'))
base = f'http://localhost:{PORT}'
srv = subprocess.Popen(['node', 'server/index.js'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'START_LEVEL': '5', 'SPAWN_AT': '12.2,-8.5',
                       'TEST_HOOKS': '1', 'DATABASE_URL': '', 'NAMED_ENABLED': '0'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
n = 0
def ok(name):
    global n; n += 1; print(f'  ok {n} - {name}', flush=True)

exe = os.environ.get('CHROMIUM') or next((os.path.join(r, f) for r, _, fs in os.walk('/opt/pw-browsers') for f in fs if f == 'chrome' and 'chrome-linux' in r), None)
try:
    time.sleep(3)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=['--enable-unsafe-swiftshader'], **({'executable_path': exe} if exe else {}))
        errors = []
        def page(name):
            ctx = b.new_context(viewport={'width': 1280, 'height': 800})
            p = ctx.new_page()
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.add_init_script("localStorage.setItem('fb_tips', '[]'); window.__sent = []; const s0 = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); if (m.type === 'guild') window.__sent.push(m.op); } catch {} return s0.call(this, d); };")
            p.goto(f'{base}/?quality=low')
            p.fill('#name', name); p.click('.cls[data-id=swordsman]'); p.click('#enter')
            p.wait_for_function('() => window.__fb?.state?.joined && window.__fb.state.inv', timeout=60000)
            p.evaluate("() => __fb.send({ type: 'test', ward: 1 })")
            return p
        S = lambda p, js: p.evaluate(js)
        def frames(p, k=3): p.evaluate('k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })', k)

        a = page('Ann'); c = page('Cyd')
        frames(a, 6)
        assert S(a, "() => __fb.interactKind()") == 'guild', S(a, "() => [__fb.state.x, __fb.state.z, __fb.interactKind()]")
        assert S(a, "() => [...document.querySelectorAll('#labels .lbl.npc')].some(e => e.style.display !== 'none' && /Guild Registrar/.test(e.textContent) && /for guilds/.test(e.textContent))")
        ok('the Guild Registrar: label and prompt in town')
        S(a, "() => __fb.send({ type: 'test', gold: 1000 })")
        a.wait_for_function("() => __fb.state.gold >= 1000", timeout=10000)
        a.mouse.click(640, 400); a.keyboard.press('KeyF')
        a.wait_for_selector('#players:not(.hidden) .gd input[data-f="gname"]', timeout=10000)
        ok('interact opens the Players window on the Guild tab')
        a.fill('.gd input[data-f="gname"]', 'Knights of <Test>')
        a.fill('.gd input[data-f="gtag"]', 'kot')
        a.click('.gd button[data-a="create"]')
        a.wait_for_selector('.gd .pb-note.err', timeout=10000)
        ok('a name with markup is refused')
        a.fill('.gd input[data-f="gname"]', "Knights of Aincrad")
        a.click('.gd button[data-a="create"]')
        a.wait_for_selector('.gd .gd-head .gd-tag', timeout=10000)
        assert '[KOT]' in a.inner_text('.gd .gd-head') and a.evaluate("() => __fb.state.gold") == 700
        ok('found a guild from the tab (the fee is paid)')
        a.wait_for_function("() => /\\[KOT\\]/.test(document.getElementById('me-name').textContent)", timeout=10000)
        ok('the [TAG] shows on the HUD name')
        S(a, "() => { const i = document.getElementById('chat-input'); i.value = '/g secret plans'; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }")
        a.wait_for_function("() => /\\[Guild\\] Ann: secret plans/.test(document.getElementById('log').textContent)", timeout=10000)
        time.sleep(1)
        assert 'secret plans' not in c.inner_text('#log')
        ok('/g chat: the guild sees it, someone outside doesn\'t')
        a.fill('.gd input[data-f="iname"]', 'Cyd'); a.click('.gd button[data-a="invite"]')
        c.wait_for_selector('.gd-invite button[data-x="1"]', timeout=10000)
        c.click('.gd-invite button[data-x="1"]')
        a.wait_for_function("() => [...document.querySelectorAll('#players .gd-m')].some(e => /Cyd/.test(e.textContent))", timeout=10000)
        ok('invite card: Cyd accepts and shows in the member list')
        c.wait_for_function("() => [...__fb.players.values()].some(e => e.label && /\\[KOT\\]/.test(e.label.text || ''))", timeout=10000)
        ok('the [TAG] shows on a guildmate\'s nameplate')
        c.click('#players-btn') if c.is_visible('#players-btn') else c.keyboard.press('KeyP')
        c.wait_for_function("() => [...document.querySelectorAll('#players .p')].some(e => /\\[KOT\\]/.test(e.textContent) && /Ann/.test(e.textContent))", timeout=10000)
        ok('the [TAG] shows in the Players list')
        S(c, "() => { const i = document.getElementById('chat-input'); i.value = '/g for the guild'; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }")
        a.wait_for_function("() => /\\[Guild\\] Cyd: for the guild/.test(document.getElementById('log').textContent)", timeout=10000)
        ok('/g chat from a new member reaches the guild')
        a.fill('.gd input[data-f="gold"]', '200'); a.click('.gd button[data-a="deposit"]')
        a.wait_for_function("() => /Bank: 200 gold/.test(document.querySelector('#players .gd').textContent)", timeout=10000)
        ok('deposit from the tab')
        S(a, "() => import('/shared/loot.js').then(m => __fb.send({ type: 'test', giveSet: Object.keys(m.SETS)[0] }))")
        a.wait_for_function("() => __fb.state.inv.bag.length > 0", timeout=10000)
        nbag = S(a, "() => __fb.state.inv.bag.length")
        a.evaluate("() => document.querySelector('#players .gd-bag').open = true")
        a.wait_for_selector('#players .gd-bag button[data-a="store"]', timeout=10000)
        a.click('#players .gd-bag button[data-a="store"]')
        a.wait_for_function("() => /Vault 1\\//.test(document.querySelector('#players .gd').textContent) && __fb.state.inv.bag.length === %d" % (nbag - 1), timeout=10000)
        ok('store an item in the vault from the tab: it leaves the bag')
        a.click('#players .gd button[data-a="take"]')
        a.wait_for_function("() => /Vault 0\\//.test(document.querySelector('#players .gd').textContent) && __fb.state.inv.bag.length === %d" % nbag, timeout=10000)
        ok('take it back')
        c.click('.pb-tabs button[data-tab="guild"]')
        c.wait_for_selector('#players .gd button[data-a="leave"]', timeout=10000)
        time.sleep(1)
        c.click('#players .gd button[data-a="leave"]')
        c.wait_for_function("() => /Sure/.test(document.querySelector('#players .gd button[data-a=\"leave\"]')?.textContent || '')", timeout=5000)
        S(c, "() => document.querySelector('#players .gd button[data-a=leave]').click()") # (the second click within 3 s: a Playwright click on a slow headless page can take longer)
        c.wait_for_selector('#players .gd input[data-f="gname"]', timeout=10000)
        ok('leave (two clicks)')
        assert not errors, errors
        ok('no page errors')
        b.close()
finally:
    srv.kill()
print(f'\nall {n} passed')
