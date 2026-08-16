import * as THREE from 'three';
import {
  brickTexture, stoneTexture, woodTexture, stuccoTexture, shingleTexture,
  concreteTexture, marbleTexture, waterTexture, poolTileTexture, abstractArtTexture,
} from './textures.js';
import { makeTree, makeBush, makeFlowerbed, makeFence, makeStreetLamp, makeCar, makeGrassGround, PERF } from './decor.js';
import { createWalkControls, attachJoystick } from './WalkControls.js';

/* ============================================================
   HOUSE.JS — maisons à véritable architecture (pas de cubes nus),
   avec matériaux PBR (verre réel via transmission + environment map,
   pierre/brique/bois/béton/marbre), jardin, piscine, terrasse, garage.
   ============================================================ */

function styleFor(person) {
  const seed = (person.name || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return seed % 3; // 0 moderne · 1 pierre & bois · 2 brique classique
}
function hashSeed(person, salt = 0) {
  return (person.name || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0) + salt;
}

function paletteFor(person) {
  if (person.gender === 'male') return { accent: 0x3498db, roofTint: '#2f3a44' };
  if (person.gender === 'female') return { accent: 0xe27396, roofTint: '#4a3238' };
  return { accent: 0x8E44AD, roofTint: '#3a3f45' };
}

// Materials are expensive-ish to build (canvas draws) — cache per style so
// they're only generated once no matter how many houses are on screen.
const materialCache = {};
function getMaterials(style) {
  if (materialCache[style]) return materialCache[style];
  let wallMat, trimMat, roofMat, baseMat;
  if (style === 0) { // moderne — béton + crépi clair
    wallMat = new THREE.MeshStandardMaterial({ map: stuccoTexture([2, 2], '#e9e4d8'), roughness: 0.85 });
    trimMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.4, metalness: 0.3 });
    roofMat = new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.7 });
    baseMat = new THREE.MeshStandardMaterial({ map: concreteTexture([3, 1]), roughness: 0.9 });
  } else if (style === 1) { // pierre & bois — cottage chaleureux
    wallMat = new THREE.MeshStandardMaterial({ map: woodTexture([2, 3], '#7a5535'), roughness: 0.8 });
    trimMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.6 });
    roofMat = new THREE.MeshStandardMaterial({ map: shingleTexture([4, 3], '#4a3a2c'), roughness: 0.85 });
    baseMat = new THREE.MeshStandardMaterial({ map: stoneTexture([3, 1.4]), roughness: 0.95 });
  } else { // brique classique
    wallMat = new THREE.MeshStandardMaterial({ map: brickTexture([3, 2], '#8a3f30'), roughness: 0.9 });
    trimMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5 });
    roofMat = new THREE.MeshStandardMaterial({ map: shingleTexture([4, 3], '#33383e'), roughness: 0.8 });
    baseMat = new THREE.MeshStandardMaterial({ map: concreteTexture([3, 1]), roughness: 0.9 });
  }
  materialCache[style] = { wallMat, trimMat, roofMat, baseMat };
  return materialCache[style];
}

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xbfe0ff, roughness: 0.05, metalness: 0, transmission: 0.9,
  thickness: 0.05, ior: 1.5, transparent: true, opacity: 1, envMapIntensity: 1.2,
});
const marbleMat = new THREE.MeshStandardMaterial({ map: marbleTexture([2, 2]), roughness: 0.25, metalness: 0.05 });

/* ============================================================
   Exterior shell
   ============================================================ */
export function buildHouseShell(person, opts = {}) {
  const scale = opts.scale ?? 1;
  const style = styleFor(person);
  const pal = paletteFor(person);
  const mats = getMaterials(style);
  const group = new THREE.Group();
  group.userData.person = person;
  group.userData.style = style;

  const W = 5.2 * scale, D = 4.4 * scale, H = 2.9 * scale;

  // Base / plinth (marble trim for a luxury touch)
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.35, D + 0.3), mats.baseMat);
  base.position.y = 0.18;
  base.receiveShadow = true;
  group.add(base);

  // Main volume
  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mats.wallMat);
  walls.position.y = 0.35 + H / 2;
  walls.castShadow = true; walls.receiveShadow = true;
  group.add(walls);

  // Roof — shape depends on style
  let roofTopY = 0.35 + H;
  if (style === 0) {
    // Flat roof with parapet ledge
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.28, D + 0.1), mats.trimMat);
    parapet.position.y = roofTopY + 0.14;
    parapet.castShadow = true;
    group.add(parapet);
    roofTopY += 0.3;
  } else {
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(W, D) * 0.8, 1.5 * scale, 4), mats.roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = roofTopY + 0.72 * scale;
    roof.castShadow = true;
    group.add(roof);
    roofTopY += 1.5 * scale;
  }

  // Chimney (style 1/2)
  if (style !== 0) {
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.32 * scale, 1.0 * scale, 0.32 * scale), mats.baseMat);
    chimney.position.set(W * 0.28, roofTopY - 0.2, D * 0.12);
    chimney.castShadow = true;
    group.add(chimney);
  }

  // Trim / corner mouldings (style 2 gives it a "classique" look)
  if (style === 2) {
    [-1, 1].forEach((side) => {
      const corner = new THREE.Mesh(new THREE.BoxGeometry(0.14 * scale, H, 0.14 * scale), mats.trimMat);
      corner.position.set(side * (W / 2 - 0.07 * scale), 0.35 + H / 2, D / 2 - 0.07 * scale);
      group.add(corner);
    });
  }

  // Large real-glass windows with mullions (2 or 3 depending on width)
  const winCount = style === 0 ? 3 : 2;
  const winW = 0.85 * scale, winH = style === 0 ? 1.5 * scale : 0.95 * scale;
  for (let i = 0; i < winCount; i++) {
    const t = (i + 1) / (winCount + 1);
    const x = -W / 2 + W * t;
    if (Math.abs(x) < 0.6 * scale) continue; // leave room for door
    const win = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.06), glassMat);
    win.position.set(x, 0.35 + H * (style === 0 ? 0.5 : 0.58), D / 2 + 0.03);
    group.add(win);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.08, winH + 0.08, 0.05), mats.trimMat);
    frame.position.copy(win.position); frame.position.z -= 0.015;
    group.add(frame);
    // mullion cross
    const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.03, winH, 0.07), mats.trimMat);
    mullionV.position.copy(win.position); mullionV.position.z += 0.01;
    const mullionH = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.03, 0.07), mats.trimMat);
    mullionH.position.copy(win.position); mullionH.position.z += 0.01;
    group.add(mullionV, mullionH);
  }

  // ---------- Door (real, opens on hinge) ----------
  const doorW = 1.0 * scale, doorH = 2.15 * scale;
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-doorW / 2, 0.35, D / 2);
  const doorMat = new THREE.MeshStandardMaterial({ color: style === 1 ? 0x4a3120 : 0x232323, roughness: 0.4, metalness: 0.3 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.09), doorMat);
  door.position.set(doorW / 2, doorH / 2, 0);
  door.castShadow = true;
  const glassInsert = new THREE.Mesh(new THREE.BoxGeometry(doorW * 0.35, doorH * 0.45, 0.02), glassMat);
  glassInsert.position.set(doorW / 2, doorH * 0.62, 0.06);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.25, metalness: 0.85 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(doorW - 0.1, doorH * 0.5, 0.07);
  door.add(glassInsert, handle);
  doorPivot.add(door);
  group.add(doorPivot);
  group.userData.doorPivot = doorPivot;
  group.userData.doorHitbox = door;

  // Grand entrance canopy
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(doorW * 2.2, 0.08, 1.1 * scale), mats.trimMat);
  canopy.position.set(0, 0.35 + doorH + 0.15, D / 2 + 0.55 * scale);
  canopy.castShadow = true;
  group.add(canopy);
  const canopyPost = (side) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, doorH + 0.15, 8), mats.trimMat);
    post.position.set(side * doorW * 0.9, 0.35 + (doorH + 0.15) / 2, D / 2 + 1.0 * scale);
    return post;
  };
  group.add(canopyPost(-1), canopyPost(1));

  // Exterior wall lights either side of door
  [-1, 1].forEach((side) => {
    const sconce = new THREE.Mesh(new THREE.SphereGeometry(0.07 * scale, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffe8bf, emissive: 0xffcf8a, emissiveIntensity: 1 }));
    sconce.position.set(side * doorW * 1.3, 0.35 + doorH * 0.65, D / 2 + 0.05);
    const lamp = new THREE.PointLight(0xffcf8a, 0.5, 3, 2);
    lamp.position.copy(sconce.position);
    group.add(sconce, lamp);
  });

  return { group, style, W, D, H, roofTopY, doorW };
}

/* ============================================================
   Full lot — house + garden + fence/gate + garage + driveway +
   optional pool/terrace, sized to keep perf sane on mobile
   ============================================================ */
export function buildLot(person, opts = {}) {
  const scale = opts.scale ?? 1;
  const lot = new THREE.Group();
  const { group: house, style, W, D, H, doorW } = buildHouseShell(person, { scale });
  lot.add(house);
  lot.userData.person = person;
  lot.userData.doorPivot = house.userData.doorPivot;
  lot.userData.doorHitbox = house.userData.doorHitbox;
  lot.userData.style = style;

  const plotW = W + 5 * scale, plotD = D + 6 * scale;

  // Grass covering the plot
  const grass = makeGrassGround(Math.max(plotW, plotD) * 0.62);
  grass.position.y = 0.001;
  lot.add(grass);

  // Front path (marble-trimmed for luxury feel)
  const path = new THREE.Mesh(new THREE.BoxGeometry(1.1 * scale, 0.04, 2.2 * scale), marbleMat);
  path.position.set(0, 0.22, D / 2 + 1.8 * scale);
  path.receiveShadow = true;
  lot.add(path);

  // Fence + gate around the plot
  if (!opts.skipFence) {
    const fence = makeFence(plotW, plotD, doorW * 1.3);
    lot.add(fence);
  }

  // Trees + bushes scattered (seeded so it's stable per person, not random each render)
  const seed = hashSeed(person);
  const treeCount = opts.decorLevel === 'low' ? Math.min(3, PERF.treesPerLot) : PERF.treesPerLot;
  for (let i = 0; i < treeCount; i++) {
    const a = (i / treeCount) * Math.PI * 2 + seed;
    const r = plotD * 0.42 + (i % 2) * 0.6;
    const tree = makeTree(seed + i);
    tree.position.set(Math.cos(a) * r * (plotW / plotD), 0, Math.sin(a) * r);
    // keep clear of the front path
    if (Math.abs(tree.position.x) < 1.2 * scale && tree.position.z > D / 2) continue;
    lot.add(tree);
  }
  const bushCount = opts.decorLevel === 'low' ? 3 : PERF.bushesPerLot;
  for (let i = 0; i < bushCount; i++) {
    const bush = makeBush(seed + i * 7);
    const side = i % 2 === 0 ? -1 : 1;
    bush.position.set(side * (W / 2 + 0.3 * scale + (i % 3) * 0.35), 0, D / 2 - 0.4 * scale - (i % 4) * 0.4);
    lot.add(bush);
  }
  // Flowerbed along the path
  const flowers = makeFlowerbed(1.6 * scale, 0.5 * scale, opts.decorLevel === 'low' ? 12 : PERF.flowersPerLot);
  flowers.position.set(0, 0.22, D / 2 + 1.9 * scale);
  lot.add(flowers);

  // Driveway + garage (only style 0/2 to keep variety, and only on the "full" lots)
  if (!opts.skipGarage) {
    const driveway = new THREE.Mesh(new THREE.BoxGeometry(1.6 * scale, 0.04, 2.6 * scale), new THREE.MeshStandardMaterial({ map: concreteTexture([2, 3]), roughness: 0.9 }));
    driveway.position.set(-(W / 2 + 1.1 * scale), 0.22, D / 2 - 0.3 * scale);
    driveway.receiveShadow = true;
    lot.add(driveway);

    const mats = getMaterials(style);
    const garage = new THREE.Mesh(new THREE.BoxGeometry(1.8 * scale, H * 0.75, 2.2 * scale), mats.wallMat);
    garage.position.set(-(W / 2 + 1.1 * scale), 0.35 + (H * 0.75) / 2, D / 2 - 0.3 * scale);
    garage.castShadow = true; garage.receiveShadow = true;
    lot.add(garage);
    const garageDoor = new THREE.Mesh(new THREE.BoxGeometry(1.5 * scale, H * 0.5, 0.06), new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.5, metalness: 0.3 }));
    garageDoor.position.set(-(W / 2 + 1.1 * scale), 0.35 + (H * 0.5) / 2, D / 2 - 0.3 * scale + 1.1 * scale + 0.03);
    lot.add(garageDoor);

    const car = makeCar([0x1c2b3a, 0x8a1e1e, 0x2c2c2c, 0xb8b2a0][seed % 4]);
    car.rotation.y = Math.PI / 2;
    car.scale.setScalar(0.85 * scale);
    car.position.set(-(W / 2 + 1.1 * scale), 0, D / 2 - 0.3 * scale + 1.5 * scale);
    lot.add(car);
  }

  // Terrace (wood deck) at the back, prominent for cottage style
  if (!opts.skipTerrace) {
    const deckW = style === 1 ? W * 0.9 : W * 0.6, deckD = 1.6 * scale;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.12, deckD), new THREE.MeshStandardMaterial({ map: woodTexture([2, 1], '#6b4530'), roughness: 0.8 }));
    deck.position.set(0, 0.28, -(D / 2 + deckD / 2));
    deck.receiveShadow = true; deck.castShadow = true;
    lot.add(deck);
    // simple table + 2 chairs
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * scale, 0.32 * scale, 0.42 * scale, 12), new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.5, metalness: 0.4 }));
    table.position.set(0, 0.55, -(D / 2 + deckD / 2));
    lot.add(table);
  }

  // Pool (moderne / brique styles — a mark of "luxury")
  if (style !== 1 && !opts.skipPool) {
    const poolW = 2.2 * scale, poolD = 1.3 * scale;
    const poolPit = new THREE.Mesh(new THREE.BoxGeometry(poolW, 0.4, poolD), new THREE.MeshStandardMaterial({ map: poolTileTexture([6, 3]), roughness: 0.3 }));
    poolPit.position.set(W / 2 + 1.6 * scale, 0.1, -(D / 2 + 0.4 * scale));
    lot.add(poolPit);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(poolW - 0.15, poolD - 0.15), new THREE.MeshPhysicalMaterial({
      map: waterTexture([2, 1.2]), roughness: 0.08, metalness: 0, transmission: 0.4, transparent: true, opacity: 0.92, color: 0x2a90b8,
    }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(poolPit.position.x, 0.31, poolPit.position.z);
    water.userData.isWater = true;
    lot.add(water);
    lot.userData.water = water;
  }

  // Street lamps at plot corners (only front two cast shadow, for perf)
  [[-plotW / 2, -plotD / 2, false], [plotW / 2, -plotD / 2, false]].forEach(([x, z, shadow]) => {
    const lamp = makeStreetLamp(shadow);
    lamp.position.set(x, 0, z);
    lot.add(lamp);
  });

  return lot;
}

/* ============================================================
   Interior — open-plan living room + kitchen counter + bedroom
   nook, real materials, TV, paintings, lamp with real light.
   (Full multi-room floor plans with corridors/staircases are out
   of scope for procedural generation — this is an honest,
   detailed single open-plan space.)
   ============================================================ */
export function buildInterior(person, scale = 1) {
  const style = styleFor(person);
  const room = new THREE.Group();
  const W = 5.2 * scale, D = 4.4 * scale, H = 2.9 * scale;

  const floorMat = new THREE.MeshStandardMaterial({
    map: style === 1 ? woodTexture([2, 3], '#8a6a48') : marbleTexture([3, 3]),
    roughness: 0.4, metalness: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, D - 0.2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.36;
  floor.receiveShadow = true;
  room.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.15, D - 0.15), new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.95, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 0.35 + H - 0.05;
  room.add(ceiling);

  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.0 * scale, 32), new THREE.MeshStandardMaterial({ color: paletteFor(person).accent, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-0.6 * scale, 0.365, 0.2 * scale);
  room.add(rug);

  // Sofa (L-shaped)
  const sofaMat = new THREE.MeshStandardMaterial({ color: 0x4a3f5a, roughness: 0.85 });
  const sofa1 = new THREE.Mesh(new THREE.BoxGeometry(1.6 * scale, 0.42 * scale, 0.65 * scale), sofaMat);
  sofa1.position.set(-1.2 * scale, 0.56, -0.6 * scale);
  const sofa2 = new THREE.Mesh(new THREE.BoxGeometry(0.65 * scale, 0.42 * scale, 1.2 * scale), sofaMat);
  sofa2.position.set(-1.85 * scale, 0.56, 0.1 * scale);
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(1.6 * scale, 0.5 * scale, 0.16 * scale), sofaMat);
  sofaBack.position.set(-1.2 * scale, 0.82, -0.9 * scale);
  [sofa1, sofa2, sofaBack].forEach((m) => { m.castShadow = true; room.add(m); });

  // Coffee table (marble top)
  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.36 * scale, 0.36 * scale, 0.04, 24), marbleMat);
  tableTop.position.set(-0.6 * scale, 0.42, 0.15 * scale);
  const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.38 * scale, 10), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.3 }));
  tableLeg.position.set(-0.6 * scale, 0.23, 0.15 * scale);
  room.add(tableTop, tableLeg);

  // TV + stand
  const stand = new THREE.Mesh(new THREE.BoxGeometry(1.4 * scale, 0.35 * scale, 0.35 * scale), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }));
  stand.position.set(0.9 * scale, 0.55, -D / 2 + 0.5 * scale);
  const tv = new THREE.Mesh(new THREE.BoxGeometry(1.2 * scale, 0.7 * scale, 0.05), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x1a2f45, emissiveIntensity: 0.5, roughness: 0.2 }));
  tv.position.set(0.9 * scale, 1.05, -D / 2 + 0.35 * scale);
  room.add(stand, tv);

  // Kitchen counter (L)
  const counterMat = new THREE.MeshStandardMaterial({ map: marbleTexture([1.5, 1]), roughness: 0.3 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.5 * scale, 0.5 * scale, 0.55 * scale), counterMat);
  counter.position.set(1.6 * scale, 0.61, 1.2 * scale);
  counter.castShadow = true;
  room.add(counter);
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x36302a, roughness: 0.6 });
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.5 * scale, 0.35 * scale, 0.5 * scale), cabinetMat);
  cabinet.position.set(1.6 * scale, 0.18, 1.2 * scale);
  room.add(cabinet);

  // Bed nook
  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(1.0 * scale, 0.32 * scale, 1.6 * scale), new THREE.MeshStandardMaterial({ color: 0x5a4530, roughness: 0.8 }));
  bedFrame.position.set(1.7 * scale, 0.52, -1.2 * scale);
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(0.92 * scale, 0.18 * scale, 1.5 * scale), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 }));
  mattress.position.set(1.7 * scale, 0.73, -1.2 * scale);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.35 * scale, 0.1 * scale, 0.25 * scale), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
  pillow.position.set(1.7 * scale, 0.85, -1.85 * scale);
  [bedFrame, mattress, pillow].forEach((m) => { m.castShadow = true; room.add(m); });

  // Floor lamp (real point light)
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3 * scale, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4 }));
  lampPole.position.set(-2.1 * scale, 0.95, -1.4 * scale);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.24 * scale, 0.3 * scale, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xf2d9a0, emissive: 0xf2d9a0, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  lampShade.position.set(-2.1 * scale, 1.65, -1.4 * scale);
  const lampLight = new THREE.PointLight(0xffdca8, 1.1, 5 * scale, 2);
  lampLight.position.set(-2.1 * scale, 1.55, -1.4 * scale);
  lampLight.castShadow = true;
  room.add(lampPole, lampShade, lampLight);

  // Paintings on the side walls (kept clear of the back opening that leads to the hallway)
  const paintSpots = [
    { x: -W / 2 + 0.08, z: -0.6 * scale, ry: Math.PI / 2 },
    { x: W / 2 - 0.08, z: 0.6 * scale, ry: -Math.PI / 2 },
  ];
  paintSpots.forEach((spot, i) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.55 * scale, 0.4 * scale, 0.04), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }));
    frame.position.set(spot.x, 1.7, spot.z);
    frame.rotation.y = spot.ry;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.48 * scale, 0.34 * scale), new THREE.MeshStandardMaterial({ map: abstractArtTexture(i + hashSeedLocal(person)), roughness: 0.8 }));
    art.position.copy(frame.position);
    art.rotation.y = spot.ry;
    art.translateZ(0.03);
    room.add(frame, art);
  });

  return room;
}
function hashSeedLocal(person) {
  return (person.name || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

/* ============================================================
   ROOM SHELL — encloses buildInterior()'s furniture in real
   walls/floor/ceiling. If the person has children, the back wall
   is left open (with door-frame flanks) so the room flows
   straight into the hallway of "chambres" below.
   ============================================================ */
export function buildRoomShell(person, scale = 1, openBack = false) {
  const style = styleFor(person);
  const mats = getMaterials(style);
  const W = 5.2 * scale, D = 4.4 * scale, H = 2.9 * scale;
  const group = new THREE.Group();

  const floorMat = new THREE.MeshStandardMaterial({
    map: style === 1 ? woodTexture([2, 3], '#8a6a48') : marbleTexture([3, 3]), roughness: 0.4, metalness: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.36;
  floor.receiveShadow = true;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.95, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, H, D), mats.wallMat);
  leftWall.position.set(-W / 2, H / 2, 0);
  const rightWall = leftWall.clone();
  rightWall.position.x = W / 2;
  [leftWall, rightWall].forEach((w) => { w.castShadow = true; w.receiveShadow = true; group.add(w); });
  group.add(floor, ceiling);

  const backOpeningWidth = Math.min(2.6 * scale, W * 0.5);
  if (openBack) {
    const segW = (W - backOpeningWidth) / 2;
    const segL = new THREE.Mesh(new THREE.BoxGeometry(segW, H, 0.12), mats.wallMat);
    segL.position.set(-W / 2 + segW / 2, H / 2, -D / 2);
    const segR = segL.clone();
    segR.position.x = W / 2 - segW / 2;
    [segL, segR].forEach((w) => { w.castShadow = true; w.receiveShadow = true; group.add(w); });
  } else {
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.12), mats.wallMat);
    backWall.position.set(0, H / 2, -D / 2);
    backWall.castShadow = true; backWall.receiveShadow = true;
    group.add(backWall);
  }

  return { group, W, D, H, backOpeningWidth };
}

function makeDoorLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,16,26,0.65)';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(0, 0, 320, 96, 18) : ctx.rect(0, 0, 320, 96);
  ctx.fill();
  ctx.fillStyle = '#f5f0ff';
  ctx.font = '600 40px Inter, Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.4, 0.42, 1);
  return sprite;
}

/* ============================================================
   HALLWAY — one real, openable door per child ("chambre").
   Extends indefinitely (length adapts to how many children);
   each door, opened, leads recursively into that child's own
   room + their own hallway of children, forever, driven purely
   by the Firestore data (no hardcoded depth limit).
   ============================================================ */
export function buildHallway(person, children, scale, startZ) {
  const style = styleFor(person);
  const mats = getMaterials(style);
  const n = children.length;
  const doorGap = 1.9 * scale;
  const rows = Math.max(1, Math.ceil(n / 2));
  const length = rows * doorGap + 1.2 * scale;
  const width = 2.6 * scale;
  const H = 2.9 * scale;
  const midZ = startZ - length / 2;
  const endZ = startZ - length;

  const group = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, length), new THREE.MeshStandardMaterial({ map: marbleTexture([1, Math.max(2, rows)]), roughness: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.36, midZ);
  floor.receiveShadow = true;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, length), new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.95, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, midZ);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, length), mats.wallMat);
  leftWall.position.set(-width / 2, H / 2, midZ);
  const rightWall = leftWall.clone();
  rightWall.position.x = width / 2;
  const endWall = new THREE.Mesh(new THREE.BoxGeometry(width, H, 0.1), mats.wallMat);
  endWall.position.set(0, H / 2, endZ);
  [leftWall, rightWall, endWall].forEach((w) => { w.castShadow = true; w.receiveShadow = true; group.add(w); });
  group.add(floor, ceiling);

  // Corridor lighting (kept light on lights/shadows for long hallways)
  const lightEvery = n > 16 ? 2 : 1;
  for (let i = 0; i <= rows; i += lightEvery) {
    const z = startZ - i * doorGap;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06 * scale, 8, 8), new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffdca0, emissiveIntensity: 1 }));
    bulb.position.set(0, H - 0.15, z);
    const light = new THREE.PointLight(0xffdca0, 0.6, 4 * scale, 2);
    light.position.copy(bulb.position);
    group.add(bulb, light);
  }

  const doors = [];
  const doorW = 0.85 * scale, doorH = 2.0 * scale;
  const doorMat = new THREE.MeshStandardMaterial({ color: style === 1 ? 0x4a3120 : 0x232323, roughness: 0.45, metalness: 0.25 });

  children.forEach((child, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2);
    const z = startZ - 0.9 * scale - row * doorGap;
    const wallX = side * (width / 2 - 0.05);

    const pivot = new THREE.Group();
    pivot.position.set(wallX, 0, z - (side < 0 ? doorW / 2 : -doorW / 2));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, doorH, doorW), doorMat);
    door.position.set(0, doorH / 2, side < 0 ? doorW / 2 : -doorW / 2);
    door.castShadow = true;
    door.userData.person = child; // click target — walking up the graph stops right here
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.03 * scale, 8, 8), new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.25, metalness: 0.85 }));
    handle.position.set(0.05, 0, side < 0 ? doorW * 0.15 : -doorW * 0.15);
    door.add(handle);
    pivot.add(door);
    group.add(pivot);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, doorH + 0.1, doorW + 0.1), mats.trimMat);
    frame.position.set(wallX + (side < 0 ? -0.03 : 0.03), doorH / 2, z);
    group.add(frame);

    const grandChildCount = (child.children && child.children.length) || 0;
    const labelText = child.name + (grandChildCount ? ` (${grandChildCount})` : '');
    const label = makeDoorLabel(labelText);
    label.position.set(wallX + (side < 0 ? -0.35 : 0.35), doorH + 0.15, z);
    group.add(label);

    doors.push({ pivot, hitbox: door, person: child });
  });

  return { group, doors, length, endZ, width };
}
