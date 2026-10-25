export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Basis = 'plan' | 'photo' | 'inferred' | 'user';
export interface Room {
  id: string;
  name: string;
  polygon: Vec2[];
  floorZ: number;
  ceilingHeight: number;
}
export interface Opening {
  id: string;
  type: 'door' | 'window' | 'passage';
  offset: number;
  width: number;
  height: number;
  bottom: number;
  basis: Basis;
}
export interface Wall {
  id: string;
  start: Vec2;
  end: Vec2;
  height: number;
  thickness: number;
  color: string;
  openings: Opening[];
}
export interface SceneObject {
  id: string;
  name: string;
  kind:
    | 'sofa'
    | 'desk'
    | 'chair'
    | 'table'
    | 'rug'
    | 'shelf'
    | 'cabinet'
    | 'counter'
    | 'plant'
    | 'appliance';
  position: Vec3;
  dimensions: Vec3;
  rotation: number;
  color: string;
  movable: boolean;
  pinned?: boolean;
  basis: Basis;
}
export interface Stair {
  id: string;
  position: Vec3;
  dimensions: Vec3;
  rotation: number;
  steps: number;
  bottom?: Vec2;
  top?: Vec2;
}
export interface CameraPreset {
  id: string;
  label: string;
  position: Vec3;
  target: Vec3;
  sourceRef?: string;
}
export interface Source {
  id: string;
  label: string;
  url: string;
  kind: 'photo' | 'plan' | 'listing';
  localUrl?: string;
}
export interface SceneSpec {
  id: string;
  revision: number;
  title: string;
  listingUrl: string;
  units: 'm';
  rooms: Room[];
  walls: Wall[];
  objects: SceneObject[];
  stairs: Stair[];
  cameras: CameraPreset[];
  sources: Source[];
  navigation: {
    start: Vec2;
    targets: { id: string; label: string; point: Vec2 }[];
    clearance: number;
  };
  notes: string[];
}
export interface Issue {
  id: string;
  type: 'collision' | 'route' | 'boundary' | 'visual' | 'source';
  severity: 'error' | 'warning';
  message: string;
  objectIds: string[];
  evidence?: string;
}
export interface Route {
  targetId: string;
  label: string;
  passed: boolean;
  points: Vec2[];
  length: number;
}
export interface Verification {
  sceneRevision: number;
  passed: boolean;
  issues: Issue[];
  routes: Route[];
  checkedAt: string;
  clearance: number;
}
export interface PipelineEvent {
  id: string;
  stage: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cached';
  detail: string;
  at: string;
  model?: string;
}
export interface PlanRoom {
  roomId: string;
  name: string;
  width: number;
  depth: number;
  ceilingHeight: number;
  dimensionBasis: 'plan' | 'inferred';
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
}
export interface PlanInterpretation {
  summary: string;
  rooms: PlanRoom[];
  scaleNote: string;
  uncertainties: string[];
}
export interface AssetProposal {
  id: string;
  name: string;
  kind: SceneObject['kind'];
  dimensions: Vec3;
  position: Vec3;
  rotation: number;
  color: string;
  sourceIds: string[];
  sourceDescription: string;
  dimensionReasoning: string;
  confidence: 'high' | 'medium' | 'low';
  origin: 'photo' | 'suggested';
  selected: boolean;
}
export interface VisualFinding {
  id: string;
  category: 'placement' | 'appearance' | 'structure' | 'evidence';
  severity: 'major' | 'minor';
  message: string;
  objectIds: string[];
  recommendation: string;
}
export interface VisualAssessment {
  revision: number;
  status: 'ready-for-human-review' | 'needs-repair' | 'insufficient-evidence';
  summary: string;
  scores: { layout: number; objects: number; materials: number };
  threshold: number;
  findings: VisualFinding[];
}
export interface WorkflowState {
  phase:
    'idle' | 'analyzing' | 'awaiting-approval' | 'building' | 'review' | 'ready' | 'needs-review';
  plan?: PlanInterpretation;
  assets: AssetProposal[];
  approvalMode?: 'reviewed' | 'suggested';
  approvedAssetIds: string[];
  review?: VisualAssessment;
  iterations: number;
  maxIterations: number;
}
export interface AppState {
  scene: SceneSpec;
  events: PipelineEvent[];
  verification: Verification | null;
  model: { configured: boolean; name: string; status: string };
  modelUrl: string | null;
  busy: boolean;
  lastAction: string;
  visualReview?: string;
  visualIssues?: Issue[];
  visualReviewRevision?: number;
  workflow?: WorkflowState;
}
export interface PlacementPatch {
  objectId: string;
  position?: Vec3;
  rotation?: number;
  color?: string;
}
// Canonical axes: X/Y floor, Z up. Three.js mapping: (x,z,-y). Rotations are radians about Z.
// API: GET /api/state => AppState; GET /api/catalog => SceneObject[];
// POST /api/build {url}; POST /api/furnish {prompt}; POST /api/verify {};
// POST /api/repair {}; POST /api/stress-test {}; POST /api/undo {};
// POST /api/object {objectId,position?,rotation?,color?}; POST /api/add {kind}; POST /api/remove {objectId};
// POST /api/visual-review {image:string /* dataURL */}; GET /api/export => scene JSON;
// POST /api/build {url} analyzes sources then pauses at awaiting-approval, before Blender.
// POST /api/approve {mode:'reviewed'|'suggested',items?:{id:string,selected:boolean,dimensions?:Vec3}[]} starts generation, returns202.
// POST /api/visual-repair {} performs at most two visual repair/render/review iterations, returns202.
// Mutating endpoints return AppState except /api/build which returns 202 {started:true}; poll /api/state.
