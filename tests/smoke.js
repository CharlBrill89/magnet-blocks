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
    const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
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

    // 0. the first visit opens on the welcome; 🎨 starts free build
    await page.waitForSelector('#welcome.show');
    assert.match(await page.textContent('#welcomePacks'), /Toy Box.*Halloween/);
    await shot('00-welcome');
    await page.click('#welcomeFree');
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

    // 6. dragging a piece into the tray deletes it
    const t = await tray('arch');
    const p0 = await toScreen(ps[2].x, ps[2].y);
    await page.mouse.move(p0.x, p0.y);
    await page.mouse.down();
    await page.mouse.move(t.x, t.y, { steps: 10 });
    await page.mouse.up();
    assert.equal((await pieces()).length, 2);

    // 7. broom clears
    await page.click('#btnClear');
    assert.equal((await pieces()).length, 0);

    // 8. the rocket: red nose, 2 blue squares, 2 orange fins
    await page.click('#btnChallenge');
    await page.waitForSelector('#picker.show');            // 🎯 opens the "what to build?" grid
    assert.equal(await page.locator('.pick').count(), 10); // the Toy Box pack, easiest first
    assert.equal(await page.locator('.packTab').count(), 2);
    assert.match(await page.textContent('.pick[data-i="0"]'), /🟢/);
    await shot('02a-picker');
    const rocket = await idx('rocket');
    await page.click(`.pick[data-i="${rocket}"]`);
    await page.waitForSelector('#picker', { state: 'hidden' });
    await page.waitForSelector('#card.show');
    assert.match(await page.textContent('#cardTitle'), /Rocket/);
    assert.equal(await page.locator('#chips .chip').count(), 3);
    // starts on ⭐ (outline); go to ⭐⭐ (counts only) for this part
    assert.equal(await page.textContent('#level'), '⭐');
    assert.equal(await page.evaluate(() => window.magnetGame.slots().length), 5);
    await page.click('#level');
    assert.equal(await page.textContent('#level'), '⭐⭐');
    assert.equal(await page.evaluate(() => window.magnetGame.slots().length), 0);
    assert.equal(await page.textContent('#gain'), '+150 🏆');  // points on offer
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
    // first rocket on ⭐⭐: 5 pieces × 10 × 2 + 50 first-time bonus
    assert.equal(await page.evaluate(() => window.magnetGame.state.score), 150);
    assert.equal(await page.textContent('#gain'), '+150 🏆');
    await page.waitForFunction(() => document.getElementById('scoreN').textContent === '150');
    await shot('03-won');
    await page.click('#next', { force: true }); // it wiggles
    assert.equal((await pieces()).length, 0);
    assert.equal(await page.evaluate(() => window.magnetGame.state.challengeIdx), await idx('tower'));
    assert.equal(await page.locator('#next.show').count(), 0);
    assert.match(await page.textContent('#cardTitle'), /Tower/);

    // 8b. ⭐ outline: shown behind the build, but pieces don't jump into it
    await page.click('#level');                           // ⭐⭐ -> ⭐
    assert.equal(await page.textContent('#level'), '⭐');
    await pickForNext('#2fb65a');
    const sl = await page.evaluate(() => window.magnetGame.slots());
    assert.equal(sl.length, 5);                           // tower
    const top = sl.find((q) => q.shape === 'triangle');
    await dragFromTray('triangle', top.x + 0.4, top.y + 0.3);
    ps = await pieces();
    near(ps[0].x, top.x + 0.4); near(ps[0].y, top.y + 0.3);  // stays where it was dropped
    assert.equal(ps[0].color, '#2fb65a');                 // and keeps its colour
    await page.click('#btnClear');
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
    assert.equal(await page.textContent('#scoreN'), '150');
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
    assert.equal(await page.textContent('#level'), '⭐');
    assert.equal(await page.textContent('#gain'), '+70 🏆');  // easy, 2 pieces, first time
    await pickForNext('#f6b800');
    await dragFromTray('trapezoid', 0.05, 0.6);
    const cx = (await pieces())[0].x;
    await pickForNext('#ff7a1a');
    await dragFromTray('triangle', cx + 0.05, 1.6);
    assert.equal(await page.evaluate(() => window.magnetGame.state.won), true);
    assert.equal(await page.evaluate(() => window.magnetGame.state.score), 150 + 70 + 200);
    await page.waitForFunction(() => document.getElementById('scoreN').textContent === '420', null, { timeout: 5000 });
    await shot('06-halloween-won');

    // 8f. ❓ brings the welcome back
    await page.click('#btnHelp');
    await page.waitForSelector('#welcome.show');
    await page.click('#welcomeChallenge');
    await page.waitForSelector('#picker.show');
    await page.click('#pickClose');

    // 9. landscape layout still fits: ground is visible and snapping works
    await page.setViewportSize({ width: 900, height: 480 });
    await page.click('#btnFree');
    assert.equal(await page.evaluate(() => window.magnetGame.theme()), 'toybox');
    await dragFromTray('arch', 0, 0.7);
    ps = await pieces();
    near(ps[0].y, 0.5);
    await shot('04-landscape');

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
