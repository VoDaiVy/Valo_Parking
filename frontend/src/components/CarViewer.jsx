import { Suspense, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import {
  useGLTF,
  OrbitControls,
  Environment,
  ContactShadows,
  Html,
  Bounds,
  useBounds,
} from '@react-three/drei';

// Target max dimension (meters) every model is normalized to.
// Changing this one constant zooms all models in/out uniformly.
const MODEL_TARGET_SIZE = 3.5;

// ─── Point DRACOLoader at the Google CDN decoder (set once at module level) ───
// Required to decode Draco-compressed GLB files produced by gltf-pipeline on
// the backend. Must be called before any useGLTF() invocation.
useGLTF.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

// ─── Internal: Load & tint the GLB model ─────────────────────────────────────
function CarModel({ modelUrl, carColor }) {
  const { scene } = useGLTF(modelUrl);
  const bounds = useBounds();
  // Ref to call bounds.refresh().fit() once after the model loads,
  // do not put bounds in the dependency array because bounds changes reference every render.
  const boundsRef = useRef(bounds);

  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);

  // ── Cleanup when the model changes or unmounts ──────────────────────────────────
  useEffect(() => {
    return () => {
      useGLTF.clear(modelUrl);
    };
  }, [modelUrl]);

  // ── Effect 1: Scale + ground — only runs when the scene/model changes ─────────
  // DO NOT put bounds in dependencies: bounds creates a new reference every render,
  // if added, the effect runs continuously and the vehicle jitters.
  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => {
    scene.scale.set(1, 1, 1);
    scene.position.set(0, 0, 0);

    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      scene.scale.setScalar(MODEL_TARGET_SIZE / maxDim);
    }

    // Ground:  Ground vehicle bottom to Y = 0
    const boxAfterScale = new THREE.Box3().setFromObject(scene);
    // eslint-disable-next-line react-hooks/immutability
    scene.position.y = -boxAfterScale.min.y;

    // Read bounds through the ref so bounds is not needed in the dependency array
    boundsRef.current.refresh().fit();

    // Move the model downward in world space after the camera has fit
    // → the vehicle appears in the lower part of the canvas instead of the center.
    scene.position.y -= 0.6;
  }, [scene]); // ← scene only, no bounds

  // ── Effect 2: Color tint - only runs when carColor changes ──────────────────
  useEffect(() => {
    const allMaterials = new Set();
    scene.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => allMaterials.add(m.name));
      }
    });

    const hasBodyPaint = [...allMaterials].some(
      (name) => name === 'BodyPaint' || /body|paint|car|exterior|varnish/i.test(name),
    );

    scene.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat) return;
        const shouldTint = hasBodyPaint
          ? mat.name === 'BodyPaint' || /body|paint|car|exterior|varnish/i.test(mat.name)
          : true;
        if (shouldTint) {
          mat.color.set(carColor);
          mat.metalness = 0.8;
          mat.roughness = 0.2;
          mat.needsUpdate = true;
        }
      });
    });
  }, [scene, carColor]);

  return <primitive object={scene} />;
}

// ─── Internal: HTML fallback shown while Suspense waits ──────────────────────
function LoadingFallback() {
  const { t } = useLanguage();
  return (
    <Html center>
      <p
        style={{
          color: '#eab308',
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        {t('vehiclesPage.loadingModel')}
      </p>
    </Html>
  );
}

/**
 * CarViewer — renders a Draco-compressed GLB car model from Cloudinary.
 *
 * Props:
 *   modelUrl  {string}  Cloudinary raw URL to a .glb file (Draco-compressed)
 *   carColor  {string}  Initial hex color applied to the BodyPaint material
 *   height    {number}  Canvas height in px (default 180)
 *
 * Ref API (via forwardRef):
 *   ref.current.changeCarColor(hexColor: string) — update paint color imperatively.
 *
 * Usage example:
 *   const viewerRef = useRef();
 *   <CarViewer ref={viewerRef} modelUrl={url} carColor="#c0392b" />
 *   <button onClick={() => viewerRef.current.changeCarColor('#2980b9')}>Blue</button>
 */
const CarViewer = forwardRef(function CarViewer({ modelUrl, carColor = '#ffffff', height = 180, boundsMargin = 1.1 }, ref) {
  // ── Internal color state — controlled by prop OR by imperative changeCarColor ──
  const [activeColor, setActiveColor] = useState(carColor);

  // Sync when parent updates the carColor prop
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setActiveColor(carColor);
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [carColor]);

  // ── Expose changeCarColor() so parent can call it without lifting state ──────
  useImperativeHandle(ref, () => ({
    /**
     * changeCarColor(hexColor)
     * Call this from a color-picker button to repaint the car body in real time.
     * @param {string} hexColor — e.g. '#2980b9'
     */
    changeCarColor: (hexColor) => setActiveColor(hexColor),
  }), []);

  if (!modelUrl) return null;

  return (
    <div style={{ width: '100%', height }}>
      <Canvas
        style={{ width: '100%', height: '100%' }}
        camera={{ position: [3, 2, 5], fov: 55 }}
        gl={{ alpha: true, antialias: true }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <spotLight
          position={[10, 10, 10]}
          angle={0.15}
          penumbra={1}
          intensity={1.5}
          castShadow
        />
        <spotLight
          position={[-8, 8, -8]}
          angle={0.2}
          penumbra={1}
          intensity={0.6}
        />

        {/* Model + environment */}
        {/* ContactShadows is intentionally placed OUTSIDE <Bounds> so its large
            scale plane (scale=10) does not inflate the bounding box and cause
            Bounds to zoom out — that was making smaller models appear tiny. */}
        <Bounds fit clip margin={boundsMargin}>
          <Suspense fallback={<LoadingFallback />}>
            <CarModel modelUrl={modelUrl} carColor={activeColor} />
          </Suspense>
        </Bounds>
        <Suspense fallback={null}>
          <ContactShadows
            position={[0, -0.01, 0]}
            opacity={0.45}
            scale={10}
            blur={2.5}
            far={1.5}
          />
        </Suspense>
        <Environment preset="city" />

        {/* Controls */}
        <OrbitControls
          autoRotate
          autoRotateSpeed={1.5}
          maxPolarAngle={Math.PI / 2}
          minPolarAngle={Math.PI / 6}
          enableZoom={false}
          enablePan={false}
        />
      </Canvas>
    </div>
  );
});

export default CarViewer;
import { useLanguage } from '../i18n/hooks/useLanguage';
