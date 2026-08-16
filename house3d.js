import { db } from './firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildLot, buildInterior } from './house.js';
import { makeGrassGround, makeTree, makeStreetLamp, makeCar, makePerson, setPersonPath, updatePerson, PERF } from './decor.js';
import { asphaltTexture, concreteTexture, marbleTexture } from './textures.js';

/* ============================================================
   GAWAY 3D v2 — quartier résidentiel de luxe explorable.
   Rendu "haut de gamme stylisé" via matériaux PBR procéduraux,
   verre réel (transmission + environment map), ciel réaliste,
   jardins, piscines, garages, personnages qui marchent, voitures
   qui circulent.
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

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 1.7, 8);

const renderer = new THREE.WebGLRenderer({ antialias: !PERF.mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERF.pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
host.appendChild(renderer.domElement);

// Real environment reflections for glass / marble / metal
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// Realistic sky + sun
const sky = new Sky();
sky.scale.setScalar(450);
scene.add(sky);
const sunPos = new THREE.Vector3();
function setSky(elevation = 32, azimuth = 145) {
  const uniforms = sky.material.uniforms;
  uniforms['turbidity'].value = 3.2;
  uniforms['rayleigh'].value = 1.6;
  uniforms['mieCoefficient'].value = 0.006;
  uniforms['mieDirectionalG'].value = 0.8;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunPos.setFromSphericalCoords(1, phi, theta);
  uniforms['sunPosition'].value.copy(sunPos);
}
setSky();
scene.fog = new THREE.Fog(0xbfd4e8, 40, 130);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.5;
controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(0, 1.4, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Lighting (sun matches sky) ----------
const hemi = new THREE.HemisphereLight(0xbfd4e8, 0x4a3f30, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2e0, 2.1);
sun.position.set(sunPos.x * 60, sunPos.y * 60, sunPos.z * 60);
sun.castShadow = true;
sun.shadow.mapSize.set(PERF.shadowMapSize, PERF.shadowMapSize);
sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26;
sun.shadow.camera.bottom = -26;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0012;
scene.add(sun);
scene.add(sun.target);

// ---------- World group ----------
const worldGroup = new THREE.Group();
scene.add(worldGroup);
let activeNpcs = [];
let activeCars = []; // {group, path (Vector3[]), t, speed}
let waterMeshes = [];

// ---------- Label sprite (names — real typography, no emoji) ----------
function makeLabelSprite(text, opts = {}) {
  const { fontSize = 60, color = '#f5f0ff', bg = 'rgba(18,14,26,0.6)', w = 512, h = 128 } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, w, h, 26); ctx.fill();
  ctx.fillStyle = color;
  ctx.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ============================================================
   Scene builders
   ============================================================ */
function clearWorld() {
  activeNpcs = [];
  activeCars = [];
  waterMeshes = [];
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

function collectWater(root) {
  root.traverse((c) => { if (c.userData && c.userData.isWater) waterMeshes.push(c); });
}

/* ---------- Single lot (the person you're currently "at") ---------- */
function buildSingleLotScene(person) {
  const lot = buildLot(person, { scale: 1, decorLevel: 'high' });
  worldGroup.add(lot);
  collectWater(lot);

  // Background neighbor silhouettes for atmosphere (cheap, non-interactive)
  const neighborCount = PERF.mobile ? 2 : 4;
  for (let i = 0; i < neighborCount; i++) {
    const fakePerson = { name: 'voisin' + i, gender: i % 2 === 0 ? 'male' : 'female' };
    const nb = buildLot(fakePerson, { scale: 0.85, skipFence: true, skipGarage: true, skipPool: true, skipTerrace: true, decorLevel: 'low' });
    const angle = (i / neighborCount) * Math.PI * 2 + 0.6;
    const r = 16;
    nb.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    nb.lookAt(0, 0, 0);
    nb.userData.person = null; // not clickable as a real house
    worldGroup.add(nb);
  }

  // Wide ground so the plaza doesn't feel like it floats in a void
  const ground = makeGrassGround(60);
  ground.position.y = -0.01;
  worldGroup.add(ground);

  // A couple of NPCs strolling the front yard
  const npcCount = Math.min(2, PERF.npcCount);
  for (let i = 0; i < npcCount; i++) {
    const npc = makePerson([0xe0b090, 0xc98b62, 0x8a5a3a][i % 3], [0x3a5a78, 0x8a3a3a, 0x2c6b4a][i % 3]);
    const pts = [
      new THREE.Vector3(-2 + i, 0, 3.5), new THREE.Vector3(2 - i, 0, 3.2), new THREE.Vector3(1, 0, 4.5),
    ];
    setPersonPath(npc, pts, 0.45 + i * 0.1);
    worldGroup.add(npc);
    activeNpcs.push(npc);
  }

  return lot;
}

/* ---------- Residential street with children's houses ---------- */
function buildStreetScene(parent, children) {
  const n = children.length;
  const spacing = 7.5;
  const radius = Math.max(9, (n / (Math.PI * 2)) * spacing + 5);

  const ground = makeGrassGround(radius + 20);
  worldGroup.add(ground);

  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTexture([1, Math.max(8, radius)]), roughness: 0.95 });
  const road = new THREE.Mesh(new THREE.RingGeometry(radius - 1.6, radius + 1.6, 64), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  road.receiveShadow = true;
  worldGroup.add(road);

  const sidewalkMat = new THREE.MeshStandardMaterial({ map: concreteTexture([2, Math.max(6, radius)]), roughness: 0.9 });
  [radius - 2.0, radius + 2.0].forEach((r) => {
    const sw = new THREE.Mesh(new THREE.RingGeometry(r - 0.35, r + 0.35, 64), sidewalkMat);
    sw.rotation.x = -Math.PI / 2;
    sw.position.y = 0.03;
    worldGroup.add(sw);
  });

  const centerLabel = makeLabelSprite('Enfants de ' + (parent.name || ''), { w: 680, h: 130, fontSize: 46 });
  centerLabel.position.set(0, 2.4, 0);
  worldGroup.add(centerLabel);
  const centerPad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshStandardMaterial({ map: marbleTexture([2, 2]), roughness: 0.3 }));
  centerPad.rotation.x = -Math.PI / 2;
  centerPad.position.y = 0.03;
  worldGroup.add(centerPad);

  const houseScale = n > 8 ? 0.65 : n > 4 ? 0.8 : 1;
  const placeR = radius + 4.2;
  children.forEach((child, i) => {
    const angle = (i / n) * Math.PI * 2;
    const lot = buildLot(child, { scale: houseScale, decorLevel: n > 6 ? 'low' : 'high', skipPool: n > 6, skipTerrace: n > 6 });
    lot.position.set(Math.cos(angle) * placeR, 0, Math.sin(angle) * placeR);
    lot.lookAt(0, 0, 0);
    lot.rotateY(Math.PI);
    worldGroup.add(lot);
    collectWater(lot);

    const lamp = makeStreetLamp(false);
    const curbR = radius - 2.0;
    lamp.position.set(Math.cos(angle) * curbR, 0, Math.sin(angle) * curbR);
    worldGroup.add(lamp);
  });

  const treeN = Math.min(16, Math.max(6, Math.round(n * 1.4)));
  for (let i = 0; i < treeN; i++) {
    const a = (i / treeN) * Math.PI * 2 + 0.3;
    const tree = makeTree(i * 11);
    tree.position.set(Math.cos(a) * (radius + 3.2), 0, Math.sin(a) * (radius + 3.2));
    worldGroup.add(tree);
  }

  if (!PERF.mobile || n <= 6) {
    const car = makeCar(0x8a1e1e);
    const pathPts = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pathPts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    worldGroup.add(car);
    activeCars.push({ group: car, path: pathPts, t: 0, speed: 0.03 });
  }

  const npcCount = Math.min(3, PERF.npcCount);
  for (let i = 0; i < npcCount; i++) {
    const npc = makePerson([0xd8a878, 0xc98b62, 0x8a5a3a][i % 3], [0x2c6b4a, 0x8a3a3a, 0x3a5a78][i % 3]);
    const a0 = (i / npcCount) * Math.PI * 2;
    const r = radius - 2.0;
    const pts = [
      new THREE.Vector3(Math.cos(a0) * r, 0, Math.sin(a0) * r),
      new THREE.Vector3(Math.cos(a0 + 0.6) * r, 0, Math.sin(a0 + 0.6) * r),
      new THREE.Vector3(Math.cos(a0 + 1.1) * r, 0, Math.sin(a0 + 1.1) * r),
    ];
    setPersonPath(npc, pts, 0.4);
    worldGroup.add(npc);
    activeNpcs.push(npc);
  }
}

/* ============================================================
   NAVIGATION STATE
   ============================================================ */
let family = null;
let historyStack = [];
let current = null;
let interactionsLocked = false;

function updateBreadcrumb(path) {
  breadcrumbEl.textContent = path.map((p) => p.name).join(' → ');
  breadcrumbEl.style.display = path.length ? 'block' : 'none';
}
function pathFromHistory(person) {
  const names = historyStack.filter((s) => s.type === 'single').map((s) => s.person);
  return [...names, person];
}

function showSingleHouse(person, { pushHistory = true } = {}) {
  if (pushHistory && current) historyStack.push(current);
  current = { type: 'single', person };

  fadeTransition(() => {
    clearWorld();
    personCard.classList.remove('show');
    controls.enabled = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 45;

    buildSingleLotScene(person);

    controls.target.set(0, 1.6, 1.5);
    camera.position.set(0.5, 2.0, 9.5);
    controls.update();

    hintEl.textContent = 'Cliquez la porte pour entrer chez ' + (person.name || '');
    hintEl.style.opacity = '1';
    updateBreadcrumb(pathFromHistory(person));
    backBtn.style.display = historyStack.length ? 'inline-block' : 'none';
  });
}

function enterHouse(person, houseGroup) {
  interactionsLocked = true;
  hintEl.style.opacity = '0';
  const pivot = houseGroup.userData.doorPivot;
  animateValue(0, -Math.PI / 1.7, 750, (v) => { pivot.rotation.y = v; }, () => {
    const interior = buildInterior(person, 1);
    worldGroup.add(interior);
    controls.enabled = false;
    animateCamera(
      new THREE.Vector3(0, 1.5, -0.4),
      new THREE.Vector3(0, 1.3, -2.4),
      1000,
      () => { interactionsLocked = false; showPersonCard(person); }
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

function showChildrenCircle(parent) {
  const children = parent.children || [];
  if (!children.length) return;
  historyStack.push(current);
  current = { type: 'circle', person: parent, children };

  fadeTransition(() => {
    clearWorld();
    personCard.classList.remove('show');
    controls.enabled = true;
    controls.minDistance = 2;
    controls.maxDistance = 60;

    buildStreetScene(parent, children);

    controls.target.set(0, 1.4, 0);
    camera.position.set(0, 5.5, 14);
    controls.update();

    hintEl.textContent = 'Faites glisser pour regarder autour, cliquez une maison';
    hintEl.style.opacity = '1';
    updateBreadcrumb([...pathFromHistory(parent), { name: 'Enfants' }]);
    backBtn.style.display = 'inline-block';
  });
}

function flyToChildHouse(childPerson) {
  interactionsLocked = true;
  hintEl.style.opacity = '0';
  fadeTransition(() => {
    showSingleHouse(childPerson, { pushHistory: false });
    interactionsLocked = false;
  });
}

function goBack() {
  if (!historyStack.length) return;
  const prev = historyStack.pop();
  if (prev.type === 'single') {
    current = null;
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
    controls.minDistance = 2;
    controls.maxDistance = 60;
    buildStreetScene(parent, children);
    controls.target.set(0, 1.4, 0);
    camera.position.set(0, 5.5, 14);
    controls.update();
    hintEl.textContent = 'Faites glisser pour regarder autour, cliquez une maison';
    hintEl.style.opacity = '1';
    updateBreadcrumb([...pathFromHistory(parent), { name: 'Enfants' }]);
    backBtn.style.display = 'inline-block';
  });
}

/* ============================================================
   INTERACTION — click on desktop, tap (not drag) on mobile
   ============================================================ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;

renderer.domElement.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (interactionsLocked || !downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 6) return; // was a drag/orbit, not a tap

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(worldGroup.children, true);
  if (!intersects.length) return;

  let obj = intersects[0].object;
  while (obj && !(obj.userData && obj.userData.person)) obj = obj.parent;
  if (!obj || !obj.userData.person) return;
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
   Animation helpers
   ============================================================ */
function animateValue(from, to, duration, onUpdate, onDone) {
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    onUpdate(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step); else onDone && onDone();
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
    if (t < 1) requestAnimationFrame(step); else onDone && onDone();
  }
  requestAnimationFrame(step);
}
function fadeTransition(rebuildFn) {
  fadeEl.classList.add('active');
  setTimeout(() => { rebuildFn(); setTimeout(() => fadeEl.classList.remove('active'), 60); }, 320);
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
  clock.start();
  animate();
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  controls.update();
  activeNpcs.forEach((npc) => updatePerson(npc, dt));
  activeCars.forEach((c) => {
    c.t += c.speed * dt;
    const path = c.path;
    const idx = Math.floor(c.t) % path.length;
    const nextIdx = (idx + 1) % path.length;
    const localT = c.t % 1;
    const p0 = path[idx], p1 = path[nextIdx];
    c.group.position.lerpVectors(p0, p1, localT);
    const dir = new THREE.Vector3().subVectors(p1, p0).normalize();
    c.group.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
  });
  waterMeshes.forEach((w) => { if (w.material.map) w.material.map.offset.y = clock.elapsedTime * 0.02; });
  renderer.render(scene, camera);
}

init();
