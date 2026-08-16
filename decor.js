import * as THREE from 'three';
import { grassTexture } from './textures.js';

/* ============================================================
   DECOR.JS — éléments d'environnement extérieur, réutilisables
   et optimisés (InstancedMesh pour tout ce qui se répète).
   ============================================================ */

export const PERF = (function () {
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 820;
  return {
    mobile,
    treesPerLot: mobile ? 4 : 8,
    bushesPerLot: mobile ? 5 : 10,
    flowersPerLot: mobile ? 24 : 60,
    npcCount: mobile ? 2 : 4,
    shadowMapSize: mobile ? 1024 : 2048,
    pixelRatioCap: mobile ? 1.5 : 2,
  };
})();

/* ---------- Tree ---------- */
const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 1.6, 7);
const leavesGeo = new THREE.IcosahedronGeometry(0.9, 1);
export function makeTree(seed = 0) {
  const hue = 0.28 + ((seed * 37) % 10) / 100;
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.95 });
  const leavesMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, 0.45, 0.28 + ((seed * 13) % 10) / 100),
    roughness: 0.85, flatShading: true,
  });
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.8;
  trunk.castShadow = true;
  const scaleVar = 0.85 + ((seed * 53) % 30) / 100;
  const leaves = new THREE.Mesh(leavesGeo, leavesMat);
  leaves.position.y = 1.75 * scaleVar;
  leaves.scale.setScalar(scaleVar);
  leaves.castShadow = true;
  group.add(trunk, leaves);
  group.scale.setScalar(0.9 + ((seed * 91) % 40) / 100);
  return group;
}

/* ---------- Bush ---------- */
const bushGeo = new THREE.IcosahedronGeometry(0.32, 0);
export function makeBush(seed = 0) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.3, 0.4, 0.25 + ((seed * 17) % 10) / 100),
    roughness: 0.9, flatShading: true,
  });
  const bush = new THREE.Mesh(bushGeo, mat);
  bush.position.y = 0.28;
  bush.scale.setScalar(0.8 + ((seed * 29) % 40) / 100);
  bush.castShadow = true;
  return bush;
}

/* ---------- Flowerbed (InstancedMesh, léger) ---------- */
export function makeFlowerbed(width, depth, count, palette = [0xe74c3c, 0xf1c40f, 0xffffff, 0xe67e22]) {
  const geo = new THREE.SphereGeometry(0.045, 6, 6);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const colorArr = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    dummy.position.set((Math.random() - 0.5) * width, 0.05, (Math.random() - 0.5) * depth);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    c.setHex(palette[i % palette.length]);
    c.toArray(colorArr, i * 3);
  }
  geo.setAttribute('color', new THREE.InstancedBufferAttribute(colorArr, 3));
  inst.castShadow = true;
  return inst;
}

/* ---------- Fence + gate ---------- */
export function makeFence(width, depth, gateWidth = 1.1) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.6, metalness: 0.4 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.55, metalness: 0.45 });
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6);
  const spacing = 0.9;

  function edge(x1, z1, x2, z2, skipGateAt = null) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / spacing));
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.05, 0.05),
      railMat
    );
    rail.position.set((x1 + x2) / 2, 0.7, (z1 + z2) / 2);
    rail.rotation.y = Math.atan2(z2 - z1, x2 - x1) * -1 + Math.PI / 2;
    rail.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    group.add(rail);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      if (skipGateAt !== null && Math.abs(t - 0.5) < skipGateAt) continue;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, 0.45, z);
      post.castShadow = true;
      group.add(post);
    }
  }
  const hw = width / 2, hd = depth / 2;
  edge(-hw, -hd, hw, -hd, gateWidth / width); // front (with gate gap)
  edge(hw, -hd, hw, hd);
  edge(hw, hd, -hw, hd);
  edge(-hw, hd, -hw, -hd);

  // Gate panels (static, slightly open for a welcoming look)
  const gatePanelGeo = new THREE.BoxGeometry(gateWidth / 2 - 0.05, 0.85, 0.04);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x2f2f2f, roughness: 0.4, metalness: 0.6 });
  const left = new THREE.Mesh(gatePanelGeo, gateMat);
  left.position.set(-gateWidth / 4, 0.45, -hd);
  left.rotation.y = 0.5;
  const right = new THREE.Mesh(gatePanelGeo, gateMat);
  right.position.set(gateWidth / 4, 0.45, -hd);
  right.rotation.y = -0.5;
  left.castShadow = right.castShadow = true;
  group.add(left, right);
  return group;
}

/* ---------- Street lamp ---------- */
export function makeStreetLamp(withShadow = false) {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8), poleMat);
  pole.position.y = 1.1;
  pole.castShadow = true;
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c8, emissive: 0xffdca0, emissiveIntensity: 1.1, roughness: 0.3,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), headMat);
  head.position.y = 2.25;
  const light = new THREE.PointLight(0xffdca0, 0.8, 5, 2);
  light.position.y = 2.25;
  light.castShadow = withShadow;
  group.add(pole, head, light);
  return group;
}

/* ---------- Car (parked or driving) ---------- */
export function makeCar(bodyColor = 0x1c2b3a) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.6, clearcoat: 0.6 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0d1b22, roughness: 0.05, metalness: 0.1, transmission: 0.6, transparent: true, opacity: 0.85 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.3, metalness: 0.8 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.95), bodyMat);
  chassis.position.y = 0.42;
  chassis.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.36, 0.86), bodyMat);
  cabin.position.set(-0.1, 0.78, 0);
  cabin.castShadow = true;
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.3, 0.88), glassMat);
  windshield.position.set(-0.1, 0.78, 0);
  group.add(chassis, cabin, windshield);

  const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.2, 14);
  const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.22, 10);
  [[-0.6, -0.5], [-0.6, 0.5], [0.65, -0.5], [0.65, 0.5]].forEach(([x, z]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.24, z);
    wheel.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, 0.24, z);
    group.add(wheel, hub);
  });

  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2b0, emissiveIntensity: 1.4 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x991111, emissive: 0x660000, emissiveIntensity: 0.9 });
  const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.18), lightMat);
  hl1.position.set(0.95, 0.42, 0.32);
  const hl2 = hl1.clone(); hl2.position.z = -0.32;
  const tl1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.18), tailMat);
  tl1.position.set(-0.95, 0.42, 0.32);
  const tl2 = tl1.clone(); tl2.position.z = -0.32;
  group.add(hl1, hl2, tl1, tl2);

  return group;
}

/* ---------- Simplified walking figure (no rig — procedural swing) ---------- */
export function makePerson(skin = 0xe0b090, shirt = 0x3a5a78, pants = 0x2c2c2c) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.75 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.75 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), skinMat);
  head.position.y = 1.55;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.38, 4, 8), shirtMat);
  torso.position.y = 1.2;

  const armGeo = new THREE.CapsuleGeometry(0.045, 0.34, 4, 6);
  const legGeo = new THREE.CapsuleGeometry(0.055, 0.42, 4, 6);

  const leftArm = new THREE.Mesh(armGeo, shirtMat); leftArm.position.set(-0.2, 1.18, 0);
  const rightArm = new THREE.Mesh(armGeo, shirtMat); rightArm.position.set(0.2, 1.18, 0);
  const leftLeg = new THREE.Mesh(legGeo, pantsMat); leftLeg.position.set(-0.08, 0.65, 0);
  const rightLeg = new THREE.Mesh(legGeo, pantsMat); rightLeg.position.set(0.08, 0.65, 0);

  [head, torso, leftArm, rightArm, leftLeg, rightLeg].forEach((m) => { m.castShadow = true; group.add(m); });

  group.userData.limbs = { leftArm, rightArm, leftLeg, rightLeg };
  group.userData.walk = { path: [], idx: 0, speed: 0.5, phase: Math.random() * 10 };
  return group;
}

export function setPersonPath(person, points, speed = 0.5) {
  person.userData.walk.path = points;
  person.userData.walk.idx = 0;
  person.userData.walk.speed = speed;
  if (points.length) person.position.copy(points[0]);
}

export function updatePerson(person, dt) {
  const walk = person.userData.walk;
  const { leftArm, rightArm, leftLeg, rightLeg } = person.userData.limbs;
  if (walk.path.length > 1) {
    const target = walk.path[(walk.idx + 1) % walk.path.length];
    const dir = new THREE.Vector3().subVectors(target, person.position);
    const dist = dir.length();
    if (dist < 0.05) {
      walk.idx = (walk.idx + 1) % walk.path.length;
    } else {
      dir.normalize();
      person.position.addScaledVector(dir, walk.speed * dt);
      const targetAngle = Math.atan2(dir.x, dir.z);
      person.rotation.y = targetAngle;
      walk.phase += dt * 6;
      const swing = Math.sin(walk.phase) * 0.5;
      leftArm.rotation.x = swing;
      rightArm.rotation.x = -swing;
      leftLeg.rotation.x = -swing;
      rightLeg.rotation.x = swing;
    }
  }
}

/* ---------- Ground with grass texture, ready to add to a scene ---------- */
export function makeGrassGround(radius) {
  const tex = grassTexture([radius / 2.2, radius / 2.2]);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}
