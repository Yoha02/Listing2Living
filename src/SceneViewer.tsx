import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SceneObject, SceneSpec, Verification, Vec3 } from '../shared/types';
import { advanceWalker, EYE_HEIGHT, findWalkStart, type WalkerPose } from '../shared/navigation';

export interface ViewerHandle {
  capture: () => string;
  view: (id: string) => void;
  walk: () => void;
  setWalkMode: (enabled: boolean) => void;
  level: (floorZ: number) => void;
}
interface Props {
  scene: SceneSpec;
  modelUrl: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  verification: Verification | null;
  showRoute: boolean;
  activeFloorZ?: number;
  onWalkModeChange?: (walking: boolean) => void;
  onFloorChange?: (floorZ: number) => void;
  onWalkPoseChange?: (pose: WalkerPose | null) => void;
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
    mesh.userData = { role: 'floor', floorZ: r.floorZ, sceneId: r.id };
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  for (const w of scene.walls) {
    const length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
    const wall = new THREE.Group();
    wall.position.copy(vec([w.start[0], w.start[1], w.floorZ ?? 0]));
    wall.rotation.y = Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0]);
    wall.userData = { sceneId: w.id, role: 'wall', floorZ: w.floorZ ?? 0 };
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
  scene.objects
    .filter((o) => !o.movable)
    .forEach((o) => {
      const item = furnishing(o);
      item.userData.role = 'fixed-object';
      item.userData.floorZ = objectFloor(scene, o);
      g.add(item);
    });
  for (const s of scene.stairs) {
    const stairs = new THREE.Group();
    stairs.position.copy(vec(s.position));
    stairs.rotation.y = s.rotation;
    stairs.userData = { role: 'stair', sceneId: s.id, floorZ: s.position[2] - s.dimensions[2] / 2 };
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
function objectFloor(scene: SceneSpec, object: SceneObject) {
  const base = object.position[2] - object.dimensions[2] / 2;
  return (
    [...new Set(scene.rooms.map((room) => room.floorZ))].sort(
      (a, b) => Math.abs(a - base) - Math.abs(b - base),
    )[0] ?? 0
  );
}
function architectureView(runtime: any, overview: boolean) {
  runtime.overview = overview;
  const activeFloor = runtime.activeFloorZ ?? 0;
  runtime.building.traverse((node: THREE.Object3D) => {
    const { role, sceneId, floorZ } = node.userData;
    if (!role) return;
    const floor = Number.isFinite(floorZ) ? Number(floorZ) : 0;
    const staircase = role === 'stair' || role === 'stair-rail';
    const onLevel = Math.abs(floor - activeFloor) < 0.08;
    node.visible = !overview || onLevel || staircase;
    if (role === 'ceiling') node.visible = !overview;
    else if (overview && (role === 'wall' || role === 'wall-trim')) {
      const front =
        sceneId === 'wall-west' ||
        sceneId === 'wall-entry' ||
        sceneId === 'wall-bath-bottom' ||
        sceneId === 'wall-bath-notch-y' ||
        sceneId === 'upper-wall-west' ||
        sceneId === 'upper-wall-east-south' ||
        sceneId === 'upper-wall-west-south';
      node.visible = onLevel && !front;
    }
  });
  runtime.objects.children.forEach((node: THREE.Object3D) => {
    node.visible = !overview || Math.abs((node.userData.floorZ ?? 0) - activeFloor) < 0.08;
  });
  runtime.selection.children.forEach((node: THREE.Object3D) => {
    node.visible = !overview || Math.abs((node.userData.floorZ ?? 0) - activeFloor) < 0.08;
  });
}

export const SceneViewer = forwardRef<ViewerHandle, Props>(function SceneViewer(
  {
    scene,
    modelUrl,
    selected,
    onSelect,
    verification,
    showRoute,
    activeFloorZ = 0,
    onWalkModeChange,
    onFloorChange,
    onWalkPoseChange,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<any>(null);
  const props = useRef({
    scene,
    onSelect,
    activeFloorZ,
    onWalkModeChange,
    onFloorChange,
    onWalkPoseChange,
  });
  props.current = {
    scene,
    onSelect,
    activeFloorZ,
    onWalkModeChange,
    onFloorChange,
    onWalkPoseChange,
  };
  const [failed, setFailed] = useState(false),
    [loaded, setLoaded] = useState(false),
    [walking, setWalking] = useState(false);
  const architectureKey = JSON.stringify([
    scene.id,
    scene.rooms,
    scene.walls,
    scene.stairs,
    scene.objects.filter((o) => !o.movable),
  ]);
  const objectKey = JSON.stringify(scene.objects),
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
        r.setWalking(false);
        if (id === 'overview') {
          r.home();
          return;
        }
        const preset = props.current.scene.cameras.find((c) => c.id === id);
        if (!preset) {
          r.home();
          return;
        }
        const floor =
          preset.floorZ ??
          [...new Set(props.current.scene.rooms.map((room) => room.floorZ))].sort(
            (a, b) =>
              Math.abs(a + EYE_HEIGHT - preset.position[2]) -
              Math.abs(b + EYE_HEIGHT - preset.position[2]),
          )[0] ??
          0;
        r.activeFloorZ = floor;
        props.current.onFloorChange?.(floor);
        r.goal = { position: vec(preset.position), target: vec(preset.target) };
        r.controls.maxPolarAngle = Math.PI * 0.94;
        r.camera.fov = 67.3;
        r.camera.updateProjectionMatrix();
        architectureView(r, false);
      },
      walk: () => {
        const r = runtime.current;
        if (r) r.walkStart = performance.now();
      },
      setWalkMode: (enabled) => runtime.current?.setWalking(enabled),
      level: (floor) => runtime.current?.setLevel(floor),
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
    controls.maxDistance = 35;
    controls.maxPolarAngle = Math.PI * 0.49;
    world.add(new THREE.HemisphereLight('#fcf6e8', '#a8b19e', 2.2));
    const sun = new THREE.DirectionalLight('#fff3da', 3);
    sun.position.set(-5, 14, -9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.normalBias = 0.025;
    sun.shadow.bias = -0.0002;
    world.add(sun);
    const fill = new THREE.DirectionalLight('#d9e7eb', 1.3);
    fill.position.set(8, 8, 7);
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
    const keys = new Set<string>();
    const reportPose = () => {
      const r = runtime.current;
      if (r?.walking && r.pose)
        props.current.onWalkPoseChange?.({
          position: [...r.pose.position] as Vec3,
          floorZ: r.pose.floorZ,
          yaw: r.pose.yaw,
          pitch: r.pose.pitch,
        });
    };
    const syncCamera = () => {
      const r = runtime.current;
      if (!r?.pose) return;
      const p = r.pose as WalkerPose;
      camera.position.copy(vec([p.position[0], p.position[1], p.position[2] + EYE_HEIGHT]));
      const horizontal = Math.cos(p.pitch);
      camera.lookAt(
        camera.position.x + Math.sin(p.yaw) * horizontal,
        camera.position.y + Math.sin(p.pitch),
        camera.position.z - Math.cos(p.yaw) * horizontal,
      );
    };
    const spawn = (floor: number): WalkerPose => {
      const position = findWalkStart(props.current.scene, floor);
      // Both entry points face their clear corridor, not a room across a wall.
      const yaw = floor > 0 ? Math.PI : 0;
      return { position, floorZ: floor, yaw, pitch: -0.1 };
    };
    const setWalkMode = (enabled: boolean) => {
      const r = runtime.current;
      if (!r || r.walking === enabled) return;
      keys.clear();
      r.goal = null;
      r.walking = enabled;
      r.dragging = false;
      controls.enabled = !enabled;
      setWalking(enabled);
      if (enabled) {
        r.pose = spawn(r.activeFloorZ);
        camera.fov = 67.3;
        camera.updateProjectionMatrix();
        architectureView(r, false);
        syncCamera();
        container.focus({ preventScroll: true });
        reportPose();
      } else {
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        controls.target.copy(camera.position).add(direction.multiplyScalar(3));
        controls.update();
        props.current.onWalkPoseChange?.(null);
      }
      props.current.onWalkModeChange?.(enabled);
      renderer.render(world, camera);
    };
    const home = () => {
      const r = runtime.current;
      if (!r) return;
      r.setWalking(false);
      const rooms = props.current.scene.rooms.filter(
        (room) => Math.abs(room.floorZ - r.activeFloorZ) < 0.08,
      );
      const points = (rooms.length ? rooms : props.current.scene.rooms).flatMap(
        (room) => room.polygon,
      );
      const minX = Math.min(...points.map((p) => p[0])),
        maxX = Math.max(...points.map((p) => p[0])),
        minY = Math.min(...points.map((p) => p[1])),
        maxY = Math.max(...points.map((p) => p[1]));
      const cx = (minX + maxX) / 2,
        cy = (minY + maxY) / 2,
        size = Math.max(maxX - minX, maxY - minY);
      r.goal = {
        position: new THREE.Vector3(
          cx - size * 0.75,
          r.activeFloorZ + size * 0.91,
          -cy + size * 0.75,
        ),
        target: new THREE.Vector3(cx, r.activeFloorZ + 0.6, -cy),
      };
      controls.maxPolarAngle = Math.PI * 0.49;
      camera.fov = 42;
      camera.updateProjectionMatrix();
      architectureView(r, true);
    };
    const setLevel = (floor: number) => {
      const r = runtime.current;
      if (!r || Math.abs(r.activeFloorZ - floor) < 0.01) return;
      keys.clear();
      r.activeFloorZ = floor;
      r.walkStart = null;
      resident.visible = false;
      if (r.walking) {
        r.pose = spawn(floor);
        syncCamera();
        reportPose();
        architectureView(r, false);
      } else home();
      renderer.render(world, camera);
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
      setWalking: setWalkMode,
      setLevel,
      activeFloorZ: props.current.activeFloorZ,
      walking: false,
      pose: null,
      goal: null,
      walkStart: null,
      walkPoints: [],
      dragging: false,
    };
    home();
    camera.position.copy(runtime.current.goal.position);
    controls.target.copy(runtime.current.goal.target);
    runtime.current.goal = null;
    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2();
    let down = [0, 0],
      lastPointer = [0, 0];
    const pointerDown = (event: PointerEvent) => {
      const r = runtime.current;
      if (!r) return;
      down = [event.clientX, event.clientY];
      lastPointer = down;
      r.goal = null;
      if (r.walking) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        r.dragging = true;
        renderer.domElement.setPointerCapture(event.pointerId);
      }
    };
    const pointerMove = (event: PointerEvent) => {
      const r = runtime.current;
      if (!r?.walking || !r.dragging) return;
      const dx = event.clientX - lastPointer[0],
        dy = event.clientY - lastPointer[1];
      lastPointer = [event.clientX, event.clientY];
      r.pose.yaw += dx * 0.004;
      r.pose.pitch = Math.max(-1.18, Math.min(1.18, r.pose.pitch - dy * 0.004));
      syncCamera();
    };
    const pointerUp = (event: PointerEvent) => {
      const r = runtime.current;
      if (!r) return;
      if (r.walking) {
        r.dragging = false;
        if (renderer.domElement.hasPointerCapture(event.pointerId))
          renderer.domElement.releasePointerCapture(event.pointerId);
        return;
      }
      if (Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
      const hits = ray.intersectObjects(
        objects.children.filter((o: THREE.Object3D) => o.visible),
        true,
      );
      props.current.onSelect(hits[0]?.object.userData.objectId || null);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);
    const clearKeys = () => {
      keys.clear();
      if (runtime.current) runtime.current.dragging = false;
    };
    const keydown = (event: KeyboardEvent) => {
      const r = runtime.current;
      if (!r?.walking) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input,textarea,select'))
      )
        return;
      if (!container.contains(target as Node) && document.activeElement !== container) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        setWalkMode(false);
        return;
      }
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
        ].includes(event.code)
      ) {
        event.preventDefault();
        keys.add(event.code);
      }
    };
    const keyup = (event: KeyboardEvent) => keys.delete(event.code);
    const focusout = (event: FocusEvent) => {
      if (!container.contains(event.relatedTarget as Node)) clearKeys();
    };
    container.addEventListener('keydown', keydown);
    container.addEventListener('focusout', focusout);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth,
        height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(world, camera);
    });
    observer.observe(container);
    let frame = 0,
      lastTime = performance.now(),
      lastReport = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const now = performance.now(),
        dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      const r = runtime.current;
      if (!r) return;
      if (r.walking) {
        const beforeFloor = r.pose.floorZ;
        r.pose = advanceWalker(
          props.current.scene,
          r.pose,
          {
            forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
            strafe: Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
            turn: Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft')),
            look: Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown')),
          },
          dt,
        );
        syncCamera();
        if (Math.abs(r.pose.floorZ - beforeFloor) > 0.01) {
          r.activeFloorZ = r.pose.floorZ;
          props.current.onFloorChange?.(r.pose.floorZ);
        }
        if (now - lastReport >= 100) {
          reportPose();
          lastReport = now;
        }
      } else {
        if (r.goal) {
          const alpha = 1 - Math.exp(-dt * 7);
          camera.position.lerp(r.goal.position, alpha);
          controls.target.lerp(r.goal.target, alpha);
          if (camera.position.distanceTo(r.goal.position) < 0.01) r.goal = null;
        }
        controls.update();
      }
      if (r.walkStart && r.walkPoints.length > 1) {
        const progress = (now - r.walkStart) / 7000;
        resident.visible = progress < 1;
        const step = Math.min(r.walkPoints.length - 1, progress * (r.walkPoints.length - 1)),
          i = Math.min(r.walkPoints.length - 2, Math.floor(step));
        resident.position.lerpVectors(r.walkPoints[i], r.walkPoints[i + 1], step - i);
        if (progress >= 1) r.walkStart = null;
      }
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
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      container.removeEventListener('keydown', keydown);
      container.removeEventListener('focusout', focusout);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
      controls.dispose();
      disposeGroup(world);
      renderer.dispose();
      container.removeChild(renderer.domElement);
      runtime.current = null;
      delete (window as any).__l2lCapture;
    };
  }, []);

  useEffect(() => {
    runtime.current?.setLevel(activeFloorZ);
  }, [activeFloorZ]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    let cancelled = false;
    setLoaded(false);
    disposeGroup(r.building);
    r.building.add(architecture(scene));
    architectureView(r, r.overview);
    r.renderer.render(r.world, r.camera);
    if (modelUrl)
      new GLTFLoader().load(
        modelUrl,
        (gltf) => {
          if (cancelled) {
            disposeGroup(gltf.scene);
            return;
          }
          disposeGroup(r.building);
          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });
          r.building.add(gltf.scene);
          architectureView(r, r.overview);
          r.renderer.render(r.world, r.camera);
          setLoaded(true);
        },
        undefined,
        () => setLoaded(false),
      );
    return () => {
      cancelled = true;
    };
  }, [modelUrl, architectureKey]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    disposeGroup(r.objects);
    scene.objects
      .filter((o) => o.movable)
      .forEach((o) => {
        const item = furnishing(o);
        item.userData.floorZ = objectFloor(scene, o);
        r.objects.add(item);
      });
    architectureView(r, r.overview);
  }, [objectKey, architectureKey]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    disposeGroup(r.selection);
    const object = scene.objects.find((o) => o.id === selected);
    if (object) {
      const [w, d, h] = object.dimensions;
      const line = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.06, h + 0.06, d + 0.06)),
        new THREE.LineBasicMaterial({ color: '#416e57', transparent: true, opacity: 0.8 }),
      );
      line.position.copy(vec(object.position));
      line.rotation.y = object.rotation;
      line.userData.floorZ = objectFloor(scene, object);
      r.selection.add(line);
    }
    architectureView(r, r.overview);
  }, [selected, objectKey, activeFloorZ]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    disposeGroup(r.routeGroup);
    r.walkPoints = [];
    if (!showRoute || !verification) return;
    verification.routes
      .filter((route) => Math.abs((route.floorZ ?? 0) - activeFloorZ) < 0.08)
      .forEach((route) => {
        if (route.points.length < 2) return;
        const points = route.points.map(
          (p) => new THREE.Vector3(p[0], (route.floorZ ?? 0) + 0.055, -p[1]),
        );
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
  }, [routeKey, showRoute, activeFloorZ]);
  return (
    <div
      className={`scene-host${walking ? ' walking' : ''}`}
      ref={host}
      tabIndex={0}
      aria-label={
        walking
          ? 'First-person home walkthrough. W A S D move; left and right arrows turn; up and down arrows look; drag to look; Escape exits.'
          : 'Interactive 3D home. Drag to orbit and scroll to zoom.'
      }
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
      {walking && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#fff9',
            border: '1px solid #38503a66',
            pointerEvents: 'none',
          }}
        />
      )}
      <span className="model-provenance">
        {loaded ? 'Blender-built geometry' : 'Scene preview · procedural geometry'}
      </span>
    </div>
  );
});
