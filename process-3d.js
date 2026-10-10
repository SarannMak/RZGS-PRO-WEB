/* ==========================================================================
   RZGS-PRO: the path to a running bot, as one small machine you can turn.

   Four stations on a plate, joined by a track:
     1  Log in on the website
     2  Choose one offer: FREE (a broker account opened with our link)
                          or PAID (the payment)
     3  The Telegram bot checks the account and the payment, and hands out the
        bot file (.ex5)
     4  MetaTrader 5: the file goes in, the bot runs
   Two cards travel the track, one down the Free lane and one down the Paid
   lane. Each changes face at every station and leaves the Telegram bot as an
   .ex5 file.

   Used by how-to-buy.html: it looks for [data-path3d]. Everything is drawn in
   code (three.js, loaded from a CDN only when the section comes near the
   screen): no models and no pictures. Without WebGL, or before the scene is
   ready, the page simply shows its four step cards.
   ========================================================================== */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

const root = document.querySelector('[data-path3d]');
if (root) {
  // The library is large: fetch it only when the section is about to be seen.
  const near = new IntersectionObserver(async (entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    near.disconnect();
    try {
      const THREE = await import(THREE_URL);
      if (document.fonts && document.fonts.ready) await document.fonts.ready; // the screens are painted with the page's fonts
      build(THREE, root);
    } catch (error) {
      console.warn('path-3d: the 3D view did not start', error);
    }
  }, { rootMargin: '500px' });
  near.observe(root);
}

function build(THREE, root) {
  const stage = root.querySelector('[data-path3d-stage]');
  const holder = root.querySelector('[data-path3d-canvas]');
  const labelLayer = root.querySelector('[data-path3d-labels]');
  const caption = root.querySelector('[data-path3d-caption]');
  const cards = [...root.querySelectorAll('[data-step]')];
  const viewButtons = [...root.querySelectorAll('[data-view]')];
  const playButton = root.querySelector('[data-play]');

  const TAU = Math.PI * 2;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HEX = { cyan: 0x19d3ff, lime: 0xa6ff1a, gold: 0xffd23f, mint: 0x2bf391, red: 0xff5a6a, body: 0x0b2733, bodyHi: 0x11394a, dark: 0x061820, plate: 0x071c26 };
  const INK = { cyan: '#19d3ff', lime: '#a6ff1a', gold: '#ffd23f', mint: '#2bf391', red: '#ff5a6a', text: '#f3fbff', muted: '#9fc0cc', dim: '#5f8492', panel: '#06212c', panelHi: '#0a2f3d', ink: '#02131a', line: '#1c4f61' };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    console.warn('path-3d: WebGL is not available', error);
    return; // the step cards stay as they are
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.hidden = false;
  holder.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xcdf3ff, 0x04131b, 1.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
  keyLight.position.set(-5, 10, 9);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(HEX.cyan, 1.5);
  rimLight.position.set(7, 5, -8);
  scene.add(rimLight);

  /* ------------------------------------------------------------ materials */
  const solid = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2, ...extra });
  const lit = (color, strength = 1) => solid(color, { emissive: color, emissiveIntensity: strength, roughness: 0.4 });
  const MAT = {
    plate: solid(HEX.plate, { roughness: 0.75 }),
    body: solid(HEX.body),
    hi: solid(HEX.bodyHi),
    dark: solid(HEX.dark, { roughness: 0.8 }),
    cyan: lit(HEX.cyan, 0.9),
    lime: lit(HEX.lime, 0.9),
    gold: lit(HEX.gold, 0.8),
    white: lit(0xdff6ff, 0.45),
  };
  const outline = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const LINE = { cyan: outline(HEX.cyan, 0.7), dim: outline(HEX.cyan, 0.26), lime: outline(HEX.lime, 0.9), gold: outline(HEX.gold, 0.9) };

  /* ------------------------------------------------------------ geometry */
  // Every block has its four upright edges cut, like the frames of the site. Its base sits at y = 0.
  const blocks = new Map();
  function blockGeo(w, h, d, cut) {
    const key = `${w}|${h}|${d}|${cut}`;
    if (!blocks.has(key)) {
      const x = w / 2, z = d / 2, c = Math.min(cut, x * 0.9, z * 0.9);
      let geo;
      if (c <= 0) {
        geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
        geo.translate(0, h / 2, 0);
      } else {
        const shape = new THREE.Shape();
        shape.moveTo(-x + c, -z);
        shape.lineTo(x - c, -z);
        shape.lineTo(x, -z + c);
        shape.lineTo(x, z - c);
        shape.lineTo(x - c, z);
        shape.lineTo(-x + c, z);
        shape.lineTo(-x, z - c);
        shape.lineTo(-x, -z + c);
        shape.closePath();
        geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // the extrusion becomes the height
        if (geo.index) geo = geo.toNonIndexed();
      }
      blocks.set(key, geo);
    }
    return blocks.get(key);
  }
  function tubeGeo(radius, height, sides) {
    const key = `c${radius}|${height}|${sides}`;
    if (!blocks.has(key)) {
      const geo = new THREE.CylinderGeometry(radius, radius, height, sides).toNonIndexed();
      geo.translate(0, height / 2, 0);
      blocks.set(key, geo);
    }
    return blocks.get(key);
  }
  const edgeCache = new WeakMap();
  function edgesOf(geo) {
    if (!edgeCache.has(geo)) edgeCache.set(geo, new THREE.EdgesGeometry(geo, 30));
    return edgeCache.get(geo);
  }

  // A station is built from many blocks that never move. They are gathered here and become one
  // mesh per material and one set of outlines per colour: a handful of draw calls per station.
  function batch(parent) {
    const solids = new Map(), lines = new Map();
    const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), turn = new THREE.Quaternion(), euler = new THREE.Euler();
    const at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    function add(geo, o, x, y, z) {
      matrix.compose(at.set(x, y, z), turn.setFromEuler(euler.set(o.rx || 0, o.ry || 0, o.rz || 0)), one);
      normalMatrix.getNormalMatrix(matrix);
      const mat = o.mat || MAT.body;
      if (!solids.has(mat)) solids.set(mat, { position: [], normal: [] });
      const bucket = solids.get(mat), position = geo.attributes.position, normal = geo.attributes.normal;
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(matrix);
        bucket.position.push(v.x, v.y, v.z);
        v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        bucket.normal.push(v.x, v.y, v.z);
      }
      const edge = o.edge === undefined ? LINE.cyan : o.edge;
      if (!edge) return;
      if (!lines.has(edge)) lines.set(edge, []);
      const list = lines.get(edge), ends = edgesOf(geo).attributes.position;
      for (let i = 0; i < ends.count; i++) {
        v.fromBufferAttribute(ends, i).applyMatrix4(matrix);
        list.push(v.x, v.y, v.z);
      }
    }
    return {
      box: (w, h, d, x, y, z, o = {}) => add(blockGeo(w, h, d, o.cut === undefined ? 0.07 : o.cut), o, x, y, z),
      tube: (radius, height, x, y, z, o = {}) => add(tubeGeo(radius, height, o.sides || 20), o, x, y, z),
      done() {
        for (const [mat, bucket] of solids) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.position, 3));
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normal, 3));
          parent.add(new THREE.Mesh(geo, mat));
        }
        for (const [mat, list] of lines) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
          parent.add(new THREE.LineSegments(geo, mat));
        }
      },
    };
  }

  /* ------------------------------------------------------------ painted screens */
  const DISPLAY = 'Oxanium, "Segoe UI", system-ui, sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
  // The screens are painted larger than they are measured, so their words stay sharp close up.
  const SHARP = 1.5;
  function painted(w, h, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = w * SHARP;
    canvas.height = h * SHARP;
    const ctx = canvas.getContext('2d');
    ctx.scale(SHARP, SHARP);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const screen = {
      texture,
      redraw(state) {
        ctx.clearRect(0, 0, w, h);
        draw(ctx, w, h, state);
        texture.needsUpdate = true;
      },
    };
    screen.redraw();
    return screen;
  }
  function write(ctx, words, x, y, size, color = INK.text, weight = 600, font = DISPLAY, align = 'left') {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(words, x, y);
  }
  // A frame with its top-left and bottom-right corners cut, as on the site.
  function frame(ctx, x, y, w, h, cut = 14) {
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - cut);
    ctx.lineTo(x + w - cut, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + cut);
    ctx.closePath();
  }
  function fillFrame(ctx, x, y, w, h, fill, stroke, cut) {
    frame(ctx, x, y, w, h, cut);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  function tick(ctx, x, y, size, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.22;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - size * 0.45, y);
    ctx.lineTo(x - size * 0.1, y + size * 0.35);
    ctx.lineTo(x + size * 0.5, y - size * 0.4);
    ctx.stroke();
  }
  function panel(parent, screen, w, h, x, y, z, rx = 0, ry = 0) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false, transparent: true }));
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    parent.add(mesh);
    return mesh;
  }
  // The middle of the front of a block that leans back by `rx` around its base: where its screen goes.
  function frontOf(x, y, z, height, depth, rx = 0, gap = 0.01) {
    const up = height / 2, out = depth / 2 + gap;
    return [x, y + up * Math.cos(rx) - out * Math.sin(rx), z + up * Math.sin(rx) + out * Math.cos(rx), rx];
  }
  // A soft pool of light on the plate under a station.
  const glowTexture = painted(128, 128, (ctx) => {
    const fade = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    fade.addColorStop(0, 'rgba(255,255,255,0.9)');
    fade.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 128, 128);
  }).texture;
  function glow(parent, color, size, x, z, opacity = 0.5) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: glowTexture, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    mesh.raycast = () => {}; // light on the floor is not part of a station when pointing at one
    parent.add(mesh);
    return mesh;
  }

  /* ------------------------------------------------------------ the plate */
  const machine = new THREE.Group();
  scene.add(machine);
  {
    const b = batch(machine);
    b.box(13.6, 0.3, 7.9, 0, -0.3, 0, { mat: MAT.plate, cut: 0.8 });
    b.box(13.2, 0.06, 7.5, 0, -0.36, 0, { mat: MAT.dark, cut: 0.75, edge: LINE.dim });
    for (const x of [-6.2, 6.2]) for (const z of [-3.35, 3.35]) b.tube(0.1, 0.03, x, 0, z, { mat: MAT.hi, edge: LINE.dim, sides: 10 });
    b.done();
    // a faint grid drawn on the plate
    const points = [];
    for (let x = -6; x <= 6.01; x += 0.8) points.push(x, 0.004, -3.4, x, 0.004, 3.4);
    for (let z = -3.2; z <= 3.21; z += 0.8) points.push(-6.4, 0.004, z, 6.4, 0.004, z);
    const grid = new THREE.BufferGeometry();
    grid.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    machine.add(new THREE.LineSegments(grid, outline(HEX.cyan, 0.09)));
    const engraved = painted(1536, 128, (ctx, w, h) => {
      write(ctx, 'RZGS-PRO', 20, 58, 46, INK.cyan, 800);
      write(ctx, '//  FROM LOGIN TO A RUNNING BOT', 290, 58, 34, INK.muted, 600);
      write(ctx, '01 LOG IN   >   02 CHOOSE ONE OFFER   >   03 VERIFY IN TELEGRAM   >   04 SET UP MT5', 22, 106, 22, INK.dim, 500, MONO);
      ctx.fillStyle = INK.lime;
      ctx.fillRect(w - 150, 40, 130, 4);
    });
    const text = panel(machine, engraved, 8.4, 0.7, -2.1, 0.006, 3.3, -Math.PI / 2);
    text.material.opacity = 0.9;
  }

  /* ------------------------------------------------------------ the track */
  const HOVER = 0.66; // how high a card travels above the plate
  const P = (x, z, y = HOVER) => new THREE.Vector3(x, y, z);
  const START = P(-6.35, 1.2), GATE = P(-4.7, 1.08), FORK = P(-1.95, 0.98), MERGE = P(1.85, 0.9), TOWER = P(2.9, 0.78), CHUTE = P(3.6, 0.92), SLOT = P(4.05, 1.32);
  const LANE = {
    free: { color: HEX.lime, ink: INK.lime, stop: P(0.15, -0.5), via: [P(-0.95, 0.25)], out: [P(1.05, -0.12)] },
    paid: { color: HEX.gold, ink: INK.gold, stop: P(0.15, 2.3), via: [P(-0.95, 1.78)], out: [P(1.05, 1.86)] },
  };
  const spline = (points) => new THREE.CatmullRomCurve3(points, false, 'centripetal');
  // Where along a curve a point lies (0..1 by length).
  function placeOn(curve, point) {
    let best = 0, nearest = Infinity;
    const probe = new THREE.Vector3();
    for (let i = 0; i <= 400; i++) {
      const distance = curve.getPointAt(i / 400, probe).distanceToSquared(point);
      if (distance < nearest) {
        nearest = distance;
        best = i / 400;
      }
    }
    return best;
  }
  for (const lane of Object.values(LANE)) {
    lane.curve = spline([START, GATE, P(-3.3, 1.0), FORK, ...lane.via, lane.stop, ...lane.out, MERGE, TOWER]);
    lane.at = { gate: placeOn(lane.curve, GATE), fork: placeOn(lane.curve, FORK), stop: placeOn(lane.curve, lane.stop) };
  }
  const lastLeg = spline([CHUTE, P(3.88, 1.28), SLOT]);

  // The rails: one piece for the shared way in, one per lane, one for the way to MetaTrader.
  const flat = (curve, from, to, n = 60) => {
    const points = [];
    for (let i = 0; i <= n; i++) {
      const point = curve.getPointAt(from + ((to - from) * i) / n);
      point.y = 0.035;
      points.push(point);
    }
    return spline(points);
  };
  const rails = [
    { curve: flat(LANE.free.curve, 0, LANE.free.at.fork), mat: MAT.cyan, color: HEX.cyan },
    { curve: flat(LANE.free.curve, LANE.free.at.fork, placeOn(LANE.free.curve, MERGE)), mat: MAT.lime, color: HEX.lime },
    { curve: flat(LANE.paid.curve, LANE.paid.at.fork, placeOn(LANE.paid.curve, MERGE)), mat: MAT.gold, color: HEX.gold },
    { curve: flat(LANE.free.curve, placeOn(LANE.free.curve, MERGE), 1, 20), mat: MAT.cyan, color: HEX.cyan },
    { curve: flat(lastLeg, 0, 1, 20), mat: MAT.lime, color: HEX.lime },
  ];
  // Small lights run along the rails, in the direction of travel.
  const sparks = [];
  for (const rail of rails) {
    machine.add(new THREE.Mesh(new THREE.TubeGeometry(rail.curve, 80, 0.028, 6, false), rail.mat));
    const count = Math.max(2, Math.round(rail.curve.getLength() / 0.85));
    for (let i = 0; i < count; i++) sparks.push({ rail, offset: i / count });
  }
  const sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.03, 0.075), new THREE.MeshBasicMaterial({ toneMapped: false }), sparks.length);
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const sparkColor = new THREE.Color();
  sparks.forEach((spark, i) => sparkMesh.setColorAt(i, sparkColor.setHex(spark.rail.color).lerp(new THREE.Color(0xffffff), 0.45)));
  sparkMesh.instanceColor.needsUpdate = true;
  machine.add(sparkMesh);
  const dummy = new THREE.Object3D(), along = new THREE.Vector3();
  function runSparks(time) {
    sparks.forEach((spark, i) => {
      const u = (spark.offset + time * 0.085) % 1;
      spark.rail.curve.getPointAt(u, dummy.position);
      spark.rail.curve.getTangentAt(u, along);
      dummy.position.y = 0.075;
      dummy.rotation.set(0, -Math.atan2(along.z, along.x), 0);
      dummy.updateMatrix();
      sparkMesh.setMatrixAt(i, dummy.matrix);
    });
    sparkMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------ the stations */
  // `focus` is how the camera looks at a station: what it aims at, from how far, from which side.
  // `close` is the same for a phone, where the stage is upright and small: what to aim at, how much
  // must fit across (`span`) and up (`rise`), and where a card stops at this station.
  const stations = [];
  function station(index, name, x, z, focus, close) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.userData.step = index;
    machine.add(group);
    const entry = { index, name, group, focus, close, lamps: [] };
    stations.push(entry);
    return entry;
  }
  // A light that the journey can make brighter for a moment.
  function lamp(owner, mesh, rest = 0.5) {
    mesh.material = mesh.material.clone();
    mesh.material.emissiveIntensity = rest;
    const entry = { material: mesh.material, rest, level: 0 };
    owner.lamps.push(entry);
    return entry;
  }
  function lightBar(parent, mat, w, h, d, x, y, z) {
    const mesh = new THREE.Mesh(blockGeo(w, h, d, 0), mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  // 1. LOG IN: a kiosk with the login page on its screen, and a gate the card passes through.
  const login = station(0, 'Log in', -4.7, 0.3, { target: [-4.7, 0.95, 0.6], distance: 7.4, side: 0.4 }, { target: [-4.7, 1.2, 0.4], span: 2.5, rise: 3.5, side: 0.3, stop: GATE });
  // Every screen says little, in large letters: on a phone it is a few centimetres wide.
  const loginScreen = painted(512, 352, (ctx, w, h, ok) => {
    fillFrame(ctx, 2, 2, w - 4, h - 4, INK.panel, INK.line, 22);
    ctx.fillStyle = INK.panelHi;
    ctx.fillRect(4, 4, w - 8, 48);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = [INK.red, INK.gold, INK.mint][i];
      ctx.beginPath();
      ctx.arc(28 + i * 22, 28, 6, 0, TAU);
      ctx.fill();
    }
    write(ctx, 'rzgspro.com', 110, 37, 24, INK.muted, 500, MONO);
    if (ok) {
      ctx.strokeStyle = INK.lime;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(w / 2, 150, 62, 0, TAU);
      ctx.stroke();
      tick(ctx, w / 2, 150, 66, INK.lime);
      write(ctx, 'LOGGED IN', w / 2, 302, 60, INK.text, 800, DISPLAY, 'center');
      return;
    }
    write(ctx, 'LOG IN', 36, 116, 58, INK.text, 800);
    for (const [value, y] of [['you@email.com', 136], ['• • • • • • •', 202]]) {
      fillFrame(ctx, 36, y, w - 72, 54, INK.ink, INK.line, 10);
      write(ctx, value, 54, y + 37, 27, INK.muted, 500, MONO);
    }
    const grad = ctx.createLinearGradient(36, 0, w - 36, 0);
    grad.addColorStop(0, INK.cyan);
    grad.addColorStop(1, INK.lime);
    fillFrame(ctx, 36, 272, w - 72, 60, grad, null, 16);
    write(ctx, 'LOG IN', w / 2, 315, 36, INK.ink, 800, DISPLAY, 'center');
  });
  {
    const b = batch(login.group);
    b.box(2.2, 0.12, 2.0, 0, 0, 0.25, { mat: MAT.dark, cut: 0.22 });
    b.box(1.25, 0.72, 0.62, 0, 0.12, -0.35, { cut: 0.1 });
    b.box(0.22, 0.5, 0.2, 0, 0.84, -0.42, { mat: MAT.hi, cut: 0.04 });
    b.box(1.74, 1.22, 0.1, 0, 1.2, -0.44, { mat: MAT.hi, cut: 0.1, rx: -0.14 });
    // the gate over the track
    b.box(0.16, 1.18, 0.16, 0, 0.12, 0.42, { mat: MAT.hi, cut: 0.03 });
    b.box(0.16, 0.2, 0.16, 0, 0.12, 1.14, { mat: MAT.hi, cut: 0.03 }); // the nearer post is low: it must not hide the card
    b.box(0.16, 0.12, 0.88, 0, 1.3, 0.78, { mat: MAT.hi, cut: 0.03 });
    b.done();
    panel(login.group, loginScreen, 1.58, 1.086, ...frontOf(0, 1.2, -0.44, 1.22, 0.1, -0.14));
    login.gate = lamp(login, lightBar(login.group, MAT.cyan, 0.04, 0.05, 0.72, 0.085, 1.27, 0.78));
    glow(login.group, HEX.cyan, 3.2, 0, 0.3, 0.32);
  }

  // 2. CHOOSE ONE OFFER: a post with two boards, then one module on each lane.
  const offer = station(1, 'Choose one offer', -1.95, -0.1, { target: [-0.75, 0.75, 0.85], distance: 11.2, side: 0.22 }, { target: [-1.9, 1.3, 0.35], span: 3.5, rise: 3.5, side: 0.14 });
  function board(title, color, lines, chip) {
    return painted(384, 256, (ctx, w, h) => {
      fillFrame(ctx, 2, 2, w - 4, h - 4, INK.panel, color, 20);
      ctx.fillStyle = color;
      ctx.fillRect(4, 4, 10, h - 28);
      write(ctx, title, 32, 88, 86, color, 800);
      write(ctx, lines[0], 34, 136, 32, INK.text, 700);
      write(ctx, lines[1], 34, 174, 25, INK.muted, 600);
      ctx.font = `600 21px ${MONO}`;
      fillFrame(ctx, 34, 196, ctx.measureText(chip).width + 32, 42, null, color, 10);
      write(ctx, chip, 50, 225, 21, color, 600, MONO);
    });
  }
  const freeBoard = board('FREE', INK.lime, ['7-day trial  ·  $0', 'Open a broker account'], 'WITH OUR LINK');
  const paidBoard = board('PAID', INK.gold, ['Elite or Diamond', '$5 or $49 a month'], 'PAY BY KHQR');
  const brokerScreen = painted(512, 240, (ctx, w, h, ok) => {
    fillFrame(ctx, 2, 2, w - 4, h - 4, INK.panel, INK.lime, 20);
    write(ctx, 'OPEN YOUR ACCOUNT', 26, 56, 40, INK.text, 800);
    write(ctx, 'WITH OUR LINK', 26, 102, 40, INK.lime, 800);
    ['EXNESS', 'INVESTIZO', 'LIRUNEX'].forEach((name, i) => {
      fillFrame(ctx, 26 + i * 156, 122, 146, 52, INK.panelHi, INK.line, 10);
      write(ctx, name, 26 + i * 156 + 73, 157, 22, INK.text, 700, DISPLAY, 'center');
    });
    if (ok) tick(ctx, 44, 205, 30, INK.lime);
    write(ctx, ok ? 'Account found' : 'Choose one broker', ok ? 72 : 26, 215, 27, ok ? INK.lime : INK.muted, 600);
  });
  const qrPicture = painted(256, 300, (ctx, w) => {
    ctx.fillStyle = '#f3fbff';
    frame(ctx, 2, 2, w - 4, 296, 18);
    ctx.fill();
    // Not a real code: the three corner marks and a fixed pattern, so it reads as "a QR code".
    const cell = 12, origin = 26;
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    ctx.fillStyle = INK.ink;
    for (let row = 0; row < 17; row++) for (let col = 0; col < 17; col++) {
      const corner = (row < 7 && col < 7) || (row < 7 && col > 9) || (row > 9 && col < 7);
      if (!corner && random() > 0.52) ctx.fillRect(origin + col * cell, origin + row * cell, cell, cell);
    }
    for (const [col, row] of [[0, 0], [10, 0], [0, 10]]) {
      ctx.fillStyle = INK.ink;
      ctx.fillRect(origin + col * cell, origin + row * cell, cell * 7, cell * 7);
      ctx.fillStyle = '#f3fbff';
      ctx.fillRect(origin + (col + 1) * cell, origin + (row + 1) * cell, cell * 5, cell * 5);
      ctx.fillStyle = INK.ink;
      ctx.fillRect(origin + (col + 2) * cell, origin + (row + 2) * cell, cell * 3, cell * 3);
    }
    write(ctx, 'KHQR', w / 2, 283, 40, INK.ink, 800, DISPLAY, 'center');
  });
  const receiptPicture = painted(192, 288, (ctx, w, h, ok) => {
    ctx.fillStyle = '#f3fbff';
    ctx.fillRect(0, 0, w, h);
    write(ctx, 'RECEIPT', w / 2, 46, 32, INK.ink, 800, DISPLAY, 'center');
    ctx.strokeStyle = '#7fa3b3';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(16, 64);
    ctx.lineTo(w - 16, 64);
    ctx.stroke();
    ctx.setLineDash([]);
    write(ctx, 'RZGS-PRO', w / 2, 104, 24, '#2c4853', 600, MONO, 'center');
    write(ctx, '$5.00', w / 2, 162, 46, INK.ink, 800, DISPLAY, 'center');
    ctx.fillStyle = ok ? '#12a85f' : '#7fa3b3';
    ctx.fillRect(18, 190, w - 36, 72);
    write(ctx, ok ? 'PAID' : 'PAY', w / 2, 242, 44, '#f3fbff', 800, DISPLAY, 'center');
  });
  {
    const b = batch(offer.group);
    b.box(1.5, 0.12, 1.3, 0, 0, 0, { mat: MAT.dark, cut: 0.2 });
    b.box(0.42, 1.9, 0.42, 0, 0.12, 0, { mat: MAT.hi, cut: 0.08 });
    b.box(0.14, 0.1, 1.0, 0.18, 1.56, 0.22, { mat: MAT.hi, cut: 0.02 });
    // the two boards hang left and right of the post
    b.box(1.5, 1.02, 0.07, -0.86, 1.02, 0.34, { mat: MAT.dark, cut: 0.08, edge: LINE.lime });
    b.box(1.5, 1.02, 0.07, 0.94, 1.02, 0.34, { mat: MAT.dark, cut: 0.08, edge: LINE.gold });
    // FREE lane: three broker towers behind the track, and a sign above them
    b.box(2.5, 0.1, 1.45, 2.1, 0, -1.5, { mat: MAT.dark, cut: 0.2, edge: LINE.lime });
    for (const x of [1.05, 3.05]) b.box(0.08, 1.25, 0.08, x, 0.1, -2.14, { mat: MAT.hi, cut: 0.02, edge: LINE.dim });
    b.box(2.34, 1.14, 0.06, 2.05, 1.3, -2.14, { mat: MAT.dark, cut: 0.08, edge: LINE.lime });
    [[1.35, 0.78], [2.05, 1.12], [2.75, 0.9]].forEach(([x, height]) => {
      b.box(0.5, height, 0.5, x, 0.1, -1.72, { cut: 0.08, edge: LINE.lime });
      b.box(0.3, 0.06, 0.3, x, 0.1 + height, -1.72, { mat: MAT.lime, cut: 0.05, edge: null });
    });
    // PAID lane: a stand with the QR code and a printer for the receipt
    b.box(2.5, 0.1, 1.3, 2.1, 0, 1.35, { mat: MAT.dark, cut: 0.2, edge: LINE.gold });
    b.box(0.24, 0.55, 0.24, 1.55, 0.1, 1.2, { mat: MAT.hi, cut: 0.04, edge: LINE.gold });
    b.box(1.02, 1.2, 0.08, 1.55, 0.6, 1.12, { mat: MAT.dark, cut: 0.08, edge: LINE.gold, rx: -0.2 });
    b.box(0.86, 0.52, 0.62, 2.62, 0.1, 1.2, { cut: 0.08, edge: LINE.gold });
    b.box(0.6, 0.05, 0.1, 2.62, 0.62, 1.2, { mat: MAT.dark, cut: 0, edge: null });
    b.done();
    // the pointer on top of the post: it turns toward the lane a card is about to take
    offer.pointer = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 4), MAT.cyan.clone());
    offer.pointer.position.set(0, 2.3, 0);
    offer.pointer.rotation.z = -Math.PI / 2;
    offer.spinner = new THREE.Group();
    offer.spinner.position.set(0, 0, 0);
    offer.spinner.add(offer.pointer);
    offer.group.add(offer.spinner);
    panel(offer.group, freeBoard, 1.38, 0.92, -0.86, 1.53, 0.385);
    panel(offer.group, paidBoard, 1.38, 0.92, 0.94, 1.53, 0.385);
    panel(offer.group, brokerScreen, 2.2, 1.03, ...frontOf(2.05, 1.3, -2.14, 1.14, 0.06));
    offer.broker = { screen: brokerScreen, ok: false };
    panel(offer.group, qrPicture, 0.84, 0.985, ...frontOf(1.55, 0.6, 1.12, 1.2, 0.08, -0.2));
    offer.receipt = panel(offer.group, receiptPicture, 0.5, 0.75, 2.62, 1.0, 1.2);
    offer.receipt.material.side = THREE.DoubleSide;
    offer.receiptPaid = { screen: receiptPicture, ok: false };
    offer.freeLamp = lamp(offer, lightBar(offer.group, MAT.lime, 2.3, 0.03, 0.05, 2.1, 0.1, -0.83));
    offer.paidLamp = lamp(offer, lightBar(offer.group, MAT.gold, 2.3, 0.03, 0.05, 2.1, 0.1, 1.95));
    glow(offer.group, HEX.lime, 3.4, 2.1, -1.4, 0.26);
    glow(offer.group, HEX.gold, 3.4, 2.1, 1.5, 0.22);
  }

  // 3. TELEGRAM: a tower with a paper plane on it. It checks, then hands out the .ex5 file.
  const telegram = station(2, 'Verify in Telegram', 2.9, 0, { target: [2.95, 1.5, 0.3], distance: 7.9, side: 0.34 }, { target: [3.22, 1.42, 0.3], span: 2.15, rise: 3.5, side: 0.3, stop: TOWER });
  const planeBadge = painted(256, 256, (ctx, w) => {
    ctx.fillStyle = INK.cyan;
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, 120, 0, TAU);
    ctx.fill();
    // a plain paper plane, pointing up and to the right
    ctx.fillStyle = '#f3fbff';
    ctx.beginPath();
    ctx.moveTo(198, 62);
    ctx.lineTo(52, 122);
    ctx.lineTo(104, 142);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(198, 62);
    ctx.lineTo(104, 142);
    ctx.lineTo(122, 200);
    ctx.lineTo(146, 160);
    ctx.lineTo(176, 178);
    ctx.closePath();
    ctx.fill();
  });
  const CHECKS = ['ACCOUNT', 'PAYMENT', 'MT5 LOGIN'];
  const chatScreen = painted(416, 448, (ctx, w, h, done = 4) => {
    fillFrame(ctx, 2, 2, w - 4, h - 4, INK.panel, INK.line, 22);
    ctx.fillStyle = INK.panelHi;
    ctx.fillRect(4, 4, w - 8, 66);
    ctx.drawImage(planeBadge.texture.image, 16, 13, 48, 48); // the Telegram mark
    write(ctx, 'RZGS-PRO BOT', 76, 49, 33, INK.text, 800);
    CHECKS.forEach((label, i) => {
      const y = 82 + i * 86, ok = done > i;
      fillFrame(ctx, 18, y, w - 36, 74, ok ? '#0c3a2b' : INK.ink, ok ? INK.mint : INK.line, 12);
      write(ctx, label, 36, y + 52, 42, ok ? INK.text : INK.dim, 700);
      if (ok) tick(ctx, w - 58, y + 37, 34, INK.mint);
    });
    if (done < 4) {
      write(ctx, done < 3 ? 'checking…' : 'sending…', w / 2, 400, 32, INK.gold, 500, MONO, 'center');
      return;
    }
    // the file the bot sends
    fillFrame(ctx, 18, 344, w - 36, 90, '#0b3a4b', INK.cyan, 14);
    fillFrame(ctx, 32, 356, 104, 66, INK.lime, null, 12);
    write(ctx, '.ex5', 84, 402, 36, INK.ink, 800, DISPLAY, 'center');
    write(ctx, 'BOT FILE', 152, 404, 42, INK.text, 800);
  });
  {
    const b = batch(telegram.group);
    b.box(2.1, 0.12, 1.9, 0, 0, 0.2, { mat: MAT.dark, cut: 0.22 });
    b.box(1.34, 2.05, 0.9, 0, 0.12, -0.05, { cut: 0.14 });
    b.box(1.14, 0.1, 0.72, 0, 2.17, -0.05, { mat: MAT.hi, cut: 0.1 });
    b.tube(0.03, 0.42, 0.42, 2.27, -0.2, { mat: MAT.hi, edge: null, sides: 8 });
    // where the card goes in, and the chute the file comes out of
    b.box(0.62, 0.72, 0.05, 0, 0.3, 0.415, { mat: MAT.dark, cut: 0.05 });
    b.box(0.5, 0.1, 0.46, 0.72, 0.32, 0.62, { mat: MAT.hi, cut: 0.04, edge: LINE.lime, rz: -0.12 });
    b.done();
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), new THREE.MeshBasicMaterial({ map: planeBadge.texture, toneMapped: false, transparent: true }));
    badge.position.set(0, 2.6, -0.05);
    telegram.group.add(badge);
    telegram.badge = badge;
    panel(telegram.group, chatScreen, 0.98, 1.055, 0, 1.62, 0.412);
    telegram.chat = { screen: chatScreen, done: 4 };
    telegram.antenna = lamp(telegram, lightBar(telegram.group, MAT.lime, 0.09, 0.09, 0.09, 0.42, 2.69, -0.2), 0.8);
    telegram.slot = lamp(telegram, lightBar(telegram.group, MAT.cyan, 0.5, 0.03, 0.03, 0, 1.04, 0.45));
    glow(telegram.group, HEX.cyan, 3.2, 0, 0.2, 0.34);
  }

  // 4. MT5: a desk, a wide screen with a live chart, and the computer the file goes into.
  const mt5 = station(3, 'Set up MT5', 5.0, 0.2, { target: [4.85, 0.95, 0.55], distance: 8.0, side: -0.2 }, { target: [4.98, 1.05, 0.5], span: 3.2, rise: 3.3, side: -0.1, stop: SLOT });
  const candles = Array.from({ length: 30 }, () => 0);
  let price = 0.5;
  function nextCandle() {
    const open = price;
    price = Math.min(0.9, Math.max(0.12, price + (Math.sin(candles.length + price * 9) * 0.5 + Math.random() - 0.42) * 0.11));
    return { open, close: price, high: Math.max(open, price) + Math.random() * 0.05, low: Math.min(open, price) - Math.random() * 0.05 };
  }
  for (let i = 0; i < candles.length; i++) candles[i] = nextCandle();
  const chartScreen = painted(672, 400, (ctx, w, h, running = true) => {
    fillFrame(ctx, 2, 2, w - 4, h - 4, INK.panel, INK.line, 22);
    ctx.fillStyle = INK.panelHi;
    ctx.fillRect(4, 4, w - 8, 58);
    write(ctx, 'XAUUSD', 22, 45, 38, INK.text, 800);
    write(ctx, 'MT5', 192, 44, 24, INK.dim, 600, MONO);
    fillFrame(ctx, w - 292, 11, 272, 40, running ? '#0c3a2b' : INK.ink, running ? INK.mint : INK.line, 10);
    write(ctx, running ? 'ALGO TRADING ON' : 'ALGO TRADING OFF', w - 156, 39, 23, running ? INK.mint : INK.dim, 600, MONO, 'center');
    ctx.strokeStyle = 'rgba(25, 211, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let y = 104; y < h - 20; y += 52) {
      ctx.beginPath();
      ctx.moveTo(16, y);
      ctx.lineTo(w - 212, y);
      ctx.stroke();
    }
    const top = 84, bottom = h - 30, span = bottom - top, step = (w - 244) / candles.length;
    candles.forEach((candle, i) => {
      const x = 22 + i * step, up = candle.close >= candle.open;
      ctx.strokeStyle = ctx.fillStyle = up ? INK.mint : INK.red;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + step * 0.32, bottom - candle.high * span);
      ctx.lineTo(x + step * 0.32, bottom - candle.low * span);
      ctx.stroke();
      const a = bottom - Math.max(candle.open, candle.close) * span;
      ctx.fillRect(x, a, step * 0.64, Math.max(3, Math.abs(candle.close - candle.open) * span));
    });
    // the bot's own panel, at the right of the chart
    fillFrame(ctx, w - 198, 76, 178, h - 98, INK.ink, INK.cyan, 14);
    write(ctx, 'RZGS-PRO', w - 109, 120, 27, INK.cyan, 800, DISPLAY, 'center');
    ctx.fillStyle = running ? INK.lime : INK.dim;
    ctx.beginPath();
    ctx.arc(w - 109, 180, 30, 0, TAU);
    ctx.fill();
    write(ctx, running ? 'RUNNING' : 'WAITING', w - 109, 258, 32, running ? INK.lime : INK.dim, 800, DISPLAY, 'center');
    write(ctx, 'BUY + SELL', w - 109, 302, 19, INK.muted, 500, MONO, 'center');
    write(ctx, 'GRID · BASKET', w - 109, 332, 19, INK.muted, 500, MONO, 'center');
  });
  {
    const b = batch(mt5.group);
    b.box(2.7, 0.12, 2.1, 0.05, 0, 0.3, { mat: MAT.dark, cut: 0.24 });
    b.box(1.9, 0.52, 0.86, 0.35, 0.12, -0.2, { cut: 0.1 });
    b.box(0.26, 0.42, 0.2, 0.35, 0.64, -0.36, { mat: MAT.hi, cut: 0.04 });
    b.box(2.16, 1.38, 0.1, 0.35, 0.92, -0.4, { mat: MAT.hi, cut: 0.1, rx: -0.1 });
    // the computer, with the slot for the .ex5 file on its front
    b.box(0.52, 1.06, 0.84, -0.95, 0.12, 0.4, { cut: 0.08 });
    b.box(0.4, 0.2, 0.04, -0.95, 0.5, 0.825, { mat: MAT.dark, cut: 0.03, edge: LINE.lime });
    // a keyboard on the desk
    b.box(0.9, 0.04, 0.3, 0.35, 0.64, 0.05, { mat: MAT.dark, cut: 0.04, edge: LINE.dim });
    b.done();
    panel(mt5.group, chartScreen, 2.0, 1.19, ...frontOf(0.35, 0.92, -0.4, 1.38, 0.1, -0.1));
    mt5.chart = { screen: chartScreen };
    mt5.power = lamp(mt5, lightBar(mt5.group, MAT.lime, 0.3, 0.035, 0.03, -0.95, 0.95, 0.83), 0.6);
    glow(mt5.group, HEX.lime, 3.6, 0.1, 0.35, 0.3);
    // The robot stands beside the screen: the bot, at work. A small figure of blocks, like the rest
    // of the machine: headphones, two lit eyes, a lime V on the chest.
    const robot = new THREE.Group();
    robot.position.set(1.05, 0.12, 0.95);
    mt5.group.add(robot);
    mt5.robot = robot;
    const r = batch(robot);
    for (const x of [-0.12, 0.12]) r.box(0.17, 0.4, 0.2, x, 0, 0, { mat: MAT.dark, cut: 0.04 }); // legs
    r.box(0.5, 0.2, 0.28, 0, 0.38, 0, { cut: 0.06 }); // hips
    r.box(0.6, 0.36, 0.32, 0, 0.56, 0, { mat: MAT.hi, cut: 0.08 }); // chest
    for (const x of [-0.38, 0.38]) {
      r.box(0.2, 0.2, 0.24, x, 0.74, 0, { cut: 0.05, edge: LINE.lime }); // shoulders
      r.box(0.14, 0.4, 0.16, x, 0.36, 0.02, { mat: MAT.dark, cut: 0.03 }); // arms
    }
    r.box(0.16, 0.08, 0.16, 0, 0.92, 0, { mat: MAT.dark, cut: 0.03, edge: LINE.dim }); // neck
    r.box(0.42, 0.4, 0.38, 0, 0.99, 0, { mat: MAT.dark, cut: 0.1 }); // head
    for (const x of [-0.25, 0.25]) r.box(0.09, 0.24, 0.24, x, 1.06, 0, { mat: MAT.hi, cut: 0.03, edge: LINE.lime }); // headphones
    r.box(0.56, 0.05, 0.1, 0, 1.39, 0, { mat: MAT.hi, cut: 0.02, edge: LINE.lime }); // their band
    r.done();
    for (const x of [-0.09, 0.09]) lightBar(robot, MAT.cyan, 0.1, 0.04, 0.02, x, 1.19, 0.185); // eyes
    for (const turn of [-0.5, 0.5]) lightBar(robot, MAT.lime, 0.2, 0.03, 0.02, turn * 0.17, 0.69, 0.165).rotation.z = -turn; // the V on the chest
  }

  /* ------------------------------------------------------------ the two cards */
  const FACE = {
    visitor: ['VISITOR', 'Sign up or log in', INK.cyan],
    account: ['ACCOUNT', 'Logged in', INK.cyan],
    free: ['FREE', '7-day trial', INK.lime],
    paid: ['PAID', 'Elite or Diamond', INK.gold],
    opened: ['BROKER', 'Opened with our link', INK.lime],
    paidok: ['PAID', 'Receipt sent', INK.gold],
  };
  const DONE = new Set(['account', 'opened', 'paidok']);
  const faces = {};
  for (const [name, [title, line, color]] of Object.entries(FACE)) {
    faces[name] = painted(256, 344, (ctx, w, h) => {
      fillFrame(ctx, 3, 3, w - 6, h - 6, INK.panel, color, 26);
      ctx.fillStyle = color;
      ctx.fillRect(6, 6, w - 12, 12);
      write(ctx, title, w / 2, 96, title.length > 6 ? 40 : 52, color, 800, DISPLAY, 'center');
      if (DONE.has(name)) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(w / 2, 180, 44, 0, TAU);
        ctx.stroke();
        tick(ctx, w / 2, 180, 46, color);
      } else {
        // a simple figure for "a person", or the price tag of the offer
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(w / 2, 158, 26, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(w / 2, 236, 50, Math.PI, 0);
        ctx.fill();
      }
      ctx.font = `600 26px ${MONO}`;
      const words = line.split(' ');
      const rows = ctx.measureText(line).width > w - 28 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [line];
      rows.forEach((row, i) => write(ctx, row, w / 2, 288 + i * 30 - (rows.length - 1) * 16, 26, INK.text, 600, MONO, 'center'));
    });
  }
  const fileLabel = painted(256, 176, (ctx, w, h) => {
    fillFrame(ctx, 3, 3, w - 6, h - 6, INK.panel, INK.lime, 24);
    write(ctx, '.ex5', w / 2, 94, 72, INK.lime, 800, DISPLAY, 'center');
    write(ctx, 'BOT FILE', w / 2, 144, 32, INK.text, 700, DISPLAY, 'center');
  });
  const travellers = ['free', 'paid'].map((laneName, i) => {
    const lane = LANE[laneName];
    const group = new THREE.Group();
    machine.add(group);
    const card = new THREE.Group();
    group.add(card);
    const back = new THREE.Mesh(blockGeo(0.52, 0.7, 0.035, 0), MAT.dark);
    back.position.y = -0.35;
    card.add(back);
    const front = {};
    for (const name of Object.keys(FACE)) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.672), new THREE.MeshBasicMaterial({ map: faces[name].texture, toneMapped: false, transparent: true, side: THREE.DoubleSide }));
      mesh.position.z = 0.02;
      mesh.visible = false;
      card.add(mesh);
      front[name] = mesh;
    }
    // after the Telegram bot the card is the bot file: a chunkier block
    const file = new THREE.Group();
    group.add(file);
    const fileBody = new THREE.Mesh(blockGeo(0.56, 0.38, 0.12, 0.05), MAT.hi);
    fileBody.position.y = -0.19;
    file.add(fileBody);
    file.add(new THREE.LineSegments(edgesOf(blockGeo(0.56, 0.38, 0.12, 0.05)), LINE.lime).translateY(-0.19));
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.344), new THREE.MeshBasicMaterial({ map: fileLabel.texture, toneMapped: false, transparent: true }));
    label.position.z = 0.065;
    file.add(label);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.325, 40), new THREE.MeshBasicMaterial({ color: lane.color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    return { name: laneName, lane, group, card, front, file, ring, shown: '', offset: i * 0.5, phase: 0, step: 0, position: new THREE.Vector3() };
  });

  /* ------------------------------------------------------------ one journey */
  // A journey is one lap, 0..1. The numbers are where each part of it ends.
  const LAP = 24; // seconds
  const T = { gate: 0.08, login: 0.115, fork: 0.2, choose: 0.24, stop: 0.38, settle: 0.435, tower: 0.56, enter: 0.6, checks: 0.68, out: 0.7, ride: 0.84, plug: 0.9, run: 0.975 };
  const ease = (x) => x * x * (3 - 2 * x);
  const part = (phase, from, to) => Math.min(1, Math.max(0, (phase - from) / (to - from)));
  const mix = (a, b, x) => a + (b - a) * x;
  function move(traveller, time) {
    const phase = (time / LAP + traveller.offset) % 1;
    const { lane, group, card, file } = traveller;
    const at = lane.at;
    let face = 'visitor', isFile = false, size = 1, step = 0, push = 0;
    if (phase < T.gate) {
      lane.curve.getPointAt(mix(0, at.gate, ease(part(phase, 0, T.gate))), group.position);
      size = Math.min(1, phase / 0.02);
    } else if (phase < T.login) {
      lane.curve.getPointAt(at.gate, group.position);
      face = phase > mix(T.gate, T.login, 0.45) ? 'account' : 'visitor';
    } else if (phase < T.fork) {
      lane.curve.getPointAt(mix(at.gate, at.fork, ease(part(phase, T.login, T.fork))), group.position);
      face = 'account';
      step = 1;
    } else if (phase < T.choose) {
      lane.curve.getPointAt(at.fork, group.position);
      face = phase > mix(T.fork, T.choose, 0.45) ? traveller.name : 'account';
      step = 1;
    } else if (phase < T.stop) {
      lane.curve.getPointAt(mix(at.fork, at.stop, ease(part(phase, T.choose, T.stop))), group.position);
      face = traveller.name;
      step = 1;
    } else if (phase < T.settle) {
      lane.curve.getPointAt(at.stop, group.position);
      face = phase > mix(T.stop, T.settle, 0.45) ? (traveller.name === 'free' ? 'opened' : 'paidok') : traveller.name;
      step = 1;
    } else if (phase < T.tower) {
      lane.curve.getPointAt(mix(at.stop, 1, ease(part(phase, T.settle, T.tower))), group.position);
      face = traveller.name === 'free' ? 'opened' : 'paidok';
      step = 2;
    } else if (phase < T.enter) {
      // into the Telegram bot
      const x = ease(part(phase, T.tower, T.enter));
      group.position.copy(TOWER);
      push = -0.34 * x;
      size = 1 - x;
      face = traveller.name === 'free' ? 'opened' : 'paidok';
      step = 2;
    } else if (phase < T.checks) {
      group.position.copy(TOWER);
      size = 0;
      step = 2;
    } else if (phase < T.out) {
      group.position.copy(CHUTE);
      isFile = true;
      size = ease(part(phase, T.checks, T.out));
      step = 2;
    } else if (phase < T.ride) {
      lastLeg.getPointAt(ease(part(phase, T.out, T.ride)), group.position);
      isFile = true;
      step = 3;
    } else if (phase < T.plug) {
      // into the computer
      const x = ease(part(phase, T.ride, T.plug));
      group.position.copy(SLOT);
      push = -0.42 * x;
      group.position.y = mix(HOVER, 0.6, x); // the height of the slot
      size = mix(1, 0.6, x);
      isFile = true;
      step = 3;
    } else {
      group.position.copy(SLOT);
      size = 0;
      step = 3;
    }
    group.position.z += push;
    if (size > 0 && phase < T.ride) group.position.y += Math.sin(time * 2.2 + traveller.offset * 9) * 0.035;
    traveller.position.copy(group.position);
    traveller.phase = phase;
    traveller.step = step;
    group.visible = size > 0.01;
    group.scale.setScalar(Math.max(0.001, size));
    card.visible = !isFile;
    file.visible = isFile;
    const wanted = isFile ? 'file' : face;
    if (traveller.shown !== wanted) {
      for (const [name, mesh] of Object.entries(traveller.front)) mesh.visible = name === wanted;
      traveller.shown = wanted;
    }
    traveller.ring.position.y = (0.045 - group.position.y) / Math.max(0.001, size); // the ring stays on the plate
  }

  // What the stations do while a card is with them.
  function react(time, dt) {
    const within = (traveller, from, to) => traveller.phase >= from && traveller.phase < to;
    const any = (from, to, name) => travellers.some((traveller) => (!name || traveller.name === name) && within(traveller, from, to));
    login.gate.level = any(T.gate, T.login) ? 1 : 0;
    const welcomed = any(mix(T.gate, T.login, 0.45), T.login + 0.02);
    if (welcomed !== login.welcomed) {
      login.welcomed = welcomed;
      loginScreen.redraw(welcomed);
    }
    // the pointer swings to the lane of the card that is choosing, or of the next one to arrive
    const choosing = travellers.find((traveller) => within(traveller, T.login, T.stop)) || travellers.find((traveller) => traveller.phase < T.login);
    const aim = !choosing ? 0 : choosing.name === 'free' ? -0.95 : 0.95;
    offer.spinner.rotation.y += (-aim - offer.spinner.rotation.y) * Math.min(1, dt * 4);
    offer.pointer.material.color.setHex(!choosing ? HEX.cyan : choosing.name === 'free' ? HEX.lime : HEX.gold);
    offer.pointer.material.emissive.copy(offer.pointer.material.color);
    offer.freeLamp.level = any(T.choose, T.settle, 'free') ? 1 : 0;
    offer.paidLamp.level = any(T.choose, T.settle, 'paid') ? 1 : 0;
    const opened = any(mix(T.stop, T.settle, 0.45), T.tower, 'free');
    if (opened !== offer.broker.ok) {
      offer.broker.ok = opened;
      brokerScreen.redraw(opened);
    }
    const paid = any(mix(T.stop, T.settle, 0.45), T.tower, 'paid');
    if (paid !== offer.receiptPaid.ok) {
      offer.receiptPaid.ok = paid;
      receiptPicture.redraw(paid);
    }
    // the receipt rises out of the printer while a Paid card is at the stand
    const printing = travellers.find((traveller) => traveller.name === 'paid' && within(traveller, T.stop, T.tower));
    const rise = printing ? ease(part(printing.phase, T.stop, T.settle)) : 0;
    offer.receipt.position.y = mix(0.3, 1.0, rise);
    offer.receipt.visible = rise > 0.02;
    // the Telegram bot ticks its checks one by one, then shows the file
    const inside = travellers.find((traveller) => within(traveller, T.enter, T.out));
    const done = inside ? Math.min(3, Math.floor(part(inside.phase, T.enter, T.checks) * 3.6)) + (inside.phase > T.checks ? 1 : 0) : 4;
    if (done !== telegram.chat.done) {
      telegram.chat.done = done;
      chatScreen.redraw(done);
    }
    telegram.slot.level = any(T.tower, T.out) ? 1 : 0;
    telegram.antenna.level = 0.5 + 0.5 * Math.sin(time * 5);
    telegram.badge.rotation.y = camera.userData.side || 0;
    telegram.badge.position.y = 2.72 + Math.sin(time * 1.6) * 0.04;
    mt5.power.level = any(T.ride, T.run) ? 1 : 0.15;
    mt5.robot.rotation.y = -0.3 + Math.sin(time * 0.7) * 0.22; // it looks from the chart to the visitor and back
    mt5.robot.position.y = 0.12 + Math.abs(Math.sin(time * 1.3)) * 0.02;
    for (const entry of stations) for (const light of entry.lamps) light.material.emissiveIntensity += (light.rest + light.level * 2.4 - light.material.emissiveIntensity) * Math.min(1, dt * 8);
  }

  /* ------------------------------------------------------------ labels over the scene */
  const tags = [
    { words: 'Log in', number: '01', at: new THREE.Vector3(-4.7, 2.75, 0.0), step: 0 },
    { words: 'Choose offer', number: '02', at: new THREE.Vector3(-1.95, 2.95, -0.1), step: 1 },
    { words: 'Broker account', lane: 'free', at: new THREE.Vector3(0.1, 2.75, -2.24), step: 1 },
    { words: 'Payment', lane: 'paid', at: new THREE.Vector3(0.65, 2.05, 1.2), step: 1 },
    { words: 'Telegram bot', number: '03', at: new THREE.Vector3(2.9, 3.25, 0.0), step: 2 },
    { words: 'MT5', number: '04', at: new THREE.Vector3(5.35, 2.75, -0.1), step: 3 },
  ];
  for (const tag of tags) {
    const el = document.createElement('span');
    el.className = 'path3d-tag' + (tag.lane ? ` path3d-tag--${tag.lane}` : '');
    if (tag.number) {
      const number = document.createElement('b');
      number.textContent = tag.number;
      el.append(number);
    } else {
      const lane = document.createElement('b');
      lane.textContent = tag.lane === 'free' ? 'FREE' : 'PAID';
      el.append(lane);
    }
    el.append(tag.words);
    el.style.opacity = '0'; // not shown before it has a place
    labelLayer.append(el);
    tag.el = el;
  }
  const projected = new THREE.Vector3();
  const captionBox = { right: 0, bottom: 0 };
  // how big the tags and the caption are on the page: measured when the stage or the caption changes
  function measureTags() {
    for (const tag of tags) {
      tag.w = tag.el.offsetWidth;
      tag.h = tag.el.offsetHeight;
    }
    captionBox.right = caption.hidden ? 0 : caption.offsetLeft + caption.offsetWidth;
    captionBox.bottom = caption.hidden ? 0 : caption.offsetTop + caption.offsetHeight;
  }
  function placeTags() {
    for (const tag of tags) {
      projected.copy(tag.at).project(camera);
      // the two lane tags would crowd the whole view: they show while the offer step is on.
      // Close up on a phone a tag would cover what it names, and the caption says the step already.
      const wanted = narrow && mode !== 'all' ? false : !tag.lane || activeStep === 1;
      const seen = wanted && projected.z < 1 && Math.abs(projected.x) < 1 && projected.y > -1.1 && projected.y < 1.3;
      tag.el.style.opacity = seen ? '' : '0';
      if (!seen) continue;
      // a tag stays whole inside the stage, under the "drag to turn" hint and off the caption
      const half = tag.w / 2 + 8;
      const x = Math.min(Math.max(((projected.x + 1) / 2) * width, half), width - half);
      const top = x - half < captionBox.right ? captionBox.bottom + 6 : narrow ? 8 : 34;
      const y = Math.max(((1 - projected.y) / 2) * height, top + tag.h);
      tag.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      tag.el.classList.toggle('is-on', tag.step === activeStep);
    }
  }

  /* ------------------------------------------------------------ camera */
  // The camera circles a point: `side` is the angle around it, `lift` the angle down from straight above.
  const view = { target: new THREE.Vector3(0, 0.55, 0.3), side: 0.42, lift: 1.02, distance: 20 };
  const goal = { target: new THREE.Vector3(0, 0.55, 0.3), side: 0.42, lift: 1.02, distance: 20 };
  let width = 1, height = 1, narrow = false, fitDistance = 20, wide = 1, lens = 1, rideStep = -1, turned = 0;
  let mode = 'all'; // all | free | paid | a step number
  let activeStep = -1, playing = !reduceMotion, clock = reduceMotion ? LAP * 0.395 : 0, sway = 0, dragging = false, held = 0;
  let ratio = 0; // the pixel ratio a slow device was brought down to (0: never)
  function frameSize() {
    width = holder.clientWidth;
    height = holder.clientHeight;
    if (!width || !height) return false;
    narrow = width < 700;
    // a phone's stage is small, so it can be drawn at more of the screen's own sharpness
    const sharpest = Math.min(devicePixelRatio || 1, narrow ? 2.5 : 1.75);
    renderer.setPixelRatio(ratio ? Math.min(ratio, sharpest) : sharpest);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    lens = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    fitDistance = Math.max(14.8 / (lens * camera.aspect * 0.92), 6.5 / (lens * 0.9));
    wide = Math.max(1, 1.25 / camera.aspect); // on an upright stage a station needs more room
    measureTags();
    return true;
  }
  // How far the camera stands so that `span` (across) and `rise` (up) both fit the stage.
  const fit = (span, rise) => Math.max(span / (lens * camera.aspect), rise / lens);
  const CLOSE_LIFT = 1.14;
  function aim() {
    rideStep = -1;
    turned = 0;
    if (typeof mode === 'number') {
      const { focus, close } = stations[mode];
      if (narrow) {
        goal.target.fromArray(close.target);
        goal.distance = fit(close.span, close.rise);
        goal.side = close.side;
        goal.lift = CLOSE_LIFT;
      } else {
        goal.target.fromArray(focus.target);
        goal.distance = focus.distance * wide;
        goal.side = focus.side;
        goal.lift = 1.08;
      }
    } else if (mode === 'all') {
      goal.target.set(0, 0.55, 0.3);
      goal.distance = fitDistance;
      goal.side = 0.42;
      goal.lift = narrow ? 0.74 : 1.02;
    } else if (!narrow) {
      goal.distance = 8.4 * wide;
      goal.lift = 1.06;
      goal.side = 0.36;
    }
  }
  // On a phone the camera rides close beside the followed card, so the screens can be read:
  // it stays with the card on the way, and turns to the station as the card arrives.
  function rideClose(followed) {
    const { close } = stations[followed.step];
    const at = followed.position;
    if (followed.step !== rideStep) {
      rideStep = followed.step;
      turned = 0;
      goal.side = close.side;
      goal.lift = CLOSE_LIFT;
    }
    if (followed.step === 1) {
      // First the board of this card's own offer. When the card leaves the fork, the place its lane
      // leads to: the brokers' sign (Free) or the QR code (Paid). The card then arrives in that view.
      // Each is watched from the side where the QR stand, in the middle of the plate, is not in the way.
      const free = followed.name === 'free', stop = followed.lane.stop;
      const board = 1 - Math.min(1, Math.max(0, (at.x - FORK.x) / 0.7));
      goal.target.set(mix(stop.x, at.x + (free ? -0.86 : 0.94), board), close.target[1], mix(stop.z - (free ? 0.85 : 0.6), at.z - 0.6, board));
      goal.side = (free ? 0.42 : mix(0.14, -0.4, board)) + turned;
      goal.distance = fit(2.6, close.rise);
      return;
    }
    const pull = Math.min(1, Math.max(0.15, (at.distanceTo(close.stop) - 0.4) / 1.6));
    goal.target.set(mix(close.target[0], at.x, pull), close.target[1], mix(close.target[2], at.z - 0.6, pull));
    goal.distance = fit(close.span, close.rise);
  }
  function placeCamera(dt) {
    if (mode === 'free' || mode === 'paid') {
      const followed = travellers.find((traveller) => traveller.name === mode);
      if (narrow) rideClose(followed);
      else goal.target.set(followed.position.x, 0.8, followed.position.z * 0.55 + 0.35);
    }
    const speed = dt < 0 ? 1 : 1 - Math.exp(-dt * 3.2);
    view.target.lerp(goal.target, speed);
    view.distance += (goal.distance - view.distance) * speed;
    view.lift += (goal.lift - view.lift) * speed;
    // a slow sway in the whole view, so the machine is never quite still
    const drift = mode === 'all' && playing && !dragging && performance.now() - held > 4000 ? Math.sin(sway * 0.16) * 0.24 : 0;
    view.side += (goal.side + drift - view.side) * speed;
    const flat = Math.sin(view.lift) * view.distance;
    camera.position.set(view.target.x + Math.sin(view.side) * flat, view.target.y + Math.cos(view.lift) * view.distance, view.target.z + Math.cos(view.side) * flat);
    camera.lookAt(view.target);
    camera.userData.side = view.side;
  }

  /* ------------------------------------------------------------ what the page shows */
  const STEP_TITLES = ['Log in on the website', 'Choose one offer', 'Verify in Telegram and get your bot file', 'Set up MT5 and the bot'];
  // One plain line under the title: what happens here. At step 2 the Free and the Paid journey differ.
  const STEP_NOTES = [
    { all: 'Create your account, or log in.' },
    { all: 'Free with our broker link, or Paid by KHQR.', free: 'Free: open a broker account with our link.', paid: 'Paid: pay by KHQR, then send your receipt.' },
    { all: 'The bot checks you, then sends your bot file.' },
    { all: 'Put the file into MT5 and start the bot.' },
  ];
  let captionKey = '';
  function showStep(step) {
    const lane = mode === 'free' || mode === 'paid' ? mode : 'all';
    if (captionKey === step + lane) return;
    captionKey = step + lane;
    activeStep = step;
    cards.forEach((card, i) => card.classList.toggle('is-on', i === step));
    if (step < 0) {
      caption.hidden = true;
      measureTags();
      return;
    }
    caption.hidden = false;
    caption.textContent = '';
    const number = document.createElement('b');
    number.textContent = `Step ${step + 1} of 4`;
    const note = document.createElement('small');
    note.textContent = STEP_NOTES[step][lane] || STEP_NOTES[step].all;
    caption.append(number, STEP_TITLES[step], note);
    measureTags();
  }
  function setMode(next) {
    mode = next;
    held = 0;
    aim();
    viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === String(mode))));
    if (typeof mode === 'number') showStep(mode);
    else if (mode === 'all') showStep(-1);
  }
  function setPlaying(next) {
    playing = next;
    playButton.setAttribute('aria-pressed', String(!playing));
    playButton.setAttribute('aria-label', playing ? 'Pause the animation' : 'Play the animation');
    playButton.classList.toggle('is-paused', !playing);
  }
  viewButtons.forEach((button) => button.addEventListener('click', () => {
    setMode(button.dataset.view);
    if (button.dataset.view !== 'all') setPlaying(true);
  }));
  playButton.addEventListener('click', () => setPlaying(!playing));
  cards.forEach((card, i) => {
    // each step card becomes a button that turns the camera to its station
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'path3d-go';
    go.setAttribute('aria-label', `Show step ${i + 1} in the 3D view: ${STEP_TITLES[i]}`);
    go.addEventListener('click', () => {
      setMode(i);
      stage.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    card.append(go);
  });

  /* ------------------------------------------------------------ pointer */
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  ray.params.Line.threshold = 0.03; // an outline is hit only when it is really under the pointer
  function stationUnder(event) {
    const box = holder.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(stations.map((entry) => entry.group), true)[0];
    if (!hit) return null;
    let object = hit.object;
    while (object && object.userData.step === undefined) object = object.parent;
    return object ? stations[object.userData.step] : null;
  }
  let downX = 0, downY = 0, moved = false, lastX = 0, lastY = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = false;
    downX = lastX = event.clientX;
    downY = lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragging) {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) moved = true;
      goal.side -= (event.clientX - lastX) * 0.006;
      turned -= (event.clientX - lastX) * 0.006;
      goal.lift = Math.min(1.36, Math.max(0.5, goal.lift - (event.clientY - lastY) * 0.004));
      lastX = event.clientX;
      lastY = event.clientY;
      held = performance.now();
      return;
    }
    if (event.pointerType !== 'mouse') return;
    const over = stationUnder(event);
    canvas.style.cursor = over ? 'pointer' : 'grab';
    canvas.title = over ? `Step ${over.index + 1}: ${STEP_TITLES[over.index]}` : '';
  });
  const release = (event) => {
    if (!dragging) return;
    dragging = false;
    held = performance.now();
    if (moved || event.type === 'pointercancel') return;
    const over = stationUnder(event);
    if (over) setMode(over.index);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  /* ------------------------------------------------------------ run */
  let seen = true, lost = false, last = performance.now(), chartAt = 0, frames = 0, measured = 0;
  new IntersectionObserver((entries) => {
    seen = entries[0].isIntersecting;
    last = performance.now();
  }, { threshold: 0.02 }).observe(stage);
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
  });
  new ResizeObserver(() => {
    if (frameSize()) aim();
  }).observe(holder);

  function frameLoop(now) {
    requestAnimationFrame(frameLoop);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!seen || lost || document.hidden || !width) return;
    if (playing) {
      clock += dt;
      sway += dt;
    }
    for (const traveller of travellers) move(traveller, clock);
    react(clock, dt);
    runSparks(clock);
    // while a journey is followed, the page shows the step that journey is at
    if (mode === 'free' || mode === 'paid') showStep(travellers.find((traveller) => traveller.name === mode).step);
    for (const traveller of travellers) {
      traveller.group.rotation.y = view.side;
      traveller.ring.material.opacity = mode === traveller.name ? 1 : 0.55;
    }
    if (playing && clock - chartAt > 0.7) {
      chartAt = clock;
      candles.shift();
      candles.push(nextCandle());
      chartScreen.redraw(true);
    }
    placeCamera(dt);
    placeTags();
    renderer.render(scene, camera);
    // On a slow device, draw fewer pixels. The scene itself stays the same.
    frames++;
    measured += dt;
    if (measured > 4) {
      const least = narrow ? 1.5 : 1; // under this the screens of the machine could not be read on a phone
      const current = renderer.getPixelRatio();
      if (frames / measured < 40 && current > least) {
        ratio = Math.max(least, current - 0.25);
        renderer.setPixelRatio(ratio);
        renderer.setSize(width, height, false);
      }
      frames = 0;
      measured = 0;
    }
  }

  frameSize();
  setMode(narrow ? 'free' : 'all'); // a phone starts close, riding with the Free card; "Path" shows the whole machine
  setPlaying(playing);
  view.target.copy(goal.target);
  view.side = goal.side;
  view.lift = goal.lift;
  view.distance = goal.distance * 1.25; // a short move in, the first time
  for (const traveller of travellers) move(traveller, clock);
  placeCamera(-1);
  view.distance = goal.distance * 1.25;
  root.classList.add('is-3d');
  requestAnimationFrame(frameLoop);

  // For checks from the browser console and automated tests; not used by the page.
  window.__path3d = {
    setMode: (next) => setMode(/^\d$/.test(String(next)) ? Number(next) : next),
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    seek: (seconds) => {
      clock = seconds;
    },
    settle: () => {
      for (const traveller of travellers) move(traveller, clock);
      placeCamera(-1);
    },
    state: () => ({ mode, playing, clock, activeStep, width, height, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, travellers: travellers.map((traveller) => ({ lane: traveller.name, step: traveller.step, face: traveller.shown, phase: Number(traveller.phase.toFixed(3)) })) }),
  };
}
