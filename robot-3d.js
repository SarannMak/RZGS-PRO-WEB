/* ==========================================================================
   RZGS-PRO: the robot, as a real 3D model that looks at the pointer.

   The model is built here in code (three.js, loaded from a CDN): black armour,
   cyan and lime lights, headphones, a black visor with two glowing eyes, RZ on
   the chest, a glass tablet with a chart in its hands. The head turns to the
   pointer, the body turns a little with it, and the robot stays where it
   stands. Now and then it blinks.

   Behind it stands its trading desk: one wide monitor and an upright one on
   each side, showing what the bot does (the gold chart with its trades, the
   grid of orders, the log). They reach out past the robot's box on both sides.

   With no mouse on the page (and on a phone, a few seconds after a touch) the
   head looks around slowly by itself. With "reduce motion" the robot stands
   still.

   The other card beside the robot holds a small graph (svg[data-spark]): it
   runs like a live price, slowly for a while, then fast, then slowly again.

   A click on its head: it nods, and the card beside it ([data-robot-says])
   types one line about RZGS-PRO, letter by letter. The lines are written in
   the page, inside that card. One click, one line: while a line is being
   typed, further clicks are not taken.

   Used on every element with data-robot-3d (the box .robot-3d of style.css):
   the model is drawn on a canvas inside that box and fades in when it is
   ready. The box keeps the robot's place until then. Without WebGL, or when
   the library cannot be loaded, the logo holds that place (.robot-failed in style.css).
   ========================================================================== */

// This is a plain script, not a module: a page opened straight from a folder (file://) may not
// load module scripts. Everything is inside one function, so the names in here do not meet the
// names of the page's other scripts.
(() => {
'use strict';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

const boxes = [...document.querySelectorAll('[data-robot-3d]')];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
// The cards that float beside the robot wait for the intro (the stylesheet hides them until they
// get "is-in"). Where there will be no 3D scene, they are let in at once.
const cardsBeside = (box) => (box.parentElement ? [...box.parentElement.querySelectorAll('.float-card')] : []);
const letCardsIn = (box) => cardsBeside(box).forEach((card) => card.classList.add('is-in'));
const noRobot = (box) => { box.classList.add('robot-failed'); letCardsIn(box); };
if (boxes.length) {
  (async () => {
    try {
      const THREE = await import(THREE_URL);
      for (const box of boxes) {
        try {
          build(THREE, box);
        } catch (error) {
          noRobot(box);
          console.warn('robot-3d: the robot could not be drawn', error);
        }
      }
    } catch (error) {
      boxes.forEach((box) => noRobot(box));
      console.warn('robot-3d: the 3D library did not load', error);
    }
  })();
}

/* ---------------------------------------------------------------- the small graph in the XAUUSD card */
// The line runs from right to left like a live price, the newest price at its right end. It goes
// slowly for a spell, then fast, then slowly again; how long a spell lasts, how fast it is and
// how far the price jumps are left to chance. It needs nothing of the 3D scene. With "reduce
// motion" the graph stays as the page drew it.
for (const svg of document.querySelectorAll('svg[data-spark]')) liveGraph(svg);

function liveGraph(svg) {
  const line = svg.querySelector('[data-spark-line]'), area = svg.querySelector('[data-spark-area]'), dot = svg.querySelector('[data-spark-dot]');
  if (!line || !area || !dot || still) return;
  // The drawing is 120 wide and 32 high. The line ends a little before the right edge, where the
  // dot has room. STEPS: how many steps of the price fit across.
  const WIDE = 117, TALL = 32, TOP = 5, LOW = 27, STEPS = 14;
  const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
  const mix = (a, b, x) => a + (b - a) * x;
  // The price at every step: prices[i] is the price at step `first + i` (0 = lowest, 1 = highest).
  // The first steps climb, like the still picture; after that the price walks by chance, and is
  // drawn back toward the middle so it never leaves the card.
  const prices = [];
  let first = 0, price = 0.24, fast = false;
  for (let i = 0; i <= STEPS + 1; i++) prices.push((price = clamp(0.24 + (i / STEPS) * 0.5 + (Math.random() - 0.5) * 0.1, 0.06, 0.94)));
  let lean = 0, walked = 0;
  function walk() {
    if (walked++ % 5 === 0) lean = (Math.random() - 0.5) * 0.12; // every five steps it leans a new way, so hills and valleys form
    price += (Math.random() - 0.5) * 2 * (fast ? 0.28 : 0.15) + lean + (0.5 - price) * 0.1;
    if (price > 0.94) price = 1.88 - price; // it bounces off the top and the bottom
    if (price < 0.06) price = 0.12 - price;
    price = clamp(price, 0.06, 0.94);
    return price;
  }
  const at = (step) => prices[step - first];
  // The picture is fitted to the prices on show, as a real chart is: the lowest of them sits near
  // the bottom, the highest near the top. The fit follows gently, so the line does not jump.
  let floor = 0.2, ceiling = 0.8;
  const high = (value) => mix(LOW, TOP, clamp((value - floor) / (ceiling - floor), -0.08, 1.08));

  // `now` is the step at the right end. `pace` is how many steps go by in a second; it eases
  // toward `aim`, which jumps between slow and fast every time a spell is over.
  let now = STEPS, pace = 0.7, aim = 0.7, spell = 1.4;
  function draw(dt) {
    spell -= dt;
    if (spell <= 0) {
      fast = !fast;
      spell = fast ? 0.7 + Math.random() * 1.3 : 1.4 + Math.random() * 2.2;
      aim = fast ? 4.5 + Math.random() * 3.5 : 0.4 + Math.random() * 0.6;
    }
    pace += (aim - pace) * (1 - Math.exp(-dt * 5));
    now += pace * dt;
    while (first + prices.length <= Math.floor(now) + 1) prices.push(walk());
    while (first < Math.floor(now - STEPS) - 1) {
      prices.shift();
      first++;
    }
    const left = now - STEPS, start = Math.floor(left), end = Math.floor(now);
    let lowest = 1, highest = 0;
    for (let step = start; step <= end + 1; step++) {
      lowest = Math.min(lowest, at(step));
      highest = Math.max(highest, at(step));
    }
    const room = Math.max(0, 0.3 - (highest - lowest)) / 2; // a flat stretch is not blown up to fill the card
    const follow = dt ? 1 - Math.exp(-dt * 3) : 1;
    floor += (lowest - room - floor) * follow;
    ceiling += (highest + room - ceiling) * follow;
    let path = '';
    for (let step = start; step <= end; step++) path += `${path ? ' L' : 'M'}${(((step - left) / STEPS) * WIDE).toFixed(1)} ${high(at(step)).toFixed(1)}`;
    const head = high(mix(at(end), at(end + 1), now - end)).toFixed(1);
    path += ` L${WIDE} ${head}`;
    line.setAttribute('d', path);
    area.setAttribute('d', `${path} L${WIDE} ${TALL} L${(((start - left) / STEPS) * WIDE).toFixed(1)} ${TALL} Z`);
    dot.setAttribute('d', `M${WIDE} ${head}h0.01`);
  }

  // It runs only while it can be seen.
  let running = false, onScreen = true, last = 0;
  function frame(time) {
    if (!running) return;
    requestAnimationFrame(frame);
    draw(Math.min(0.05, Math.max(0, (time - last) / 1000)));
    last = time;
  }
  function run() {
    const should = onScreen && !document.hidden;
    if (should === running) return;
    running = should;
    if (running) {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  }
  svg.classList.add('is-live');
  draw(0);
  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    run();
  }).observe(svg);
  document.addEventListener('visibilitychange', run);
  run();

  // For checks from the browser console and automated tests; not used by the page.
  (window.__spark = window.__spark || []).push({ step: (seconds) => draw(seconds), state: () => ({ now, pace, aim, fast, spell, path: line.getAttribute('d') }) });
}

// One pointer for all robots on the page. A mouse is looked at for as long as it is on the page,
// also while it rests; the place a finger touched only for a few seconds.
const pointer = { x: 0, y: 0, at: -1e9, mouse: false };
function seen(event) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.at = performance.now();
  pointer.mouse = event.pointerType === 'mouse';
}
addEventListener('pointermove', seen, { passive: true });
addEventListener('pointerdown', seen, { passive: true });
document.addEventListener('mouseleave', () => {
  pointer.at = -1e9; // the mouse left the page: look around again
  pointer.mouse = false;
});

function build(THREE, box) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    noRobot(box);
    return; // no WebGL
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const TAU = Math.PI * 2;
  const CYAN = 0x19d3ff, LIME = 0xa6ff1a;
  const mix = (a, b, x) => a + (b - a) * x;
  const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
  const scene = new THREE.Scene();

  /* ------------------------------------------------------------ light */
  // Glossy black armour shows what is around it. Around the robot: a soft white light above and
  // in front, a cyan wall to the left, a lime wall to the right. Never seen, only mirrored.
  {
    const room = new THREE.Scene();
    room.background = new THREE.Color(0x020608);
    const wall = (color, strength, w, h, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide }));
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      room.add(mesh);
    };
    wall(0xffffff, 3.2, 6, 3, 0, 7, 5);
    wall(0xdff6ff, 0.8, 8, 2.5, 0, 0.5, 9);
    wall(CYAN, 7, 2.5, 8, -8, 1, 1.5);
    wall(LIME, 6, 2.5, 8, 8, 0, 1.5);
    wall(CYAN, 3, 8, 2.5, 0, 4, -8);
    wall(0xffffff, 0.4, 10, 3, 0, -6, 4);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
  }
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-2.5, 4, 6);
  scene.add(key);
  const rimCyan = new THREE.PointLight(CYAN, 26, 0, 2);
  rimCyan.position.set(-2.6, 1.2, -1.2);
  scene.add(rimCyan);
  const rimLime = new THREE.PointLight(LIME, 20, 0, 2);
  rimLime.position.set(2.6, 0.4, -1.2);
  scene.add(rimLime);

  /* ------------------------------------------------------------ materials */
  const armour = new THREE.MeshPhysicalMaterial({ color: 0x0b1014, metalness: 0.9, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.22 });
  const plate = new THREE.MeshPhysicalMaterial({ color: 0x1b242a, metalness: 0.82, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.35 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x07090b, metalness: 0.25, roughness: 0.72 });
  const visorGlass = new THREE.MeshPhysicalMaterial({ color: 0x010203, metalness: 0.5, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.55 });
  const lit = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const haze = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const LIT = { cyan: lit(CYAN), lime: lit(LIME) };
  const HAZE = { cyan: haze(CYAN, 0.2), lime: haze(LIME, 0.17) };

  /* ------------------------------------------------------------ helpers */
  const add = (parent, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  // A lit line through points: a bright core and a soft haze around it.
  function glowLine(parent, points, radius, tone, closed = false) {
    const curve = new THREE.CatmullRomCurve3(points, closed);
    const steps = Math.max(12, points.length * 4);
    add(parent, new THREE.TubeGeometry(curve, steps, radius, 6, closed), LIT[tone]);
    add(parent, new THREE.TubeGeometry(curve, steps, radius * 2.7, 6, closed), HAZE[tone]);
  }
  // A lit ring that faces +z.
  function glowRing(parent, size, thick, tone, z = 0) {
    add(parent, new THREE.TorusGeometry(size, thick, 8, 40), LIT[tone], 0, 0, z);
    add(parent, new THREE.TorusGeometry(size, thick * 2.6, 6, 40), HAZE[tone], 0, 0, z);
  }
  // A sheet laid over a curved surface: at(u, v) gives the point for u across and v down, 0..1.
  function sheet(at, across, down) {
    const position = [], uv = [], index = [];
    for (let j = 0; j <= down; j++) for (let i = 0; i <= across; i++) {
      const p = at(i / across, j / down);
      position.push(p.x, p.y, p.z);
      uv.push(i / across, 1 - j / down);
    }
    for (let j = 0; j < down; j++) for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i, b = a + 1, c = a + across + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  }
  // A smooth curve through evenly spaced values, read at x = 0..1.
  function through(values, x) {
    const n = values.length - 1, f = clamp(x, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
    const p0 = values[Math.max(0, i - 1)], p1 = values[i], p2 = values[i + 1], p3 = values[Math.min(n, i + 2)];
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
  }
  // A round limb from one point to another.
  function limb(parent, from, to, radius, material) {
    const way = new THREE.Vector3().subVectors(to, from);
    const mesh = add(parent, new THREE.CapsuleGeometry(radius, way.length(), 8, 20), material);
    mesh.position.copy(from).addScaledVector(way, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), way.clone().normalize());
    return mesh;
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // A four-pointed star, the mark in the middle of every round emblem.
  const starShape = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const reach = i % 2 ? 0.3 : 1, angle = (i / 8) * TAU + Math.PI / 2;
    starShape[i ? 'lineTo' : 'moveTo'](Math.cos(angle) * reach, Math.sin(angle) * reach);
  }
  const starGeometry = new THREE.ShapeGeometry(starShape);
  // The round emblem of the headphones, shoulders, elbows and hips: a hub, a lime ring, a cyan ring, a star. It faces +z.
  function emblem(parent, size) {
    const group = new THREE.Group();
    parent.add(group);
    const hub = new THREE.CylinderGeometry(size * 1.28, size * 1.42, size * 0.5, 44);
    hub.rotateX(Math.PI / 2);
    add(group, hub, armour, 0, 0, -size * 0.25);
    add(group, new THREE.CircleGeometry(size * 0.86, 44), rubber, 0, 0, 0.004);
    glowRing(group, size, size * 0.15, 'lime', size * 0.02);
    glowRing(group, size * 0.58, size * 0.075, 'cyan', size * 0.02);
    const star = add(group, starGeometry, LIT.lime, 0, 0, 0.012);
    star.scale.setScalar(size * 0.3);
    return group;
  }
  // A soft round light that always faces the viewer.
  const haloTexture = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const fade = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    fade.addColorStop(0, 'rgba(255,255,255,1)');
    fade.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  })();
  function halo(parent, color, w, h, opacity, x, y, z) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sprite.scale.set(w, h, 1);
    sprite.position.set(x, y, z);
    parent.add(sprite);
    return sprite;
  }

  /* ------------------------------------------------------------ the robot */
  // The robot faces +z. `body` is at the line of the shoulders; the head turns on `neck`.
  const robot = new THREE.Group();
  scene.add(robot);
  const body = new THREE.Group();
  robot.add(body);
  const neck = new THREE.Group();
  neck.position.set(0, 0.2, 0);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.03);
  neck.add(head);

  /* ---- head ---- */
  // The helmet is an egg. A point on it: `yaw` around (0 = the face), `pitch` up or down.
  const SKULL = { x: 0.44, y: 0.56, z: 0.48 };
  const narrow = (up) => mix(1, 0.66, clamp((0.2 - up) / 1.2, 0, 1) ** 1.25); // `up` is -1 at the chin, 1 at the crown
  const onHead = (yaw, pitch, lift = 1) => {
    const up = Math.sin(pitch), wide = narrow(up) * Math.cos(pitch) * lift;
    return V(Math.sin(yaw) * wide * SKULL.x, up * SKULL.y * lift, Math.cos(yaw) * wide * SKULL.z);
  };
  {
    const egg = new THREE.SphereGeometry(1, 56, 44);
    const at = egg.attributes.position;
    for (let i = 0; i < at.count; i++) {
      const wide = narrow(at.getY(i));
      at.setXYZ(i, at.getX(i) * wide * SKULL.x, at.getY(i) * SKULL.y, at.getZ(i) * wide * SKULL.z);
    }
    egg.computeVertexNormals();
    add(head, egg, armour);
  }

  // The visor: a black glass face, wide at the eyes and narrow at the chin.
  const VISOR_TOP = 0.58, VISOR_CHIN = -1.12;
  const visorHalf = (v) => through([0.62, 0.9, 0.96, 0.9, 0.74, 0.3], v);
  const onVisor = (u, v, lift) => onHead((u * 2 - 1) * visorHalf(v), mix(VISOR_TOP, VISOR_CHIN, v), lift);
  add(head, sheet((u, v) => onVisor(u, v, 1.014), 40, 40), visorGlass);
  {
    // a thin cyan line all round the visor
    const rim = [];
    for (let i = 0; i <= 18; i++) rim.push(onVisor(0, i / 18, 1.02));
    for (let i = 1; i < 8; i++) rim.push(onVisor(i / 8, 1, 1.02));
    for (let i = 18; i >= 0; i--) rim.push(onVisor(1, i / 18, 1.02));
    for (let i = 7; i > 0; i--) rim.push(onVisor(i / 8, 0, 1.02));
    glowLine(head, rim, 0.0075, 'cyan', true);
  }
  // The chin guard under the visor, in lighter metal.
  add(head, sheet((u, v) => onHead((u * 2 - 1) * mix(0.5, 0.36, v), mix(-1.06, -1.34, v), mix(1.05, 1.03, v)), 16, 6), plate);

  // The eyes: two lit shapes with a hard slanted brow, on the glass.
  const eyes = [];
  for (const side of [-1, 1]) {
    // the outer corner is high, the corner at the nose is low; the lower edge is round
    const shape = new THREE.Shape();
    shape.moveTo(0.105 * side, 0.046);
    shape.lineTo(-0.092 * side, -0.006);
    shape.quadraticCurveTo(-0.086 * side, -0.07, 0.005 * side, -0.072);
    shape.quadraticCurveTo(0.098 * side, -0.066, 0.105 * side, 0.046);
    const eyeLight = lit(0xbff6ff);
    eyeLight.side = THREE.DoubleSide;
    const eye = add(head, new THREE.ShapeGeometry(shape, 20), eyeLight);
    const place = onHead(side * 0.38, -0.02, 1.03);
    eye.position.copy(place);
    // it lies flat on the glass: it faces straight out of the helmet at that point
    eye.quaternion.setFromUnitVectors(V(0, 0, 1), V(place.x / SKULL.x ** 2, place.y / SKULL.y ** 2, place.z / SKULL.z ** 2).normalize());
    halo(head, CYAN, 0.36, 0.22, 0.7, place.x * 1.04, place.y, place.z * 1.04);
    eyes.push(eye);
  }

  // Lime bands over the top of the helmet, and a cyan line on each cheek.
  for (const side of [-1, 1]) {
    const band = [];
    for (let i = 0; i <= 14; i++) {
      const angle = mix(0.74, 2.45, i / 14), x = side * 0.15, round = Math.sqrt(1 - (x / SKULL.x) ** 2);
      band.push(V(x, Math.sin(angle) * SKULL.y * round * 1.012, Math.cos(angle) * SKULL.z * round * 1.012));
    }
    glowLine(head, band, 0.02, 'lime');
  }

  // Headphones: a cup on each ear with the round emblem, and a band over the top.
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * (SKULL.x - 0.03), 0.0, -0.02);
    ear.rotation.y = side * (Math.PI / 2 - 0.3);
    head.add(ear);
    const cup = new THREE.CylinderGeometry(0.2, 0.235, 0.13, 44);
    cup.rotateX(Math.PI / 2);
    add(ear, cup, plate, 0, 0, 0.045);
    emblem(ear, 0.145).position.z = 0.19;
  }
  {
    const band = add(head, new THREE.TorusGeometry(0.535, 0.036, 14, 56, Math.PI), armour, 0, -0.02, -0.03);
    band.scale.y = 1.13;
    const line = [];
    for (let i = 2; i <= 26; i++) {
      const angle = (i / 28) * Math.PI;
      line.push(V(Math.cos(angle) * 0.575, Math.sin(angle) * 0.575 * 1.13 - 0.02, -0.03));
    }
    glowLine(head, line, 0.008, 'cyan');
  }

  // Where a click counts as "on the head": a plain ball round the helmet and its headphones. It is never drawn.
  const headShape = add(head, new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial());
  headShape.scale.set(0.66, 0.66, 0.56);
  headShape.visible = false;

  /* ---- neck ---- */
  add(neck, new THREE.CylinderGeometry(0.2, 0.25, 0.4, 28), rubber, 0, 0.0, 0);
  for (let i = 0; i < 3; i++) add(neck, new THREE.TorusGeometry(0.212 + i * 0.012, 0.016, 8, 32), plate, 0, 0.12 - i * 0.075, 0).rotation.x = Math.PI / 2;

  /* ---- torso ---- */
  // The torso is turned on a lathe (wide chest, narrow waist) and then made less deep.
  const DEEP = 0.62;
  const OUTLINE = [[0.37, -1.7], [0.36, -1.42], [0.31, -1.12], [0.34, -0.86], [0.49, -0.58], [0.62, -0.33], [0.66, -0.14], [0.6, 0.0], [0.43, 0.09], [0.29, 0.14], [0.2, 0.2]];
  const outline = new THREE.SplineCurve(OUTLINE.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(60);
  add(body, new THREE.LatheGeometry(outline, 72), armour).scale.z = DEEP;
  const girth = (y) => {
    for (let i = 1; i < outline.length; i++) if (outline[i].y >= y) {
      const a = outline[i - 1], b = outline[i];
      return mix(a.x, b.x, (y - a.y) / Math.max(1e-6, b.y - a.y));
    }
    return outline[outline.length - 1].x;
  };
  // A point on the torso: `around` is the angle from the middle of the chest.
  const onTorso = (around, y, lift = 1) => V(Math.sin(around) * girth(y) * lift, y, Math.cos(around) * girth(y) * DEEP * lift);
  const onTorsoLine = (way, lift = 1.03) => {
    const points = [];
    for (let i = 0; i <= 16; i++) points.push(onTorso(...way(i / 16), lift));
    return points;
  };

  // The chest plate, in lighter metal, with a V-shaped lower edge. A lime line runs along that edge.
  const chestEdge = (around) => -0.72 + Math.abs(around) * 0.66;
  add(body, sheet((u, v) => {
    const around = mix(-0.98, 0.98, u);
    return onTorso(around, mix(0.03, chestEdge(around), v), 1.022);
  }, 44, 16), plate);
  for (const side of [-1, 1]) {
    glowLine(body, onTorsoLine((s) => [side * mix(0.98, 0, s), chestEdge(mix(0.98, 0, s))], 1.036), 0.017, 'lime');
    // a cyan line from the collar out over each collar bone
    glowLine(body, onTorsoLine((s) => [side * mix(0.22, 0.92, s), mix(0.04, -0.03, s) - Math.sin(s * Math.PI) * 0.035], 1.04), 0.009, 'cyan');
    // cyan lines down the sides to the waist, and lime ones on the hips
    glowLine(body, onTorsoLine((s) => [side * mix(0.72, 0.5, s), mix(-0.6, -1.08, s)]), 0.011, 'cyan');
    glowLine(body, onTorsoLine((s) => [side * mix(0.3, 0.9, s), mix(-1.36, -1.5, s)]), 0.013, 'lime');
  }
  // The belly: three plates, each a shallow V, and a belt with a lime line.
  for (let i = 0; i < 3; i++) {
    const top = -0.8 - i * 0.115, reach = 0.5 - i * 0.07;
    add(body, sheet((u, v) => {
      const around = mix(-reach, reach, u);
      return onTorso(around, top - v * 0.085 - (1 - Math.abs(u * 2 - 1)) * 0.05, 1.02);
    }, 20, 4), plate);
  }
  add(body, sheet((u, v) => onTorso(mix(-1.5, 1.5, u), mix(-1.17, -1.27, v) - (1 - Math.abs(u * 2 - 1)) ** 3 * 0.06, 1.03), 40, 4), plate);
  glowLine(body, onTorsoLine((s) => [mix(-1.5, 1.5, s), -1.165 - (1 - Math.abs(s * 2 - 1)) ** 3 * 0.06], 1.045), 0.011, 'lime');
  // The collar ring round the base of the neck.
  add(body, new THREE.TorusGeometry(0.27, 0.055, 12, 40), plate, 0, 0.14, 0).rotation.x = Math.PI / 2;

  // RZ on the chest.
  let paintLogo = () => {};
  {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const fade = ctx.createLinearGradient(90, 0, 420, 0);
    fade.addColorStop(0, '#19d3ff');
    fade.addColorStop(1, '#a6ff1a');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    paintLogo = () => {
      ctx.clearRect(0, 0, 512, 256);
      ctx.font = 'italic 800 210px Oxanium, "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(25, 211, 255, 0.9)';
      ctx.shadowBlur = 26;
      ctx.fillStyle = fade;
      ctx.fillText('RZ', 250, 138);
      ctx.shadowBlur = 0;
      ctx.fillText('RZ', 250, 138);
      texture.needsUpdate = true;
    };
    paintLogo();
    add(body, sheet((u, v) => onTorso(mix(-0.3, 0.3, u), mix(-0.1, -0.37, v), 1.045), 16, 8), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  }

  /* ---- shoulders, arms, hands ---- */
  for (const side of [-1, 1]) {
    const pad = add(body, new THREE.SphereGeometry(0.3, 36, 28), armour, side * 0.78, -0.1, 0);
    pad.scale.set(1.05, 0.92, 0.98);
    const mark = emblem(body, 0.135);
    mark.position.set(side * (0.78 + Math.sin(0.5) * 0.27), -0.1, Math.cos(0.5) * 0.27);
    mark.rotation.y = side * 0.5;
    // a lime line over the top of the shoulder
    const over = [];
    for (let i = 0; i <= 10; i++) {
      const angle = mix(0.35, 2.2, i / 10);
      over.push(V(side * (0.78 - Math.cos(angle) * 0.322), -0.1 + Math.sin(angle) * 0.284, -0.07));
    }
    glowLine(body, over, 0.012, 'lime');
  }
  // The tablet: a sheet of glass with a chart. Its face is turned toward the robot's own face, so
  // the viewer sees it from behind, through the glass.
  const TABLET = V(0.5, -0.5, 0.9);
  const tablet = new THREE.Group();
  tablet.position.copy(TABLET);
  body.add(tablet);
  {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.translate(384, 0);
    ctx.scale(-1, 1); // drawn mirrored: seen from behind it reads the right way round
    const round = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    round(6, 6, 372, 500, 26);
    const glass = ctx.createLinearGradient(0, 0, 384, 512);
    glass.addColorStop(0, 'rgba(160, 240, 255, 0.34)');
    glass.addColorStop(1, 'rgba(25, 211, 255, 0.12)');
    ctx.fillStyle = glass;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 235, 255, 0.95)';
    ctx.lineWidth = 6;
    ctx.stroke();
    // candles climbing from the lower left to the upper right, and the volume under them
    const MOVES = [34, -16, 40, 26, -20, 46, 30, -14, 38, 44, 28], VOLUME = [14, 22, 18, 30, 24, 40, 34, 52, 44, 60, 70];
    let price = 395;
    MOVES.forEach((move, i) => {
      const open = price;
      price -= move;
      const x = 44 + i * 28;
      ctx.fillStyle = ctx.strokeStyle = price < open ? 'rgba(43, 243, 145, 0.95)' : 'rgba(255, 90, 106, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 8, Math.min(open, price) - 16);
      ctx.lineTo(x + 8, Math.max(open, price) + 16);
      ctx.stroke();
      ctx.fillRect(x, Math.min(open, price), 16, Math.max(8, Math.abs(open - price)));
      ctx.fillStyle = 'rgba(25, 211, 255, 0.55)';
      ctx.fillRect(x, 470 - VOLUME[i], 16, VOLUME[i]);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    add(tablet, new THREE.PlaneGeometry(0.66, 0.88), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    tablet.lookAt(TABLET.clone().add(V(-0.42, 0.3, -0.86)));
    tablet.updateMatrixWorld(true);
    halo(tablet, CYAN, 1.3, 1.5, 0.16, 0, 0, 0.02);
  }
  // A place on the tablet, in the body's own measure: x across (the viewer's right is negative),
  // y up, z toward the robot (the viewer's side is negative).
  const onTablet = (x, y, z) => tablet.localToWorld(V(x, y, z));

  // The upper arms hang down; the forearms come forward to the tablet. Left and right are as the
  // viewer sees them: the right hand holds the tablet by its lower corner, the left one points at the chart.
  const TOUCH = onTablet(0.13, -0.08, -0.03); // where the finger touches the glass
  const KNUCKLE = TOUCH.clone().add(V(-0.25, -0.06, 0.0));
  const ELBOW = { left: V(-0.97, -0.93, 0.12), right: V(0.99, -0.95, 0.1) };
  const WRIST = { left: KNUCKLE.clone().add(V(-0.17, -0.05, -0.1)), right: onTablet(-0.43, -0.44, 0.12) };
  for (const [name, side] of [['left', -1], ['right', 1]]) {
    const shoulder = V(side * 0.86, -0.22, 0.02);
    limb(body, shoulder, ELBOW[name], 0.185, armour);
    limb(body, ELBOW[name], WRIST[name], 0.14, armour);
    add(body, new THREE.SphereGeometry(0.19, 24, 18), rubber).position.copy(ELBOW[name]);
    const joint = emblem(body, 0.095);
    joint.position.copy(ELBOW[name]).add(V(side * 0.16, 0, 0.08));
    joint.rotation.y = side * 1.1;
    // a cyan line along the outside of the upper arm and along the top of the forearm
    const out = V(side * 0.15, 0, 0.115);
    glowLine(body, [shoulder.clone().lerp(ELBOW[name], 0.32).add(out), shoulder.clone().lerp(ELBOW[name], 0.8).add(out)], 0.012, 'cyan');
    const up = V(0, 0.14, 0.03);
    glowLine(body, [ELBOW[name].clone().lerp(WRIST[name], 0.3).add(up), ELBOW[name].clone().lerp(WRIST[name], 0.82).add(up)], 0.011, 'cyan');
    // a cuff at the wrist, with a thin lime line
    const cuff = add(body, new THREE.TorusGeometry(0.135, 0.03, 10, 32), plate);
    cuff.position.copy(ELBOW[name]).lerp(WRIST[name], 0.93);
    cuff.lookAt(WRIST[name]);
    const trim = add(body, new THREE.TorusGeometry(0.166, 0.008, 8, 32), LIT.lime);
    trim.position.copy(cuff.position);
    trim.quaternion.copy(cuff.quaternion);
  }

  // The hands. Each is a palm and four fingers; a finger is one or two short pieces with a lit knuckle.
  function finger(parent, from, to, tip = null) {
    limb(parent, from, to, 0.026, plate);
    add(parent, new THREE.SphereGeometry(0.018, 10, 8), LIT.lime).position.copy(from).add(V(0, 0, 0.02));
    if (tip) limb(parent, to, tip, 0.023, plate);
  }
  {
    // the hand on the viewer's left points at the chart: one finger out, three curled in
    const palm = add(body, new THREE.SphereGeometry(1, 20, 16), armour);
    palm.position.copy(WRIST.left).lerp(KNUCKLE, 0.6);
    palm.scale.set(0.11, 0.09, 0.1);
    finger(body, KNUCKLE, KNUCKLE.clone().lerp(TOUCH, 0.5), TOUCH);
    halo(body, LIME, 0.16, 0.16, 0.7, TOUCH.x, TOUCH.y, TOUCH.z + 0.03);
    for (let i = 0; i < 3; i++) {
      const from = KNUCKLE.clone().add(V(-0.015, -0.04 - i * 0.042, 0.02));
      finger(body, from, from.clone().add(V(0.07, -0.025, -0.045)));
    }
  }
  {
    // the hand on the viewer's right holds the tablet at its lower corner: the palm is behind the
    // glass, the fingers come round the edge onto the viewer's side
    const palm = add(body, new THREE.SphereGeometry(1, 20, 16), armour);
    palm.position.copy(onTablet(-0.37, -0.32, 0.07));
    palm.scale.set(0.1, 0.13, 0.08);
    for (let i = 0; i < 4; i++) {
      const y = -0.4 + i * 0.066;
      finger(body, onTablet(-0.345, y, -0.035), onTablet(-0.24, y + 0.01, -0.05), onTablet(-0.16, y + 0.012, -0.035));
    }
  }

  /* ---- hips and legs (they fade out at the bottom of the picture) ---- */
  for (const side of [-1, 1]) {
    const mark = emblem(body, 0.12);
    mark.position.set(side * 0.37, -1.52, 0.17);
    mark.rotation.y = side * 0.75;
    limb(body, V(side * 0.25, -1.62, 0), V(side * 0.34, -2.6, 0.04), 0.25, armour);
    glowLine(body, [V(side * 0.42, -1.85, 0.2), V(side * 0.5, -2.6, 0.2)], 0.014, 'cyan');
  }

  /* ------------------------------------------------------------ the monitors behind the robot */
  // A trading desk: one wide monitor behind the robot's head and an upright one on each side,
  // turned in toward the viewer. They show what the bot is doing. They stand still while the
  // robot turns. Every screen says little, in large letters: most of it is behind the robot.
  const desk = new THREE.Group();
  scene.add(desk);
  const INK = { cyan: '#19d3ff', lime: '#a6ff1a', mint: '#2bf391', red: '#ff5a6a', gold: '#ffd23f', text: '#f3fbff', muted: '#8fb4c2', dark: '#03151d' };
  const FONT = 'Oxanium, "Segoe UI", system-ui, sans-serif';
  // One monitor: a dark case, a lit screen with a cyan line round it. `draw` paints the screen.
  function monitor(w, h, across, draw) {
    const group = new THREE.Group();
    desk.add(group);
    const canvas = document.createElement('canvas');
    canvas.width = across;
    canvas.height = Math.round((across * h) / w);
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    add(group, new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.06), rubber, 0, 0, -0.036);
    const glass = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    add(group, new THREE.PlaneGeometry(w, h), glass);
    const x = w / 2 + 0.02, y = h / 2 + 0.02, corners = [V(-x, -y, 0.004), V(x, -y, 0.004), V(x, y, 0.004), V(-x, y, 0.004)];
    corners.forEach((corner, i) => glowLine(group, [corner, corners[(i + 1) % 4]], 0.006, 'cyan'));
    const screen = {
      group,
      glass,
      home: 0, // where it stands, left to right (the intro shakes it about this place)
      redraw() {
        // the screen's own light and its grid, then what it shows
        const light = ctx.createLinearGradient(0, 0, 0, canvas.height);
        light.addColorStop(0, '#08374a');
        light.addColorStop(1, INK.dark);
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = 'rgba(25, 211, 255, 0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let gx = 70; gx < canvas.width; gx += 70) {
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, canvas.height);
        }
        for (let gy = 70; gy < canvas.height; gy += 70) {
          ctx.moveTo(0, gy);
          ctx.lineTo(canvas.width, gy);
        }
        ctx.stroke();
        draw(ctx, canvas.width, canvas.height);
        texture.needsUpdate = true;
      },
    };
    return screen;
  }
  const words = (ctx, text, x, y, size, color, align = 'left') => {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  };

  // The gold price: a made-up walk. Every candle is one step of it; now and then the bot trades.
  const CANDLES = 30;
  const candles = [];
  let price = 0.5, steps = 0;
  function nextCandle() {
    const open = price;
    steps++;
    price = clamp(price + (Math.sin(steps * 0.9 + price * 7) * 0.5 + Math.random() - 0.45) * 0.1, 0.14, 0.86);
    return { open, close: price, high: Math.max(open, price) + Math.random() * 0.04, low: Math.min(open, price) - Math.random() * 0.04, trade: steps % 4 === 0 };
  }
  for (let i = 0; i < CANDLES; i++) candles.push(nextCandle());

  // The wide monitor: the gold chart. A rising candle is filled, a falling one is hollow (told
  // apart without colour too). Where the bot traded: a lime arrow up for a buy under the candle,
  // a gold arrow down for a sell over it. The bot opens both together.
  const chart = monitor(2.1, 1.3, 840, (ctx, w, h) => {
    const top = 104, bottom = h - 44, tall = bottom - top, step = (w - 60) / CANDLES;
    candles.forEach((candle, i) => {
      const x = 30 + i * step, up = candle.close >= candle.open, wide = step * 0.62;
      const high = bottom - candle.high * tall, low = bottom - candle.low * tall, from = bottom - Math.max(candle.open, candle.close) * tall, body = Math.max(7, Math.abs(candle.close - candle.open) * tall);
      ctx.strokeStyle = ctx.fillStyle = up ? INK.mint : INK.red;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + wide / 2, high);
      ctx.lineTo(x + wide / 2, low);
      ctx.stroke();
      if (up) ctx.fillRect(x, from, wide, body);
      else {
        ctx.fillStyle = INK.dark;
        ctx.fillRect(x, from, wide, body);
        ctx.strokeRect(x + 1.5, from + 1.5, wide - 3, body - 3);
      }
      if (!candle.trade) return;
      for (const [color, tip, base] of [[INK.lime, low + 12, low + 34], [INK.gold, high - 12, high - 34]]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + wide / 2, tip);
        ctx.lineTo(x + wide / 2 - 13, base);
        ctx.lineTo(x + wide / 2 + 13, base);
        ctx.closePath();
        ctx.fill();
      }
    });
    // the price now: a dashed line across the chart
    const now = bottom - price * tall;
    ctx.strokeStyle = INK.cyan;
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 9]);
    ctx.beginPath();
    ctx.moveTo(0, now);
    ctx.lineTo(w, now);
    ctx.stroke();
    ctx.setLineDash([]);
    words(ctx, 'XAUUSD', 28, 68, 54, INK.text);
    words(ctx, 'M5', 262, 66, 30, INK.muted);
  });
  const DESK = { y: 0.96, back: -1.25, turn: 0.6, reach: 1.66 }; // reach: how far the desk shows to each side of the robot's middle
  chart.group.position.set(0, DESK.y, DESK.back);
  add(desk, new THREE.BoxGeometry(0.14, 1.7, 0.06), rubber, 0, DESK.y - 1.45, DESK.back - 0.1); // its arm, behind the robot

  // The left monitor: the grid. Orders wait above and below the price, larger the further away:
  // sells above (hollow), buys below (filled). The cyan line is the price.
  const grid = monitor(0.78, 1.22, 360, (ctx, w, h) => {
    words(ctx, 'GRID', 24, 70, 58, INK.lime);
    const now = 150 + (1 - price) * (h - 250);
    for (let level = 1; level <= 4; level++) for (const side of [-1, 1]) {
      const y = now + side * level * 58;
      if (y < 110 || y > h - 28) continue;
      const long = 60 + level * 50;
      if (side > 0) {
        ctx.fillStyle = INK.mint;
        ctx.fillRect(w - 22 - long, y - 14, long, 28);
      } else {
        ctx.strokeStyle = INK.red;
        ctx.lineWidth = 4;
        ctx.strokeRect(w - 20 - long, y - 12, long - 4, 24);
      }
      words(ctx, (side > 0 ? 'B' : 'S') + level, 24, y + 11, 30, INK.muted);
    }
    ctx.fillStyle = INK.cyan;
    ctx.fillRect(0, now - 3, w, 6);
  });
  // The right monitor: the bot's log, the newest line on top.
  const LOG = [['BUY L1', INK.mint], ['SELL L1', INK.red], ['TP HIT', INK.lime], ['BUY L2', INK.mint], ['SELL L2', INK.red], ['TP HIT', INK.lime], ['CLOSED', INK.cyan]];
  let logged = 0;
  const log = monitor(0.78, 1.22, 360, (ctx, w, h) => {
    words(ctx, 'LOG', 24, 70, 58, INK.cyan);
    for (let row = 0; row < 6; row++) {
      const [text, color] = LOG[(logged + LOG.length * 8 - row) % LOG.length], y = 150 + row * 72;
      if (y > h - 20) break;
      ctx.globalAlpha = 1 - row * 0.15;
      ctx.fillStyle = color;
      ctx.fillRect(24, y - 34, 9, 44);
      words(ctx, text, 48, y, 42, row ? INK.muted : INK.text);
    }
    ctx.globalAlpha = 1;
  });
  for (const [screen, side] of [[grid, -1], [log, 1]]) {
    // hinged to the wide monitor's edge and turned in toward the viewer
    const hinge = side * (1.05 + 0.07), half = 0.39;
    screen.group.position.set(hinge + side * half * Math.cos(DESK.turn), DESK.y, DESK.back + half * Math.sin(DESK.turn));
    screen.group.rotation.y = -side * DESK.turn;
    for (const up of [-0.42, 0.42]) add(desk, new THREE.BoxGeometry(0.07, 0.16, 0.07), plate, hinge - side * 0.02, DESK.y + up, DESK.back - 0.03);
  }
  const screens = [chart, grid, log];
  screens.forEach((screen) => {
    screen.home = screen.group.position.x;
    screen.redraw();
  });
  // A monitor comes on with a glitch: a thin bright line, two blackouts, a jump to the side, and
  // then the picture stands. `u` runs from 0 (still off) to 1 (on).
  function flicker(screen, u) {
    const group = screen.group;
    group.visible = u > 0;
    if (u <= 0) return;
    if (u >= 1) {
      group.scale.set(1, 1, 1);
      group.position.x = screen.home;
      glassOf(screen).setScalar(1);
      return;
    }
    const beat = Math.floor(u * 10), chance = Math.abs(Math.sin(beat * 12.9898 + screen.home * 78.233) * 43758.5453) % 1;
    group.visible = beat !== 2 && beat !== 5;
    group.scale.set(u < 0.3 ? 1.05 : 1, u < 0.3 ? 0.03 : u < 0.6 ? mix(0.45, 0.9, chance) : 1, 1);
    group.position.x = screen.home + (u < 0.8 ? (chance - 0.5) * 0.16 : 0);
    glassOf(screen).setScalar(u < 0.6 ? 1.8 : mix(1.8, 1, (u - 0.6) / 0.4));
  }
  const glassOf = (screen) => screen.glass.color;
  // Every beat: one new candle; the grid follows the price; every second beat the log gets a line.
  let beatAt = 0, beats = 0;
  function runDesk(time) {
    if (time - beatAt < 0.9) return;
    beatAt = time;
    beats++;
    candles.shift();
    candles.push(nextCandle());
    chart.redraw();
    grid.redraw();
    if (beats % 2 === 0) {
      logged++;
      log.redraw();
    }
  }

  /* ------------------------------------------------------------ the view */
  // The camera sees one upright frame, 2 wide and 3 high, with the whole robot in it.
  const FRAME = { top: 1.52, bottom: -2.06 };
  const WHOLE = 2 / 3;
  const HEADROOM = 0.08; // a box less tall than the frame shows the upper part: this share of the cut comes off the top
  const camera = new THREE.PerspectiveCamera(24, 2 / 3, 0.5, 60);
  {
    const tall = FRAME.top - FRAME.bottom, middle = (FRAME.top + FRAME.bottom) / 2;
    const far = tall / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.position.set(0, middle + 0.5, far);
    camera.lookAt(0, middle, 0);
  }

  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true'); // the box itself carries the words for a screen reader
  canvas.style.opacity = '0';
  canvas.style.transition = 'opacity 0.25s';
  box.appendChild(canvas);

  // The box holds the robot; the canvas is as high as the box and wider (the stylesheet sizes it),
  // so the side monitors show past the box on both sides. `crop` is the part of the whole frame
  // the box shows: left, top, width, height.
  let crop = [0, 0, 1, 1];
  function layout() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return false;
    const wide = Math.max(w, canvas.clientWidth), beside = (wide - w) / 2;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(wide, h, false);
    const shape = w / h;
    crop = shape > WHOLE ? [0, (1 - WHOLE / shape) * HEADROOM, 1, WHOLE / shape] : [(1 - shape / WHOLE) * 0.5, 0, shape / WHOLE, 1];
    const fullW = w / crop[2], fullH = h / crop[3];
    camera.setViewOffset(fullW, fullH, crop[0] * fullW - beside, crop[1] * fullH, wide, h);
    // Where the page has little room beside the box (a phone, a narrow window), the desk is made
    // smaller, so its side monitors are whole and not cut off by the edge of the screen.
    const rect = box.getBoundingClientRect(), middle = rect.left + rect.width / 2;
    const room = Math.min(middle, document.documentElement.clientWidth - middle, wide / 2) - 4;
    const fits = clamp(room / ((DESK.reach * fullH) / (FRAME.top - FRAME.bottom)), 0.7, 1);
    desk.scale.setScalar(fits);
    desk.position.y = DESK.y * (1 - fits); // it keeps its height
    return true;
  }

  /* ------------------------------------------------------------ looking */
  // Where the pointer is, seen from the head: -1..1 sideways and up or down.
  const HEAD_AT = [0.5, (FRAME.top - 0.72) / (FRAME.top - FRAME.bottom)]; // the head's place in the whole frame
  function wanted(seconds, now) {
    if (!pointer.mouse && now - pointer.at > 3500) {
      // nobody is pointing: look around slowly
      return [Math.sin(seconds * 0.5) * 0.6, Math.sin(seconds * 0.37 + 1.3) * 0.35 + 0.05];
    }
    const rect = box.getBoundingClientRect();
    const x = rect.left + ((HEAD_AT[0] - crop[0]) / crop[2]) * rect.width;
    const y = rect.top + ((HEAD_AT[1] - crop[1]) / crop[3]) * rect.height;
    return [clamp((pointer.x - x) / Math.max(260, innerWidth * 0.36), -1, 1), clamp((pointer.y - y) / Math.max(220, innerHeight * 0.42), -1, 1)];
  }

  const STANCE = 0.2; // the body stands turned this much toward the viewer's right; the head is counted from straight ahead
  const look = { head: [0, 0], body: [0, 0] };
  let blink = 0, nextBlink = 2.2, held = false, shown = false, clock = 0;
  // The intro, one second in all, counted in `intro` (seconds since the scene came up): the robot
  // comes up into its place, then the monitors flicker on one after the other, then the cards
  // beside the robot come in. With "reduce motion" there is none: everything is simply there.
  const INTRO = { robot: 0.35, monitors: 0.25, apart: 0.07, glitch: 0.3, cards: 0.68, between: 0.1, over: 1.1 };
  const cards = cardsBeside(box);
  let intro = still ? INTRO.over : 0, cardsIn = 0, settled = false;
  function playIntro() {
    const rise = 1 - (1 - clamp(intro / INTRO.robot, 0, 1)) ** 3;
    robot.scale.setScalar(mix(0.88, 1, rise));
    robot.position.y -= (1 - rise) * 0.2;
    screens.forEach((screen, i) => flicker(screen, (intro - INTRO.monitors - i * INTRO.apart) / INTRO.glitch));
    while (cardsIn < cards.length && intro >= INTRO.cards + cardsIn * INTRO.between) cards[cardsIn++].classList.add('is-in');
    settled = intro >= INTRO.over;
  }
  function pose() {
    // the head turns far, the body a little; nothing leaves its place
    const dip = Math.sin(nod * Math.PI); // a quick nod after a click on the head
    neck.rotation.y = look.head[0] * 0.62 - STANCE;
    neck.rotation.x = look.head[1] * 0.34 + dip * 0.15;
    neck.rotation.z = -look.head[0] * 0.05;
    body.rotation.y = STANCE + look.body[0] * 0.2;
    body.rotation.x = look.body[1] * 0.04;
    robot.position.y = Math.sin(clock * 1.5) * 0.012; // breathing
    tablet.position.y = TABLET.y + Math.sin(clock * 1.9 + 1) * 0.008;
    for (const eye of eyes) eye.scale.y = (1 - 0.94 * blink) * (1 - 0.5 * dip);
    if (!settled) playIntro();
  }
  function draw() {
    pose();
    renderer.render(scene, camera);
    if (!shown) {
      shown = true;
      canvas.style.opacity = '1'; // the robot fades in
    }
  }

  /* ------------------------------------------------------------ a click on the head */
  // The robot nods and types one line about RZGS-PRO into the card beside it, letter by letter,
  // slowly enough to read along. The page lists the lines in that card; every line is said once
  // before any is said again. One click, one line: until the line is typed, clicks are not taken.
  const card = box.parentElement ? box.parentElement.querySelector('[data-robot-says]') : null;
  const resting = card && card.querySelector('[data-robot-rest]'), reply = card && card.querySelector('[data-robot-reply]');
  const lines = card ? [...card.querySelectorAll('[data-robot-lines] li')].map((line) => line.textContent.trim()).filter(Boolean) : [];
  // In milliseconds: one letter, the rest after a full stop, the shortest wait before the next
  // click is taken, and how long a finished line stays in the card.
  const LETTER = 45, FULL_STOP = 260, AT_LEAST = 1000, STAYS = 5000;
  let unsaid = [], lastSaid = -1, quiet = 0, typing = 0, busy = false;
  // Types the next line and tells how long that takes.
  function say() {
    if (!lines.length || !resting || !reply) return 0;
    if (!unsaid.length) {
      unsaid = lines.map((line, i) => i);
      for (let i = unsaid.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [unsaid[i], unsaid[j]] = [unsaid[j], unsaid[i]];
      }
      if (unsaid.length > 1 && unsaid[unsaid.length - 1] === lastSaid) unsaid.reverse(); // never the same line twice in a row
    }
    lastSaid = unsaid.pop();
    const line = lines[lastSaid];
    clearTimeout(quiet);
    clearTimeout(typing);
    // The whole line is in the card from the first moment, unseen, so the card has its full size
    // at once and no word jumps to a new row while it is typed. The letters then show one by one.
    const typed = document.createElement('span'), toCome = document.createElement('span');
    typed.className = 'typed';
    toCome.className = 'untyped';
    toCome.textContent = line;
    reply.textContent = '';
    reply.append(typed, toCome);
    resting.hidden = true;
    reply.hidden = false;
    card.classList.add('is-talking', 'is-typing');
    const done = () => {
      card.classList.remove('is-typing');
      quiet = setTimeout(() => {
        reply.hidden = true;
        resting.hidden = false;
        card.classList.remove('is-talking');
      }, STAYS);
    };
    if (still) {
      // "reduce motion": the line is simply there
      typed.textContent = line;
      toCome.textContent = '';
      done();
      return 0;
    }
    let count = 0, takes = 0;
    const type = () => {
      count++;
      typed.textContent = line.slice(0, count);
      toCome.textContent = line.slice(count);
      if (count >= line.length) return done();
      typing = setTimeout(type, line[count - 1] === '.' ? FULL_STOP : LETTER);
    };
    typing = setTimeout(type, LETTER);
    for (let i = 0; i < line.length; i++) takes += i && line[i - 1] === '.' ? FULL_STOP : LETTER;
    return takes;
  }
  const ray = new THREE.Raycaster(), spot = new THREE.Vector2();
  function hitsHead(x, y) {
    const rect = canvas.getBoundingClientRect(); // the camera's picture is the whole canvas, wider than the box
    if (!rect.width || !rect.height) return false;
    spot.set(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    ray.setFromCamera(spot, camera);
    return ray.intersectObject(headShape, false).length > 0;
  }
  let nod = 0; // 1 right after a click on the head, back to 0 in half a second
  function poke() {
    if (busy) return false; // one thing at a time: this click is not taken
    busy = true;
    if (!still) nod = 1;
    setTimeout(() => {
      busy = false;
    }, Math.max(AT_LEAST, say() + 150));
    return true;
  }
  box.addEventListener('click', (event) => {
    if (hitsHead(event.clientX, event.clientY)) poke();
  });
  box.addEventListener('pointermove', (event) => {
    // the hand shows only when a click would be taken
    if (event.pointerType === 'mouse') box.style.cursor = !busy && hitsHead(event.clientX, event.clientY) ? 'pointer' : '';
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      // the scene did not wait for the page's font: now that it is here, the words are painted again
      paintLogo();
      screens.forEach((screen) => screen.redraw());
      if (shown && (still || held)) draw();
    });
  }

  if (still) {
    // "reduce motion": the robot stands still, its head a little turned
    look.head = [-0.25, 0.1];
    look.body = [-0.25, 0.1];
    new ResizeObserver(() => {
      if (layout()) draw();
    }).observe(box);
    return;
  }

  let running = false, onScreen = true, lost = false, last = 0, ready = false;
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const passed = Math.max(0, (now - last) / 1000), dt = Math.min(0.05, passed);
    last = now;
    if (held) return;
    clock += dt;
    intro += Math.min(0.12, passed); // the intro keeps to real time, so a slow phone does not stretch it
    const goal = wanted(clock, now), quick = 1 - Math.exp(-dt * 8), slow = 1 - Math.exp(-dt * 3.5);
    for (let i = 0; i < 2; i++) {
      look.head[i] += (goal[i] - look.head[i]) * quick;
      look.body[i] += (goal[i] - look.body[i]) * slow;
    }
    // a blink takes a fifth of a second and comes every few seconds
    nextBlink -= dt;
    if (nextBlink < -0.2) nextBlink = 2.4 + Math.random() * 3;
    blink = nextBlink < 0 ? Math.sin((-nextBlink / 0.2) * Math.PI) : 0;
    nod = Math.max(0, nod - dt / 0.5);
    runDesk(clock);
    draw();
  }
  function run() {
    const should = ready && onScreen && !lost && !document.hidden;
    if (should === running) return;
    running = should;
    if (running) {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  }
  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    run();
  }).observe(canvas);
  document.addEventListener('visibilitychange', run);
  new ResizeObserver(() => {
    if (layout() && shown) draw();
  }).observe(box);
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    run();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    run();
  });

  // The first picture. The shaders are made ready first (where the browser can do that without
  // holding the page up), so the intro does not begin with a stall.
  const start = () => {
    ready = true;
    if (layout()) draw();
    run();
  };
  if (renderer.compileAsync) renderer.compileAsync(scene, camera).then(start, start);
  else start();

  // For checks from the browser console and automated tests; not used by the page.
  (window.__robot3d = window.__robot3d || []).push({
    canvas,
    snap(across, down, closed = 0, introAt = INTRO.over) {
      held = true;
      look.head = [across, down];
      look.body = [across, down];
      blink = closed;
      intro = introAt; // a moment of the intro can be held too
      settled = false;
      layout();
      draw();
    },
    free() {
      held = false;
    },
    poke,
    hitsHead,
    said: () => (reply && !reply.hidden && reply.firstChild ? reply.firstChild.textContent : ''), // what is typed so far
    line: () => (reply && !reply.hidden ? reply.textContent : ''), // the whole line being typed
    busy: () => busy,
    state: () => ({ head: look.head.slice(), goal: wanted(clock, performance.now()), blink, running, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  });
}
})();
