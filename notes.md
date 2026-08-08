# Broken Glass Shader — Notes (M1–M7)

Everything we built, explained twice for every idea:
- **Noob** — plain language, analogies, no jargon.
- **Pro** — the precise, technical way to say it.
- **Code** — the actual GLSL/JSX we wrote (with the fixes applied).

**Where you are now:** a fullscreen pane of glass with a wallpaper photo behind it, a seamless Voronoi crack network with dark hairlines and bright glints, fake refraction, a vignette, a time-gated reveal from the center, hover that widens cracks, and click impacts that burst outward. This document is your revision guide — read it before you touch the code again.

---

## Table of contents

1. The GPU pipeline (vertex + fragment)
2. Attributes, uniforms, varyings
3. The fullscreen quad (React Three Fiber)
4. GLSL math toolkit
5. Time and animation (the uniform bridge)
6. The sin normalization trick
7. Hash functions (reliable randomness)
8. Voronoi noise — the territory map
9. Edges as cracks (`d2 - d1`)
10. Scope in GLSL
11. Gotchas and traps (all milestones)
12. M4 — Glass shaping (gradient, core + glint, refraction, vignette)
13. M5 — The reveal from center
14. M6 — Interaction (uniform pipe, hover, click burst)
15. M7 — Texture background + aspect cover
16. Mental-model cheatsheet
17. Tuning map (every knob → effect)
18. The complete final code (App.jsx)
19. Where it could go next

---

## 1. The GPU pipeline (vertex + fragment)

**Noob:** Your GPU doesn't loop over pixels like JavaScript. It runs one tiny program *per pixel, all at the same time*. That's why shaders are fast — the pixel count is handled by parallelism, not by a `for` loop. Every shader is two stages:
- **Vertex shader** — runs once per *corner* of a triangle. Decides where the corner is on screen.
- **Fragment shader** — runs once per *pixel* the triangle covers. Decides that pixel's color.

**Pro:** The vertex stage transforms per-vertex attributes (`position`, `uv`) through the model → view → projection matrix chain into clip space, writing values to `varying` outputs. The rasterizer interpolates those varyings per-fragment. The fragment stage emits a single color. This runs in parallel for every fragment, so each fragment is an independent, pure computation.

**Code (vertex shader):**
```glsl
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```
`projectionMatrix`, `modelViewMatrix`, `position`, and `uv` are all injected by three.js automatically.

---

## 2. Attributes, uniforms, varyings

**Noob:** Three kinds of data reach a shader:
- **Attribute** — a property of each *corner* of the geometry (`position`, `uv`). Different at every corner.
- **Uniform** — one value for the *whole draw call*, shared by every pixel (`uTime`, `uMouse`, `uClickPos`, ...). This is the CPU→GPU bridge.
- **Varying** — a *handoff*: written per-corner in the vertex shader, smoothly interpolated per-pixel in the fragment shader. This is how `uv` becomes "my address on screen."

**Pro:**
- Attributes: per-vertex, read-only in the vertex shader.
- Uniforms: constant across the draw call, readable in both stages.
- Varyings: outputs of the vertex shader, interpolated per-fragment, read in the fragment shader.

**Code:**
```glsl
// vertex: write it
varying vec2 vUv;
void main() { vUv = uv; ... }

// fragment: read it (must declare the same varying)
varying vec2 vUv;
```

**Key insight:** on a fullscreen quad, `uv` interpolates `0→1` across the whole window. Every pixel has a unique address — that's the foundation of everything procedural.

---

## 3. The fullscreen quad (React Three Fiber)

**Noob:** We want the shader to paint the whole window. So we put one flat rectangle in front of the camera and size it to *exactly* fill the view. Then `uv` covers the entire screen.

**Pro:** R3F's `useThree(s => s.viewport)` returns the world-space size of what the camera sees:
- Orthographic camera: `{ width: canvasPx / zoom, height: canvasPx / zoom }`
- Perspective camera: the frustum's visible width/height at the target depth.

Sizing the plane to the viewport makes it fill the screen for **either** camera type. A 2×2 quad does *not* fill the screen in R3F — we verified this against the library source (`updateCamera` sets ortho bounds to ±canvasPx/2), so 1 world unit = 1 CSS pixel at zoom 1.

**Code:**
```jsx
function Quad() {
    const materialRef = useRef();
    const { viewport } = useThree();

    return (
        <mesh position={[0, 0, 0]}>
            <planeGeometry args={[viewport.width, viewport.height]} />
            <shaderMaterial
                ref={materialRef}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={{ uTime: { value: 0 } }}
            />
        </mesh>
    );
}
```
A flat quad only needs 1×1 segments (the default) — two triangles already interpolate `uv` across the whole plane. Extra segments are wasted work.

---

## 4. GLSL math toolkit

Every tool we used, noob + pro:

| Function | Noob | Pro |
|---|---|---|
| `mix(a, b, t)` | Blend from `a` toward `b` by amount `t` | Linear interpolation: `a*(1-t) + b*t`. `t` in `[0,1]` |
| `smoothstep(a, b, x)` | Fades 0→1 smoothly between `a` and `b` | Smooth Hermite step with clamped ratio |
| `fract(x)` | The "where am I inside my box" part | `x - floor(x)`, in `[0, 1)` |
| `floor(x)` | The "which box am I in" part | Largest integer `<= x` |
| `step(a, x)` | A hard switch at `a` | `0` if `x < a`, else `1` |
| `sin(x)` | A smooth wave | Period `2π`, range `[-1, 1]` |
| `atan(y, x)` | Which direction am I facing | Angle of a vector, `[-π, π]` |
| `dot(a, b)` | Combined strength of two directions | Sum of component products |
| `length(v)` / `distance(a, b)` | How far | Euclidean magnitude / distance |
| `clamp(x, a, b)` | Squeeze into a range | `min(max(x, a), b)` |
| `max(a, b)` | Keep the bigger | Useful for merging masks safely |

### The smoothstep "reversed edge" trick

**Noob:** `smoothstep(a, b, x)` with `a > b` **flips** the fade — instead of rising, it falls.

**Pro:** `smoothstep(a, b, x)` with reversed edges returns `1` when `x <= b` and `0` when `x >= a`, with a smooth falloff between.

**Code (the dot mask):**
```glsl
float dist = distance(spot, hash(tilenumber));
float radius = 0.05;
float blur = 0.02;
float brightness = smoothstep(radius + blur, radius, dist); // 1 at the dot
```
**Code (equivalent with normal order):**
```glsl
float brightness = 1.0 - smoothstep(radius, radius + blur, dist);
```

This "solid core + soft edge" pattern is reused over and over: dots first, crack lines next, hover/proximity masks, the reveal front, the shock ring. Once you see it, you see it everywhere.

---

## 5. Time and animation (the uniform bridge)

**Noob:** Shaders are pure functions — same input, same output. To animate, you hand the shader a new input every frame: **time**. A uniform set from JS each frame is the whole animation secret.

**Pro:** Shaders have no persistent state. All motion must come from a time input. R3F's `useFrame` callback runs each rendered frame and provides `state.clock`; you write the elapsed time into the uniform's `.value`. The uniform object must remain the **same JS object** across frames — mutate `.value`, never recreate the object.

**Code:**
```jsx
useFrame((state) => {
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
});
```
```glsl
uniform float uTime;
```

---

## 6. The sin normalization trick

**Noob:** `sin` goes from `-1` to `1`, but a color channel only works in `[0, 1]`. Negative values get clamped to black, causing harsh flicker. Fix: shrink the wave, then shift it up.

**Pro:** `sin` outputs `[-1, 1]`; framebuffers clamp to `[0, 1]`, wasting half the range and producing hard flicker. Mapping `x → x*0.5 + 0.5` rescales to `[0, 1]` while preserving smoothness.

**Code:**
```glsl
float pulse = sin(uTime * 2.0) * 0.5 + 0.5; // speed *2, then shrink + shift
```

**Why it works:**
- `uTime * 2.0` → speed (cycles twice as fast)
- `sin(...)` → smooth wave in `[-1, 1]`
- `* 0.5` → amplitude `[-0.5, 0.5]`
- `+ 0.5` → range `[0, 1]`

Same shape feeds the refraction wobble in M4: `sin(uTime + vUv.y * 10.0) * 0.5 + 0.5` — a spatial `+ vUv.y * 10.0` inside the wave makes it *vary across the screen*, not just over time.

---

## 7. Hash functions (reliable randomness)

**Noob:** A shader runs every pixel every frame. Real randomness would re-roll the screen constantly → shimmer. So we use a **hash**: a machine that *pretends* to be random but is fully deterministic. Same input → same output, always. Give it a different tile number and it returns a totally different-looking value.

**Pro:** A hash maps an integer (cell id) to a pseudo-random value in `[0,1)` using a chaotic function (trig + dot product) folded back with `fract`. Determinism guarantees frame-to-frame stability.

**Code:**
```glsl
vec2 hash(vec2 tile) {
    return fract(sin(vec2(
        dot(tile, vec2(127.1, 311.7)),
        dot(tile, vec2(269.5, 183.3))
    )) * 43758.5453123);
}
```
The magic constants are arbitrary — pick your own. The structure is what matters: integer → trig → `fract`.

---

## 8. Voronoi noise — the territory map

**Noob:** Think of a town with pizza shops. Every house orders from the *nearest* shop. The jagged lines where two shops are *equally close* form the delivery-territory boundaries. That boundary web is exactly what shattered glass looks like. Voronoi = "color every pixel by which dot it's nearest to; the boundaries are the lines."

**Pro:** Worley/Voronoi noise: a distance field to the nearest of a set of points. The cell edges (where the two nearest distances are equal) form a crack-like network.

### The grid trick

**Noob:** To scatter dots evenly-but-randomly, tile the screen. `floor(p)` = which tile; `fract(p)` = where inside it. One dot per tile = guaranteed coverage.

**Pro:** `p = uv * N` splits the screen into `N×N` cells. `floor(p)` is the cell id, `fract(p)` the intra-cell position.

### The 3×3 neighborhood search

**Noob:** Your nearest dot might be in the *neighbor's* tile, so each pixel must check its own tile **plus the 8 surrounding tiles**. For each neighbor: find its dot, measure the distance, and keep a running "leaderboard" of the closest and second-closest.

**Pro:** For a point at `p` with `spot = fract(p)` in cell `floor(p)`, loop offsets `dx, dy ∈ {-1,0,1}`. The pixel's position in neighbor cell's frame is `spot - offset` (because the neighbor cell is `offset` away). Distance = `length(spot - offset - hash(tilenumber + offset))`. Track `d1` (nearest) and `d2` (second-nearest). The 3×3 loop is what makes the field **seam-free** — without it, tiles show square borders.

### The leaderboard (top-2 selection)

**Noob:** Keep two running records: 1st place and 2nd place. For each newcomer: if it beats 1st, demote old 1st to 2nd and it takes 1st; otherwise if it beats 2nd, it takes 2nd.

**Pro:** Two accumulators initialized to a large value. Demotion order matters: update `second` *before* `best`.

**Code:**
```glsl
float best = 100.0;
float second = 100.0;
for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
        vec2 offset = vec2(float(x), float(y));
        vec2 neighbour = tilenumber + offset;
        float d = distance(spot - offset, hash(neighbour));
        if (d < best) {
            second = best;
            best = d;
        } else if (d < second) {
            second = d;
        }
    }
}
```

**Verification:** render `vec3(best)` — you should see soft hills that meet neighbors *cleanly at tile boundaries* with no seams. Seams mean the coordinate math is off.

---

## 9. Edges as cracks (`d2 - d1`)

**Noob:** A pixel exactly on a territory boundary is equally far from two dots — nearest and second-nearest are the same distance, so their difference is zero. Zero-difference = a crack line. Far from any boundary, the difference grows.

**Pro:** `edge = d2 - d1` is a distance-to-boundary field: `0` on every Voronoi edge, rising in cell interiors. Threshold it with the radius/blur idiom to draw thin crack bands.

**Code:**
```glsl
float edge = second - best;
float crackWidth = 0.05;
float crackMask = smoothstep(crackWidth, 0.0, edge); // 1 on boundary, 0 past width
vec3 color = mix(vec3(best), vec3(0.0), crackMask);
gl_FragColor = vec4(color, 1.0);
```

**Why the reversed smoothstep:** `smoothstep(crackWidth, 0.0, edge)` reads "as `edge` goes 0 → `crackWidth`, output goes 1 → 0." So `edge = 0` (dead center of a boundary) gives `1`, `edge = crackWidth` gives `0`. `edge` always sits in the **third** argument slot; the thresholds are constants.

---

## 10. Scope in GLSL

**Noob:** Visibility = which braces you're inside.

**Pro:** Three levels:
- **Global** — outside all functions (`uniform` declarations, helper functions). Visible everywhere.
- **Function scope** — top of a function body. Visible throughout, including nested blocks.
- **Block scope** — inside `{ }`. Visible only within that block.

**The accumulators rule:** declared *outside* the loop so they persist across iterations, but *modified* inside. If declared inside, they'd reset every pass.

**The declaration-before-use rule:** a variable must be declared *above* the line that reads it. This bites with masks — e.g. `crackActive` must be declared before `crackMask` uses it, and `dist` must move up before the masks that need it.

**Shadowing warning:** a variable with the same name declared inside a block shadows the outer one — it compiles, but it's a confusion trap. Avoid it.

---

## 11. Gotchas and traps we hit (all milestones)

1. **Reserved words:** you cannot use built-in function names as variables — `length`, `dot`, `distance`, `fract`, `mix`, `smoothstep`, `step`, etc. `float length = ...` and `float dot = ...` won't compile.
2. **Semicolons:** every statement needs one. `float second = 100.0` is a compile error.
3. **Vector constructor size:** `vec4(vec2, float, float, float)` has 5 components — invalid. `vec4(vec2, float, float)` is fine. Count your components.
4. **Type discipline:** a `vec2` cannot become a `float` silently. `float p = vUv * 8.0` is an error; it must be `vec2 p`. Same for `vec2 + float` — wrap the scalar: `vec2(bend - 0.5)`.
5. **Case sensitivity:** `crackwidth` ≠ `crackWidth`.
6. **`for` loop syntax:** C-style with `;` separators and **constant bounds**: `for (int x = -1; x <= 1; x++)`.
7. **Tone mapping:** R3F applies tone mapping + sRGB by default; raw shader colors may look muted. `material.toneMapped = false` keeps colors raw.
8. **Unused variables:** if a variable is computed but never read, it's a bug or leftover — remove it.
9. **`distance()` takes two arguments:** `distance(vUv, uMouse)` — not `distance(uClick)`. Every distance needs "from here" and "to there."
10. **Scalar → vector needs the constructor:** `vec3 glassColor = step(...)` fails on some drivers (ANGLE); `vec3(step(...))` compiles.
11. **The both-sides rule:** every uniform must be declared in GLSL *and* given a `{ value }` in the JS uniforms object. Missing one side = a `undefined` crash or a dead uniform.
12. **Uniforms are live data, not constants:** a "snapshot" uniform (like `uClickTime`) must be written only where the event happens — writing it every frame in `useFrame` makes `uTime - uClickTime` permanently zero.
13. **Event handlers are functions, not assignments:** `onPointerDown={uClickTime = ...}` runs the assignment at render time and leaves a number behind. Wrap it in a function: `onPointerDown={() => ...}`.
14. **`new` is not optional:** `THREE.Vector2()` without `new` throws in strict mode. Always `new THREE.Vector2()`.
15. **`e.uv` is a gift:** R3F pointer events hand you the hit's texture coordinate already in UV space — no NDC conversion needed.
16. **Sentinel direction matters:** an initial `uClickTime` must make *every* consumer inactive. `-100` fixed the ring but opened the spokes; `+9999` (a future time) makes `clickAge` negative so everything stays off.
17. **`texture2D`, not `texture`:** WebGL1/GLSL ES 1.00 uses `texture2D(uTexture, uv)` and returns a `vec4` — remember `.rgb`.
18. **`colorSpace`:** in three r152+, set `texture.colorSpace = THREE.SRGBColorSpace` or the image looks washed out.
19. **One declaration per name per scope:** a leftover duplicate line (two `vec3 glassColor`) is a compile error, not a warning.
20. **No `textureSize()` in WebGL1:** to know the image's aspect, pass `texture.image.width / texture.image.height` from JS.
21. **Order is state:** in shaders a variable carries the value it had *at the moment it's used*. Multiply a mask before use, not after — `shift` computed from an ungated `proximityMask` bends glass during the brooding phase.

---

## 12. M4 — Glass shaping (gradient, core + glint, refraction, vignette)

The goal: turn the raw crack field into a pane of glass.

### 12.1 The glass gradient background

**Noob:** glass isn't flat gray — it's paler toward the sky at the top and deeper at the bottom. Every pixel picks its color by its height on the screen (`vUv.y`).

**Pro:** lerp two colors by the vertical coordinate: `mix(topColor, bottomColor, vUv.y)`.

**Code:**
```glsl
vec3 topColor = vec3(0.65, 0.80, 0.95);
vec3 bottomColor = vec3(0.30, 0.42, 0.58);
vec3 glassColor = mix(topColor, bottomColor, vUv.y);
```

### 12.2 Dark hairline core + bright glint

**Noob:** real cracks are a dark hairline with a bright rim on each side. We draw two soft bands: a narrow dark one exactly on the line, and a wider bright one hugging it.

**Pro:** two smoothstep bands at different widths. `crackMask` (width 0.02) = the dark core. `outer` (width 0.06) = the whole bright halo. `glint = outer - crackMask` = a **donut ring**: 0 on the centerline, peaking just outside the core, 0 past the halo.

**Code:**
```glsl
float crackWidth = 0.02;
float crackMask = smoothstep(crackWidth, 0.0, edge);
float rimW = 0.06;
float outer = smoothstep(rimW, 0.0, edge);
float glint = outer - crackMask;
```

### 12.3 Chained mixes (three layers, two mixes)

**Noob:** `mix` blends two things. Three layers need two `mix` calls in a chain.

**Pro:** `mix(x, y, 0) = x` — a 0 mask leaves the layer untouched, so layering is safe. First blend glass→core, then blend that result→glint.

**Code:**
```glsl
vec3 color = mix(glassColor, coreColor, crackMask);
color = mix(color, glintColor, glint);
```

### 12.4 Fake refraction (UV perturbation)

**Noob:** glass bends light around a break. We fake it by sampling the background at a slightly wrong position near cracks.

**Pro:** a per-pixel offset `shift` that is strong only near cracks (`proximityMask`), scaled tiny (0.04), animated by a sine wave. Sample the background at `vUv + shift`. "UV perturbation" = "sample at a wrong position near a break."

**Code:**
```glsl
float proximityMask = (1.0 - smoothstep(0.0, 0.15, edge)) * crackActive;
float bend = sin(uTime + vUv.y * 10.0) * 0.5 + 0.5;
vec2 shift = vec2(bend - 0.5) * 0.04 * proximityMask;
vec3 glassColor = mix(topColor, bottomColor, shiftedUv.y); // at the M4 stage
```
**Debug trick:** swap the background for stripes (`vec3(step(0.5, fract(shiftedUv.y * 10.0)))`) to *see* the bend; revert after. On a smooth gradient the wobble is nearly invisible — that's expected, not a bug.

### 12.5 Vignette

**Noob:** glass darkens near the frame. Darken by distance from center, applied **last** so cracks stay on top.

**Code:**
```glsl
float dist = distance(vUv, vec2(0.5));
float vignette = smoothstep(0.45, 0.85, dist);
color = mix(color, vec3(0.02, 0.03, 0.05), vignette * 0.6);
```

---

## 13. M5 — The reveal from center

**Noob:** the pane sits clean for a moment, then cracks spread from the center outward. The cracks were always in the field — a mask decides which pixels are *allowed* to show them.

**Pro:** two gates multiplied into the crack masks:
- `progress` converts **seconds → a radius** (`smoothstep(2.0, 5.0, uTime)`). This is the trick you found confusing: it *looks* like time, but its output is a distance in UV units — the same units as `dist`. That's why the two can be compared.
- `crackActive = (1.0 - smoothstep(progress, progress + 0.1, dist)) * timeGate` — 1 where the pixel is inside the growing circle.

**The center-out comparison:** every pixel tests `dist < progress` — "is the wave farther from center than I am?" Two *different kinds* of numbers: `dist` is per-pixel ("where am I?"), `progress` is one global value for the whole screen ("how far has the wave reached?"). Pixels inside the growing radius pass; the collection of passing pixels forms an expanding circle. `0.5` in `vec2(0.5)` is just the center of the UV range — nothing magic.

**The leak and `timeGate`:** at `progress = 0` the spatial term already activates the center dot during the whole brooding phase. `timeGate = smoothstep(2.0, 2.15, uTime)` guarantees exactly zero before the break.

**Multiply, don't rebuild:** scale every crack-linked mask by `crackActive` *at its declaration* so core, glint, and refraction all inherit the same circle.

**Code:**
```glsl
float dist = distance(vUv, vec2(0.5));
float progress = smoothstep(2.0, 5.0, uTime);
float timeGate = smoothstep(2.0, 2.15, uTime);
float crackActive = (1.0 - smoothstep(progress, progress + 0.1, dist)) * timeGate;

float crackMask = smoothstep(crackWidth, 0.0, edge) * crackActive;
float outer = smoothstep(rimW, 0.0, edge) * crackActive;
float proximityMask = (1.0 - smoothstep(0.0, 0.15, edge)) * crackActive;
```

**Ordering rule:** `dist` and `crackActive` must be declared *above* the masks that consume them (declaration-before-use), and the old duplicate `dist` near the vignette must go.

---

## 14. M6 — Interaction

### 14.1 The uniform pipe

**Noob:** the shader is a pure function of its uniforms. To interact, JS feeds it new inputs on events and frames.

**Pro:** uniforms are the CPU→GPU bridge. Five inputs now: `uTime` (every frame), `uMouse` (pointer moves), `uClickPos` + `uClickTime` (clicks), plus the texture. Both-sides rule: declare in GLSL *and* provide `{ value }` in JS.

### 14.2 Snapshot vs live clock

**Noob:** a clock photograph. `uTime` = the live clock (written every frame in `useFrame`); `uClickTime` = a photo of it (written only on click). `uTime - uClickTime` = "how long ago was the click" — the driver of the burst. If you write `uClickTime` every frame, the photo is retaken constantly and the age is always zero.

**Code:**
```js
const handleClick = (e) => {
  materialRef.current.uniforms.uClickPos.value.set(e.uv.x, e.uv.y);
  materialRef.current.uniforms.uClickTime.value = materialRef.current.uniforms.uTime.value;
};
```

### 14.3 Handlers are functions

**Noob:** `onPointerDown={...}` stores a function; JSX evaluates the braces at render. An assignment runs immediately (wrong moment) and leaves a number behind, which R3F then tries to call (crash). The function wrapper is the "do this when the event fires" container.

**Code:** `onPointerDown={handleClick}` where `handleClick` is a function whose body runs on click.

### 14.4 `e.uv` — the raycaster's gift

The event's `.uv` is the hit's texture coordinate — already in the same 0..1 UV space as `vUv`. No NDC conversion needed:
```js
const onPointerMove = (e) => {
  materialRef.current.uniforms.uMouse.value.set(e.uv.x, e.uv.y);
};
```

### 14.5 Hover — constants become per-pixel values

**Noob:** `crackWidth` isn't a fixed number anymore — every pixel computes its own from its distance to the cursor.

**Code:**
```glsl
float hoverMask = 1.0 - smoothstep(0.0, 0.25, distance(vUv, uMouse));
hoverMask *= crackActive; // no effect on unbroken glass

float crackWidth = 0.02 * (1.0 + 2.5 * hoverMask);
float rimW = 0.06 * (1.0 + 2.5 * hoverMask);
```

### 14.6 The click burst

**The shockwave ring** — a bright expanding annulus that fades:
- `ringRadius = clickAge * 1.5` — the front moves outward.
- a double smoothstep = donut band (hole at center + soft far edge).
- `ringLife = 1.0 - smoothstep(0.0, 1.2, clickAge)` — fades after ~1.2s.

```glsl
float ringRadius = clickAge * 1.5;
float ring = (1.0 - smoothstep(ringRadius, ringRadius + 0.12, clickDist))
           * smoothstep(ringRadius - 0.15, ringRadius, clickDist);
float ringLife = 1.0 - smoothstep(0.0, 1.2, clickAge);
float shock = ring * ringLife;
color = mix(color, vec3(0.85, 0.92, 1.0), shock * 0.5);
```

**The radial spokes** — permanent cracks radiating from the click:
- `atan(toClick.y, toClick.x)` = the pixel's angle around the click (the new function this milestone).
- the fract trick wraps the angle range onto a 0..1 repeat, so "distance to nearest spoke" is `abs(fract(angle / π · N) - 0.5) * 2.0` — 0 on each spoke.
- gated by a `smoothstep(0.0, 0.15, clickAge)` so they sprout at the click, then persist.

```glsl
float angle = atan(toClick.y, toClick.x);
float spokeDist = abs(fract(angle / 3.14159 * 8.0) - 0.5) * 2.0;
float spokeMask = (1.0 - smoothstep(0.0, 0.45, clickDist))
                * (1.0 - smoothstep(0.0, 0.22, spokeDist))
                * smoothstep(0.0, 0.15, clickAge);

crackMask = max(crackMask, spokeMask);
glint = max(glint, spokeMask);
```

**Why `max` for glint:** `glint = outer - crackMask` goes *negative* on spokes that aren't on voronoi cracks, and `mix` with a negative `t` is undefined behavior (dark halos on some GPUs). `max(glint, spokeMask)` guarantees spokes keep a bright rim and stay harmless elsewhere.

### 14.7 The sentinel trap

The initial `uClickTime` must make **every** consumer inactive. `-100` → `clickAge` huge positive → ring off but spokes ON (their gate `smoothstep(0, 0.15, huge)` = 1). `+9999` → `clickAge` very negative → the ring's radius is negative (empty circle) *and* the spokes' gate is 0. When you set a sentinel, check every gate the value feeds.

---

## 15. M7 — Texture background + aspect cover

### 15.1 Sampling an image

**Noob:** the gradient was a procedural fake; now the "background" is a real photo. The shader reads it through a `sampler2D` uniform.

**Pro:**
```glsl
uniform sampler2D uTexture;
vec3 glassColor = texture2D(uTexture, coverUv + shift).rgb;
```
Gotchas: `texture2D` (WebGL1 name), it returns a `vec4` → use `.rgb` (alpha lives in `.a` — a transparent PNG sampled with `.rgb` turns its transparent areas black), and `texture.colorSpace = THREE.SRGBColorSpace` is required for correct colors in three r152+.

### 15.2 Loading it (drei)

```js
import { useTexture } from '@react-three/drei';
const texture = useTexture('/Bleach.png');   // file lives in public/ → served at the root
texture.colorSpace = THREE.SRGBColorSpace;
// uniforms: uTexture: { value: texture }
```
(`useLoader(THREE.TextureLoader, url)` from `@react-three/fiber` is the no-install equivalent — drei's `useTexture` wraps exactly that.)

### 15.3 The cover transform (no stretch)

**Noob:** the quad and the image both map 0..1 UV onto themselves; when the window isn't the image's shape, one gets squeezed. "Cover" = scale the image to fill the screen and **crop the overflow** instead of stretching.

**Pro:** the visible window of the image must have the screen's aspect. With `r = screenAspect / imageAspect`, scale x and y by `min(1, r)` and `min(1, 1/r)` around the center:
```glsl
float r = uScreenAspect / uImageAspect;
vec2 coverUv = vec2(0.5) + (vUv - vec2(0.5)) * vec2(min(1.0, r), min(1.0, 1.0 / r));
vec3 glassColor = texture2D(uTexture, coverUv + shift).rgb;
```
The two aspects come from JS: screen = `viewport.width / viewport.height` (refreshed in `useFrame` so resizing stays correct), image = `texture.image.width / texture.image.height` (a property of the file, set once). WebGL1 has no `textureSize()`, so the image aspect must arrive as a uniform.

**Why it's clean:** only the *texture sample* changes — cracks, glint, hover, reveal, and click burst all keep working in plain screen `vUv`, so clicks still land exactly where the cursor is. The refraction rides along because the sample uses `coverUv + shift`.

---

## 16. Mental-model cheatsheet

The reusable idioms you now own — each one is a tool you'll reach for again:

| Idiom | Shape | Used for |
|---|---|---|
| Hash | `fract(sin(dot(tile, k)) * m)` | deterministic per-tile randomness |
| Distance mask | `1.0 - smoothstep(0.0, radius, distance(...))` | "near something" (dots, hover, proximity) |
| Band on a field | `smoothstep(width, 0.0, edge)` | thin line on a distance field (cracks) |
| Donut ring | `outer - inner` | glint around a core |
| Gated timer | `smoothstep(a, b, uTime)` | delay → 0..1 |
| Expanding circle | `1.0 - smoothstep(p, p + feather, dist)` | reveal / ring from an anchor |
| Snapshot uniform | written only in the handler | click age = `uTime - uClickTime` |
| Per-pixel constant | `base * (1.0 + boost * mask)` | widths/sizes that vary in space |
| Cover UV | `0.5 + (uv - 0.5) * vec2(min(1, r), min(1, 1/r))` | texture without stretching |
| Spokes | `abs(fract(angle / π · N) - 0.5) * 2.0` | rays from a point |
| Safe merge | `max(maskA, maskB)` | combine layers without negative glint |

---

## 17. Tuning map (every knob → effect)

| Knob | Code | Current | Effect |
|---|---|---|---|
| Crack density | `vec2 p = vUv * 8.0` | 8 | tiles per axis (cell size) |
| Reveal start / end | `smoothstep(2.0, 5.0, uTime)` | 2s / 5s | brooding delay / spread duration |
| Wave front width | `progress + 0.1` | 0.1 | softness of the reveal edge |
| Core width | `crackWidth` | 0.02 (× hover boost) | dark hairline thickness |
| Rim width | `rimW` | 0.06 (× hover boost) | glint halo thickness |
| Hover reach / boost | `0.25` / `2.5` | 0.25 / 2.5 | cursor influence radius / strength |
| Refraction strength | `0.04` | 0.04 | how much background bends near cracks |
| Refraction wave | `vUv.y * 10.0` | 10 | shimmer frequency (speed = the `uTime` term) |
| Shock speed / life | `1.5` / `1.2` | 1.5 / 1.2 | ring expansion rate / fade time |
| Spoke count / length / width | `8.0` / `0.45` / `0.22` | 8 / 0.45 / 0.22 | burst rays |
| Vignette | `0.45, 0.85`, `* 0.6` | — | edge darkening start / full / strength |
| Image | `/Bleach.png` | — | the photo behind the glass |

---

## 18. The complete final code (App.jsx)

**App.jsx** (R3F harness + both shaders, as it currently runs):

```jsx
import { useRef } from 'react';
import './App.css'

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three'

const vertexShader = `
varying vec2 vUv;
void main(){
vUv = uv;
gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}
`;

const fragmentShader = `
varying vec2 vUv;
uniform float uTime;
uniform float uClickTime;
uniform vec2 uMouse;
uniform vec2 uClickPos;
uniform sampler2D uTexture;
uniform float uScreenAspect;
uniform float uImageAspect;

vec2 hash(vec2 tile){
return fract(sin(vec2(
    dot(tile, vec2(127.1, 311.7)),
    dot(tile, vec2(269.5, 183.3))
)) * 43758.5453123);
}
void main() {
vec2 p = vUv * 8.0;
vec2 tilenumber = floor(p);
vec2 spot = fract(p);

float best = 100.0;
float second = 100.0;

for(int x = -1; x  <= 1; x++){
for(int y = -1; y <=  1; y++) {
vec2 offset = vec2(float(x), float(y));
vec2 neighbour = vec2(tilenumber + offset);
float d = distance(spot - offset, hash(neighbour));
if(d < best){
second = best;
best = d;
} else if(d < second) {
second = d;
  }
}
}

float edge = second - best;
float dist = distance(vUv, vec2(0.5));
float clickAge = uTime - uClickTime;
float clickDist = distance(vUv, uClickPos);
float ringRadius = clickAge * 1.5;
float ring = (1.0 - smoothstep(ringRadius, ringRadius + 0.12, clickDist)) * smoothstep(ringRadius - 0.15, ringRadius, clickDist);
float ringLife =  1.0 - smoothstep(0.0, 1.2, clickAge);
float shock = ring * ringLife;
vec2 toClick = vUv - uClickPos;
float angle = atan(toClick.y, toClick.x);
float spokeDist = abs(fract(angle / 3.14159 * 8.0) - 0.5) * 2.0;
float spokeMask = (1.0 - smoothstep(0.0, 0.45, clickDist))
                * (1.0 - smoothstep(0.0, 0.22, spokeDist))
                * smoothstep(0.0, 0.15, clickAge);

float progress = smoothstep(2.0, 5.0, uTime);
float timeGate = smoothstep(2.0, 2.15, uTime);
float hoverMask = 1.0 - smoothstep(0.0, 0.25, distance(vUv,uMouse));
float crackActive = (1.0 - smoothstep(progress, progress + 0.1, dist)) * timeGate;
hoverMask *= crackActive;

float crackWidth = 0.02 * (1.0 + 2.5 * hoverMask);
float crackMask = smoothstep(crackWidth, 0.0, edge) * crackActive;
crackMask = max(crackMask,spokeMask);
float rimW = 0.06 * (1.0 + 2.5 * hoverMask);
float outer = smoothstep(rimW, 0.0, edge) * crackActive;
float glint = outer - crackMask;
glint = max(glint,spokeMask);
float proximityMask = (1.0 - smoothstep(0.0, 0.15, edge)) * crackActive;

float bend = sin(uTime + vUv.y * 10.0) * 0.5 + 0.5;
vec2 shift = vec2(bend - 0.5) * 0.04 * proximityMask;
vec2 shiftedUv = vUv + shift;

float vignette = smoothstep(0.45, 0.85, dist);
vec3 glintColor = vec3(0.85, 0.92, 1.0);
float r =  uScreenAspect / uImageAspect;
vec2 coverUv = vec2(0.5) + (vUv - vec2(0.5)) * vec2(min(1.0, r), min(1.0, 1.0 / r));
vec3 glassColor = texture2D(uTexture, coverUv + shift).rgb;
vec3 coreColor = vec3(0.04, 0.06, 0.10);
vec3 color = mix(glassColor, coreColor, crackMask);
color = mix(color, glintColor, glint);
color = mix(color, vec3(0.02, 0.03, 0.05), vignette * 0.6);
color = mix(color, vec3(0.85, 0.92, 1.0), shock * 0.5);
gl_FragColor = vec4(color, 1.0);
}
`;

function Quad() {
  const materialRef = useRef();
  const { viewport } = useThree();
  const texture = useTexture('/Bleach.png')
  texture.colorSpace = THREE.SRGBColorSpace;
  useFrame((state) => {
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    materialRef.current.uniforms.uScreenAspect.value = viewport.width / viewport.height;
  })

  const handleClick = (e) => {
    materialRef.current.uniforms.uClickPos.value.set(e.uv.x, e.uv.y);
    materialRef.current.uniforms.uClickTime.value = materialRef.current.uniforms.uTime.value
  }

  const onpointerMove = (e) => {
    materialRef.current.uniforms.uMouse.value.set(e.uv.x, e.uv.y);
  }

  return (
    <mesh position={[0, 0, 0]} onPointerDown={handleClick}
      onPointerMove={onpointerMove}
    >
      <planeGeometry args={[viewport.width, viewport.height]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          uTime: { value: 0 },
          uClickTime: { value: 9999 },
          uMouse: { value: new THREE.Vector2() },
          uClickPos: { value: new THREE.Vector2() },
          uTexture: { value: texture },
          uScreenAspect: { value: 1.0 },
          uImageAspect: { value: texture.image.width / texture.image.height }
        }}
      />
    </mesh>
  )
}

function App() {
  return (
    <div id='canvas-container'>
      <Canvas>
        <Quad />
      </Canvas>
    </div>
  );
}

export default App;
```

---

## 19. Where it could go next

Ideas you now have all the tools for:

- **Multiple stored impacts** — the deferred stretch. Array uniforms; each click keeps its own burst instead of last-click-wins.
- **Click-to-break-early** — clicking during the brooding phase triggers the reveal (the old option C).
- **Aspect-correct the crack field** — fold the screen aspect into `p = vUv * 8.0` so cells aren't stretched on wide windows.
- **Sound-reactive cracks** — feed an analyser value as a uniform to drive crack width or shock strength.
- **Camera shake** — nudge the quad on impact via `useFrame`.
- **Lighting / fresnel** — a light glow toward the rim of the pane.
- **Wallpaper export** — capture a frame with the full reveal for a static desktop wallpaper.
- **HTML/CSS UI overlay (next up)** — plain DOM/JSX elements (title, buttons, HUD, instructions) rendered on top of the fullscreen canvas. R3F renders inside a container, so you can absolutely-position regular HTML over it with CSS `position: absolute` / `z-index`. Pointer-events rule: interactive HTML needs `pointer-events: auto`, decorative overlays need `pointer-events: none` so clicks fall through to the canvas (and the `onPointerMove`/click burst still work).

Reusable knowledge you now own: hash functions, the 3×3 neighborhood search, the leaderboard pattern, distance fields, edges-as-lines, donut rings from subtracted bands, chained mixes, UV perturbation, gated timers, per-pixel constants, expanding-circle reveals, the uniform data pipe, snapshot semantics, `e.uv`, the cover transform, and the `atan`/fract spoke trick. Every future milestone reuses these.
