import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CameraPreset, SceneObject, SceneSpec, Verification, Vec3 } from '../shared/types';

export interface ViewerHandle {
  capture: () => string;
  view: (id: string) => void;
  walk: () => void;
}
interface Props {
  scene: SceneSpec;
  modelUrl: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  verification: Verification | null;
  showRoute: boolean;
}
const vec = (p: Vec3) => new THREE.Vector3(p[0], p[2], -p[1]);
const material = (color: string, roughness = 0.8, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function rounded(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  r = 0.05,
) {
  r = Math.min(r, w / 3, d / 3, h / 3);
  const s = new THREE.Shape();
  const a = -w / 2,
    b = -d / 2;
  s.moveTo(a + r, b);
  s.lineTo(a + w - r, b);
  s.quadraticCurveTo(a + w, b, a + w, b + r);
  s.lineTo(a + w, b + d - r);
  s.quadraticCurveTo(a + w, b + d, a + w - r, b + d);
  s.lineTo(a + r, b + d);
  s.quadraticCurveTo(a, b + d, a, b + d - r);
  s.lineTo(a, b + r);
  s.quadraticCurveTo(a, b, a + r, b);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, h - 2 * r),
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: r,
    bevelThickness: r,
    curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -h / 2 + r, 0);
  g.computeBoundingBox();
  const bounds = g.boundingBox!;
  const extent = new THREE.Vector3(),
    center = new THREE.Vector3();
  bounds.getSize(extent);
  bounds.getCenter(center);
  g.translate(-center.x, -center.y, -center.z);
  g.scale(w / extent.x, h / extent.y, d / extent.z);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cylinder(
  parent: THREE.Object3D,
  r1: number,
  r2: number,
  h: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 14), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function furnishing(o: SceneObject) {
  const g = new THREE.Group();
  g.name = o.id;
  g.userData.objectId = o.id;
  g.position.copy(vec(o.position));
  g.rotation.y = o.rotation + (['sofa', 'desk', 'chair'].includes(o.kind) ? Math.PI : 0);
  const [w, d, h] = o.dimensions;
  g.position.y -= h / 2;
  const m = material(o.color),
    wood = material('#a78560'),
    dark = material('#3a3a32', 0.55, 0.25),
    cream = material('#f0e8d8');
  if (o.kind === 'sofa') {
    rounded(g, w - 0.12, 0.23, d - 0.1, 0, 0.24, 0, m);
    rounded(g, w, 0.4, 0.19, 0, h - 0.2, d / 2 - 0.12, m);
    const arms = 0.16;
    for (const x of [-w / 2 + arms / 2, w / 2 - arms / 2])
      rounded(g, arms, h - 0.2, d, x, (h + 0.2) / 2, 0, m);
    const seats = w > 1.9 ? 3 : 2;
    for (let i = 0; i < seats; i++) {
      const sw = (w - 2 * arms - 0.05) / seats;
      rounded(g, sw - 0.02, 0.17, d - 0.26, -w / 2 + arms + 0.025 + sw * (i + 0.5), 0.43, -0.07, m);
      rounded(
        g,
        sw - 0.035,
        0.34,
        0.16,
        -w / 2 + arms + 0.025 + sw * (i + 0.5),
        0.66,
        d / 2 - 0.23,
        m,
      );
    }
    for (const x of [-w / 2 + 0.16, w / 2 - 0.16])
      for (const z of [-d / 2 + 0.15, d / 2 - 0.15])
        cylinder(g, 0.025, 0.021, 0.15, x, 0.075, z, wood);
    rounded(g, 0.31, 0.32, 0.12, -w / 2 + 0.4, 0.64, d / 2 - 0.34, cream, 0.04).rotation.z = 0.16;
  } else if (o.kind === 'desk' || o.kind === 'table') {
    rounded(g, w, 0.055, d, 0, h - 0.035, 0, m, 0.025);
    for (const x of [-w / 2 + 0.1, w / 2 - 0.1])
      for (const z of [-d / 2 + 0.1, d / 2 - 0.1])
        box(g, 0.045, h - 0.07, 0.045, x, (h - 0.07) / 2, z, dark);
  } else if (o.kind === 'chair') {
    rounded(g, w, 0.08, d - 0.04, 0, h * 0.48, 0, m);
    rounded(g, w - 0.02, h * 0.4, 0.08, 0, h * 0.78, d / 2 - 0.05, m);
    for (const x of [-w / 2 + 0.07, w / 2 - 0.07])
      for (const z of [-d / 2 + 0.07, d / 2 - 0.07])
        cylinder(g, 0.018, 0.014, h * 0.45, x, h * 0.225, z, wood);
  } else if (o.kind === 'rug') {
    rounded(g, w, h, d, 0, h / 2, 0, m, 0.008);
    const border = material(new THREE.Color(o.color).multiplyScalar(0.83).getStyle());
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06])
      box(g, 0.018, 0.002, d - 0.12, x, h - 0.001, 0, border);
  } else if (o.kind === 'plant') {
    cylinder(g, w * 0.28, w * 0.21, h * 0.28, 0, h * 0.14, 0, material('#d7c9b6'));
    cylinder(g, 0.012, 0.018, h * 0.6, 0, h * 0.5, 0, wood);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4,
        y = h * (0.34 + i * 0.062);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 6),
        material(new THREE.Color(o.color).multiplyScalar(i % 2 ? 0.9 : 1.08).getStyle()),
      );
      mesh.scale.set(w * 0.17, h * 0.13, 0.035);
      mesh.position.set(Math.cos(a) * w * 0.15, y, Math.sin(a) * w * 0.15);
      mesh.rotation.set(0.5, a, -0.5);
      mesh.castShadow = true;
      g.add(mesh);
    }
  } else if (o.kind === 'shelf') {
    for (const x of [-w / 2 + 0.035, w / 2 - 0.035]) box(g, 0.07, h, d, x, h / 2, 0, m);
    for (let i = 0; i < 4; i++) box(g, w, 0.045, d, 0, 0.08 + (i * (h - 0.12)) / 3, 0, m);
    for (let i = 0; i < 7; i++)
      box(
        g,
        0.06,
        0.24 + Math.sin(i) * 0.04,
        d * 0.6,
        -w * 0.35 + i * 0.08,
        h * 0.38,
        0,
        material(['#9b7060', '#d3ccb7', '#687d6b'][i % 3]),
      );
  } else {
    box(g, w, h, d, 0, h / 2, 0, m);
    if (o.kind === 'counter') {
      box(g, w + 0.025, 0.045, d + 0.04, 0, h + 0.022, 0, material('#d8d5c9'));
      for (let i = 0; i < Math.max(1, Math.round(w / 0.55)); i++)
        box(
          g,
          0.1,
          0.014,
          0.025,
          -w / 2 + ((i + 0.5) * w) / Math.max(1, Math.round(w / 0.55)),
          h - 0.12,
          -d / 2 - 0.02,
          dark,
        );
    }
  }
  g.traverse((c) => {
    c.userData.objectId = o.id;
  });
  return g;
}
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const a = c.getContext('2d')!;
  a.fillStyle = '#b58d61';
  a.fillRect(0, 0, 512, 512);
  let seed = 31;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 8; i++) {
    a.fillStyle = `rgba(${110 + rand() * 60},${75 + rand() * 35},${40 + rand() * 20},.23)`;
    a.fillRect(i * 64, 0, 64, 512);
    a.strokeStyle = 'rgba(65,40,20,.17)';
    a.lineWidth = 1;
    a.beginPath();
    a.moveTo(i * 64, 0);
    a.lineTo(i * 64, 512);
    a.stroke();
    for (let k = 0; k < 22; k++) {
      a.strokeStyle = `rgba(65,40,20,${rand() * 0.09})`;
      a.beginPath();
      let x = i * 64 + rand() * 64;
      a.moveTo(x, 0);
      a.bezierCurveTo(x + rand() * 5, 150, x - rand() * 5, 300, x, 512);
      a.stroke();
    }
    a.beginPath();
    const y = (i % 3) * 160 + 30;
    a.moveTo(i * 64, y);
    a.lineTo((i + 1) * 64, y);
    a.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  return t;
}
function architecture(scene: SceneSpec) {
  const g = new THREE.Group();
  const floor = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.65 });
  for (const r of scene.rooms) {
    const shape = new THREE.Shape();
    r.polygon.forEach((p, i) => (i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])));
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, floor);
    mesh.position.y = r.floorZ;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  for (const w of scene.walls) {
    const length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
    const wall = new THREE.Group();
    wall.position.copy(vec([w.start[0], w.start[1], 0]));
    wall.rotation.y = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]);
    wall.userData = { sceneId: w.id, role: 'wall' };
    const mat = material(w.color);
    const openings = [...w.openings].sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    const segment = (x: number, width: number, base: number, height: number) => {
      if (width > 0.001 && height > 0.001)
        box(wall, width, height, w.thickness, x + width / 2, base + height / 2, 0, mat);
    };
    for (const o of openings) {
      const start = o.offset - o.width / 2;
      segment(cursor, start - cursor, 0, w.height);
      segment(start, o.width, 0, o.bottom);
      segment(start, o.width, o.bottom + o.height, w.height - o.bottom - o.height);
      if (o.type === 'window') {
        box(wall, o.width, 0.05, w.thickness + 0.06, o.offset, o.bottom, 0, material('#d9d6c9'));
        const glass = new THREE.MeshStandardMaterial({
          color: '#b9d9d2',
          transparent: true,
          opacity: 0.2,
          roughness: 0.15,
        });
        box(wall, o.width, o.height, 0.015, o.offset, o.bottom + o.height / 2, 0, glass);
        for (const x of [o.offset - o.width / 2, o.offset, o.offset + o.width / 2])
          box(wall, 0.035, o.height, 0.04, x, o.bottom + o.height / 2, 0, material('#514f44'));
      }
      cursor = o.offset + o.width / 2;
    }
    segment(cursor, length - cursor, 0, w.height);
    g.add(wall);
  }
  scene.objects.filter((o) => !o.movable).forEach((o) => g.add(furnishing(o)));
  for (const s of scene.stairs) {
    const stairs = new THREE.Group();
    stairs.position.copy(vec(s.position));
    stairs.rotation.y = s.rotation;
    const [w, d, h] = s.dimensions;
    stairs.position.y -= h / 2;
    for (let i = 0; i < s.steps; i++)
      box(
        stairs,
        w,
        0.07,
        d / s.steps,
        0,
        ((i + 1) * h) / s.steps,
        -d / 2 + ((i + 0.5) * d) / s.steps,
        material('#8c806a'),
      );
    for (const x of [-w / 2, w / 2]) {
      for (let i = 0; i <= s.steps; i += 2)
        cylinder(
          stairs,
          0.016,
          0.016,
          0.9,
          x,
          (i * h) / s.steps + 0.45,
          -d / 2 + (i * d) / s.steps,
          material('#444840'),
        );
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.023, 0.023, Math.hypot(d, h), 10),
        material('#444840'),
      );
      rail.position.set(x, h / 2 + 0.9, 0);
      rail.rotation.x = Math.atan2(d, h);
      stairs.add(rail);
    }
    g.add(stairs);
  }
  return g;
}
function disposeGroup(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
        m.dispose();
      });
    }
  });
  group.clear();
}
function architectureView(runtime: any, overview: boolean) {
  runtime.overview = overview;
  runtime.building.traverse((o: THREE.Object3D) => {
    const { role, sceneId } = o.userData;
    if (role === 'ceiling') o.visible = !overview;
    else if (role === 'wall' || role === 'wall-trim') {
      const front =
        sceneId === 'wall-west' ||
        sceneId === 'wall-entry' ||
        sceneId === 'wall-bath-bottom' ||
        sceneId === 'wall-bath-notch-y';
      o.visible = !(overview && front);
    }
  });
}

export const SceneViewer = forwardRef<ViewerHandle, Props>(function SceneViewer(
  { scene, modelUrl, selected, onSelect, verification, showRoute },
  ref,
) {
  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<any>(null),
    props = useRef({ scene, onSelect }),
    [failed, setFailed] = useState(false),
    [loaded, setLoaded] = useState(false);
  props.current = { scene, onSelect };
  const architectureKey = JSON.stringify([
      scene.id,
      scene.rooms,
      scene.walls,
      scene.stairs,
      scene.objects.filter((o) => !o.movable),
    ]),
    objectKey = JSON.stringify(scene.objects),
    routeKey = JSON.stringify(verification);
  useImperativeHandle(
    ref,
    () => ({
      capture: () => {
        const r = runtime.current;
        if (!r) return '';
        r.renderer.render(r.world, r.camera);
        return r.renderer.domElement.toDataURL('image/jpeg', 0.8);
      },
      view: (id) => {
        const r = runtime.current;
        if (!r) return;
        if (id === 'overview') {
          r.home();
          return;
        }
        const p = props.current.scene.cameras.find((c) => c.id === id);
        if (p) {
          r.goal = { position: vec(p.position), target: vec(p.target) };
          r.controls.maxPolarAngle = Math.PI * 0.94;
          r.camera.fov = 67.3;
          r.camera.updateProjectionMatrix();
          architectureView(r, false);
        } else r.home();
      },
      walk: () => {
        const r = runtime.current;
        if (r) r.walkStart = performance.now();
      },
    }),
    [],
  );
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    world.background = new THREE.Color('#e8e8df');
    world.fog = new THREE.Fog('#e8e8df', 27, 65);
    const camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.05,
      100,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 0.4;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(3, 0, -4);
    world.add(new THREE.HemisphereLight('#fcf6e8', '#a8b19e', 2.2));
    const sun = new THREE.DirectionalLight('#fff3da', 3.0);
    sun.position.set(-5, 12, -9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.normalBias = 0.025;
    sun.shadow.bias = -0.0002;
    world.add(sun);
    const fill = new THREE.DirectionalLight('#d9e7eb', 1.3);
    fill.position.set(8, 5, 7);
    world.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), material('#e5e6dc', 1));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.15;
    ground.receiveShadow = true;
    world.add(ground);
    const building = new THREE.Group(),
      objects = new THREE.Group(),
      routeGroup = new THREE.Group(),
      selection = new THREE.Group();
    world.add(building, objects, routeGroup, selection);
    const resident = new THREE.Group();
    cylinder(resident, 0.09, 0.1, 0.45, 0, 0.76, 0, material('#8b634d'));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), material('#c4a487'));
    head.position.y = 1.08;
    resident.add(head);
    for (const x of [-0.055, 0.055])
      cylinder(resident, 0.035, 0.03, 0.5, x, 0.26, 0, material('#454e45'));
    resident.visible = false;
    world.add(resident);
    const home = () => {
      const pts = props.current.scene.rooms.flatMap((r) => r.polygon);
      const minX = Math.min(...pts.map((p) => p[0])),
        maxX = Math.max(...pts.map((p) => p[0])),
        minY = Math.min(...pts.map((p) => p[1])),
        maxY = Math.max(...pts.map((p) => p[1]));
      const cx = (minX + maxX) / 2,
        cy = (minY + maxY) / 2,
        size = Math.max(maxX - minX, maxY - minY);
      runtime.current.goal = {
        position: new THREE.Vector3(cx - size * 0.75, size * 0.91, -cy + size * 0.75),
        target: new THREE.Vector3(cx, 0.6, -cy),
      };
      controls.maxPolarAngle = Math.PI * 0.49;
      camera.fov = 42;
      camera.updateProjectionMatrix();
      architectureView(runtime.current, true);
    };
    runtime.current = {
      renderer,
      world,
      camera,
      controls,
      building,
      objects,
      routeGroup,
      selection,
      resident,
      home,
      goal: null,
      walkStart: null,
      walkPoints: [],
    };
    home();
    camera.position.copy(runtime.current.goal.position);
    controls.target.copy(runtime.current.goal.target);
    runtime.current.goal = null;
    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let down = [0, 0];
    const start = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
      runtime.current.goal = null;
    };
    const end = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      const hits = ray.intersectObjects(objects.children, true);
      props.current.onSelect(hits[0]?.object.userData.objectId || null);
    };
    renderer.domElement.addEventListener('pointerdown', start);
    renderer.domElement.addEventListener('pointerup', end);
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const moves: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        w: [0, -1],
        ArrowDown: [0, 1],
        s: [0, 1],
        ArrowLeft: [-1, 0],
        a: [-1, 0],
        ArrowRight: [1, 0],
        d: [1, 0],
      };
      if (!moves[e.key]) return;
      e.preventDefault();
      runtime.current.goal = null;
      const [x, z] = moves[e.key],
        forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
      const shift = forward.multiplyScalar(-z * 0.24).add(right.multiplyScalar(x * 0.24));
      camera.position.add(shift);
      controls.target.add(shift);
    };
    container.addEventListener('keydown', key);
    const observer = new ResizeObserver(() => {
      const w = container.clientWidth,
        h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    observer.observe(container);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const r = runtime.current;
      if (!r) return;
      if (r.goal) {
        camera.position.lerp(r.goal.position, 0.09);
        controls.target.lerp(r.goal.target, 0.09);
        if (camera.position.distanceTo(r.goal.position) < 0.01) r.goal = null;
      }
      if (r.walkStart && r.walkPoints.length > 1) {
        const progress = (performance.now() - r.walkStart) / 7000;
        resident.visible = progress < 1;
        const step = Math.min(r.walkPoints.length - 1, progress * (r.walkPoints.length - 1)),
          i = Math.min(r.walkPoints.length - 2, Math.floor(step));
        resident.position.lerpVectors(r.walkPoints[i], r.walkPoints[i + 1], step - i);
        if (progress >= 1) r.walkStart = null;
      }
      controls.update();
      renderer.render(world, camera);
    };
    animate();
    (window as any).__l2lCapture = () => {
      renderer.render(world, camera);
      return renderer.domElement.toDataURL('image/jpeg', 0.8);
    };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', start);
      renderer.domElement.removeEventListener('pointerup', end);
      container.removeEventListener('keydown', key);
      controls.dispose();
      disposeGroup(world);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      runtime.current = null;
      delete (window as any).__l2lCapture;
    };
  }, []);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    let cancelled = false;
    setLoaded(false);
    disposeGroup(r.building);
    const fallback = architecture(scene);
    r.building.add(fallback);
    architectureView(r, r.overview);
    if (modelUrl) {
      new GLTFLoader().load(
        modelUrl,
        (gltf) => {
          if (cancelled) {
            disposeGroup(gltf.scene);
            return;
          }
          disposeGroup(r.building);
          gltf.scene.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          r.building.add(gltf.scene);
          architectureView(r, r.overview);
          setLoaded(true);
        },
        undefined,
        () => setLoaded(false),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [modelUrl, architectureKey]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    disposeGroup(r.objects);
    scene.objects.filter((o) => o.movable).forEach((o) => r.objects.add(furnishing(o)));
  }, [objectKey]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    disposeGroup(r.selection);
    const obj = scene.objects.find((o) => o.id === selected);
    if (obj) {
      const [w, d, h] = obj.dimensions;
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.06, h + 0.06, d + 0.06));
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: '#416e57', transparent: true, opacity: 0.8 }),
      );
      line.position.copy(vec(obj.position));
      line.rotation.y = obj.rotation;
      r.selection.add(line);
    }
  }, [selected, scene.objects]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    disposeGroup(r.routeGroup);
    r.walkPoints = [];
    if (!showRoute || !verification) return;
    verification.routes.forEach((route) => {
      if (route.points.length < 2) return;
      const points = route.points.map((p) => new THREE.Vector3(p[0], 0.055, -p[1]));
      const curve = new THREE.CatmullRomCurve3(points);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(12, points.length * 3), 0.026, 6, false),
        new THREE.MeshBasicMaterial({
          color: route.passed ? '#538466' : '#c77d53',
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        }),
      );
      tube.renderOrder = 5;
      r.routeGroup.add(tube);
      if (route.passed && points.length > r.walkPoints.length) r.walkPoints = points;
    });
  }, [routeKey, showRoute]);
  return (
    <div
      className="scene-host"
      ref={host}
      tabIndex={0}
      aria-label="Interactive 3D home. Drag to orbit, scroll to zoom, arrow keys to move."
    >
      {failed && (
        <div className="webgl-error">
          <strong>3D rendering is unavailable</strong>
          <p>
            Enable hardware acceleration in your browser. You can still explore the plan and edit
            furniture.
          </p>
        </div>
      )}
      <span className="model-provenance">
        {loaded ? 'Blender-built geometry' : 'Scene preview · procedural geometry'}
      </span>
    </div>
  );
});
