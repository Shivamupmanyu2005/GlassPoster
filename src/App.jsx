
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

`

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

