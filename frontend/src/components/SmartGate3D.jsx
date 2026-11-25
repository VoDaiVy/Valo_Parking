import { useRef, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, ContactShadows, Text } from '@react-three/drei';
import * as THREE from 'three';

// 1. Real car
function RealCarModel({ position }) {
  const ref = useRef();
  const { scene } = useGLTF('/car.glb'); 
  
  useFrame((state) => {
    const t = state.clock.getElapsedTime() % 10;
    
    // Movement phase
    if (t < 2.6) ref.current.position.z = THREE.MathUtils.lerp(25, 9.2, t / 2.6); // Move toward the barrier
    else if (t < 4.4) ref.current.position.z = 9.2; // Stop for scanning
    else if (t < 5.3) ref.current.position.z = 9.2; // Wait for the barrier to open
    else if (t < 9) ref.current.position.z = THREE.MathUtils.lerp(9.2, -20, (t - 5.3) / 3.7); // Pass through
    else ref.current.position.z = 25; // Reset
  });

  return <primitive ref={ref} object={scene} scale={1.5} position={position} rotation={[0, 0, 0]} />;
}

// 2. Booth station, camera AI, and barrier
function BarrierAndCamera({ position = [2, 0, 5], rotationY = 0, enabled = true, showPlate = false }) {
  const arm = useRef();
  const light = useRef();
  const plateRef = useRef();

  useFrame((state) => {
    const t = state.clock.getElapsedTime() % 10;
    
    // Camera scan logic: Lights up when the car stops (t from 2.6 to 4.4)
    if (t > 2.6 && t < 4.4) {
      light.current.intensity = Math.abs(Math.sin(t * 10)) * 5;
    } else {
      light.current.intensity = 0;
    }

    // Barrier logic: Opens after scanning (t from 4.5)
    arm.current.rotation.x = 0;
    arm.current.rotation.y = 0;
    if (!enabled) {
      arm.current.rotation.z = 0;
      if (plateRef.current) plateRef.current.visible = false;
      return;
    }
    if (plateRef.current) {
      plateRef.current.visible = showPlate && t > 2.6 && t < 8.8;
    }

    if (t < 4.4) arm.current.rotation.z = 0; // Closed
    else if (t < 5.3) arm.current.rotation.z = THREE.MathUtils.lerp(0, -Math.PI / 2, (t - 4.4) / 0.9); // Open straight up 90 degrees
    else if (t < 8.8) arm.current.rotation.z = -Math.PI / 2; // Keep open
    else arm.current.rotation.z = THREE.MathUtils.lerp(-Math.PI / 2, 0, (t - 8.8) / 1.2); // Close again
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Camera / AI scan light */}
      <pointLight ref={light} position={[1.2, 5.35, -0.35]} color="#38bdf8" intensity={0} distance={8} />
      <group position={[1.2, 5.2, -0.45]} rotation={[0.25, -Math.PI / 8, 0]}>
        <mesh>
          <cylinderGeometry args={[0.12, 0.12, 0.35, 20]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0, 0, 0.18]}>
          <coneGeometry args={[0.08, 0.18, 20]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0, 0, 0.26]}>
          <circleGeometry args={[0.06, 20]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.5} />
        </mesh>
        <mesh position={[-0.12, -0.14, -0.05]}>
          <boxGeometry args={[0.06, 0.08, 0.1]} />
          <meshStandardMaterial color="#6b7280" />
        </mesh>
      </group>

      {/* Toll gate frame (gantry) */}
      <group position={[-2.5, 0, 0]} rotation={[0, 0, 0]}>
        <mesh position={[0, 2.6, 0]}>
          <boxGeometry args={[0.4, 5.2, 0.4]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
        <mesh position={[4.8, 2.6, 0]}>
          <boxGeometry args={[0.4, 5.2, 0.4]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
        <mesh position={[2.4, 5.2, 0]}>
          <boxGeometry args={[5.2, 0.5, 0.5]} />
          <meshStandardMaterial color="#94a3b8" />
        </mesh>
        <mesh position={[2.4, 4.0, 0.6]}>
          <boxGeometry args={[3.2, 0.6, 0.2]} />
          <meshStandardMaterial color="#0f172a" />
        </mesh>
        <Text
          ref={plateRef}
          position={[2.4, 4.0, -0.72]}
          rotation={[0, Math.PI, 0]}
          fontSize={0.24}
          color="#e2e8f0"
          anchorX="center"
          anchorY="middle"
        >
          59A-123.45
        </Text>
      </group>

      {/* Motor box and VETC-style barrier arm */}
      <group position={[2.6, 0, 0]}>
        <mesh position={[0, 1.1, 0]}>
          <boxGeometry args={[0.9, 1.2, 1.1]} />
          <meshStandardMaterial color="#e2e8f0" />
        </mesh>
        <mesh position={[0.1, 1.7, 0]}>
          <boxGeometry args={[1.2, 0.2, 1.2]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
      </group>

      {/* Barrier arm */}
      <group position={[2.8, 1.8, 0]} ref={arm}>
        <mesh position={[-2.8, 0, 0]}>
          <boxGeometry args={[5.6, 0.12, 0.12]} />
          <meshStandardMaterial color="#f8b4b4" emissive="#f8b4b4" emissiveIntensity={0.2} />
        </mesh>
        <mesh position={[-5.4, 0, 0]}>
          <boxGeometry args={[0.4, 0.18, 0.18]} />
          <meshStandardMaterial color="#f97316" />
        </mesh>
      </group>
    </group>
  );
}

// 3. Main canvas
export default function SmartGate3D() {
  return (
    <div className="w-full h-[520px] rounded-2xl overflow-hidden relative bg-gradient-to-br from-slate-100 via-slate-50 to-stone-100 ring-1 ring-black/5">
      <Canvas
        camera={{ position: [-16, 10, 20], fov: 38 }}
        shadows
        dpr={[1, 2]}
      >
        <color attach="background" args={['#f8fafc']} />
        <fog attach="fog" args={['#f3f4f6', 18, 55]} />

        <ambientLight intensity={0.5} />
        <hemisphereLight skyColor="#f8fafc" groundColor="#bfc7d5" intensity={0.6} />
        <directionalLight
          position={[12, 18, 8]}
          intensity={1.7}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={1}
          shadow-camera-far={50}
        />
        <spotLight
          position={[-8, 12, 12]}
          angle={0.35}
          penumbra={0.6}
          intensity={0.9}
          castShadow
        />

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          target={[0, 1.8, 0]}
        />

        <Suspense fallback={null}>
          <BarrierAndCamera position={[-6, 0, 5]} rotationY={0} enabled={false} showPlate={false} />
          <BarrierAndCamera position={[6, 0, 5]} rotationY={Math.PI} enabled showPlate />
          <RealCarModel position={[6, 0, 0]} />

          <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[120, 120]} />
            <meshStandardMaterial color="#e7e5e4" roughness={0.9} metalness={0.05} />
          </mesh>

          {/* Two parallel lanes */}
          <mesh position={[-6, -0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[6, 80]} />
            <meshStandardMaterial color="#d4d4d4" roughness={0.95} />
          </mesh>
          <mesh position={[6, -0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[6, 80]} />
            <meshStandardMaterial color="#d4d4d4" roughness={0.95} />
          </mesh>
          <mesh position={[0, -0.035, 12]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6, 10]} />
            <meshStandardMaterial color="#f5c04b" />
          </mesh>
          <mesh position={[0, -0.035, -6]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6, 10]} />
            <meshStandardMaterial color="#f5c04b" />
          </mesh>
          <mesh position={[0, -0.035, -24]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6, 10]} />
            <meshStandardMaterial color="#f5c04b" />
          </mesh>

          {/* Road shoulder */}
          <mesh position={[-11.5, 0.15, 0]} receiveShadow>
            <boxGeometry args={[2, 0.3, 80]} />
            <meshStandardMaterial color="#cbd5e1" />
          </mesh>
          <mesh position={[11.5, 0.15, 0]} receiveShadow>
            <boxGeometry args={[2, 0.3, 80]} />
            <meshStandardMaterial color="#cbd5e1" />
          </mesh>

          {/* Entrance sign */}
          <group position={[-12, 2.2, 6]}>
            <mesh position={[0, 0, 0]}>
              <boxGeometry args={[2.6, 1.4, 0.2]} />
              <meshStandardMaterial color="#0f172a" />
            </mesh>
            <mesh position={[0, -1.2, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 2.2, 16]} />
              <meshStandardMaterial color="#94a3b8" />
            </mesh>
          </group>

          {/* Parking lot light pole */}
          <group position={[-10, 0, -14]}>
            <mesh position={[0, 3.2, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 6.4, 16]} />
              <meshStandardMaterial color="#9aa3b2" />
            </mesh>
            <mesh position={[0, 6.6, 0]}>
              <boxGeometry args={[0.8, 0.2, 0.8]} />
              <meshStandardMaterial color="#e2e8f0" emissive="#e2e8f0" emissiveIntensity={0.35} />
            </mesh>
          </group>

          {/* Traffic bollard */}
          <mesh position={[-3.5, 0.2, 9]}>
            <cylinderGeometry args={[0.25, 0.35, 0.4, 16]} />
            <meshStandardMaterial color="#f97316" />
          </mesh>
          <mesh position={[-3.5, 0.2, 6.5]}>
            <cylinderGeometry args={[0.25, 0.35, 0.4, 16]} />
            <meshStandardMaterial color="#f97316" />
          </mesh>

          <mesh position={[0, 6, -18]} receiveShadow>
            <boxGeometry args={[80, 12, 1]} />
            <meshStandardMaterial color="#e5e7eb" roughness={0.8} />
          </mesh>

          <ContactShadows
            position={[0, -0.02, 0]}
            opacity={0.5}
            scale={30}
            blur={1.6}
            far={18}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
