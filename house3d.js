import { db } from './firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ============================================================
   GAWAY 3D — monde familial explorable
   Maisons générées procéduralement (aucun asset externe requis,
   aucun emoji). Style "réaliste stylisé" : matériaux PBR,
   ombres portées, éclairage chaud/froid, proportions réelles.
   ============================================================ */

// ---------- DOM ----------
const host = document.getElementById('canvasHost');
const loadingEl = document.getElementById('loading');
const fadeEl = document.getElementById('fadeOverlay');
const backBtn = document.getElementById('backBtn3d');
const breadcrumbEl = document.getElementById('breadcrumb3d');
const hintEl = document.getElementById('hint');
const personCard = document.getElementById('personCard');
const pcPhoto = document.getElementById('pcPhoto');
const pcName = document.getElementById('pcName');
const pcMeta = document.getElementById('pcMeta');
const pcBio = document.getElementById('pcBio');
const enterChildrenBtn = document.getElementById('enterChildrenBtn');
const exitHouseBtn = document.getElementById('exitHouseBtn');

// ---------- THREE base ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.FogExp2(0x0b0f14, 0.028);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 1.7, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.5;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(0, 1.4, 0);
controls.enabled = true;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Lighting ----------
const hemi = new THREE.HemisphereLight(0x9fb8d9, 0x3a2f28, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2e0, 1.3);
sun.position.set(12, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0015;
scene.add(sun);

const fill = new THREE.DirectionalLight(0x6d8fc9, 0.25);
fill.position.set(-10, 6, -10);
scene.add(fill);

// ---------- Ground plaza (always present) ----------
const groundMat = new THREE.MeshStandardMaterial({ color: 0x2c3a33, roughness: 0.95, metalness: 0.0 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// world content group — cleared & rebuilt on every navigation
const worldGroup = new THREE.Group();
scene.add(worldGroup);

// ---------- Text-plate helper (names, no emoji, real typography) ----------
function makeLabelSprite(text, opts = {}) {
  const { fontSize = 64, color = '#f5f0ff', bg = 'rgba(20,16,28,0.55)', w = 512, h = 128 } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, w, h, 26);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- Portrait texture loader (uses your existing photos/ folder, gracefully falls back) ----------
const texLoader = new THREE.TextureLoader();
function loadPortraitTexture(photo) {
  return new Promise((resolve) => {
    if (!photo) return resolve(null);
    texLoader.load(
      'photos/' + photo,
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); },
      undefined,
      () => resolve(null)
    );
  });
}

// ---------- House palette by gender ----------
function paletteFor(person) {
  if (person.gender === 'male') return { wall: 0xdcd3c4, roof: 0x3a5a78, door: 0x2f4d63, accent: 0x3498db };
  if (person.gender === 'female') return { wall: 0xe9d9d6, roof: 0x7a3b52, door: 0x6b2c42, accent: 0xe74c3c };
  return { wall: 0xd8d4cc, roof: 0x555b62, door: 0x43484d, accent: 0x8E44AD };
}

/* ============================================================
   HOUSE BUILDER — real structure: foundation, walls, windows,
   pitched roof, chimney, real door with hinge for opening.
   Interior: floor, rug, sofa, table, bed, lamp (all primitives).
   ============================================================ */
function buildHouse(person, opts = {}) {
  const scale = opts.scale ?? 1;
  const pal = paletteFor(person);
  const group = new THREE.Group();
  group.userData.person = person;

  const W = 4.2 * scale, D = 3.6 * scale, H = 2.6 * scale;

  // Foundation
  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.4, 0.2, D + 0.4),
    new THREE.MeshStandardMaterial({ color: 0x6b6459, roughness: 0.9 })
  );
  foundation.position.y = 0.1;
  foundation.receiveShadow = true;
  group.add(foundation);

  // Walls
  const wallMat = new THREE.MeshStandardMaterial({ color: pal.wall, roughness: 0.85, metalness: 0.02 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
  walls.position.y = 0.2 + H / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  // Roof (pyramidal hip roof)
  const roofMat = new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.6, metalness: 0.05 });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(W, D) * 0.78, 1.3 * scale, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.2 + H + 0.62 * scale;
  roof.castShadow = true;
  group.add(roof);

  // Chimney
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.3 * scale, 0.9 * scale, 0.3 * scale),
    new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: 0.9 })
  );
  chimney.position.set(W * 0.28, 0.2 + H + 0.75 * scale, D * 0.15);
  chimney.castShadow = true;
  group.add(chimney);

  // Windows (front)
  const winMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, roughness: 0.15, metalness: 0.3, emissive: 0x142033, emissiveIntensity: 0.6 });
  [-1, 1].forEach((side) => {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.6 * scale, 0.7 * scale, 0.06), winMat);
    win.position.set(side * W * 0.28, 0.2 + H * 0.58, D / 2 + 0.03);
    group.add(win);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.68 * scale, 0.78 * scale, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.8 })
    );
    frame.position.copy(win.position);
    frame.position.z -= 0.02;
    group.add(frame);
  });

  // Door + hinge pivot (this is what opens on click)
  const doorW = 0.85 * scale, doorH = 1.9 * scale;
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-doorW / 2, 0.2, D / 2);
  const doorMat = new THREE.MeshStandardMaterial({ color: pal.door, roughness: 0.55, metalness: 0.1 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.08), doorMat);
  door.position.set(doorW / 2, doorH / 2, 0);
  door.castShadow = true;
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(0.045 * scale, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.3, metalness: 0.8 })
  );
  handle.position.set(doorW - 0.1, doorH / 2, 0.06);
  door.add(handle);
  doorPivot.add(door);
  group.add(doorPivot);
  group.userData.doorPivot = doorPivot;
  group.userData.doorHitbox = door;

  // Door frame
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a231c, roughness: 0.8 });
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.12, doorH + 0.1, 0.12), frameMat);
  doorFrame.position.set(0, (doorH + 0.1) / 2 + 0.2, D / 2 + 0.02);
  group.add(doorFrame);

  // Name plate above door
  const label = makeLabelSprite(person.name || 'Sans nom');
  label.position.set(0, 0.2 + H + 0.05, D / 2 + 0.5);
  group.add(label);

  // Small path to door
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9 * scale, 1.6 * scale),
    new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1 })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.11, D / 2 + 1.2 * scale);
  path.receiveShadow = true;
  group.add(path);

  return group;
}

/* Interior room — built lazily, positioned "inside" the same house group
   so the camera can dolly through the doorway into it. */
function buildInterior(person, scale = 1) {
  const pal = paletteFor(person);
  const room = new THREE.Group();
  const W = 4.2 * scale, D = 3.6 * scale, H = 2.6 * scale;

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, D - 0.2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.21;
  floor.receiveShadow = true;
  room.add(floor);

  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(0.9 * scale, 32),
    new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 1 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.215, 0.2);
  room.add(rug);

  // Interior walls (inverted normals feel via double-sided ceiling)
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf2ede4, roughness: 0.95, side: THREE.DoubleSide });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.15, D - 0.15), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 0.2 + H - 0.05;
  room.add(ceiling);

  // Sofa
  const sofaMat = new THREE.MeshStandardMaterial({ color: 0x5a4a6b, roughness: 0.8 });
  const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(1.4 * scale, 0.4 * scale, 0.6 * scale), sofaMat);
  sofaBase.position.set(-1.1 * scale, 0.4 * scale, -0.9 * scale);
  sofaBase.castShadow = true;
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(1.4 * scale, 0.5 * scale, 0.15 * scale), sofaMat);
  sofaBack.position.set(-1.1 * scale, 0.65 * scale, -1.15 * scale);
  room.add(sofaBase, sofaBack);

  // Coffee table
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32 * scale, 0.32 * scale, 0.32 * scale, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.5, metalness: 0.1 })
  );
  table.position.set(-0.4 * scale, 0.36 * scale, -0.3 * scale);
  table.castShadow = true;
  room.add(table);

  // Bed (small alcove)
  const bedMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e6, roughness: 0.9 });
  const bedBase = new THREE.Mesh(new THREE.BoxGeometry(1.0 * scale, 0.32 * scale, 1.6 * scale), new THREE.MeshStandardMaterial({ color: 0x6b4a35, roughness: 0.8 }));
  bedBase.position.set(1.2 * scale, 0.36 * scale, 0.3 * scale);
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(0.92 * scale, 0.18 * scale, 1.5 * scale), bedMat);
  mattress.position.set(1.2 * scale, 0.56 * scale, 0.3 * scale);
  bedBase.castShadow = true; mattress.castShadow = true;
  room.add(bedBase, mattress);

  // Lamp with actual point light
  const lampPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02 * scale, 0.02 * scale, 1.1 * scale, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
  );
  lampPole.position.set(1.6 * scale, 0.75 * scale, -1.2 * scale);
  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.22 * scale, 0.28 * scale, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf2d9a0, emissive: 0xf2d9a0, emissiveIntensity: 0.4, side: THREE.DoubleSide })
  );
  lampShade.position.set(1.6 * scale, 1.28 * scale, -1.2 * scale);
  const lampLight = new THREE.PointLight(0xffdca8, 0.9, 4 * scale, 2);
  lampLight.position.set(1.6 * scale, 1.2 * scale, -1.2 * scale);
  lampLight.castShadow = true;
  room.add(lampPole, lampShade, lampLight);

  // Portrait frame on back wall (uses real photo texture if available)
  const frameGeo = new THREE.PlaneGeometry(0.6 * scale, 0.75 * scale);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(0, 1.55 * scale, -D / 2 + 0.18);
  room.add(frame);
  loadPortraitTexture(person.photo).then((tex) => {
    if (!tex) return;
    const portraitMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(0.5 * scale, 0.65 * scale), portraitMat);
    portrait.position.copy(frame.position);
    portrait.position.z += 0.01;
    room.add(portrait);
  });

  room.position.z = -D * 0.15; // sit slightly toward the back of the shell
  return room;
}

/* ============================================================
   NAVIGATION STATE
   ============================================================ */
let family = null;             // root node from Firestore (nested tree, same shape as app.js)
let historyStack = [];         // {type:'single'|'circle', person, parent}
let current = null;            // current state object
let interactionsLocked = false;

function clearWorld() {
  while (worldGroup.children.length) {
    const obj = worldGroup.children.pop();
    disposeDeep(obj);
  }
}
function disposeDeep(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    }
  });
}

function updateBreadcrumb(path) {
  breadcrumbEl.textContent = path.map((p) => p.name).join(' → ');
  breadcrumbEl.style.display = path.length ? 'block' : 'none';
}

function pathFromHistory(person) {
  // rebuild readable path for breadcrumb using stack + current person
  const names = historyStack
    .filter((s) => s.type === 'single')
    .map((s) => s.person);
  return [...names, person];
}

/* ---------- STATE: single house (exterior) ---------- */
function showSingleHouse(person, { pushHistory = true, cameFromCircleOf = null } = {}) {
  if (pushHistory && current) historyStack.push(current);
  current = { type: 'single', person, cameFromCircleOf };

  fadeTransition(() => {
    clearWorld();
    personCard.classList.remove('show');
    controls.enabled = true;

    const house = buildHouse(person, { scale: 1 });
    worldGroup.add(house);

    controls.minDistance = 1.5;
    controls.maxDistance = 40;
    controls.target.set(0, 1.5, 0.5);
    camera.position.set(0, 1.7, 6.5);
    controls.update();

    hintEl.textContent = 'Cliquez la porte pour entrer chez ' + (person.name || '');
    hintEl.style.opacity = '1';
    updateBreadcrumb(pathFromHistory(person));
    backBtn.style.display = historyStack.length ? 'inline-block' : 'none';
  });
}

/* ---------- STATE: interior ---------- */
function enterHouse(person, houseGroup) {
  interactionsLocked = true;
  hintEl.style.opacity = '0';

  // Door swing animation
  const pivot = houseGroup.userData.doorPivot;
  animateValue(0, -Math.PI / 1.7, 700, (v) => { pivot.rotation.y = v; }, () => {
    // Dolly camera through doorway
    const interior = buildInterior(person, 1);
    worldGroup.add(interior);
    controls.enabled = false;
    animateCamera(
      new THREE.Vector3(0, 1.5, -0.6),
      new THREE.Vector3(0, 1.3, -2.2),
      1000,
      () => {
        interactionsLocked = false;
        showPersonCard(person);
      }
    );
  });
}

function showPersonCard(person) {
  pcName.textContent = person.name || 'Sans nom';
  const genderText = person.gender === 'male' ? 'Homme' : person.gender === 'female' ? 'Femme' : 'Genre non renseigné';
  const birthText = person.birth ? ' · né(e) le ' + person.birth : '';
  pcMeta.textContent = genderText + birthText;
  pcBio.textContent = person.bio || '';
  pcPhoto.src = person.photo ? 'photos/' + person.photo : 'ssi.jpg';
  pcPhoto.onerror = () => { pcPhoto.src = 'ssi.jpg'; };
  const childCount = (person.children && person.children.length) || 0;
  enterChildrenBtn.textContent = childCount ? `Voir les enfants (${childCount})` : 'Aucun enfant';
  enterChildrenBtn.disabled = childCount === 0;
  personCard.classList.add('show');
}

/* ---------- STATE: circle of children ---------- */
function showChildrenCircle(parent) {
  const children = parent.children || [];
  if (!children.length) return;

  historyStack.push(current);
  current = { type: 'circle', person: parent, children };

  fadeTransition(() => {
    clearWorld();
    personCard.classList.remove('show');
    controls.enabled = true;

    const n = children.length;
    const radius = Math.max(6, 3 + n * 1.6);
    const houseScale = n > 6 ? 0.75 : 1;

    children.forEach((child, i) => {
      const angle = (i / n) * Math.PI * 2;
      const house = buildHouse(child, { scale: houseScale });
      house.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      house.lookAt(0, 0, 0);
      house.rotateY(Math.PI); // face door toward center
      worldGroup.add(house);
    });

    // Central marker (parent's plaza)
    const centerLabel = makeLabelSprite('Enfants de ' + (parent.name || ''), { w: 640, h: 128, fontSize: 48 });
    centerLabel.position.set(0, 2.2, 0);
    worldGroup.add(centerLabel);

    controls.target.set(0, 1.2, 0);
    camera.position.set(0, 1.7, 0.01); // center point, user rotates to look around
    controls.minDistance = 0.1;
    controls.maxDistance = 0.1;
    controls.update();

    hintEl.textContent = 'Tournez autour de vous, puis cliquez une maison';
    hintEl.style.opacity = '1';
    updateBreadcrumb([...pathFromHistory(parent), { name: 'Enfants' }]);
    backBtn.style.display = 'inline-block';
  });
}

function flyToChildHouse(childPerson) {
  interactionsLocked = true;
  controls.minDistance = 1.5;
  controls.maxDistance = 40;
  hintEl.style.opacity = '0';

  // Rebuild as single-house scene directly (visually it's a fresh location,
  // navigation intent matters more than continuous flight physics here)
  fadeTransition(() => {
    showSingleHouse(childPerson, { pushHistory: false });
    // replace the circle entry in history with nothing extra; single state already set
    interactionsLocked = false;
  });
}

/* ---------- Back navigation ---------- */
function goBack() {
  if (!historyStack.length) return;
  const prev = historyStack.pop();
  if (prev.type === 'single') {
    current = null; // avoid double push
    showSingleHouse(prev.person, { pushHistory: false });
    current = prev;
    backBtn.style.display = historyStack.length ? 'inline-block' : 'none';
  } else if (prev.type === 'circle') {
    current = null;
    rebuildCircle(prev.person, prev.children);
  }
}
function rebuildCircle(parent, children) {
  current = { type: 'circle', person: parent, children };
  fadeTransition(() => {
    clearWorld();
    personCard.classList.remove('show');
    controls.enabled = true;
    const n = children.length;
    const radius = Math.max(6, 3 + n * 1.6);
    const houseScale = n > 6 ? 0.75 : 1;
    children.forEach((child, i) => {
      const angle = (i / n) * Math.PI * 2;
      const house = buildHouse(child, { scale: houseScale });
      house.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      house.lookAt(0, 0, 0);
      house.rotateY(Math.PI);
      worldGroup.add(house);
    });
    controls.target.set(0, 1.2, 0);
    camera.position.set(0, 1.7, 0.01);
    controls.minDistance = 0.1;
    controls.maxDistance = 0.1;
    controls.update();
    hintEl.textContent = 'Tournez autour de vous, puis cliquez une maison';
    hintEl.style.opacity = '1';
    updateBreadcrumb([...pathFromHistory(parent), { name: 'Enfants' }]);
    backBtn.style.display = 'inline-block';
  });
}

/* ============================================================
   INTERACTION — click/tap on doors or circle houses
   ============================================================ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener('click', (e) => {
  if (interactionsLocked) return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(worldGroup.children, true);
  if (!intersects.length) return;

  const hit = intersects[0].object;
  // Walk up to find a house group with userData.person
  let obj = hit;
  while (obj && !obj.userData.person) obj = obj.parent;
  if (!obj) return;

  const person = obj.userData.person;

  if (current.type === 'single' && person === current.person) {
    enterHouse(person, obj);
  } else if (current.type === 'circle') {
    flyToChildHouse(person);
  }
});

/* ============================================================
   UI buttons
   ============================================================ */
backBtn.addEventListener('click', () => { if (!interactionsLocked) goBack(); });
exitHouseBtn.addEventListener('click', () => {
  if (interactionsLocked || !current) return;
  showSingleHouse(current.person, { pushHistory: false });
});
enterChildrenBtn.addEventListener('click', () => {
  if (interactionsLocked || !current || enterChildrenBtn.disabled) return;
  showChildrenCircle(current.person);
});

/* ============================================================
   Small animation helpers (no external tween lib needed)
   ============================================================ */
function animateValue(from, to, duration, onUpdate, onDone) {
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    onUpdate(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else onDone && onDone();
  }
  requestAnimationFrame(step);
}
function animateCamera(toPos, toTarget, duration, onDone) {
  const fromPos = camera.position.clone();
  const fromTarget = controls.target.clone();
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(fromPos, toPos, eased);
    controls.target.lerpVectors(fromTarget, toTarget, eased);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
    else onDone && onDone();
  }
  requestAnimationFrame(step);
}
function fadeTransition(rebuildFn) {
  fadeEl.classList.add('active');
  setTimeout(() => {
    rebuildFn();
    setTimeout(() => fadeEl.classList.remove('active'), 60);
  }, 320);
}

/* ============================================================
   DATA LOADING — same document shape as app.js (famille/bollou_oumar)
   ============================================================ */
async function loadFamily() {
  const ref = doc(db, 'famille', 'bollou_oumar');
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Aucune donnée famille trouvée');
  const data = snap.data();
  if (!data.gender) data.gender = 'male';
  return data;
}

async function init() {
  try {
    family = await loadFamily();
    showSingleHouse(family, { pushHistory: false });
    backBtn.style.display = 'none';
  } catch (err) {
    console.error(err);
    loadingEl.innerHTML = '<div>Erreur de chargement des données familiales.</div>';
    return;
  }
  loadingEl.classList.add('hidden');
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

init();
