# Broken Glass Shader — Session 1 Notes

Everything we built today (Milestones 1–3), explained twice for every idea:
- **Noob** — plain language, analogies, no jargon.
- **Pro** — the precise, technical way to say it.
- **Code** — the actual GLSL/JSX we wrote (with the fixes applied).

Your current progress: a fullscreen quad that renders a **seamless Voronoi field with crack lines** along every territory boundary. That pattern is the skeleton of the whole broken-glass effect.

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
11. Gotchas and traps we hit
12. The complete code so far
13. Where we go next (Milestones 4–7)

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
- **Uniform** — one value for the *whole draw call*, shared by every pixel (`uTime`, later `uMouse`). This is the CPU→GPU bridge.
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
| `dot(a, b)` | Combined strength of two directions | Sum of component products |
| `length(v)` / `distance(a, b)` | How far | Euclidean magnitude / distance |
| `clamp(x, a, b)` | Squeeze into a range | `min(max(x, a), b)` |

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

This "solid core + soft edge" pattern is reused over and over: dots now, crack lines next, mouse influence later.

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

**Pro:** For a point at `p` with `spot = fract(p)` in cell `floor(p)`, loop offsets `dx, dy ∈ {-1,0,1}`. The pixel's position in neighbor cell's frame is `spot - offset` (because the neighbor cell is `offset` away). Distance = `length(spot - offset - hash(tilenumber + offset))`. Track `d1` (nearest) and `d2` (second-nearest).

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

**Shadowing warning:** a variable with the same name declared inside a block shadows the outer one — it compiles, but it's a confusion trap. Avoid it.

---

## 11. Gotchas and traps we hit

1. **Reserved words:** you cannot use built-in function names as variables — `length`, `dot`, `distance`, `fract`, `mix`, `smoothstep`, `step`, etc. `float length = ...` and `float dot = ...` won't compile.
2. **Semicolons:** every statement needs one. `float second = 100.0` is a compile error.
3. **Vector constructor size:** `vec4(vec2, float, float, float)` has 5 components — invalid. `vec4(vec2, float, float)` is fine. Count your components.
4. **Type discipline:** a `vec2` cannot become a `float` silently. `float p = vUv * 8.0` is an error; it must be `vec2 p`.
5. **Case sensitivity:** `crackwidth` ≠ `crackWidth`.
6. **`for` loop syntax:** C-style with `;` separators and **constant bounds**: `for (int x = -1; x <= 1; x++)`.
7. **Tone mapping:** R3F applies tone mapping + sRGB by default; raw shader colors may look muted. `material.toneMapped = false` keeps colors raw.
8. **Unused variables:** if a variable is computed but never read, it's a bug or leftover — remove it.

---

## 12. The complete code so far

**App.jsx** (R3F harness):
```jsx
import { useRef } from 'react';
import './App.css'
import { Canvas, useFrame, useThree } from '@react-three/fiber';

const vertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
varying vec2 vUv;
uniform float uTime;

vec2 hash(vec2 tile) {
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

    float edge = second - best;
    float crackWidth = 0.05;
    float crackMask = smoothstep(crackWidth, 0.0, edge);
    vec3 color = mix(vec3(best), vec3(0.0), crackMask);

    gl_FragColor = vec4(color, 1.0);
}
`;

function Quad() {
    const materialRef = useRef();
    const { viewport } = useThree();

    useFrame((state) => {
        materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    });

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

## 13. Where we go next

The crack pattern is done — it's the foundation. Next sessions build the *story* on top of it:

- **M4 — Glass shaping:** replace the plain field with a glassy gradient background; crack lines become dark hairlines with a bright glint; add a subtle fake refraction (UV distortion) near cracks; fresnel-ish tint at edges.
- **M5 — The reveal:** after a delay (`uTime`), cracks spread gradually from the screen center using an eased radius that grows over time — a `smoothstep` mask circle.
- **M6 — Interaction:** pointer → NDC → uniform (`uMouse`); hover widens cracks near the cursor; click spawns an impact whose radius expands outward (`uClickPos`, `uClickTime`).
- **M7 — Polish:** crack density control, aspect correction, performance (iteration budget), feel.

Reusable knowledge you now own: hash functions, the 3×3 neighborhood search, the leaderboard pattern, distance fields, edges-as-lines, the radius/blur idiom, and the uniform/CPU bridge. Every future milestone reuses these.
