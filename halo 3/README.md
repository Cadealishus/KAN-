# Halo Ring Collection — All 26

A KAN community mod for **HUMAN SPACE PROGRAM**.
Author: **benjeep10** · Version **0.2.1**

26 Kerfin Ring Installations (KRI-01 … KRI-26). **KRI-01 is fully implemented**
with artificial gravity and a visible megastructure. The other 25 are data
entries — they are registered and listed, but deliberately have **no physics
and no meshes** until each is finished.

## Why it is built this way

26 ringworlds must not become 26 gravity wells. HSP's gravity is an n-body sum
over the active body, its ancestors and its mons; adding 26 more attractors
would change every trajectory in the game. So:

* Only rings marked `implemented: true` register any physics at all.
* The gravity provider returns `null` unless the vessel is inside a ring's
  band **and** within its `activationRange`. Away from a ring, HSP's gravity is
  **bit-for-bit identical** to stock — this is verified by a test.
* Meshes are created lazily and hidden beyond `visualRange`, so an
  unimplemented ring costs nothing per frame.

## Install (current HSP, no core edits)

HSP 0.84's KAN screen is visual-only — it cannot install packages yet. Until it
can, load the mod with four script tags after the game, or paste them in the
console:

```html
<script src="src/hsp-ext-shim.js"></script>
<script src="src/halo-ring-physics.js"></script>
<script src="src/halo-ring-renderer.js"></script>
<script src="src/halo-ring-mod.js"></script>
<script>HaloRingMod.init(window.HSP_EXT);</script>
```

**No HSP file is modified.** `hsp-ext-shim.js` builds the `HSP_EXT` hook API by
wrapping two globals HSP already exposes (`window.hspGravityFull` and
`flightScene`). If a future HSP ships a real `HSP_EXT`, the shim stands aside
and the mod uses the official one instead.

Remove the mod with `HaloRingMod.shutdown()` — or by deleting the files. Both
restore stock behaviour; the tests check this.

## How the ring works

A ring is a spinning cylinder band. For any point, the mod decomposes position
into the ring's frame: distance along the spin axis (`axial`) and distance from
the axis (`radial`). The floor is at `radial == radius`, and for someone standing
on the inside, **down is outward**.

Spin rate comes from the requested floor gravity: `ω = √(a / r)`.
KRI-01: r = 5,000 km, a = 9.2 m/s² → ω = 1.356e-3 rad/s, floor speed 6.78 km/s.

### The transition problem

Real centrifugal force only acts on something already co-rotating. A craft
arriving from outside is not, so applying full `ω²r` at the boundary would fling
it sideways. Instead the pull is ramped in with a smoothstep on depth and aimed
strictly **outward along the radial**, which never injects tangential energy.
Measured ramp for KRI-01:

| height above floor | artificial gravity |
|---|---|
| 0 km | 9.200 m/s² |
| 400 km | 7.376 m/s² |
| 800 km | 3.621 m/s² |
| 1200 km | 0.510 m/s² |
| 1600 km | 0.000 m/s² |

Largest change across a 10 km step: **0.04 m/s²** — a smooth ramp, no cliff.
Outside the band edge the ring contributes exactly zero.

## Scaling to all 26

Nothing changes structurally. Set `implemented: true` on a ring in
`data/rings.json` and give it a `terrainSeed` and theme. Cost is bounded because:

* the gravity provider early-outs on `implemented`, then on band, then on range —
  so an inactive ring is three comparisons per physics step;
* meshes exist only within `visualRange`;
* at most one ring can be active at a time (they are spaced far apart), so local
  physics never stacks.

If all 26 were ever implemented and the player somehow sat between two, the
provider returns the first match rather than summing — that is intentional.

### Cheat-panel safety

HSP's cheat panel indexes `HSP_BODIES[sel.value]` for both the description and
the button result message. A ring is deliberately not a body, so those lookups
would throw `Cannot read properties of undefined`. The mod therefore intercepts
its own `halo:` ids for the dropdown's `onchange` and for both buttons, and
never lets them reach the core lookups. Normal bodies pass straight through,
and `shutdown()` restores the original handlers.

## Not done yet (honest list)

* **No landing.** `HaloPhysics.surface()` exists and returns clearance and up
  vector, but is **not registered** as a surface provider. Touching HSP's contact
  solver is the risky part and belongs in step 2, as the brief allows.
* **No ring terrain.** The band is a smooth cylinder; there is no local terrain
  patch generation yet.
* **No atmosphere** on the ring.
* **Map view**: rings register as megastructures with a `centre(t)` function, but
  HSP's map does not read `HSP_EXT.megastructures` yet — that needs a small core
  change on HSP's side.
* Rings orbit on a simple fixed-phase circle, not a full Kepler solution.

## Layout

```
manifest.json          mod metadata for KAN
data/rings.json        all 26 ring definitions
src/hsp-ext-shim.js    installs HSP_EXT without editing HSP
src/halo-ring-physics.js   ring frame maths + artificial gravity (pure)
src/halo-ring-renderer.js  megastructure meshes, floating-origin aware
src/halo-ring-mod.js       registry, lifecycle, entry point
assets/                textures and models (empty for now)
```

## Getting to a ring

Once installed, KRI-01 appears in the flight cheats panel's destination
dropdown as **◍ KRI-01 — Verdant Halo (ring)**:

* **Circular orbit around body** → drops you 40 km above the ring floor
* **Land on body** → places you just above the floor

The ring is not a celestial body, so it is added to that dropdown by the mod
wrapping `hspOrbitBody` / `hspLandBody` and namespacing its ids as
`halo:KRI-01`. Normal bodies pass straight through to HSP's own handlers, and
`shutdown()` unwraps both. No HSP file is edited.

The mod also takes over the panel's description text and both buttons for its
own ids. HSP's cheat panel indexes `HSP_BODIES[sel.value]` directly, and a ring
is deliberately not a body, so letting a `halo:` id reach that lookup threw
`Cannot read properties of undefined`. Normal bodies pass through untouched and
`shutdown()` restores the original handlers.

You arrive **moving with the ring**. The ring is parented to Kerfin, which
travels ~9.4 km/s through the Sun frame, so a naive teleport that zeroed
velocity would fling the craft across the band at orbital speed.

## Console helpers

```js
HaloRingMod.rings                  // all 26 definitions
HaloRingMod.probe(pos, t)          // depth / band / gravity at a point
HaloRingMod.teleportToRing('KRI-01')      // 40 km above the floor
HaloRingMod.teleportToRing('KRI-01', 0.5) // half a km above the floor
HaloRingMod.shutdown()             // remove cleanly
```
