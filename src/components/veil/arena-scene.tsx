import { useEffect, useRef } from "react";
import * as THREE from "three";

export function ArenaScene() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: "low-power",
      precision: "mediump",
      stencil: false,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#0c0e12", 14, 32);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    camera.position.set(0, 6.4, 8.2);
    camera.lookAt(0, 0.4, -1.2);

    scene.add(new THREE.AmbientLight("#d5dbe8", 1.6));
    const moon = new THREE.DirectionalLight("#e7eefc", 2.4);
    moon.position.set(-6, 12, 4);
    scene.add(moon);
    const brass = new THREE.PointLight("#e3a04a", 8, 18);
    brass.position.set(0, 2.4, 0.4);
    scene.add(brass);
    const veil = new THREE.PointLight("#7a3e8a", 6, 14);
    veil.position.set(3.2, 1.6, -2.4);
    scene.add(veil);
    const grove = new THREE.PointLight("#1f8a4c", 4, 12);
    grove.position.set(-3.4, 1.4, 2.2);
    scene.add(grove);

    const stone = new THREE.MeshStandardMaterial({ color: "#242a36", roughness: 0.78, metalness: 0.08 });
    const brassMat = new THREE.MeshStandardMaterial({
      color: "#e3a04a",
      metalness: 0.72,
      roughness: 0.32,
      emissive: "#4a2e10",
      emissiveIntensity: 0.35,
    });
    const floorTex = new THREE.TextureLoader().load("/assets/veil/arena/floor-moon.jpg");
    floorTex.colorSpace = THREE.SRGBColorSpace;
    const dais = new THREE.Mesh(
      new THREE.CircleGeometry(6.6, 72),
      new THREE.MeshBasicMaterial({ map: floorTex, color: "#ffffff" }),
    );
    dais.rotation.x = -Math.PI / 2;
    scene.add(dais);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.15, 0.055, 10, 90), brassMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    scene.add(ring);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.03, 8, 64), brassMat);
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 0.06;
    scene.add(inner);

    const pillar = (x: number, z: number, height: number, broken: boolean) => {
      const group = new THREE.Group();
      const segments = 3;
      for (let i = 0; i < segments; i++) {
        const radius = 0.42 - i * 0.06;
        const part = height / segments;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.92, radius, part * 0.82, 8), stone);
        shaft.position.y = part * i + part * 0.45;
        group.add(shaft);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.06, radius + 0.06, 0.08, 8), brassMat);
        band.position.y = part * (i + 1) - 0.04;
        group.add(band);
      }
      if (broken) {
        const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), stone);
        chunk.position.set(0.18, height * 0.7, 0.1);
        chunk.rotation.set(0.4, 0.2, 0.7);
        group.add(chunk);
      }
      group.position.set(x, 0, z);
      scene.add(group);
    };
    pillar(-2.6, -3.4, 2.4, true);
    pillar(2.7, -3.2, 2.1, true);

    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.1, 8, 24, Math.PI), stone);
    arch.position.set(0, 1.7, -4.2);
    scene.add(arch);
    const keystone = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), brassMat);
    keystone.position.set(0, 3.35, -4.2);
    scene.add(keystone);

    const cloth = new THREE.MeshStandardMaterial({ color: "#1c2433", roughness: 0.72, metalness: 0.08 });
    const veilCloth = new THREE.MeshStandardMaterial({ color: "#3a2344", roughness: 0.66, metalness: 0.12 });
    const sentinel = (x: number, z: number, robe: THREE.Material, yaw: number) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.72, 4, 8), robe);
      body.position.y = 1.02;
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), brassMat);
      helm.scale.set(1, 1.2, 1);
      helm.position.y = 1.68;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.08), stone);
      visor.position.set(0, 1.64, 0.16);
      const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), brassMat);
      shoulderL.position.set(-0.32, 1.32, 0);
      const shoulderR = shoulderL.clone();
      shoulderR.position.x = 0.32;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.03), brassMat);
      blade.position.set(0.46, 1.12, 0.08);
      blade.rotation.z = -0.12;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.05), brassMat);
      guard.position.set(0.42, 1.52, 0.08);
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.85), robe);
      cape.position.set(0, 1.02, -0.2);
      group.add(body, helm, visor, shoulderL, shoulderR, blade, guard, cape);
      group.position.set(x, 0, z);
      group.rotation.y = yaw;
      group.scale.setScalar(1.35);
      scene.add(group);
      return group;
    };
    const leftKnight = sentinel(-2.85, -0.15, cloth, 0.42);
    const rightKnight = sentinel(2.85, -0.05, veilCloth, -0.42);

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.18, 0.16, 8), brassMat);
    bowl.position.set(0, 0.28, -1.55);
    scene.add(bowl);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.42, 6),
      new THREE.MeshBasicMaterial({ color: "#e3a04a" }),
    );
    flame.position.set(0, 0.58, -1.55);
    scene.add(flame);
    const ember = new THREE.PointLight("#e3a04a", 3, 6);
    ember.position.set(0, 0.7, -1.55);
    scene.add(ember);

    const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), stone);
    rubble.position.set(-1.4, 0.18, -1.6);
    rubble.rotation.y = 0.6;
    scene.add(rubble);
    const rubble2 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.3), stone);
    rubble2.position.set(1.5, 0.1, -0.4);
    rubble2.rotation.y = -0.4;
    scene.add(rubble2);

    const crystalGeo = new THREE.OctahedronGeometry(0.28, 0);
    const yours = new THREE.Mesh(
      crystalGeo,
      new THREE.MeshStandardMaterial({ color: "#7ec8c3", emissive: "#146864", emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.35 }),
    );
    yours.position.set(-1.15, 1.15, -0.2);
    const theirs = new THREE.Mesh(
      crystalGeo.clone(),
      new THREE.MeshStandardMaterial({ color: "#d4654a", emissive: "#6a2418", emissiveIntensity: 0.9, roughness: 0.18, metalness: 0.35 }),
    );
    theirs.position.set(1.15, 1.2, -1.6);
    scene.add(yours, theirs);

    const count = 32;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 11;
      positions[i * 3 + 1] = Math.random() * 3.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 9;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: "#e3a04a", size: 0.045, transparent: true, opacity: 0.75 }));
    scene.add(motes);

    const step = 1000 / 30;
    let frame = 0;
    let last = performance.now();
    let acc = step;
    const resize = () => {
      const width = canvas.clientWidth || 1;
      const height = canvas.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      acc += now - last;
      last = now;
      if (acc < step) return;
      const dt = Math.min(0.05, acc / 1000);
      acc = 0;
      yours.rotation.y += dt * 0.7;
      theirs.rotation.y -= dt * 0.5;
      yours.position.y = 0.9 + Math.sin(now * 0.0014) * 0.08;
      theirs.position.y = 0.95 + Math.sin(now * 0.0014 + 1.2) * 0.08;
      keystone.rotation.y += dt * 0.3;
      leftKnight.rotation.y = 0.42 + Math.sin(now * 0.0004) * 0.04;
      rightKnight.rotation.y = -0.42 - Math.sin(now * 0.0004) * 0.04;
      const flicker = 0.85 + Math.sin(now * 0.012) * 0.18 + Math.sin(now * 0.031) * 0.08;
      flame.scale.set(flicker, 0.75 + flicker * 0.35, flicker);
      ember.intensity = 2.2 + flicker;
      const attr = moteGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        let y = attr.getY(i) + dt * 0.22;
        if (y > 3.8) y = 0.05;
        attr.setY(i, y);
      }
      attr.needsUpdate = true;
      renderer.render(scene, camera);
    };
    const onHide = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      if (!frame) {
        last = performance.now();
        acc = step;
        frame = requestAnimationFrame(tick);
      }
    };
    if (reduced) renderer.render(scene, camera);
    else {
      document.addEventListener("visibilitychange", onHide);
      frame = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onHide);
      observer.disconnect();
      floorTex.dispose();
      const seenGeo = new Set<THREE.BufferGeometry>();
      const seenMat = new Set<THREE.Material>();
      scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) && !(obj instanceof THREE.Points)) return;
        const geometry = obj.geometry;
        if (geometry && !seenGeo.has(geometry)) {
          seenGeo.add(geometry);
          geometry.dispose();
        }
        const material = obj.material;
        const list = Array.isArray(material) ? material : [material];
        for (const item of list) {
          if (!seenMat.has(item)) {
            seenMat.add(item);
            item.dispose();
          }
        }
      });
      renderer.dispose();
    };
  }, []);

  return <canvas ref={ref} className="arena-canvas" aria-hidden />;
}
