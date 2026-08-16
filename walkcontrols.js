import * as THREE from 'three';

export function createWalkControls(camera, domElement, opts = {}) {
  const eyeHeight = opts.eyeHeight ?? 1.65;
  let yaw = opts.yaw ?? 0;
  let pitch = opts.pitch ?? 0;
  const pitchLimit = Math.PI / 2 - 0.08;
  const speed = opts.speed ?? 2.6;

  let boundsFn = opts.bounds || ((x, z) => ({ x, z }));
  let enabled = true;
  let onTap = null;

  camera.rotation.order = 'YXZ';
  function applyLook() { camera.rotation.set(pitch, yaw, 0); }

  function setYawPitch(y, p) { yaw = y; pitch = p; applyLook(); }
  function setBounds(fn) { boundsFn = fn; }
  function setPosition(x, z) {
    const c = boundsFn(x, z);
    camera.position.set(c.x, eyeHeight, c.z);
  }
  function setEnabled(v) { enabled = v; }
  function setOnTap(fn) { onTap = fn; }

  // ---------- Look (drag) ----------
  let dragging = false, lastX = 0, lastY = 0, downPos = null;
  function pointerDown(e) {
    if (!enabled) return;
    if (e.target !== domElement) return; // ignore touches starting on UI overlays (joystick etc.)
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    downPos = { x: e.clientX, y: e.clientY };
  }
  function pointerMove(e) {
    if (!enabled || !dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    yaw -= dx * 0.0034;
    pitch -= dy * 0.0034;
    pitch = Math.max(-pitchLimit, Math.min(pitchLimit, pitch));
    applyLook();
  }
  function pointerUp(e) {
    if (!enabled) return;
    dragging = false;
    if (downPos) {
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (moved < 6 && onTap) onTap(e.clientX, e.clientY);
    }
    downPos = null;
  }
  domElement.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);

  // ---------- Keyboard (desktop) ----------
  const keys = {};
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ---------- Joystick vector (mobile, set by external UI) ----------
  const joy = { x: 0, y: 0 };
  function setJoystick(x, y) { joy.x = x; joy.y = y; }

  // ---------- Per-frame update ----------
  function update(dt) {
    if (!enabled) return;
    let f = 0, r = 0;
    if (keys['KeyW'] || keys['ArrowUp']) f += 1;
    if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) r += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) r -= 1;
    f += -joy.y;
    r += joy.x;
    if (f === 0 && r === 0) return;
    const len = Math.hypot(f, r) || 1;
    f /= len; r /= len;

    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    const forward = { x: -sinY, z: -cosY };
    const right = { x: cosY, z: -sinY };

    const dx = (forward.x * f + right.x * r) * speed * dt;
    const dz = (forward.z * f + right.z * r) * speed * dt;

    const next = boundsFn(camera.position.x + dx, camera.position.z + dz);
    camera.position.x = next.x;
    camera.position.z = next.z;
    camera.position.y = eyeHeight;
  }

  function dispose() {
    domElement.removeEventListener('pointerdown', pointerDown);
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp);
  }

  return { update, setYawPitch, setBounds, setPosition, setEnabled, setOnTap, setJoystick, dispose, eyeHeight };
}

/* ============================================================
   Simple on-screen joystick UI — attaches to a DOM element
   (a circular pad) and reports a normalized -1..1 vector.
   ============================================================ */
export function attachJoystick(padEl, knobEl, onChange) {
  let active = false, originX = 0, originY = 0, pointerId = null;
  const maxR = 38;

  function start(e) {
    active = true;
    pointerId = e.pointerId;
    const rect = padEl.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    padEl.setPointerCapture(pointerId);
  }

  function move(e) {
    if (!active || e.pointerId !== pointerId) return;

    let dx = e.clientX - originX;
    let dy = e.clientY - originY;

    const dist = Math.hypot(dx, dy);

    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }

    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    onChange(dx / maxR, dy / maxR);
  }

  function end(e) {
    if (pointerId !== null && e.pointerId !== pointerId) return;

    active = false;
    pointerId = null;
    knobEl.style.transform = 'translate(0px, 0px)';
    onChange(0, 0);
  }

  padEl.addEventListener('pointerdown', start);
  padEl.addEventListener('pointermove', move);
  padEl.addEventListener('pointerup', end);
  padEl.addEventListener('pointercancel', end);
}