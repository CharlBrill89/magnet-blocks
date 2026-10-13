# 🧲 Magnet Blocks

A browser game for toddlers and young children, based on a box of chunky magnetic
stacking blocks. Drag shapes out of the tray. They click together like magnets.
Build anything you like, or build one of the 10 creations pictured on the box.

![Challenge complete](docs/challenge-won.png)

It is made for tablets and phones first and works with a mouse too. Instead of words it
uses emoji, big touch targets and happy sounds. It has no timers, scores or fail states.

## How to play

| Do this | What happens |
| --- | --- |
| Drag a shape out of the bottom tray | A new block (there's no limit) follows your finger |
| Drop it near another block | It snaps into place with a *click* and a glow 🧲 |
| Tap a block | It turns 90° and is selected |
| Tap a color | It recolors the selected block and colors new blocks |
| Drag a block into the tray | It's deleted 🗑️ |
| Tap a shape in the tray | A block drops into the middle of the play area |
| 🧹 | Clears everything |
| 🎨 / 🎯 | Free build / challenges |
| 🔊 | Sound on/off |

**Challenges 🎯:** a card says what to build, for example "Build a Rocket! 🚀", and shows
how many of each shape you need. When your blocks form **one connected, snapped
structure** that has at least those pieces, there's confetti and a little tune,
and a ➡️ button moves on. Blocks lying elsewhere on the board don't count against
you. The 10 builds are rocket, tower, castle, robot, horse, dome house, guitar, boat,
bridge and tree. No build needs more pieces than the real box contains.

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
*GitHub Actions*. On Vercel, import the repo as a static site with no build command.

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
tap-to-rotate, recoloring, deleting by dragging into the tray, the broom, completing
the rocket challenge, and the landscape layout. It fails on any page error.

## Roadmap

- **Group drag:** drag a whole snapped stack at once.
- **"Copy this picture" mode:** show a silhouette of a build to fill in.
- **Save and share builds:** for example as a URL hash or a picture.
- **Gentle physics:** unsupported blocks wobble or slide down softly, never in a frustrating way.
