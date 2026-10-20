// Playwright smoke test: drags pieces with the mouse and checks they snap.
// Usage: node tests/smoke.js   (chromium must be installed; we never download it)
// Set SHOTS=dir to save screenshots.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createServer } = require('../scripts/serve.js');

const SHOTS = process.env.SHOTS;
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

(async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const errors = [];
  let failed = false;
  try {
    let page = await browser.newPage({ viewport: { width: 420, height: 800 } }); // the helpers below use whichever page this is
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url);
    await page.waitForFunction(() => window.magnetGame);
    const shot = async (name) => {
      if (!SHOTS) return;
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, name + '.png') });
    };
    const pieces = () => page.evaluate(() => window.magnetGame.state.pieces.map((p) => ({ ...p })));
    const toScreen = (x, y) => page.evaluate(([x, y]) => window.magnetGame.w2s(x, y), [x, y]);
    const idx = (id) => page.evaluate((id) => window.MagnetGeometry.CHALLENGES.findIndex((c) => c.id === id), id);
    const tray = (shape) => page.evaluate((s) => window.magnetGame.trayPoint(s), shape);
    // drag a tray shape so its centre lands at world (x, y)
    async function dragFromTray(shape, x, y) {
      const a = await tray(shape), b = await toScreen(x, y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
      await page.mouse.move(b.x, b.y, { steps: 6 });
      await page.mouse.up();
    }

    // 0. the first visit opens on the welcome; tapping outside it leaves a blank board in free build
    await page.waitForSelector('#welcome.show');
    assert.match(await page.textContent('#welcomePacks'), /Toy Box.*Halloween/);
    await shot('00-welcome');
    await page.mouse.click(5, 795);
    await page.waitForSelector('#welcome', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.magnetGame.state.mode), 'free');

    // 1. ground snap: dropped slightly above the ground -> rests on y = 0
    await dragFromTray('square', 0, 0.8);
    let ps = await pieces();
    assert.equal(ps.length, 1);
    near(ps[0].y, 0.5);

    // 2. magnet snap sideways: dropped near the right edge -> flush against it
    await dragFromTray('square', 1.14, 0.58);
    ps = await pieces();
    assert.equal(ps.length, 2);
    near(ps[1].x, ps[0].x + 1);
    near(ps[1].y, 0.5);

    // 3. stacking on top snaps to the neighbours' corner points
    await dragFromTray('triangle', 0.55, 1.65);
    ps = await pieces();
    near(ps[2].y, 1.5);
    assert.ok(Math.abs(ps[2].x - ps[0].x) < 0.02 || Math.abs(ps[2].x - ps[1].x) < 0.02 || Math.abs(ps[2].x - 0.5) < 0.02);
    await shot('01-snapped');

    // 4. first tap selects, a second tap on the selected piece turns it
    const sky = await toScreen(-3, 5);
    await page.mouse.click(sky.x, sky.y);                // deselect
    assert.equal(await page.evaluate(() => window.magnetGame.state.selected), null);
    const c = await toScreen(ps[2].x, ps[2].y);
    await page.mouse.click(c.x, c.y);
    ps = await pieces();
    assert.equal(ps[2].rot, 0, 'first tap only selects');
    assert.equal(await page.evaluate(() => window.magnetGame.state.selected.id), ps[2].id);
    await page.waitForTimeout(600);                      // two separate taps, not a double-click
    await page.mouse.click(c.x, c.y);
    ps = await pieces();
    assert.equal(ps[2].rot, 1, 'tapping the selected piece turns it');

    // 4b. the round ↻ button beside the selected piece rotates it too
    const h = await page.evaluate(() => window.magnetGame.rotateHandle());
    assert.ok(h, 'rotate button shown for the selected piece');
    await page.waitForTimeout(400); // let the pop finish before the screenshot
    await shot('01b-rotate-button');
    await page.mouse.click(h.x, h.y);
    ps = await pieces();
    assert.equal(ps[2].rot, 2);
    assert.equal(ps.length, 3, 'tapping the button must not spawn or delete pieces');

    // 5. palette recolors the selected piece
    await page.click('.swatch[data-color="#e5393b"]');
    ps = await pieces();
    assert.equal(ps[2].color, '#e5393b');

    // 6. deleting is only ever done with the bin, which appears top-right while dragging
    const fields = (p) => ({ shape: p.shape, color: p.color, x: p.x, y: p.y, rot: p.rot });
    const binPoint = () => page.evaluate(() => window.magnetGame.binPoint());
    // drag the piece with this id from its centre to screen point b, hold for `wait` ms, release
    async function dragPieceTo(id, b, wait) {
      const q = (await pieces()).find((p) => p.id === id);
      const a = await toScreen(q.x, q.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
      if (wait) await page.waitForTimeout(wait);
      await page.mouse.up();
    }
    // 6a. rest a block on the bin for 250ms and let go: it's deleted
    await dragPieceTo(ps[2].id, await binPoint(), 250);
    assert.equal((await pieces()).length, 2, 'an armed bin deletes the block');
    // 6b. tap the bin straight away: the block comes back exactly as it was
    const binned = await page.evaluate(() => ({ ...window.magnetGame.state.lastBinned }));
    assert.equal(binned.shape, 'triangle');
    const bp = await binPoint();
    await page.mouse.click(bp.x, bp.y);
    ps = await pieces();
    assert.equal(ps.length, 3, 'tapping the bin undoes the delete');
    assert.deepEqual(fields(ps[2]), binned);
    assert.equal(ps[2].color, '#e5393b');
    // 6c. dropping a board block over the tray leaves it resting on the ground
    const sqId = ps[0].id;
    await dragPieceTo(sqId, await tray('arch'));
    ps = await pieces();
    assert.equal(ps.length, 3, 'dropping over the tray never deletes');
    near(ps.find((p) => p.id === sqId).y, 0.5);                // resting on the ground
    // 6d. touch: set a new block on the ground, which leaves the finger 0.5 units into the grass/tray
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const ta = await tray('square'), tb = await toScreen(0, -0.5);
    assert.ok(tb.y >= await page.evaluate(() => window.innerHeight - window.magnetGame.view.trayH),
      'the finger really ends up inside the tray');
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', ta.x, ta.y);
    for (let i = 1; i <= 8; i++) await touch('touchMove', ta.x + (tb.x - ta.x) * i / 8, ta.y + (tb.y - ta.y) * i / 8);
    await touch('touchEnd');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    ps = await pieces();
    assert.equal(ps.length, 4, 'a block set on the ground by touch stays');
    near(ps[3].y, 0.5);
    // 6e. flinging a block across the bin (under 100ms over it) doesn't delete it
    await dragPieceTo(ps[3].id, await binPoint());
    assert.equal((await pieces()).length, 4, 'no dwell, no delete');

    // 6f. a cancelled drag (the OS takes the touch away) puts the block back where it was
    ps = await pieces();
    const before = fields(ps[1]), cancelId = ps[1].id;
    const c1 = await toScreen(ps[1].x, ps[1].y);
    await page.mouse.move(c1.x, c1.y);
    await page.mouse.down();
    await page.mouse.move(c1.x - 120, c1.y - 150, { steps: 6 });
    await page.evaluate(() => {
      const id = window.magnetGame.state.drag.id;
      document.getElementById('stage').dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, bubbles: true }));
    });
    await page.mouse.up();
    ps = await pieces();
    assert.equal(ps.length, 4, 'pointercancel never deletes');
    assert.deepEqual(fields(ps.find((p) => p.id === cancelId)), before);
    await shot('01c-bin');

    // 7. 🧹 is press-and-hold: a tap does nothing, a hold clears, ↩️ brings everything back
    const all = (await pieces()).map(fields);
    await page.click('#btnClear');
    assert.equal((await pieces()).length, 4, 'a tap on 🧹 clears nothing');
    const holdClear = async () => {
      await page.hover('#btnClear');
      await page.mouse.down();
      await page.waitForTimeout(800);
      await page.mouse.up();
    };
    await holdClear();
    assert.equal((await pieces()).length, 0, 'holding 🧹 clears');
    assert.equal(await page.textContent('#btnClear'), '↩️');
    await page.click('#btnClear');                         // undo
    assert.deepEqual((await pieces()).map(fields), all, 'undo restores every piece');
    assert.equal(await page.textContent('#btnClear'), '🧹');
    await holdClear();
    assert.equal((await pieces()).length, 0);

    // 7b. the free build is kept when you go to a challenge (it has its own board)
    await dragFromTray('square', -3, 0.6);
    const freeBlock = fields((await pieces())[0]);

    // 8. the rocket: red nose, 2 blue squares, 2 orange fins
    await page.click('#btnChallenge');
    await page.waitForSelector('#picker.show');            // 🎯 opens the "what to build?" grid
    assert.equal(await page.locator('.pick').count(), 10); // the Toy Box pack, easiest first
    assert.equal(await page.locator('.packTab').count(), 2);
    assert.match(await page.textContent('.pick[data-i="0"]'), /🟢 Easy/);
    await shot('02a-picker');
    const rocket = await idx('rocket');
    await page.click(`.pick[data-i="${rocket}"]`);
    await page.waitForSelector('#picker', { state: 'hidden' });
    await page.waitForSelector('#card.show');
    assert.match(await page.textContent('#cardTitle'), /Rocket/);
    assert.equal((await pieces()).length, 0, 'the challenge starts on its own empty board');
    assert.deepEqual(await page.evaluate(() => window.magnetGame.state.boards.free.map((p) => ({ ...p })))
      .then((b) => b.map(fields)), [freeBlock], 'starting a challenge keeps the free build');
    assert.equal(await page.locator('#chips .chip').count(), 3);
    // the grey outline of the build is always shown; there's no difficulty button
    assert.equal(await page.evaluate(() => window.magnetGame.slots().length), 5);
    assert.equal(await page.locator('#level').count(), 0);
    assert.equal(await page.textContent('#gain'), '+100 🏆');  // points on offer
    await shot('02-challenge');
    const color = (hex) => page.click(`.swatch[data-color="${hex}"]`);
    // tap empty sky to deselect, so picking a colour doesn't repaint the last piece
    const pickForNext = async (hex) => { const s = await toScreen(-3.5, 5.5); await page.mouse.click(s.x, s.y); await color(hex); };
    await page.click('#chips .chip[data-i="0"]');           // chip picks blue
    assert.equal(await page.evaluate(() => window.magnetGame.state.color), '#2f7bea');
    await dragFromTray('square', 0.07, 0.55);
    const x0 = (await pieces())[0].x;
    await dragFromTray('square', x0 + 0.06, 1.6);
    await pickForNext('#ff7a1a');
    await dragFromTray('triangle', x0 - 1.1, 0.6);       // left fin
    await dragFromTray('triangle', x0 + 1.12, 0.55);     // right fin
    await pickForNext('#2fb65a');                        // wrong colour nose...
    await dragFromTray('triangle', x0 - 0.08, 2.6);
    ps = await pieces();
    near(ps[1].x, x0); near(ps[1].y, 1.5);
    near(ps[2].x, x0 - 1); near(ps[3].x, x0 + 1);
    near(ps[4].x, x0); near(ps[4].y, 2.5);
    assert.equal(await page.evaluate(() => window.magnetGame.state.won), false);
    await page.textContent('#chips .chip[data-i="1"]').then((t) => assert.match(t, /0\/1/));
    await color('#e5393b');                              // ...recolour it red (still selected)
    assert.equal(await page.evaluate(() => window.magnetGame.state.won), true);
    await page.waitForSelector('#next.show');               // big ➡️ showing what's next
    assert.equal(await page.textContent('#nextEmoji'), '🗼');
    // first rocket: 5 pieces × 10 + 50 first-time bonus
    assert.equal(await page.evaluate(() => window.magnetGame.state.score), 100);
    assert.equal(await page.textContent('#gain'), '+100 🏆');
    await page.waitForFunction(() => document.getElementById('scoreN').textContent === '100');
    await shot('03-won');
    // 100 points crosses the first 🎁 (checked in step 12); close it so ➡️ can be tapped
    const dismissGift = async () => {
      await page.waitForSelector('#gift.show', { timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#gift', { state: 'hidden' });
    };
    await dismissGift();
    await page.click('#next', { force: true }); // it wiggles
    assert.equal((await pieces()).length, 0);
    assert.equal(await page.evaluate(() => window.magnetGame.state.challengeIdx), await idx('tower'));
    assert.equal(await page.locator('#next.show').count(), 0);
    assert.match(await page.textContent('#cardTitle'), /Tower/);

    // 8b. the outline is shown behind the build, but pieces don't jump into it
    await pickForNext('#2fb65a');
    const sl = await page.evaluate(() => window.magnetGame.slots());
    assert.equal(sl.length, 5);                           // tower
    const top = sl.find((q) => q.shape === 'triangle');
    await dragFromTray('triangle', top.x + 0.4, top.y + 0.3);
    ps = await pieces();
    near(ps[0].x, top.x + 0.4); near(ps[0].y, top.y + 0.3);  // stays where it was dropped
    assert.equal(ps[0].color, '#2fb65a');                 // and keeps its colour
    await holdClear();
    await page.waitForTimeout(300);
    await shot('05-outline');

    // 8c. tap the card's emoji to choose another build; finished ones get a ✅
    await dragFromTray('square', 3, 0.6);                  // something on the board
    await page.click('#cardEmoji');
    await page.waitForSelector('#picker.show');
    assert.equal(await page.locator('.pick.done').count(), 1);
    assert.equal(await page.getAttribute('.pick.done', 'data-i'), String(rocket));
    await page.click(`.pick[data-i="${await idx('horse')}"]`);
    assert.match(await page.textContent('#cardTitle'), /Horse/);
    assert.equal((await pieces()).length, 0);               // fresh board
    assert.equal(await page.evaluate(() => window.magnetGame.slots().length), 6);
    // ✖ closes without changing the build
    await page.click('#cardEmoji'); await page.click('#pickClose');
    await page.waitForSelector('#picker', { state: 'hidden' });
    assert.match(await page.textContent('#cardTitle'), /Horse/);

    // 8d. the score and finished builds survive a reload (pretend all of Halloween but the candy corn is done)
    await page.evaluate(() => {
      const done = JSON.parse(localStorage.getItem('magnet-blocks-done'));
      for (const c of window.MagnetGeometry.CHALLENGES) if (c.pack === 'halloween' && c.id !== 'candycorn') done.push(c.id);
      localStorage.setItem('magnet-blocks-done', JSON.stringify(done));
    });
    await page.reload();
    await page.waitForFunction(() => window.magnetGame);
    assert.equal(await page.textContent('#scoreN'), '100');
    // a returning player skips the welcome and starts in challenges
    assert.equal(await page.isVisible('#welcome'), false);
    assert.equal(await page.evaluate(() => window.magnetGame.state.mode), 'challenge');
    await page.waitForSelector('#picker.show');
    assert.equal(await page.locator('.pick.done').count(), 1);

    // 8e. 🎃 Halloween pack: dusk theme; finishing the last build gives the pack bonus
    await page.click('.packTab[data-pack="halloween"]');
    assert.equal(await page.locator('.pick').count(), 7);
    await shot('06a-halloween-picker');
    await page.click(`.pick[data-i="${await idx('candycorn')}"]`);
    assert.equal(await page.evaluate(() => window.magnetGame.theme()), 'halloween');
    assert.equal(await page.textContent('#gain'), '+70 🏆');  // easy, 2 pieces, first time
    await pickForNext('#f6b800');
    await dragFromTray('trapezoid', 0.05, 0.6);
    const cx = (await pieces())[0].x;
    await pickForNext('#ff7a1a');
    await dragFromTray('triangle', cx + 0.05, 1.6);
    assert.equal(await page.evaluate(() => window.magnetGame.state.won), true);
    assert.equal(await page.evaluate(() => window.magnetGame.state.score), 100 + 70 + 200);
    await page.waitForFunction(() => document.getElementById('scoreN').textContent === '370', null, { timeout: 5000 });
    await shot('06-halloween-won');
    await dismissGift(); // 370 crosses the 🌙 gift

    // 8f. ❓ brings the welcome back
    await page.click('#btnHelp');
    await page.waitForSelector('#welcome.show');
    await page.click('#welcomeChallenge');
    await page.waitForSelector('#picker.show');
    await page.click('#pickClose');
    // ✖️ just closes it and leaves you where you were
    await page.click('#btnHelp');
    await page.waitForSelector('#welcome.show');
    await page.click('#welcomeClose');
    await page.waitForSelector('#welcome', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.magnetGame.state.mode), 'challenge');

    // 9. landscape layout still fits: ground is visible and snapping works.
    // The free build from 7b is still there after the challenges and the reload.
    await page.setViewportSize({ width: 900, height: 480 });
    await page.click('#btnFree');
    assert.equal(await page.evaluate(() => window.magnetGame.theme()), 'toybox');
    ps = await pieces();
    assert.equal(ps.length, 1, 'the free build survives challenges and a reload');
    assert.equal(ps[0].shape, freeBlock.shape); assert.equal(ps[0].color, freeBlock.color);
    near(ps[0].y, freeBlock.y);
    await dragFromTray('arch', 0, 0.7);
    ps = await pieces();
    near(ps[1].y, 0.5);
    await shot('04-landscape');

    // 9b. bigger screens, where a full touch lift reaches above the tray: a touch spawn dragged
    // sideways inside the tray (or cancelled there) is quietly put back, not left on the board
    for (const [w, hgt] of [[900, 480], [768, 1024]]) {
      await page.setViewportSize({ width: w, height: hgt });
      await page.waitForTimeout(100);
      const n = (await pieces()).length;
      const a = await tray('triangle'), b = await tray('trapezoid');
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      for (const end of ['touchEnd', 'touchCancel']) {
        await touch('touchStart', a.x, a.y);
        for (let i = 1; i <= 6; i++) await touch('touchMove', a.x + (b.x - a.x) * i / 6, a.y);
        await cdp.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] });
        assert.equal((await pieces()).length, n, `a touch spawn kept in the tray (${end}) is put back at ${w}x${hgt}`);
      }
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }

    // 9c. every shape can be binned, at every size: wide blocks (trapezoid, arch) are stopped
    // short of the corner by the screen edge, so their centre never reaches the bin
    for (const [w, hgt] of [[420, 800], [768, 1024], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: hgt });
      await page.waitForTimeout(100);
      for (const shape of ['square', 'triangle', 'quarter', 'trapezoid', 'arch']) {
        const n = (await pieces()).length;
        await dragFromTray(shape, -2.5, 0.5);
        const spawned = await pieces();
        assert.equal(spawned.length, n + 1);
        await dragPieceTo(spawned[spawned.length - 1].id, await binPoint(), 250);
        assert.equal((await pieces()).length, n, `a ${shape} dropped on the bin is deleted at ${w}x${hgt}`);
      }
    }

    // 10. short screens: every build's whole outline is visible below the card, and the bar fits
    const choose = async (i) => {
      if (!(await page.isVisible('#picker'))) await page.click('#cardEmoji');
      const pack = await page.evaluate((i) => window.MagnetGeometry.CHALLENGES[i].pack, i);
      await page.click(`.packTab[data-pack="${pack}"]`);
      await page.click(`.pick[data-i="${i}"]`);
      await page.waitForSelector('#picker', { state: 'hidden' });
    };
    const nBuilds = await page.evaluate(() => window.MagnetGeometry.CHALLENGES.length);
    for (const [w, hgt] of [[375, 667], [667, 375], [568, 320]]) {
      await page.setViewportSize({ width: w, height: hgt });
      await page.click('#btnChallenge');
      for (let i = 0; i < nBuilds; i++) {
        await choose(i);
        const m = await page.evaluate(() => {
          const g = window.magnetGame, G = window.MagnetGeometry;
          let top = Infinity, l = Infinity, r = -Infinity;
          for (const sl of g.slots()) for (const v of G.worldPolygon(sl)) {
            const q = g.w2s(v.x, v.y); top = Math.min(top, q.y); l = Math.min(l, q.x); r = Math.max(r, q.x);
          }
          const bar = document.getElementById('bar');
          return { top, l, r, card: document.getElementById('card').getBoundingClientRect().bottom,
            overflow: bar.scrollWidth > bar.clientWidth, name: G.CHALLENGES[g.state.challengeIdx].name };
        });
        assert.ok(m.top >= m.card && m.l >= 0 && m.r <= w && !m.overflow, `${m.name} fits at ${w}x${hgt}: ${JSON.stringify(m)}`);
      }
    }

    // 11. finish the Tower by dragging, on a small landscape phone
    await page.setViewportSize({ width: 568, height: 320 });
    await choose(await idx('tower'));
    await shot('07-tower-568x320');
    const deselect = async () => { const s = await toScreen(-6, 1); await page.mouse.click(s.x, s.y); };
    const swatch = async (hex) => { await deselect(); await color(hex); };
    const towerSlots = await page.evaluate(() => window.magnetGame.slots());
    for (const sl of towerSlots) {
      await swatch(sl.color);
      await dragFromTray(sl.shape, sl.x + 0.06, sl.y + 0.12);
    }
    assert.equal(await page.evaluate(() => window.magnetGame.state.won), true, 'Tower finished at 568x320');
    await shot('08-tower-won-568x320');

    // 12. 🎁 score gifts, each in a fresh browser profile on a 375×667 phone.
    // seed: localStorage values (JSON-encoded) set before the game loads.
    // init: a script run in the page before the game loads.
    const fresh = async (seed, opts = {}, init) => {
      const context = await browser.newContext({ viewport: { width: 375, height: 667 }, ...opts });
      if (init) await context.addInitScript(init);
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await p.goto(url);
      if (seed) {
        await p.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
        await p.reload();
      }
      await p.waitForFunction(() => window.magnetGame);
      return p;
    };
    const G = { CHALLENGES: await page.evaluate(() => window.MagnetGeometry.CHALLENGES.map((c) => ({ id: c.id, pack: c.pack }))),
      reached: (s) => page.evaluate((s) => window.MagnetGeometry.milestonesReached(s), s) };
    const gifts = () => page.evaluate(() => {
      const g = window.magnetGame.gifts;
      return { unlocked: [...g.unlocked], seen: [...g.seen], scene: g.scene, skin: g.skin };
    });
    const stored = (k) => page.evaluate((k) => localStorage.getItem(k), k);
    const pickBuild = async (id) => {
      await page.waitForSelector('#picker.show');
      await page.click(`.packTab[data-pack="${G.CHALLENGES.find((c) => c.id === id).pack}"]`);
      await page.click(`.pick[data-i="${await idx(id)}"]`);
      await page.waitForSelector('#picker', { state: 'hidden' });
    };
    // build the current challenge by dragging each piece into its slot (deselecting first, so a
    // colour pick never repaints the last piece)
    const buildIt = async () => {
      for (const sl of await page.evaluate(() => window.magnetGame.slots())) {
        const s = await toScreen(-4.2, 0.4); await page.mouse.click(s.x, s.y);
        await color(sl.color);
        await dragFromTray(sl.shape, sl.x + 0.06, sl.y + 0.12);
      }
      assert.equal(await page.evaluate(() => window.magnetGame.state.won), true, 'build finished');
    };
    const focused = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    const toyboxBut = (id) => G.CHALLENGES.filter((c) => c.pack === 'toybox' && c.id !== id).map((c) => c.id);

    // 12a. a fresh install finishes the Bridge: one overlay, only once the counter shows 90
    page = await fresh();
    await page.click('#welcomeChallenge');
    await pickBuild('bridge');
    await page.evaluate(() => {
      const el = document.getElementById('gift');
      new MutationObserver(() => {
        if (el.classList.contains('show') && window.giftAt === undefined) window.giftAt = document.getElementById('scoreN').textContent;
      }).observe(el, { attributes: true });
    });
    await buildIt();
    assert.equal(await page.isVisible('#gift'), false, 'no overlay before the count-up');
    await page.waitForSelector('#gift.show', { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.giftAt), '90', 'the overlay waits for the score to show 90');
    assert.equal(await page.getAttribute('#gift', 'aria-label'), 'New gift: Sparkly blocks');
    assert.equal(await focused(), 'giftBox');
    await page.waitForTimeout(500);
    await shot('10-gift-overlay');
    await page.click('#giftBox', { force: true }); // it wobbles
    await page.waitForSelector('#gift.opened');
    assert.equal((await gifts()).skin, 'sparkle', 'opening it switches on ✨ blocks');
    assert.equal(await page.textContent('#giftName'), 'Sparkly blocks', 'the overlay names the gift');
    await page.waitForTimeout(450);
    await shot('11-gift-opened');
    await page.click('#giftShow');
    await page.waitForSelector('#gift', { state: 'hidden' });
    assert.equal(await focused(), 'score', 'focus goes back to 🏆');
    await page.waitForTimeout(800);
    assert.equal(await page.isVisible('#gift'), false, 'exactly one gift');
    assert.deepEqual((await gifts()).unlocked, ['sparkle']);
    assert.equal(await page.isVisible('#giftDot'), false, 'an opened gift leaves no dot');
    await page.context().close();

    // 12b. a win that crosses two thresholds (the Toy Box pack bonus) shows two overlays in turn
    const twoStep = { 'magnet-blocks-welcomed': true, 'magnet-blocks-score': 40, 'magnet-blocks-done': toyboxBut('bridge'),
      'magnet-blocks-gifts': { v: 1, unlocked: [], scene: 'sunny', skin: 'plain', seen: [] } };
    page = await fresh(twoStep);
    await pickBuild('bridge');
    await buildIt();
    assert.equal(await page.evaluate(() => window.magnetGame.state.score), 40 + 90 + 200);
    for (const name of ['Sparkly blocks', 'Night sky']) {
      await page.waitForSelector('#gift.show', { timeout: 6000 });
      assert.equal(await page.getAttribute('#gift', 'aria-label'), 'New gift: ' + name);
      assert.equal(await page.textContent('#scoreN'), '330', 'after the pack-bonus count-up');
      await page.waitForTimeout(500);                       // let the 🎁 pop in from nothing
      await page.click('#giftBox', { force: true });       // it wobbles
      await page.waitForSelector('#gift.opened');
      assert.equal(await page.textContent('#giftName'), name === 'Night sky' ? 'Night sky · in 🎨 free build and 🧸 builds' : name);
      await page.click('#giftShow');
      // closed (the next one follows 300ms later, so don't wait for the overlay to stay hidden)
      await page.waitForFunction(() => !document.getElementById('gift').classList.contains('opened'));
    }
    await page.waitForSelector('#gift', { state: 'hidden' });
    assert.deepEqual(await gifts().then((g) => [g.unlocked, g.scene, g.skin]), [['sparkle', 'night'], 'night', 'sparkle']);

    // 12c. the 🏆 shelf: picking 🌙 sets the sky for free build and 🧸 builds; themed packs keep their own
    await page.click('#score');
    await page.waitForSelector('#gifts.show');
    assert.equal(await page.locator('#skyTiles .tile').count(), 3, '☀️, 🌙 and the wrapped 🎁 (the next gift, 🌊, is a sky)');
    assert.equal(await page.locator('#skinTiles .tile').count(), 2, 'plain and ✨');
    assert.equal(await page.locator('#gifts .tile[data-next]').count(), 1);
    for (const b of await page.locator('#gifts .tile').all()) {
      const r = await b.boundingBox();
      assert.ok(r.width >= 88 && r.height >= 88, 'tiles are at least 88×88');
    }
    await page.click('#skyTiles .tile[data-id="sunny"]');
    await page.waitForSelector('#gifts', { state: 'hidden' });            // closes itself after 400ms
    assert.equal((await gifts()).scene, 'sunny');
    await page.click('#score');
    await page.click('#skyTiles .tile[data-next]');                       // not yet: it wiggles, nothing changes
    assert.equal(await page.isVisible('#gifts'), true);
    await page.waitForTimeout(800);
    await shot('12-gift-shelf');
    await page.click('#skyTiles .tile[data-id="night"]');
    assert.equal(await page.getAttribute('#skyTiles .tile[data-id="night"]', 'aria-pressed'), 'true');
    await page.waitForSelector('#gifts', { state: 'hidden' });
    assert.equal((await gifts()).scene, 'night');
    await page.click('#btnFree');
    assert.equal(await page.evaluate(() => window.magnetGame.sky()), 'night');
    await color('#2f7bea');
    await dragFromTray('square', -1, 0.6);
    await dragFromTray('square', 0.05, 0.6);
    await page.mouse.click(...Object.values(await toScreen(3, 5)));       // deselect, so red only colours new blocks
    await color('#e5393b');
    await dragFromTray('triangle', -0.95, 1.6);
    const free = await pieces();
    assert.deepEqual(free.map((p) => p.color), ['#2f7bea', '#2f7bea', '#e5393b'], 'a block look never changes a colour');
    await page.mouse.click(...Object.values(await toScreen(3, 5)));       // deselect for the picture
    await page.waitForTimeout(400);
    await shot('13-free-night-sparkly');
    await page.click('#btnChallenge');
    await page.click('#pickClose');
    assert.equal(await page.evaluate(() => window.magnetGame.theme()), 'toybox');
    assert.equal(await page.evaluate(() => window.magnetGame.sky()), 'night', 'a 🧸 Toy Box challenge shows the chosen sky');
    await page.click('#cardEmoji');
    await pickBuild('candycorn');
    assert.equal(await page.evaluate(() => window.magnetGame.sky()), 'halloween', 'a themed pack ignores the chosen sky');
    await page.click('#cardEmoji');
    await pickBuild('bridge');                              // back to the Toy Box for the rest of the walk-through

    // 12d. a reload keeps the gifts and the choices; losing the gifts key loses no gift
    await page.reload();
    await page.waitForFunction(() => window.magnetGame);
    assert.deepEqual(await gifts().then((g) => [g.unlocked, g.scene, g.skin]), [['sparkle', 'night'], 'night', 'sparkle']);
    await page.evaluate(() => localStorage.removeItem('magnet-blocks-gifts'));
    await page.reload();
    await page.waitForFunction(() => window.magnetGame);
    assert.deepEqual((await gifts()).unlocked, await G.reached(330), 'every unlock comes back from the score');
    await page.context().close();

    // 12e. migration: a score from before gifts shows no overlay, just the dot and every unlock reached
    // (the issue says "4 unlocks", but 1800 is past the 1700 🚀 threshold, so it's 5)
    page = await fresh({ 'magnet-blocks-welcomed': true, 'magnet-blocks-score': 1800,
      'magnet-blocks-free': [{ shape: 'square', color: '#2fb65a', x: 0, y: 0.5, rot: 0 }] });
    await page.waitForTimeout(2500);
    assert.equal(await page.isVisible('#gift'), false, 'no celebration flood');
    assert.equal(await page.isVisible('#giftDot'), true);
    const migrated = await gifts();
    assert.deepEqual(migrated.unlocked, await G.reached(1800));
    assert.equal(migrated.unlocked.length, 5);
    assert.deepEqual(migrated.seen, []);
    assert.ok(JSON.parse(await stored('magnet-blocks-gifts')).unlocked.length === 5, 'written back');

    // 12h. the top bar gains no button and no height at 375px (#19, the wrap itself, is separate)
    await page.click('#pickClose');
    const bar = await page.evaluate(() => {
      const b = document.getElementById('bar'), h = () => b.getBoundingClientRect().height;
      const before = h();
      for (const id of ['giftStrip', 'giftDot']) document.getElementById(id).style.display = 'none';
      const without = h();
      for (const id of ['giftStrip', 'giftDot']) document.getElementById(id).style.display = '';
      return { before, without, buttons: b.querySelectorAll('button').length, swatches: b.querySelectorAll('.swatch').length,
        score: document.getElementById('score').getBoundingClientRect().height,
        tool: document.getElementById('btnHelp').getBoundingClientRect().height };
    });
    assert.equal(bar.before, bar.without, 'the strip and dot add no height');
    assert.equal(bar.buttons, 5 + 1 + bar.swatches, 'five tools, 🏆 and the swatches: no new button');
    assert.equal(bar.score, bar.tool, '🏆 is the same height as the other buttons');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
    await page.keyboard.press('Shift');
    await page.focus('#score');
    assert.equal(await page.evaluate(() => document.getElementById('score').matches(':focus-visible')), true);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('score')).outlineStyle), 'none', 'a visible focus ring');

    // 12f. reset lives in ❓ behind a confirmation: [Keep everything] changes nothing, [Erase] clears progress
    const keys = ['magnet-blocks-score', 'magnet-blocks-done', 'magnet-blocks-gifts'];
    const snap = () => page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), keys);
    const kept = await snap();
    await page.click('#btnHelp');
    await page.click('#resetOpen');
    await page.waitForSelector('#reset.show');
    assert.equal(await focused(), 'resetKeep', '[Keep everything] is the default');
    assert.match(await page.textContent('#resetText'), /can't be undone/);
    await shot('14-reset-confirm');
    await page.click('#resetKeep');
    await page.waitForSelector('#reset', { state: 'hidden' });
    assert.deepEqual(await snap(), kept, 'keep changes nothing');
    assert.equal(await page.textContent('#scoreN'), '1800');
    await page.click('#resetOpen');
    await page.click('#resetErase');
    await page.waitForSelector('#reset', { state: 'hidden' });
    assert.deepEqual(await snap(), [null, null, null], 'erase clears the three keys');
    assert.equal(await page.textContent('#scoreN'), '0');
    assert.deepEqual(await gifts(), { unlocked: [], seen: [], scene: 'sunny', skin: 'plain' });
    assert.equal(await stored('magnet-blocks-welcomed'), 'true', 'the welcomed flag is kept');
    assert.equal(JSON.parse(await stored('magnet-blocks-free')).length, 1, 'the free build is kept');
    await page.click('#welcomeChallenge');
    await page.waitForSelector('#picker.show');
    assert.equal(await page.locator('.pick.done').count(), 0, 'no finished builds');
    await page.context().close();

    // 12g. reduced motion: no wobble, burst or sparkle animation; a crossfade only
    page = await fresh({ 'magnet-blocks-welcomed': true }, { reducedMotion: 'reduce' });
    await pickBuild('candycorn');
    await buildIt();
    await page.waitForSelector('#gift.show', { timeout: 5000 });
    const anim = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).animationName, sel);
    assert.equal(await anim('#giftBox'), 'none', 'the 🎁 does not wobble');
    const n0 = await page.evaluate(() => window.magnetGame.state.particles.length);
    await page.click('#giftBox');                         // no wobble, so no force needed
    await page.waitForSelector('#gift.opened');
    assert.ok(await page.evaluate(() => window.magnetGame.state.particles.length) <= n0, 'no burst');
    assert.equal(await anim('#giftPreview'), 'none');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('giftShow')).transitionDuration), '0.2s', 'a 200ms crossfade');
    await page.click('#giftShow');
    await page.waitForSelector('#gift', { state: 'hidden', timeout: 1000 }); // closed by the tap, not the 5s timer
    await page.evaluate(() => { document.getElementById('giftStrip').classList.add('near'); document.getElementById('giftDot').hidden = false; });
    assert.equal(await anim('#giftPeek'), 'none'); assert.equal(await anim('#giftDot'), 'none');
    await page.evaluate(() => { document.getElementById('giftStrip').classList.remove('near'); document.getElementById('giftDot').hidden = true; });
    // ✨ blocks hold still: two pictures of a block, a moment apart, are identical
    assert.equal((await gifts()).skin, 'sparkle');
    await page.waitForFunction(() => window.magnetGame.state.particles.length === 0, null, { timeout: 8000 });
    const trap = (await pieces()).find((p) => p.shape === 'trapezoid');
    // the left half only: the wiggling ➡️ can overlap the right end at this size
    const a = await toScreen(trap.x - 0.6, trap.y + 0.25), z = await toScreen(trap.x - 0.05, trap.y - 0.3);
    const clip = { x: a.x, y: a.y, width: z.x - a.x, height: z.y - a.y };
    const pic1 = await page.screenshot({ clip });
    await page.waitForTimeout(700);
    assert.ok(pic1.equals(await page.screenshot({ clip })), 'sparkles do not twinkle under reduced motion');
    await page.context().close();

    // press Tab and Shift+Tab over and over: focus never leaves the dialog
    const tabStaysIn = async (sel) => {
      for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        assert.ok(await page.evaluate((s) => document.querySelector(s).contains(document.activeElement), sel),
          `${key} keeps focus inside ${sel}`);
      }
    };
    const startCandyCorn = async (more) => {
      page = await fresh({ 'magnet-blocks-welcomed': true }, ...(more || []));
      await pickBuild('candycorn');
      await buildIt();                                      // 70 points: crosses the ✨ gift at 50
    };

    // 12i. a gift waiting for its celebration isn't on the shelf yet; then focus stays inside each dialog
    await startCandyCorn();
    await page.click('#score');                             // during the count-up
    await page.waitForSelector('#gifts.show');
    assert.equal(await page.locator('#skinTiles .tile[data-id="sparkle"]').count(), 0, 'no ✨ tile before its celebration');
    assert.equal(await page.isVisible('#giftDot'), false, 'and no dot for it');
    // (Tab inside the shelf is checked in step 13: here the celebration may close it at any moment.)
    await page.waitForSelector('#gift.show', { timeout: 5000 });
    assert.equal(await page.isVisible('#gifts'), false, 'the shelf closes before the overlay opens');
    await tabStaysIn('#gift');
    await page.waitForTimeout(300);
    await page.click('#giftBox', { force: true });          // it wobbles
    await page.waitForSelector('#gift.opened');
    await tabStaysIn('#gift');
    await page.click('#giftShow');
    await page.waitForSelector('#gift', { state: 'hidden' });
    assert.equal(await focused(), 'score', 'focus still goes back to 🏆');
    await page.click('#score');
    assert.equal(await page.locator('#skinTiles .tile[data-id="sparkle"]').count(), 1, 'opened: ✨ is on the shelf');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#gifts', { state: 'hidden' });
    assert.equal(await focused(), 'score');
    await page.click('#btnHelp');
    await page.click('#resetOpen');
    await tabStaysIn('#reset');
    await page.keyboard.press('Escape');
    assert.equal(await focused(), 'resetOpen', 'focus goes back to "Reset progress…"');
    assert.equal(await page.evaluate(() => [...document.body.children].some((el) => el.inert)), false, 'nothing left inert');
    await page.context().close();

    // 12j. a reload in the middle of the count-up still keeps the gift (shown with the dot)
    await startCandyCorn();
    await page.reload();
    await page.waitForFunction(() => window.magnetGame);
    assert.deepEqual((await gifts()).unlocked, ['sparkle']);
    assert.equal(await page.isVisible('#giftDot'), true);
    await page.waitForTimeout(2000);
    assert.equal(await page.isVisible('#gift'), false);
    await page.context().close();

    // 12k. Erase during a win's count-up: no ➡️, no won card, no overlay later, score 0
    await startCandyCorn();
    await page.click('#btnHelp');
    await page.click('#resetOpen');
    await page.click('#resetErase');
    await page.waitForTimeout(3500);                        // past when the count-up and overlay would have been
    assert.equal(await page.isVisible('#gift'), false, 'no overlay');
    assert.equal(await page.isVisible('#next'), false, 'no ➡️');
    assert.equal(await page.locator('#card.won').count(), 0, 'the card is not won');
    assert.equal(await page.textContent('#scoreN'), '0');
    assert.deepEqual(await page.evaluate(() => [window.magnetGame.state.won, window.magnetGame.state.score,
      window.magnetGame.state.boards.challenge.length, document.querySelectorAll('.fly').length]), [false, 0, 0, 0]);
    assert.deepEqual(await gifts(), { unlocked: [], seen: [], scene: 'sunny', skin: 'plain' });
    await page.context().close();

    // 12k2. the reset confirmation opened during the count-up keeps working: the gift waits for it
    page = await fresh({ 'magnet-blocks-welcomed': true });
    await pickBuild('candycorn');
    await buildIt();
    await page.click('#btnHelp');
    await page.click('#resetOpen');
    await page.waitForTimeout(3500);                        // past when the overlay would have opened
    assert.equal(await page.isVisible('#gift'), false, 'the gift waits while the reset confirmation is open');
    await page.click('#resetKeep', { timeout: 2000 });      // still responds
    await page.waitForSelector('#gift.show', { timeout: 2000 });
    assert.equal(await focused(), 'giftBox', 'then the gift takes focus');
    await page.context().close();

    // 12l. the 🎁 opens itself, then closes itself (timings shortened here; 6s and 5s for real)
    page = await fresh({ 'magnet-blocks-welcomed': true });
    assert.deepEqual(await page.evaluate(() => ({ ...window.magnetGame.giftTiming })), { open: 6000, close: 5000 });
    await page.evaluate(() => Object.assign(window.magnetGame.giftTiming, { open: 600, close: 500 }));
    await pickBuild('candycorn');
    await buildIt();
    await page.waitForSelector('#gift.show', { timeout: 5000 });
    await page.waitForSelector('#gift.opened', { timeout: 2000 });   // nobody tapped it
    assert.equal((await gifts()).skin, 'sparkle', 'auto-opened and switched on');
    await page.waitForSelector('#gift', { state: 'hidden', timeout: 2000 });
    assert.equal(await focused(), 'score');
    await page.context().close();

    // 12m. storage that throws (blocked or private mode): win, get a gift, use the shelf and reset, no errors
    page = await fresh(null, {}, () => {
      for (const m of ['getItem', 'setItem', 'removeItem']) Storage.prototype[m] = () => { throw new Error('storage blocked'); };
    });
    await page.click('#welcomeChallenge');
    await pickBuild('candycorn');
    await buildIt();
    await page.waitForSelector('#gift.show', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.click('#giftBox', { force: true });
    await page.click('#giftShow');
    await page.waitForSelector('#gift', { state: 'hidden' });
    await page.click('#score');
    await page.click('#skinTiles .tile[data-id="plain"]');
    await page.waitForSelector('#gifts', { state: 'hidden' });
    assert.equal((await gifts()).skin, 'plain');
    await page.click('#btnHelp');
    await page.click('#resetOpen');
    await page.click('#resetErase');
    assert.equal(await page.textContent('#scoreN'), '0');
    await page.context().close();

    // 13. the prizes shelf: a title, "🏆 300 → 🎁 600" over a bar, exactly one wrapped 🎁 (showing its
    // target) in the row of the next gift and none once all are found, and the grown-ups section at the bottom.
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth &&
      ['welcome', 'gifts', 'reset'].every((id) => { const el = document.getElementById(id); return el.scrollWidth <= el.clientWidth; }));
    const grownUps = async (now) => {
      assert.equal(await page.locator('#gifts #howPoints').count(), 1, 'the grown-ups section is on the shelf');
      assert.equal(await page.locator('#welcome #howPoints').count(), 0, 'and not in ❓');
      assert.equal(await page.evaluate(() => document.getElementById('howPoints').open), false, 'closed by default');
      assert.equal(await page.locator('#howGifts tr').count(), 6);
      assert.equal(await page.textContent('#howNow'), now);
    };
    for (const [score, row, label] of [[30, 'skinTiles', 'a surprise block look'], [60, 'skyTiles', 'a surprise sky'],
      [300, 'skyTiles', 'a surprise sky'], [3000, null]]) {
      page = await fresh({ 'magnet-blocks-welcomed': true, 'magnet-blocks-score': score });
      await page.click('#pickClose');
      await page.click('#score');
      await page.waitForSelector('#gifts.show');
      assert.ok(await page.getByText('Your prizes', { exact: true }).isVisible(), 'the shelf has a title');
      assert.ok(await page.getByText('Tap one to use it', { exact: true }).isVisible());
      assert.equal(await page.locator('#gifts .tile.wrapped').count(), row ? 1 : 0, `wrapped tiles at ${score}`);
      const to = await page.evaluate((s) => { const m = window.MagnetGeometry.nextMilestone(s); return m && m.to; }, score);
      if (row) {
        assert.equal(await page.locator(`#${row} .tile.wrapped`).count(), 1, `in ${row} at ${score}`);
        assert.equal(await page.getAttribute('.tile.wrapped', 'aria-label'), `Next gift at ${to}: ${label}`);
        assert.equal(await page.textContent('.tile.wrapped .tileNum'), String(to), 'the wrapped tile shows its target');
        const k = await page.evaluate((s) => window.MagnetGeometry.nextMilestone(s).k, score);
        const w = await page.evaluate(() => { const b = document.querySelector('.tile.wrapped .tileBar');
          return b.querySelector('i').getBoundingClientRect().width / b.getBoundingClientRect().width; });
        near(w, k, 0.02);
      }
      assert.equal(await page.textContent('#shelfScore'), `${score >= 2900 ? '👑' : '🏆'} ${score}`);
      assert.equal(await page.textContent('#shelfTarget'), to ? `→ 🎁 ${to}` : '', 'the next total to aim for');
      // the only numbers for the child: the score, the target and the target on the wrapped tile
      assert.ok(!/\d/.test(await page.evaluate(() => {
        const c = document.querySelector('#gifts .panel').cloneNode(true);
        for (const el of c.querySelectorAll('#shelfScore, #shelfTarget, .tileNum, #howPoints')) el.remove();
        return c.textContent;
      })), 'no other numbers on the shelf');
      assert.ok(await fits(), `no horizontal scroll at ${score}`);
      if (score === 300) {
        // 13iii. both row labels show, with the skies caption
        for (const t of ['Skies', 'Block looks', 'Shows in 🎨 free build and 🧸 builds']) {
          assert.ok(await page.getByText(t, { exact: true }).isVisible(), t);
        }
        await tabStaysIn('#gifts');                         // Tab stays inside the shelf
        await page.click('.tile.wrapped');                  // wiggles, and its bar pulses
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tile.wrapped .tileBar')).animationName), 'barPulse');
        await page.waitForTimeout(600);
        await shot('15-shelf-300');
        // 13ii. the grown-ups section, at the bottom of the shelf
        await grownUps('Now: 300 🏆. Next gift at 600: 🌊 Underwater');
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('#howGifts tr td:first-child')]
          .filter((td) => td.textContent === '✓').length), 2);
        // reached with Tab inside the trapped shelf, within one full cycle
        const onSummary = () => page.evaluate(() => document.activeElement === document.querySelector('#howPoints summary'));
        for (let i = 0; i < 12 && !(await onSummary()); i++) await page.keyboard.press('Tab');
        assert.ok(await onSummary(), 'Tab reaches the grown-ups summary');
        assert.equal(await page.evaluate(() => document.querySelector('#howPoints summary').matches(':focus-visible')), true);
        await page.keyboard.press('Enter');                 // opens it from the keyboard
        assert.equal(await page.evaluate(() => document.getElementById('howPoints').open), true);
        assert.ok(await fits(), 'the open section fits without sideways scroll');
        await page.locator('#howNow').scrollIntoViewIfNeeded();
        await shot('16-grownups');
        // 13iv. a sky picked in a 🧸 challenge shows straight away (no 🎨 nudge)...
        await page.evaluate(() => { document.getElementById('gifts').scrollTop = 0; });
        await page.click('#skyTiles .tile[data-id="night"]');
        await page.waitForSelector('#gifts', { state: 'hidden' });
        assert.equal(await page.evaluate(() => window.magnetGame.sky()), 'night');
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#btnFree.nudge').count(), 0, 'no nudge in a 🧸 build');
        // ...but in a themed pack 🎨 wiggles (or, with reduced motion, glows) to say where it will show
        await page.click('#cardEmoji');
        await pickBuild('candycorn');
        assert.equal(await page.evaluate(() => window.magnetGame.sky()), 'halloween');
        await page.click('#score');
        await page.click('#skyTiles .tile[data-id="sunny"]');
        await page.waitForSelector('#btnFree.nudge');
        assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('btnFree')).animationName), 'wiggle');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForSelector('#btnFree:not(.nudge)');
        await page.click('#score');
        await page.click('#skyTiles .tile[data-id="night"]');
        await page.waitForSelector('#btnFree.nudge');
        assert.deepEqual(await page.evaluate(() => { const st = getComputedStyle(document.getElementById('btnFree'));
          return [st.animationName, st.boxShadow.includes('rgb(255, 210, 63)')]; }), ['none', true], 'a glow, not a wiggle');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        // 13v. ❓ has a button that opens the shelf; closing it puts focus on 🏆
        await page.click('#btnHelp');
        await page.waitForSelector('#welcome.show');
        assert.equal(await page.textContent('#welcomePrizes'), '🏆 Prizes, backgrounds & points');
        await page.waitForSelector('#welcomePrizes', { state: 'visible' }); // the panel pops in from nothing
        await page.click('#welcomePrizes');
        await page.waitForSelector('#gifts.show');
        assert.equal(await page.isVisible('#welcome'), false, 'the welcome closes');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#gifts', { state: 'hidden' });
        assert.equal(await focused(), 'score');
        // 13vi. a short landscape phone: the shelf scrolls up and down, never sideways
        await page.setViewportSize({ width: 568, height: 320 });
        await page.click('#score');
        await page.click('#howPoints summary');
        assert.ok(await fits(), 'no horizontal scroll at 568×320');
        assert.ok(await page.evaluate(() => { const g = document.getElementById('gifts'); return g.scrollHeight > g.clientHeight; }), 'it scrolls');
        await page.locator('#howNow').scrollIntoViewIfNeeded();
        assert.ok(await page.locator('#howNow').isVisible());
        await shot('17-shelf-568x320');
      }
      if (score === 3000) await grownUps('Every gift found! 👑');
      await page.context().close();
    }

    // 14. the outline reads on every chosen sky in a 🧸 Toy Box challenge: sample just outside its
    // edge (the white line at 1px, the halo at 3px) against the sky 12px out, and want ≥3:1
    const probe = () => page.evaluate(() => {
      const g = window.magnetGame, G = window.MagnetGeometry, c = document.getElementById('stage');
      const cx = c.getContext('2d'), dpr = c.width / window.innerWidth, slots = g.slots();
      const lum = (d) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(d[0]) + 0.7152 * f(d[1]) + 0.0722 * f(d[2]); };
      const px = (p) => lum(cx.getImageData(Math.floor(p.x * dpr), Math.floor(p.y * dpr), 1, 1).data); // the pixel the point is in
      const inside = (p) => { const w = g.s2w(p.x, p.y); return slots.some((sl) => G.pointInPolygon(w.x, w.y, G.worldPolygon(sl))); };
      let n = 0, ok = 0;
      for (const sl of slots) {
        const poly = G.worldPolygon(sl).map((v) => g.w2s(v.x, v.y));
        poly.forEach((a, i) => {
          const b = poly[(i + 1) % poly.length], len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 12) return;
          let nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len;            // outward normal
          if (inside({ x: (a.x + b.x) / 2 + nx * 3, y: (a.y + b.y) / 2 + ny * 3 })) { nx = -nx; ny = -ny; }
          for (let t = 0.1; t < 0.91; t += 0.05) {
            const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            const at = (d) => ({ x: q.x + nx * d, y: q.y + ny * d });
            if (inside(at(1)) || inside(at(12)) || at(12).y >= g.view.groundY) continue; // edges between pieces, the ground
            const sky = px(at(12)), cr = (l) => (Math.max(l, sky) + 0.05) / (Math.min(l, sky) + 0.05);
            n++;
            if (Math.max(cr(px(at(1))), cr(px(at(3)))) >= 3) ok++;
          }
        });
      }
      return { n, share: ok / n };
    });
    page = await fresh({ 'magnet-blocks-welcomed': true, 'magnet-blocks-score': 3000 });
    await pickBuild('rocket');
    for (const sc of ['night', 'sea', 'space', 'dusk']) {
      await page.evaluate((sc) => { window.magnetGame.gifts.scene = sc; }, sc);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.magnetGame.sky()), sc);
      const r = await probe();
      assert.ok(r.n >= 40 && r.share >= 0.9, `outline contrast on ${sc}: ${JSON.stringify(r)}`);
      await shot('18-rocket-' + sc);
    }
    await page.click('#cardEmoji');
    await pickBuild('ghost');
    assert.equal(await page.evaluate(() => window.magnetGame.sky()), 'halloween', 'Halloween ignores the chosen sky');
    const rg = await probe();
    assert.ok(rg.share >= 0.9, `outline contrast on Halloween: ${JSON.stringify(rg)}`);
    await page.context().close();

    assert.deepEqual(errors, []);
    console.log('smoke test passed');
  } catch (e) {
    failed = true;
    console.error(e);
    if (errors.length) console.error('page errors:', errors);
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(failed ? 1 : 0);
})();
