import { db } from './firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  buildLot,
  buildInterior,
  buildRoomShell,
  buildHallway
} from './house.js';

import { makeGrassGround, PERF } from './decor.js';

import {
  createWalkControls,
  attachJoystick
} from './WalkControls.js';

/* ============================================================
   GAWAY 3D v4
   ------------------------------------------------------------
   Déplacement première personne :

   PC :
   - WASD / flèches = marcher
   - souris = regarder autour
   - clic = ouvrir une porte

   MOBILE :
   - joystick = marcher
   - glissement du doigt = regarder
   - tap = ouvrir une porte

   Extérieur + intérieur :
   - même système de déplacement
   ============================================================ */


/* ============================================================
   DOM
   ============================================================ */

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


/* ============================================================
   THREE
   ============================================================ */

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  800
);

camera.position.set(0, 1.65, 9.5);


/* ============================================================
   RENDERER
   ============================================================ */

const renderer = new THREE.WebGLRenderer({
  antialias: !PERF.mobile,
  powerPreference: 'high-performance'
});

renderer.setPixelRatio(
  Math.min(window.devicePixelRatio, PERF.pixelRatioCap)
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

host.appendChild(renderer.domElement);


/* ============================================================
   ENVIRONMENT
   ============================================================ */

const pmrem = new THREE.PMREMGenerator(renderer);

scene.environment =
  pmrem.fromScene(new RoomEnvironment(), 0.04).texture;


/* ============================================================
   SKY
   ============================================================ */

const sky = new Sky();

sky.scale.setScalar(450);

scene.add(sky);

const sunPos = new THREE.Vector3();

function setSky(elevation = 32, azimuth = 145) {

  const u = sky.material.uniforms;

  u['turbidity'].value = 3.2;
  u['rayleigh'].value = 1.6;
  u['mieCoefficient'].value = 0.006;
  u['mieDirectionalG'].value = 0.8;

  const phi =
    THREE.MathUtils.degToRad(90 - elevation);

  const theta =
    THREE.MathUtils.degToRad(azimuth);

  sunPos.setFromSphericalCoords(
    1,
    phi,
    theta
  );

  u['sunPosition'].value.copy(sunPos);
}

setSky();

scene.fog = new THREE.Fog(
  0xbfd4e8,
  40,
  130
);


/* ============================================================
   WALK CONTROLS
   ============================================================ */

const walkControls = createWalkControls(
  camera,
  renderer.domElement,
  {
    eyeHeight: 1.65,
    speed: 2.6
  }
);


/* ============================================================
   RESIZE
   ============================================================ */

window.addEventListener('resize', () => {

  camera.aspect =
    window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );

});


/* ============================================================
   LIGHTING
   ============================================================ */

const hemi = new THREE.HemisphereLight(
  0xbfd4e8,
  0x4a3f30,
  0.55
);

scene.add(hemi);


const sun = new THREE.DirectionalLight(
  0xfff2e0,
  2.1
);

sun.position.set(
  sunPos.x * 60,
  sunPos.y * 60,
  sunPos.z * 60
);

sun.castShadow = true;

sun.shadow.mapSize.set(
  PERF.shadowMapSize,
  PERF.shadowMapSize
);

sun.shadow.camera.left = -26;
sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26;
sun.shadow.camera.bottom = -26;

sun.shadow.camera.far = 120;

sun.shadow.bias = -0.0012;

scene.add(sun);


/* ============================================================
   INTERIOR LIGHT
   ============================================================ */

const interiorFill = new THREE.PointLight(
  0xfff2d8,
  0,
  20,
  2
);

scene.add(interiorFill);


/* ============================================================
   WORLD
   ============================================================ */

const worldGroup = new THREE.Group();

scene.add(worldGroup);

let waterMeshes = [];


function clearWorld() {

  waterMeshes = [];

  while (worldGroup.children.length) {

    disposeDeep(
      worldGroup.children.pop()
    );

  }

}


function disposeDeep(obj) {

  obj.traverse((child) => {

    if (child.geometry) {
      child.geometry.dispose();
    }

    if (child.material) {

      const mats =
        Array.isArray(child.material)
          ? child.material
          : [child.material];

      mats.forEach((m) => {

        if (m.map) {
          m.map.dispose();
        }

        m.dispose();

      });

    }

  });

}


function collectWater(root) {

  root.traverse((c) => {

    if (
      c.userData &&
      c.userData.isWater
    ) {

      waterMeshes.push(c);

    }

  });

}


/* ============================================================
   NAVIGATION
   ============================================================ */

let family = null;

let historyStack = [];

let current = null;

let interactionsLocked = false;


/* ============================================================
   BREADCRUMB
   ============================================================ */

function chainPersons() {

  const chain =
    historyStack
      .filter(
        (s) => s.type === 'interior'
      )
      .map(
        (s) => s.person
      );

  if (
    current &&
    current.type === 'interior'
  ) {

    chain.push(current.person);

  }

  return chain;
}


function updateBreadcrumb() {

  const chain = chainPersons();

  breadcrumbEl.textContent =
    chain
      .map((p) => p.name)
      .join(' → ');

  breadcrumbEl.style.display =
    chain.length
      ? 'block'
      : 'none';

}


/* ============================================================
   EXTERIOR
   ============================================================ */

function showExterior(
  person,
  { pushHistory = true } = {}
) {

  if (
    pushHistory &&
    current
  ) {

    historyStack.push(current);

  }

  current = {
    type: 'exterior',
    person
  };


  fadeTransition(() => {

    clearWorld();

    personCard.classList.remove('show');

    interiorFill.intensity = 0;

    walkControls.setEnabled(true);


    const lot = buildLot(
      person,
      {
        scale: 1,
        decorLevel: 'high'
      }
    );

    worldGroup.add(lot);

    collectWater(lot);


    const ground =
      makeGrassGround(60);

    ground.position.y = -0.01;

    worldGroup.add(ground);


    /* Position du joueur */

    walkControls.setYawPitch(
      0,
      0
    );

    walkControls.setPosition(
      0.5,
      9.5
    );


    hintEl.textContent =
      'Regardez autour de vous et approchez-vous de la porte de ' +
      (person.name || '');

    hintEl.style.opacity = '1';


    updateBreadcrumb();


    backBtn.style.display =
      historyStack.length
        ? 'inline-block'
        : 'none';

  });

}


/* ============================================================
   INTERIOR
   ============================================================ */

function showInterior(
  person,
  { pushHistory = true } = {}
) {

  if (
    pushHistory &&
    current
  ) {

    historyStack.push(current);

  }

  current = {
    type: 'interior',
    person
  };


  fadeTransition(() => {

    clearWorld();

    personCard.classList.remove('show');

    walkControls.setEnabled(true);


    const children =
      person.children || [];

    const hasKids =
      children.length > 0;


    const shell =
      buildRoomShell(
        person,
        1,
        hasKids
      );

    worldGroup.add(shell.group);


    const furniture =
      buildInterior(
        person,
        1
      );

    worldGroup.add(furniture);


    let farClip =
      shell.D;


    if (hasKids) {

      const hallway =
        buildHallway(
          person,
          children,
          1,
          -shell.D / 2
        );

      worldGroup.add(
        hallway.group
      );

      farClip =
        shell.D +
        hallway.length;


      hallway.doors.forEach((d) => {

        d.hitbox.userData.roomDoor = true;

      });

    }


    /* Position du joueur */

    walkControls.setYawPitch(
      0,
      0
    );

    walkControls.setPosition(
      0,
      shell.D * 0.28
    );


    interiorFill.intensity = 0.35;

    interiorFill.position.set(
      0,
      2.2,
      -shell.D * 0.15
    );


    if (hasKids) {

      hintEl.textContent =
        `Regardez autour de vous — ${children.length} chambre(s) mène(nt) à la génération suivante`;

    } else {

      hintEl.textContent =
        'Aucun enfant enregistré ici — fin de cette branche de la famille';

    }


    hintEl.style.opacity = '1';


    showPersonCard(person);


    updateBreadcrumb();


    backBtn.style.display =
      'inline-block';

  });

}


/* ============================================================
   PERSON CARD
   ============================================================ */

function showPersonCard(person) {

  pcName.textContent =
    person.name || 'Sans nom';


  const genderText =
    person.gender === 'male'
      ? 'Homme'
      : person.gender === 'female'
        ? 'Femme'
        : 'Genre non renseigné';


  const birthText =
    person.birth
      ? ' · né(e) le ' + person.birth
      : '';


  pcMeta.textContent =
    genderText + birthText;


  pcBio.textContent =
    person.bio || '';


  pcPhoto.src =
    person.photo
      ? 'photos/' + person.photo
      : 'ssi.jpg';


  pcPhoto.onerror = () => {

    pcPhoto.src = 'ssi.jpg';

  };


  personCard.classList.add(
    'show'
  );

}


/* ============================================================
   ENTER ROOT HOUSE
   ============================================================ */

function enterRootHouse(
  person,
  lotGroup
) {

  interactionsLocked = true;

  hintEl.style.opacity = '0';


  const pivot =
    lotGroup.userData.doorPivot;


  if (!pivot) {

    interactionsLocked = false;

    showInterior(person);

    return;

  }


  animateValue(
    0,
    -Math.PI / 1.7,
    750,

    (v) => {

      pivot.rotation.y = v;

    },

    () => {

      animateCamera(
        camera.position.clone(),
        new THREE.Vector3(
          0,
          1.65,
          2
        ),
        450,

        () => {

          interactionsLocked = false;

          showInterior(person);

        }

      );

    }

  );

}


/* ============================================================
   ENTER CHILD ROOM
   ============================================================ */

function enterChildRoom(
  child,
  pivot
) {

  interactionsLocked = true;

  hintEl.style.opacity = '0';


  if (!pivot) {

    interactionsLocked = false;

    showInterior(child);

    return;

  }


  animateValue(
    0,
    -Math.PI / 1.6,
    650,

    (v) => {

      pivot.rotation.y = v;

    },

    () => {

      fadeTransition(() => {

        interactionsLocked = false;

        showInterior(child);

      });

    }

  );

}


/* ============================================================
   BACK
   ============================================================ */

function goBack() {

  if (!historyStack.length) {
    return;
  }


  const prev =
    historyStack.pop();


  if (
    prev.type === 'exterior'
  ) {

    current = null;

    showExterior(
      prev.person,
      {
        pushHistory: false
      }
    );

  } else {

    current = null;

    showInterior(
      prev.person,
      {
        pushHistory: false
      }
    );

  }


  backBtn.style.display =
    historyStack.length
      ? 'inline-block'
      : 'none';

}


/* ============================================================
   INTERACTION
   ============================================================ */

const raycaster =
  new THREE.Raycaster();

const pointer =
  new THREE.Vector2();

let downPos = null;


renderer.domElement.addEventListener(
  'pointerdown',
  (e) => {

    downPos = {
      x: e.clientX,
      y: e.clientY
    };

  }
);


renderer.domElement.addEventListener(
  'pointerup',
  (e) => {

    if (
      interactionsLocked ||
      !downPos
    ) {
      return;
    }


    const moved =
      Math.hypot(
        e.clientX - downPos.x,
        e.clientY - downPos.y
      );


    downPos = null;


    /* Si le doigt/souris a bougé,
       c'est un déplacement et pas un clic */

    if (moved > 6) {
      return;
    }


    pointer.x =
      (e.clientX /
        window.innerWidth) *
        2 - 1;

    pointer.y =
      -(e.clientY /
        window.innerHeight) *
        2 + 1;


    raycaster.setFromCamera(
      pointer,
      camera
    );


    const intersects =
      raycaster.intersectObjects(
        worldGroup.children,
        true
      );


    if (!intersects.length) {
      return;
    }


    let hit =
      intersects[0].object;


    /* Cherche l'objet qui contient
       les informations de porte/personne */

    let doorObject = null;

    let cursor = hit;


    while (cursor) {

      if (
        cursor.userData &&
        cursor.userData.roomDoor
      ) {

        doorObject = cursor;

        break;

      }


      if (
        cursor.userData &&
        cursor.userData.person
      ) {

        doorObject = cursor;

        break;

      }


      cursor =
        cursor.parent;

    }


    if (!doorObject) {
      return;
    }


    const person =
      doorObject.userData.person;


    if (!person) {
      return;
    }


    /* --------------------------------------------------------
       PORTE DE LA MAISON PRINCIPALE
       -------------------------------------------------------- */

    if (
      current &&
      current.type === 'exterior' &&
      person === current.person
    ) {

      let pivot =
        doorObject.userData.doorPivot;


      if (!pivot) {

        pivot =
          doorObject.parent;

      }


      enterRootHouse(
        person,
        {
          userData: {
            doorPivot: pivot
          }
        }
      );

      return;

    }


    /* --------------------------------------------------------
       PORTE D'UNE CHAMBRE
       -------------------------------------------------------- */

    if (
      current &&
      current.type === 'interior' &&
      doorObject.userData.roomDoor
    ) {

      let pivot =
        doorObject.parent;


      enterChildRoom(
        person,
        pivot
      );

    }

  }
);


/* ============================================================
   BUTTONS
   ============================================================ */

backBtn.addEventListener(
  'click',
  () => {

    if (!interactionsLocked) {
      goBack();
    }

  }
);


exitHouseBtn.addEventListener(
  'click',
  () => {

    if (!interactionsLocked) {
      goBack();
    }

  }
);


/* ============================================================
   JOYSTICK MOBILE
   ------------------------------------------------------------
   Ton HTML doit avoir :

   <div id="joystick">
      <div id="joystickKnob"></div>
   </div>

   Si ces éléments n'existent pas, le joystick est simplement
   ignoré.
   ============================================================ */

const joystickPad =
  document.getElementById(
    'joystick'
  );

const joystickKnob =
  document.getElementById(
    'joystickKnob'
  );


if (
  joystickPad &&
  joystickKnob
) {

  attachJoystick(
    joystickPad,
    joystickKnob,

    (x, y) => {

      walkControls.setJoystick(
        x,
        y
      );

    }
  );

}


/* ============================================================
   ANIMATION HELPERS
   ============================================================ */

function animateValue(
  from,
  to,
  duration,
  onUpdate,
  onDone
) {

  const start =
    performance.now();


  function step(now) {

    const t =
      Math.min(
        1,
        (now - start) /
          duration
      );


    const eased =
      1 -
      Math.pow(
        1 - t,
        3
      );


    onUpdate(
      from +
      (to - from) *
      eased
    );


    if (t < 1) {

      requestAnimationFrame(step);

    } else if (onDone) {

      onDone();

    }

  }


  requestAnimationFrame(step);

}


/* ============================================================
   CAMERA ANIMATION
   ------------------------------------------------------------
   Avec WalkControls il n'y a plus de controls.target.
   On anime donc uniquement la position.
   ============================================================ */

function animateCamera(
  toPos,
  toTarget,
  duration,
  onDone
) {

  const fromPos =
    camera.position.clone();


  const start =
    performance.now();


  function step(now) {

    const t =
      Math.min(
        1,
        (now - start) /
          duration
      );


    const eased =
      1 -
      Math.pow(
        1 - t,
        3
      );


    camera.position.lerpVectors(
      fromPos,
      toPos,
      eased
    );


    if (t < 1) {

      requestAnimationFrame(step);

    } else if (onDone) {

      onDone();

    }

  }


  requestAnimationFrame(step);

}


/* ============================================================
   FADE
   ============================================================ */

function fadeTransition(
  rebuildFn
) {

  fadeEl.classList.add(
    'active'
  );


  setTimeout(() => {

    rebuildFn();


    setTimeout(() => {

      fadeEl.classList.remove(
        'active'
      );

    }, 60);

  }, 320);

}


/* ============================================================
   FIRESTORE
   ============================================================ */

async function loadFamily() {

  const ref =
    doc(
      db,
      'famille',
      'bollou_oumar'
    );


  const snap =
    await getDoc(ref);


  if (!snap.exists()) {

    throw new Error(
      'Aucune donnée famille trouvée'
    );

  }


  const data =
    snap.data();


  if (!data.gender) {

    data.gender = 'male';

  }


  return data;

}


/* ============================================================
   INITIALISATION
   ============================================================ */

async function init() {

  try {

    family =
      await loadFamily();


    showExterior(
      family,
      {
        pushHistory: false
      }
    );


    backBtn.style.display =
      'none';

  } catch (err) {

    console.error(err);


    loadingEl.innerHTML =
      '<div>Erreur de chargement des données familiales.</div>';


    return;

  }


  loadingEl.classList.add(
    'hidden'
  );


  clock.start();

  animate();

}


/* ============================================================
   GAME LOOP
   ============================================================ */

const clock =
  new THREE.Clock();


function animate() {

  requestAnimationFrame(
    animate
  );


  const dt =
    Math.min(
      clock.getDelta(),
      0.05
    );


  /* Déplacement FPS */

  walkControls.update(
    dt
  );


  /* Eau */

  waterMeshes.forEach(
    (w) => {

      if (
        w.material &&
        w.material.map
      ) {

        w.material.map.offset.y =
          clock.elapsedTime *
          0.02;

      }

    }
  );


  renderer.render(
    scene,
    camera
  );

}


/* ============================================================
   START
   ============================================================ */

init();