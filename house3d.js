import { db } from './firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildLot, buildInterior, buildRoomShell, buildHallway } from './house.js';
import { makeGrassGround, PERF } from './decor.js';
import { createWalkControls, attachJoystick } from './WalkControls.js';

/* ============================================================
   GAWAY 3D v3
   - Caméra libre (rotation + zoom + glisser) à l'intérieur,
     exactement comme à l'extérieur.
   - Chaque enfant devient une vraie porte de chambre dans le
     couloir de la maison de son parent. Ouvrir cette porte fait
     entrer dans la maison de cet enfant — qui a son propre
     couloir avec ses propres enfants en portes, et ainsi de
     suite indéfiniment, tant que les données Firestore continuent.
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

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const sky = new Sky();
sky.scale.setScalar(450);
scene.add(sky);
const sunPos = new THREE.Vector3();
function setSky(elevation = 32, azimuth = 145) {
  const u = sky.material.uniforms;
  u['turbidity'].value = 3.2; u['rayleigh'].value = 1.6;
  u['mieCoefficient'].value = 0.006; u['mieDirectionalG'].value = 0.8;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunPos.setFromSphericalCoords(1, phi, theta);
  u['sunPosition'].value.copy(sunPos);
}
setSky();
scene.fog = new THREE.Fog(0xbfd4e8, 40, 130);

// ---------- Controls: SAME free look (rotate + zoom + pan) both indoors and outdoors ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 0.9;
controls.minDistance = 1.2;
controls.maxDistance = 45;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.target.set(0, 1.4, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Lighting ----------
const hemi = new THREE.HemisphereLight(0xbfd4e8, 0x4a3f30, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2e0, 2.1);
sun.position.set(sunPos.x * 60, sunPos.y * 60, sunPos.z * 60);
sun.castShadow = true;
sun.shadow.mapSize.set(PERF.shadowMapSize, PERF.shadowMapSize);
sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
sun.shadow.camera.far = 120; sun.shadow.bias = -0.0012;
scene.add(sun, sun.target);

// Warm interior ambient fill so rooms aren't pitch black away from lamps
const interiorFill = new THREE.PointLight(0xfff2d8, 0, 20, 2);
scene.add(interiorFill);

// ---------- World group ----------
const worldGroup = new THREE.Group();
scene.add(worldGroup);
let waterMeshes = [];

function clearWorld() {
  waterMeshes = [];
  while (worldGroup.children.length) disposeDeep(worldGroup.children.pop());
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

/* ============================================================
   NAVIGATION STATE
   'exterior' — only ever the very first (root) ancestor's house,
                approached from the street.
   'interior' — inside ANY person's house; if they have children,
                a hallway of doors leads to each of them, and each
                of those doors opens into that child's own
                'interior' scene, recursively, without limit.
   ============================================================ */
let family = null;
let historyStack = [];
let current = null;
let interactionsLocked = false;

function chainPersons() {
  const chain = historyStack.filter((s) => s.type === 'interior').map((s) => s.person);
  if (current && current.type === 'interior') chain.push(current.person);
  return chain;
}
function updateBreadcrumb() {
  const chain = chainPersons();
  breadcrumbEl.textContent = chain.map((p) => p.name).join(' → ');
  breadcrumbEl.style.display = chain.length ? 'block' : 'none';
}

/* ---------- Exterior (root only) ---------- */
function showExterior(person, { pushHistory = true } = {}) {
  if (pushHistory && current) historyStack.push(current);
  current = { type: 'exterior', person };

  fadeTransition(() => {
    clearWorld();
    personCard.classList.remove('show');
    interiorFill.intensity = 0;
    controls.enabled = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 45;

    const lot = buildLot(person, { scale: 1, decorLevel: 'high' });
    worldGroup.add(lot);
    collectWater(lot);
    const ground = makeGrassGround(60);
    ground.position.y = -0.01;
    worldGroup.add(ground);

    controls.target.set(0, 1.6, 1.5);
    camera.position.set(0.5, 2.0, 9.5);
    controls.update();

    hintEl.textContent = 'Cliquez la porte pour entrer chez ' + (person.name || '');
    hintEl.style.opacity = '1';
    updateBreadcrumb();
    backBtn.style.display = historyStack.length ? 'inline-block' : 'none';
  });
}

/* ---------- Interior (any generation, recursive) ---------- */
function showInterior(person, { pushHistory = true } = {}) {
  if (pushHistory && current) historyStack.push(current);
  current = { type: 'interior', person };

  fadeTransition(() => {
    clearWorld();
    personCard.classList.remove('show');
    controls.enabled = true;
    controls.enablePan = true;

    const children = person.children || [];
    const hasKids = children.length > 0;

    const shell = buildRoomShell(person, 1, hasKids);
    worldGroup.add(shell.group);
    const furniture = buildInterior(person, 1);
    worldGroup.add(furniture);

    let farClip = shell.D;
    if (hasKids) {
      const hallway = buildHallway(person, children, 1, -shell.D / 2);
      worldGroup.add(hallway.group);
      farClip = shell.D + hallway.length;
      hallway.doors.forEach((d) => { d.hitbox.userData.roomDoor = true; });
    }

    controls.minDistance = 0.5;
    controls.maxDistance = Math.max(10, farClip + 4);
    controls.target.set(0, 1.4, -shell.D * 0.15);
    camera.position.set(0, 1.55, shell.D * 0.28);
    controls.update();

    interiorFill.intensity = 0.35;
    interiorFill.position.set(0, 2.2, -shell.D * 0.15);

    if (hasKids) {
      hintEl.textContent = `Regardez autour de vous — ${children.length} chambre(s) mène(nt) à la génération suivante`;
    } else {
      hintEl.textContent = 'Aucun enfant enregistré ici — fin de cette branche de la famille';
    }
    hintEl.style.opacity = '1';

    showPersonCard(person);
    updateBreadcrumb();
    backBtn.style.display = 'inline-block';
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
  personCard.classList.add('show');
}

/* ---------- Entering a house (root, from outside) ---------- */
function enterRootHouse(person, lotGroup) {
  interactionsLocked = true;
  hintEl.style.opacity = '0';
  const pivot = lotGroup.userData.doorPivot;
  animateValue(0, -Math.PI / 1.7, 750, (v) => { pivot.rotation.y = v; }, () => {
    animateCamera(
      camera.position.clone().lerp(new THREE.Vector3(0, 1.6, 2), 0.6),
      new THREE.Vector3(0, 1.4, 0),
      450,
      () => {
        fadeTransition(() => { interactionsLocked = false; showInterior(person); });
      }
    );
  });
}

/* ---------- Opening a bedroom door (recursive descent) ---------- */
function enterChildRoom(child, pivot) {
  interactionsLocked = true;
  hintEl.style.opacity = '0';
  animateValue(0, -Math.PI / 1.6, 650, (v) => { pivot.rotation.y = v; }, () => {
    fadeTransition(() => { interactionsLocked = false; showInterior(child); });
  });
}

/* ---------- Back navigation ---------- */
function goBack() {
  if (!historyStack.length) return;
  const prev = historyStack.pop();
  if (prev.type === 'exterior') {
    current = null;
    showExterior(prev.person, { pushHistory: false });
    backBtn.style.display = historyStack.length ? 'inline-block' : 'none';
  } else {
    current = null;
    showInterior(prev.person, { pushHistory: false });
    backBtn.style.display = historyStack.length ? 'inline-block' : 'none';
  }
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

  if (current.type === 'exterior' && person === current.person) {
    enterRootHouse(person, obj);
  } else if (current.type === 'interior' && obj.userData.roomDoor) {
    enterChildRoom(person, obj.parent); // obj.parent is the hinge pivot
  }
});

/* ============================================================
   UI buttons
   ============================================================ */
backBtn.addEventListener('click', () => { if (!interactionsLocked) goBack(); });
exitHouseBtn.addEventListener('click', () => { if (!interactionsLocked) goBack(); });

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
    showExterior(family, { pushHistory: false });
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
  controls.update();
  waterMeshes.forEach((w) => { if (w.material.map) w.material.map.offset.y = clock.elapsedTime * 0.02; });
  renderer.render(scene, camera);
}

init();
