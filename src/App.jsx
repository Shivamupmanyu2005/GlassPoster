
import { useRef } from 'react';
import './App.css'

import { Canvas,useFrame,useThree } from '@react-three/fiber';

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
float crackWidth = 0.05;
float crackMask = smoothstep(crackWidth,0.0,edge);
vec3 color = mix(vec3(best),vec3(0.0),crackMask);

 gl_FragColor = vec4(color,1.0);
}

`

function Quad(){
const materialRef = useRef();
  const { viewport } = useThree();

  useFrame((state) => {
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  })
return (
  <mesh position={[0,0,0]}>
    <planeGeometry args={[viewport.width, viewport.height]} />
    <shaderMaterial 
    ref={materialRef}
    vertexShader=  {vertexShader}
    fragmentShader= {fragmentShader}
    uniforms={{
      uTime: {value : 0}
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

