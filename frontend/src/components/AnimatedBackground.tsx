'use client';

import { useEffect, useRef } from 'react';

/**
 * Animated background using Three.js.
 * Renders subtle, paper-like planes drifting with instancing for performance.
 */
export default function AnimatedBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cleanup = () => {};

    (async () => {
      try {
        const THREE: any = await import('three');

        const container = containerRef.current;
        if (!container) return;

        const tmpObj = new THREE.Object3D();

        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const area = window.innerWidth * window.innerHeight;
        const baseCount = Math.min(120, Math.max(40, Math.floor(area / 14000)));
        const INSTANCE_COUNT = prefersReduced ? Math.floor(baseCount * 0.4) : baseCount;
        const PLANE_MIN_SIZE = 3.5;
        const PLANE_MAX_SIZE = 7.5;
        const DRIFT_SPEED = prefersReduced ? 0.008 : 0.015;
        const ROT_X = prefersReduced ? 0.0003 : 0.0007;
        const ROT_Y = prefersReduced ? 0.0006 : 0.0012;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 1000);
        camera.position.set(0, 0, 60);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.outputEncoding = THREE.sRGBEncoding;
        container.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.9));
        const directional = new THREE.DirectionalLight(0xffffff, 0.3);
        directional.position.set(0, 1, 1);
        scene.add(directional);

        const unitPlane = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.MeshStandardMaterial({
          color: 0xf5f5f5,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.5,
        });
        const instanced = new THREE.InstancedMesh(unitPlane, material, INSTANCE_COUNT);
        const velocities: number[] = new Array(INSTANCE_COUNT);
        const rotSpeeds: number[] = new Array(INSTANCE_COUNT * 2);

        for (let i = 0; i < INSTANCE_COUNT; i++) {
          const width = THREE.MathUtils.lerp(PLANE_MIN_SIZE, PLANE_MAX_SIZE, Math.random());
          const height = THREE.MathUtils.lerp(PLANE_MIN_SIZE * 0.6, PLANE_MAX_SIZE * 0.8, Math.random());
          tmpObj.scale.set(width, height, 1);
          tmpObj.position.set((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 80);
          tmpObj.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
          tmpObj.updateMatrix();
          instanced.setMatrixAt(i, tmpObj.matrix);

          velocities[i] = DRIFT_SPEED * (0.6 + Math.random() * 0.8);
          rotSpeeds[i * 2] = ROT_X * (0.6 + Math.random() * 0.8);
          rotSpeeds[i * 2 + 1] = ROT_Y * (0.6 + Math.random() * 0.8);
        }
        instanced.instanceMatrix.needsUpdate = true;
        scene.add(instanced);

        const onResize = () => {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', onResize);

        const mouse = { x: 0, y: 0 };
        const onPointerMove = (e: PointerEvent) => {
          const nx = (e.clientX / window.innerWidth) * 2 - 1;
          const ny = (e.clientY / window.innerHeight) * 2 - 1;
          mouse.x = nx;
          mouse.y = ny;
        };
        window.addEventListener('pointermove', onPointerMove);

        let raf = 0;
        const animate = () => {
          raf = requestAnimationFrame(animate);
          camera.position.x += (mouse.x * 2 - camera.position.x) * 0.02;
          camera.position.y += (-mouse.y * 1.5 - camera.position.y) * 0.02;
          camera.lookAt(0, 0, 0);

          for (let i = 0; i < INSTANCE_COUNT; i++) {
            instanced.getMatrixAt(i, tmpObj.matrix);
            tmpObj.position.setFromMatrixPosition(tmpObj.matrix);
            tmpObj.rotation.setFromRotationMatrix(tmpObj.matrix);
            tmpObj.rotation.x += rotSpeeds[i * 2];
            tmpObj.rotation.y += rotSpeeds[i * 2 + 1];
            tmpObj.position.y += velocities[i];
            if (tmpObj.position.y > 40) tmpObj.position.y = -40;
            tmpObj.updateMatrix();
            instanced.setMatrixAt(i, tmpObj.matrix);
          }
          instanced.instanceMatrix.needsUpdate = true;
          renderer.render(scene, camera);
        };
        animate();

        cleanup = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', onResize);
          window.removeEventListener('pointermove', onPointerMove as any);
          try {
            instanced?.geometry?.dispose?.();
            instanced?.material?.dispose?.();
            renderer.dispose?.();
          } catch {}
          if (container && renderer?.domElement?.parentNode === container) {
            container.removeChild(renderer.domElement);
          }
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Animated background failed to load', err);
      }
    })();

    return () => cleanup();
  }, []);

  return <div id="bg-container" ref={containerRef} aria-hidden />;
}

