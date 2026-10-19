# 🧲 Magnet Blocks

A browser game for toddlers and young children, based on a box of chunky magnetic
stacking blocks. Drag shapes out of the tray. They click together like magnets.
Build anything you like, or take on themed challenges: the 10 creations pictured on the box,
plus a 🎃 Halloween pack.

![Challenge complete](docs/challenge-won.png)

It is made for tablets and phones first and works with a mouse too. Instead of words it
uses emoji, big touch targets and happy sounds. It has no timers or fail states. Finishing a
build earns 🏆 points, and that's the only score.

## How to play

| Do this | What happens |
| --- | --- |
| Drag a shape out of the bottom tray | A new block (there's no limit) follows your finger |
| Drop it near another block | It snaps into place with a *click* and a glow 🧲 |
| Tap a block | It is selected, ready for a new colour |
| Tap the selected block again | It turns 90° |
| Tap the round ↺ button beside the selected block | It turns 90° again |
| Tap a color | It recolors the selected block and colors new blocks |
| Drag a block into the tray | It's deleted 🗑️ |
| Tap a shape in the tray | A block drops into the middle of the play area |
| 🧹 | Clears everything |
| 🎯 / 🎨 | Challenges / free build. 🎯 opens a grid where you choose a theme (🧸 Toy Box or 🎃 Halloween) and what to build. Tap the big emoji on the card to choose again; finished builds get a ✅ |
| 🏆 | Your score. It goes up every time you finish a build and is remembered on this device |
| 🔊 | Sound on/off |

**Challenges 🎯:** a card says what to build, for example "Build a Rocket! 🚀". It shows
each piece you need as a coloured shape with a count, such as 2 blue squares, 1 red
triangle and 2 orange triangles. Tapping a shape on the card picks its colour. The ⭐ button
on the card sets the difficulty, and the choice is remembered:

| Level | Help on screen |
| --- | --- |
| ⭐ | A plain grey **outline** of the build, without colours or piece lines. Pieces don't jump into it, so you still have to work out which pieces fit where. |
| ⭐⭐ | Only the card's counts. |

When your blocks **match the build**, with every piece in the right colour, in the right
place and turned the right way, there's confetti and a little tune. The build can stand
anywhere on the board. A ✅ on the card means all of that piece are in the right place,
and `1/2` means one of two is. Then a big green ➡️ button
appears just above the grass, showing the emoji of the next build. Blocks lying
elsewhere on the board don't count against you.

**Easy → hard 🟢🟡🔴:** each build gets a tier from how tricky it is: one point per piece,
two more per piece that has to be turned, and one more per extra kind of shape.

| Tier | Complexity |
| --- | --- |
| 🟢 easy | up to 6 |
| 🟡 medium | 7–10 |
| 🔴 hard | 11 and up |

Within each theme the builds are ordered easiest first. ➡️ follows that path to the next
build you haven't finished, so a child works up from the Bridge and the Tree to the Horse.
Nothing is locked, and you can still pick any build from the grid. The grid shows each
build's tier dot and the points it's worth.

![Choosing a Halloween build](docs/picker.png)

**Score 🏆:** each finished build gives points. A "+N" flies from the card to the 🏆
counter, which counts up with a little *ding*:

| | Points |
| --- | --- |
| Each piece in the build | 10 |
| Tier | ×1 🟢, ×2 🟡, ×3 🔴 |
| On ⭐⭐ | ×2 |
| First time you finish that build | +50 bonus |
| First time you finish every build in a theme | +200 bonus, with an encore of confetti |

So the Rocket (5 pieces, 🟢) is worth 50 on ⭐, or 150 the first time on ⭐⭐. The Horse
(6 pieces, 🔴) is worth 180 on ⭐. The card shows the points on offer before you start.
The score and the ✅ finished builds are saved in `localStorage`, so they survive a reload.

**Themes 🎃:** choosing a 🎃 Halloween build turns the sky to dusk, with a big moon,
bats flitting past and pumpkins in the grass. The pack has 7 builds, all made from the
same box of blocks: Candy Corn 🍬, Witch Hat 🧙, Cat 🐈‍⬛, Haunted House 🏚️, Ghost 👻,
Bat 🦇 and Pumpkin 🎃.

![The Halloween builds](docs/halloween.png)

![The 10 builds](docs/builds.png)

Each build is a target layout in `geometry.js`, with the pack it belongs to (see `PACKS`).
Its piece counts and tier are worked out from that layout. No build needs more of a
shape than the real box contains. To add a theme, add an entry to `PACKS` and give
its builds that `pack` id.

## The block set

| Shape | In the box | Size (square = 1) |
| --- | --- | --- |
| Square | 5 | 1 × 1 |
| Triangle | 3 | isosceles, base 1, height 1 |
| Quarter circle | 4 | radius 1 |
| Arch | 2 | 2 × 1, semicircle (r = ½) cut from the bottom |
| Trapezoid | 1 | 2 wide at the bottom, 1 wide at the top, 1 tall |

Colors: gold, purple, orange, blue, red, green and teal.

## Running it

There's no build step and there are no runtime dependencies. Any static file server will do:

```sh
npm start            # node scripts/serve.js 8000 → http://localhost:8000/
# or: python3 -m http.server
```

**Deploying:** `.github/workflows/pages.yml` runs the unit tests and publishes the
site to GitHub Pages on every push to `main`. First set *Settings → Pages → Source* to
*GitHub Actions*. The workflow stamps the script URLs in `index.html` with the
commit hash (`game.js?v=…`), so browsers never mix a cached old script with a new page. On Vercel, import the repo as a static site with no build command.

## Code layout

| File | What it does |
| --- | --- |
| `index.html` | Layout, top bar, palette and challenge card (CSS inline) |
| `game.js` | Canvas rendering, pointer input, WebAudio sounds, confetti and UI |
| `geometry.js` | **Pure** logic with no DOM: shapes, transforms, magnet/ground snapping, hit testing, connectivity and challenges. Works in Node and the browser (`window.MagnetGeometry`) |
| `tests/geometry.test.js` | Unit tests (`node:test`) |
| `tests/smoke.js` | Playwright smoke test that drags real pieces with the mouse |
| `scripts/serve.js` | Tiny static server used by `npm start` and the smoke test |

**World model:** world units with the square at 1×1, the ground at `y = 0` and +y pointing up.
A piece is `{ id, shape, color, x, y, rot }`, where `(x, y)` is the centre of its bounding
box and `rot` counts 90° turns. The view always fits about 9 units across and 7 above
the ground, so builds fit in portrait and landscape.

**Snapping:** each shape has snap points (its vertices, its edge midpoints, and points
one unit apart along the 2-wide edges). While you drag, the nearest pair of points
between the dragged piece and any other piece is found. If that pair is within 0.3
units, the piece moves so the two points meet. A snap that would push the piece below
the ground is skipped. In that case the piece rests on the ground and can still slide
sideways to meet a neighbour. Two pieces are *connected* when they share a point.

## Tests

```sh
npm run test:unit    # pure geometry and snapping tests, no browser
npm run test:e2e     # Playwright smoke test; uses the installed Chromium, never downloads it
SHOTS=out npm run test:e2e   # also saves screenshots to ./out
```

The smoke test checks ground snapping, sideways and stacked magnet snapping,
tap to select then tap again to rotate, the ↺ rotate button, choosing a build from the picker, recoloring, deleting by dragging into the tray, the broom, completing
the rocket challenge in the right colours (including fixing a wrong-coloured piece),
the outline on ⭐ (pieces aren't pulled into it), the score for a finished build and that it
survives a reload, ➡️ going to the next build on the path, the 🎃 theme and its pack bonus,
and the landscape layout. It fails on any page error.

## Roadmap

- **Group drag:** drag a whole snapped stack at once.
- **3D-looking blocks:** give the pieces thickness and lighting, while building stays in the flat plane.
- **Save and share builds:** for example as a URL hash or a picture.
- **Gentle physics:** unsupported blocks wobble or slide down softly, never in a frustrating way.
