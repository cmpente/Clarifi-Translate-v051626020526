'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

const VOICE_COLORS = {
  Puck: { primary: '#f59e0b', emissive: '#d97706', light: '#fcd34d' },
  Charon: { primary: '#8b5cf6', emissive: '#6d28d9', light: '#c4b5fd' },
  Kore: { primary: '#06b6d4', emissive: '#0891b2', light: '#a5f3fc' },
  Fenrir: { primary: '#f43f5e', emissive: '#e11d48', light: '#fda4af' },
  Zephyr: { primary: '#10b981', emissive: '#059669', light: '#6ee7b7' },
};

const vertexShader = `
  uniform float uTime;
  uniform float uEnergy;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  
  // Simplex 3D Noise for vertex displacement
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  float snoise(vec3 v){ 
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0 ); 
    vec4 p = permute( permute( permute( 
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 1.0/7.0;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                  dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
    vUv = uv;
    vPosition = position;
    vNormal = normalize(normalMatrix * normal);
    
    // Scale based on energy - more dramatic
    // Base breathing + energy-driven expansion
    float scale = 1.0 + (uEnergy * 0.6) + (sin(uTime * 0.8) * 0.03);
    
    // Very subtle, low-frequency displacement - more reactive
    float noiseFreq = 1.0; // Lower frequency for more fluid movement
    // Base noise + energy-driven noise (talking effect)
    float noiseAmp = 0.05 + (uEnergy * 0.5) + (sin(uTime * 0.8) * 0.02);
    vec3 noisePos = vec3(position.x * noiseFreq + uTime * 0.3, position.y * noiseFreq + uTime * 0.3, position.z * noiseFreq);
    // Add a slower, more fluid noise component when talking
    float fluidNoise = snoise(vec3(position * 1.5 + uTime * 0.8)) * uEnergy * 0.2;
    float displacement = (snoise(noisePos) * noiseAmp) + fluidNoise;
    
    vec3 newPosition = position * scale + normal * displacement;
    
    vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uColorIdle;
  uniform vec3 uColorActive;
  
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  // Simplex 3D Noise
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  float snoise(vec3 v){ 
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0 ); 
    vec4 p = permute( permute( permute( 
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 1.0/7.0;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                  dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 normal = normalize(vNormal);
    float fresnel = clamp(dot(viewDir, normal), 0.0, 1.0);
    
    float energy = uEnergy;
    float t = uTime * 0.5;
    
    // Smooth, large-scale noise for color mixing
    vec3 p = vPosition * 2.0;
    float noise1 = snoise(p + vec3(0.0, t, 0.0));
    float noise2 = snoise(p * 1.5 + vec3(t, 0.0, t));
    
    float combinedNoise = (noise1 + noise2) * 0.5;
    combinedNoise = combinedNoise * 0.5 + 0.5; // map to 0..1
    
    // Colors
    vec3 mixColor = mix(uColorIdle, uColorActive, combinedNoise * 0.4 + energy * 1.2);
    
    // Add a bright core highlight when energy is high
    mixColor = mix(mixColor, vec3(1.0), pow(combinedNoise, 1.5) * energy * 1.5);
    
    // Edge glow (Fresnel) - inverted so edges glow
    float rim = pow(1.0 - fresnel, 3.0);
    float core = pow(fresnel, 1.5);
    
    // Add rim light color
    mixColor += uColorActive * rim * (0.5 + energy);
    
    // Density / Alpha
    float alpha = 0.8 + energy * 0.2;
    
    gl_FragColor = vec4(mixColor, alpha);
  }
`;

function VolumetricOrb({ voiceName, energy }: { voiceName: string, energy: number }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const innerCoreRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);
  const energyRef = useRef(0);
  
  const colors = VOICE_COLORS[voiceName as keyof typeof VOICE_COLORS] || VOICE_COLORS.Puck;

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uColorIdle: { value: new THREE.Color(colors.primary) },
    uColorActive: { value: new THREE.Color(colors.light) }
  }), [colors.primary, colors.light]);

  useFrame((state, delta) => {
    if (materialRef.current) {
      // Smoothly interpolate energy - increased damping factor for faster reaction
      const targetEnergy = Math.max(0, Math.min(1, energy));
      energyRef.current = THREE.MathUtils.damp(energyRef.current, targetEnergy, 40, delta);
      
      // Accumulate time based on energy. 
      // CRITICAL FIX: We must accumulate time here rather than multiplying absolute time in the shader.
      // Multiplying absolute time causes massive visual jumps when the multiplier changes.
      const speed = 0.15 + energyRef.current * 0.65;
      timeRef.current += delta * speed;
      
      materialRef.current.uniforms.uTime.value = timeRef.current;
      materialRef.current.uniforms.uEnergy.value = energyRef.current;
      
      // Update colors dynamically if voice changes
      materialRef.current.uniforms.uColorIdle.value.set(colors.primary);
      materialRef.current.uniforms.uColorActive.value.set(colors.light);
      
      if (innerCoreRef.current) {
        const scale = 1.0 + energyRef.current * 0.2;
        innerCoreRef.current.scale.set(scale, scale, scale);
      }
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Inner core to give the orb physical presence and block background */}
      <mesh ref={innerCoreRef}>
        <sphereGeometry args={[0.58, 64, 64]} />
        <meshBasicMaterial color="#020205" />
      </mesh>

      {/* Volumetric fluid shell */}
      <mesh>
        <sphereGeometry args={[0.6, 64, 64]} />
        <shaderMaterial 
          ref={materialRef}
          transparent
          depthWrite={false}
          blending={THREE.NormalBlending}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
        />
      </mesh>
    </group>
  );
}

export default function PersonaAvatar({ voiceName, energy = 0 }: { voiceName: string, energy?: number }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 6.0], fov: 45 }} dpr={[1, 2]}>
        <VolumetricOrb key={voiceName} voiceName={voiceName} energy={energy} />
        <ContactShadows position={[0, -0.8, 0]} opacity={0.6} scale={3} blur={2} far={2} color="#000000" />
      </Canvas>
    </div>
  );
}
