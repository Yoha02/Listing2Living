import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cuboid,
  Expand,
  Eye,
  Footprints,
  Grid2X2,
  Layers,
  Link2,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import type { AppState, PlacementPatch, SceneObject, Source } from '../shared/types';
import type { WalkerPose } from '../shared/navigation';
import { PlanView } from './PlanView';
import { SceneViewer, type ViewerHandle } from './SceneViewer';
import { ApprovalDialog, VisualReviewPanel } from './WorkflowReview';

const LISTING =
  'https://www.zillow.com/homedetails/200-Brannan-St-APT-114-San-Francisco-CA-94107/69817820_zpid/';
const categories = [
  { kind: 'sofa', name: 'Linen sofa', description: 'Room to settle in', color: '#c8b89a' },
  { kind: 'desk', name: 'Writing desk', description: 'A little focus', color: '#9c7954' },
  { kind: 'chair', name: 'Dining chair', description: 'Take a seat', color: '#a8ad91' },
  { kind: 'table', name: 'Coffee table', description: 'Gather around', color: '#9e795a' },
  { kind: 'rug', name: 'Woven rug', description: 'Soften the space', color: '#d8cdb4' },
  { kind: 'plant', name: 'Indoor plant', description: 'Something living', color: '#667e53' },
  { kind: 'shelf', name: 'Bookcase', description: 'Keep it close', color: '#a88b62' },
];
function FurnitureGlyph({ kind, color = '#b7ad96' }: { kind: string; color?: string }) {
  return (
    <svg viewBox="0 0 100 70" aria-hidden="true">
      <ellipse cx="50" cy="59" rx="35" ry="5" fill="#d8d8c9" opacity=".45" />
      {kind === 'sofa' ? (
        <>
          <path d="M18 33 31 24 82 30 68 40z" fill={color} />
          <path d="M18 33v17l50 7V40z" fill={color} />
          <path d="m68 40 14-10v18L68 57z" fill={color} filter="brightness(.85)" />
          <path d="m25 35 10-7 38 5-10 8z" fill="#ece4d2" />
          <path d="M23 28v16l9 2V29zM63 34v17l9-5V31z" fill={color} />
          <path d="M24 51v7m40-3v7m13-13v7" stroke="#71694f" strokeWidth="3" />
        </>
      ) : kind === 'rug' ? (
        <>
          <path d="m15 42 35-19 36 20-35 19z" fill={color} />
          <path d="m22 42 28-15 29 16-28 15z" fill="none" stroke="#b5a58a" />
        </>
      ) : kind === 'plant' ? (
        <>
          <path d="m40 44 21 0-4 17H44z" fill="#c7b39b" />
          <path d="M50 48V18" stroke="#7f785b" strokeWidth="2" />
          <path
            d="M50 35Q26 28 33 19q18 1 17 16M50 29q3-22 19-18-1 17-19 18M50 45q5-23 22-20-3 17-22 20"
            fill={color}
          />
        </>
      ) : kind === 'chair' ? (
        <>
          <path d="m37 16 27 4v23l-27-4z" fill={color} />
          <path d="m27 44 11-7 27 6-11 9z" fill={color} />
          <path d="M30 46v15m23-11v14m10-20v15M38 39V17" stroke="#81745a" strokeWidth="3" />
        </>
      ) : kind === 'shelf' ? (
        <>
          <path d="M29 13 66 19v44L29 57z" fill={color} />
          <path d="m34 21 27 5v10l-27-5zm0 18 27 5v10l-27-5z" fill="#76634d" />
          <path d="M39 25v7m7-5v7m7-5v7" stroke="#d7c6a6" strokeWidth="5" />
        </>
      ) : (
        <>
          <path d="m17 31 27-13 42 13-27 15z" fill={color} />
          <path d="M21 34v24m36-13v18m25-29v22M45 22v25" stroke="#665c49" strokeWidth="3" />
          {kind === 'desk' && (
            <>
              <path d="m44 16 20 5v13l-20-5z" fill="#4d5551" />
              <path d="m54 31v6" stroke="#4d5551" strokeWidth="2" />
            </>
          )}
        </>
      )}
    </svg>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Cuboid size={20} strokeWidth={1.6} />
      </span>
      <span>
        listing<span className="brand-number">2</span>living<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Inspector({
  object,
  onPatch,
  onRemove,
  pending,
}: {
  object: SceneObject;
  onPatch: (patch: PlacementPatch) => void;
  onRemove: () => void;
  pending: boolean;
}) {
  const [x, setX] = useState(object.position[0].toFixed(2)),
    [y, setY] = useState(object.position[1].toFixed(2));
  useEffect(() => {
    setX(object.position[0].toFixed(2));
    setY(object.position[1].toFixed(2));
  }, [object.id, object.position[0], object.position[1]]);
  return (
    <div className="inspector">
      <div className="eyebrow">MAKE IT YOURS</div>
      <h3>{object.name}</h3>
      <p className="object-size">
        {Math.round(object.dimensions[0] * 100)} × {Math.round(object.dimensions[1] * 100)} ×{' '}
        {Math.round(object.dimensions[2] * 100)} cm
      </p>
      <div className="inspector-controls">
        <label>
          X{' '}
          <input
            aria-label="Object X position in metres"
            type="number"
            step=".1"
            value={x}
            onChange={(e) => setX(e.target.value)}
            onBlur={() => {
              if (Number.isFinite(Number(x)) && x !== '' && Number(x) !== object.position[0])
                onPatch({
                  objectId: object.id,
                  position: [Number(x), object.position[1], object.position[2]],
                });
            }}
            disabled={pending}
          />
          <span>m</span>
        </label>
        <label>
          Y{' '}
          <input
            aria-label="Object Y position in metres"
            type="number"
            step=".1"
            value={y}
            onChange={(e) => setY(e.target.value)}
            onBlur={() => {
              if (Number.isFinite(Number(y)) && y !== '' && Number(y) !== object.position[1])
                onPatch({
                  objectId: object.id,
                  position: [object.position[0], Number(y), object.position[2]],
                });
            }}
            disabled={pending}
          />
          <span>m</span>
        </label>
      </div>
      <div className="material-row">
        <span>Finish</span>
        <div className="swatches">
          {['#c8b89a', '#e5dfcf', '#697c64', '#9b7259', '#49534a'].map((color) => (
            <button
              key={color}
              aria-label={`Change finish to ${color}`}
              style={{ background: color }}
              className={object.color === color ? 'chosen' : ''}
              onClick={() => onPatch({ objectId: object.id, color })}
              disabled={pending}
            />
          ))}
        </div>
      </div>
      <div className="inspector-actions">
        <button
          onClick={() => onPatch({ objectId: object.id, rotation: object.rotation + Math.PI / 2 })}
          disabled={pending}
        >
          <RotateCcw size={14} /> Rotate 90°
        </button>
        <button className="remove" onClick={onRemove} disabled={pending}>
          <Trash2 size={14} /> Remove
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null),
    [loadError, setLoadError] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(''),
    [tab, setTab] = useState<'plan' | 'furniture' | 'sources'>('plan'),
    [selected, setSelected] = useState<string | null>(null),
    [url, setUrl] = useState(LISTING),
    [urlOpen, setUrlOpen] = useState(false),
    [prompt, setPrompt] = useState(''),
    [pipeline, setPipeline] = useState(false),
    [showRoute, setShowRoute] = useState(false),
    [showChecks, setShowChecks] = useState(false),
    [compare, setCompare] = useState(false),
    [activeSource, setActiveSource] = useState<string>(''),
    [camera, setCamera] = useState('overview'),
    [activeFloorZ, setActiveFloorZ] = useState(0),
    [walking, setWalking] = useState(false),
    [walkPose, setWalkPose] = useState<Pick<WalkerPose, 'position' | 'floorZ' | 'yaw'> | null>(
      null,
    ),
    [catalogSearch, setCatalogSearch] = useState(''),
    [help, setHelp] = useState(false),
    [notification, setNotification] = useState(''),
    [catalog, setCatalog] = useState<SceneObject[]>([]),
    [planReviewOpen, setPlanReviewOpen] = useState(false);
  const viewer = useRef<ViewerHandle>(null),
    mutation = useRef(false),
    lastPoll = useRef(0),
    lastApprovalKey = useRef(''),
    lastAssessmentKey = useRef('');
  const poll = useCallback(async () => {
    try {
      const request = Date.now();
      const res = await fetch('/api/state');
      if (!res.ok) throw Error(`Server returned ${res.status}`);
      const next = (await res.json()) as AppState;
      if (!mutation.current && request >= lastPoll.current) {
        setState(next);
        lastPoll.current = request;
      }
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not connect to the local service');
    }
  }, []);
  useEffect(() => {
    poll();
    fetch('/api/catalog')
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog)
      .catch(() => {});
    const interval = setInterval(poll, 1800);
    return () => clearInterval(interval);
  }, [poll]);
  useEffect(() => {
    const workflow = state?.workflow;
    if (!workflow) return;
    const approvalKey = JSON.stringify([workflow.plan, workflow.assets]);
    if (workflow.phase === 'awaiting-approval' && lastApprovalKey.current !== approvalKey) {
      lastApprovalKey.current = approvalKey;
      setPlanReviewOpen(true);
      setPipeline(true);
    }
    if (workflow.phase === 'analyzing' || workflow.phase === 'building') setPlanReviewOpen(false);
    const assessmentKey = JSON.stringify(workflow.review);
    if (workflow.review && assessmentKey !== lastAssessmentKey.current) {
      lastAssessmentKey.current = assessmentKey;
      setShowChecks(true);
    }
  }, [state?.workflow]);
  useEffect(() => {
    if (!notification) return;
    const id = setTimeout(() => setNotification(''), 5000);
    return () => clearTimeout(id);
  }, [notification]);
  const act = useCallback(
    async (path: string, body: unknown = {}, label = path) => {
      if (mutation.current) return;
      mutation.current = true;
      setPending(label);
      setError('');
      try {
        const response = await fetch(`/api/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok)
          throw Error(data.error || data.message || `Request failed (${response.status})`);
        if (data.scene) {
          setState(data);
          lastPoll.current = Date.now();
        }
        if (path === 'build') {
          setPipeline(true);
          setUrlOpen(false);
          setPlanReviewOpen(false);
          lastApprovalKey.current = '';
          setNotification(
            'Reading the listing. You will review the plan and items before we build.',
          );
        }
        if (path === 'approve' || path === 'visual-repair') {
          setPipeline(true);
          setPlanReviewOpen(false);
          setNotification(
            path === 'approve'
              ? 'Your choices are approved. Blender is building your home.'
              : 'The visual repair loop has started. Each pass is recorded below.',
          );
        }
        if (path === 'verify' || path === 'repair' || path === 'stress-test') {
          setShowChecks(true);
          setShowRoute(true);
        }
        if (path === 'visual-review') setShowChecks(true);
        return data;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      } finally {
        mutation.current = false;
        setPending('');
        poll();
      }
    },
    [poll],
  );
  if (!state)
    return (
      <main className="loading-page">
        <Brand />
        <div className="loading-content">
          <div className="loading-house">
            <Cuboid size={38} strokeWidth={1} />
          </div>
          <h1>A little closer to home.</h1>
          <p>
            {loadError
              ? 'Waiting for the local workspace to connect…'
              : 'Opening your home studio…'}
          </p>
          {loadError ? (
            <button className="primary-button" onClick={poll}>
              Try again <ArrowRight size={16} />
            </button>
          ) : (
            <LoaderCircle className="spin" size={20} />
          )}
        </div>
        <span>STEP INSIDE YOUR NEXT HOME</span>
      </main>
    );
  const scene = state.scene,
    object = scene.objects.find((o) => o.id === selected),
    busy = !!pending || state.busy,
    photos = scene.sources.filter((s) => s.kind === 'photo' || s.kind === 'plan'),
    source =
      photos.find((s) => s.id === activeSource) ||
      photos.find((s) => s.kind === 'photo') ||
      photos[0],
    issues = state.verification?.issues || [],
    stale = state.verification && state.verification.sceneRevision !== scene.revision,
    doneEvents = state.events.filter((e) => e.status === 'done' || e.status === 'cached').length;
  const setView = (id: string) => {
    setCamera(id);
    const preset = scene.cameras.find((entry) => entry.id === id);
    if (preset && id !== 'overview') setActiveFloorZ(preset.floorZ || 0);
    viewer.current?.view(id);
  };
  const levels = scene.levels || [{ id: 'lower', label: 'Main floor', floorZ: 0 }];
  const currentLevel = levels.find((level) => level.floorZ === activeFloorZ) || levels[0];
  const selectFloor = (floorZ: number) => {
    setActiveFloorZ(floorZ);
    setSelected(null);
    setCamera('overview');
    viewer.current?.level(floorZ);
  };
  const canInspect =
    !!state.workflow?.approvalMode &&
    !['awaiting-approval', 'analyzing'].includes(state.workflow.phase);
  const reviewHint = canInspect
    ? 'Ask Argon to inspect this view'
    : 'Approve the plan and build this home before inspecting the rendered view.';
  const review = () => {
    if (!canInspect) {
      setError(reviewHint);
      return;
    }
    const image = viewer.current?.capture();
    if (image) act('visual-review', { image }, 'Argon is inspecting the view');
    else setError('The 3D view is not ready to capture yet.');
  };
  const sourceCard = (s: Source) => (
    <button
      className={`source-card ${activeSource === s.id ? 'active' : ''}`}
      key={s.id}
      onClick={() => {
        setActiveSource(s.id);
        setCompare(true);
      }}
    >
      {s.kind !== 'listing' && <img src={s.localUrl || s.url} alt={s.label} loading="lazy" />}
      <span>{s.kind === 'plan' ? 'FLOOR PLAN' : 'SOURCE PHOTO'}</span>
      <strong>{s.label}</strong>
      <span className="source-open">
        Compare with your home <ArrowUpRight size={13} />
      </span>
    </button>
  );
  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="property-header">
          <span className="property-dot" />
          <span>
            200 Brannan Street <span className="muted">/ Loft 114</span>
          </span>
          <button
            aria-label="Change listing URL"
            className="icon-button"
            onClick={() => setUrlOpen(!urlOpen)}
          >
            <ChevronDown size={15} />
          </button>
        </div>
        <div className="topbar-actions">
          <span
            className={`connection ${state.model.configured ? 'connected' : ''}`}
            title={state.model.status}
          >
            <span />
            {state.model.configured ? 'Argon connected' : 'Argon setup needed'}
          </span>
          <button
            className="icon-button"
            aria-label="Undo last change"
            title="Undo last change"
            disabled={busy}
            onClick={() => act('undo', {}, 'Restoring previous scene')}
          >
            <RotateCcw size={17} />
          </button>
          <a className="export-button" href="/api/export" download="listing2living-scene.json">
            <ArrowDownToLine size={15} /> Save scene
          </a>
          <button
            className="icon-button help-button"
            aria-label="Show controls and scene information"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      {urlOpen && (
        <form
          className="url-bar"
          onSubmit={(e) => {
            e.preventDefault();
            act('build', { url }, 'Starting reconstruction');
          }}
        >
          <Link2 size={17} />
          <input
            aria-label="Property listing URL"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button type="submit" className="primary-button" disabled={busy}>
            Analyze listing <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close URL entry"
            onClick={() => setUrlOpen(false)}
          >
            <X size={17} />
          </button>
        </form>
      )}
      {state.workflow?.phase === 'awaiting-approval' && (
        <div className="approval-banner">
          <span className="approval-banner-icon">
            <Check size={14} />
          </span>
          <div>
            <strong>Your blueprint is ready.</strong>
            <span> Review the rooms and choose the pieces before Blender starts.</span>
          </div>
          <button onClick={() => setPlanReviewOpen(true)}>
            Review & approve <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-intro">
            <div className="eyebrow">A PLACE FOR POSSIBILITY</div>
            <h1>
              Make yourself
              <br />
              at home<span>.</span>
            </h1>
            <p>A new perspective on your next place.</p>
            <button className="analyze-entry" onClick={() => setUrlOpen(true)}>
              <Link2 size={12} /> Analyze a listing <ArrowRight size={12} />
            </button>
          </div>
          <nav className="rail-tabs" aria-label="Workspace tools">
            {(['plan', 'furniture', 'sources'] as const).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t === 'plan' ? (
                  <Grid2X2 size={14} />
                ) : t === 'furniture' ? (
                  <Layers size={14} />
                ) : (
                  <Eye size={14} />
                )}
                <span>{t[0].toUpperCase() + t.slice(1)}</span>
              </button>
            ))}
          </nav>
          <div className="rail-content">
            <div className="floor-selector" aria-label="Choose a floor">
              {levels.map((level) => (
                <button
                  key={level.id}
                  className={currentLevel.id === level.id ? 'active' : ''}
                  aria-pressed={currentLevel.id === level.id}
                  onClick={() => selectFloor(level.floorZ)}
                >
                  <Layers size={13} /> {level.label}
                </button>
              ))}
            </div>
            {tab === 'plan' && (
              <>
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">YOUR HOME, YOUR WAY</div>
                    <h2>{currentLevel.label}</h2>
                  </div>
                  <span className="small-tag">{activeFloorZ > 0 ? '~88 m²' : '~40 m²'}</span>
                </div>
                <p className="panel-caption">
                  {activeFloorZ > 0
                    ? 'Two bedrooms, hallway & quiet corners.'
                    : 'Entry, kitchen & everyday moments.'}
                </p>
                <PlanView
                  scene={scene}
                  floorZ={activeFloorZ}
                  walkPose={walkPose}
                  selected={selected}
                  onSelect={setSelected}
                  onMove={(id, x, y) => {
                    const o = scene.objects.find((o) => o.id === id);
                    if (o && !busy)
                      act(
                        'object',
                        { objectId: id, position: [x, y, o.position[2]] },
                        'Moving furniture',
                      );
                  }}
                  verification={state.verification}
                  showRoute={showRoute}
                />
                <div className="plan-footnote">
                  <MousePointer2 size={12} />
                  <span>Select and drag furniture to arrange.</span>
                </div>
                {object?.movable ? (
                  <Inspector
                    key={object.id}
                    object={object}
                    pending={busy}
                    onPatch={(patch) => act('object', patch, 'Updating furniture')}
                    onRemove={() => {
                      act('remove', { objectId: object.id }, 'Removing furniture');
                      setSelected(null);
                    }}
                  />
                ) : (
                  <div className="plan-invitation">
                    <span className="mini-furniture">
                      <FurnitureGlyph kind="sofa" />
                    </span>
                    <div>
                      <strong>Find your perfect arrangement.</strong>
                      <p>Add a few things that feel like you.</p>
                      <button onClick={() => setTab('furniture')}>
                        Explore furniture <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="source-note">
                  <ShieldCheck size={14} />
                  <span>Plan-informed geometry. Heights and some details are estimates.</span>
                </div>
              </>
            )}
            {tab === 'furniture' && (
              <>
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">THE FINISHING TOUCHES</div>
                    <h2>Room for you.</h2>
                  </div>
                </div>
                <label className="catalog-search">
                  <Search size={14} />
                  <input
                    placeholder="Find something for your home"
                    aria-label="Find furniture"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                  />
                </label>
                <div className="furniture-grid">
                  {categories
                    .filter((c) =>
                      catalog.length
                        ? catalog.some((o) => o.kind === c.kind)
                        : ['sofa', 'desk', 'chair', 'table', 'rug'].includes(c.kind),
                    )
                    .filter((c) =>
                      `${c.name} ${c.kind}`.toLowerCase().includes(catalogSearch.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        className="furniture-card"
                        key={c.kind}
                        disabled={busy}
                        onClick={async () => {
                          const before = scene.objects.map((o) => o.id);
                          const next = await act(
                            'add',
                            { kind: c.kind, floorZ: activeFloorZ },
                            `Adding ${c.name.toLowerCase()}`,
                          );
                          if (next?.scene) {
                            const added = next.scene.objects.find(
                              (o: SceneObject) => !before.includes(o.id),
                            );
                            if (added) setSelected(added.id);
                          }
                        }}
                      >
                        <FurnitureGlyph kind={c.kind} color={c.color} />
                        <strong>{c.name}</strong>
                        <span>{c.description}</span>
                        <span className="add-furniture">
                          <Plus size={13} />
                        </span>
                      </button>
                    ))}
                </div>
                <p className="catalog-note">
                  Procedurally built pieces. Dimensions are editable scene data; these are not
                  retailer products.
                </p>
                {object?.movable && (
                  <Inspector
                    key={object.id}
                    object={object}
                    pending={busy}
                    onPatch={(patch) => act('object', patch, 'Updating furniture')}
                    onRemove={() => {
                      act('remove', { objectId: object.id });
                      setSelected(null);
                    }}
                  />
                )}
              </>
            )}
            {tab === 'sources' && (
              <>
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">BUILT FROM EVIDENCE</div>
                    <h2>The original place.</h2>
                  </div>
                </div>
                <p className="panel-caption">Compare the model with its source material.</p>
                <div className="source-list">{photos.map(sourceCard)}</div>
                <a
                  className="listing-link"
                  href={scene.listingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the original listing <ArrowUpRight size={14} />
                </a>
                <details className="source-details">
                  <summary>What we know & what we estimate</summary>
                  {scene.notes.map((note, i) => (
                    <p key={i}>{note}</p>
                  ))}
                </details>
              </>
            )}
          </div>
          <div className="sidebar-bottom">
            <span className="floor-dot" /> {currentLevel.label}{' '}
            <span>Metres · Rev {scene.revision}</span>
          </div>
        </aside>
        <section className="main-stage" aria-label="Home exploration workspace">
          <div className="viewport">
            <SceneViewer
              ref={viewer}
              scene={scene}
              selected={selected}
              modelUrl={state.modelUrl}
              onSelect={setSelected}
              verification={state.verification}
              showRoute={showRoute}
              activeFloorZ={activeFloorZ}
              onWalkModeChange={setWalking}
              onFloorChange={setActiveFloorZ}
              onWalkPoseChange={setWalkPose}
            />
            <div className="viewport-top">
              <div className="view-switch">
                <button className={!compare ? 'active' : ''} onClick={() => setCompare(false)}>
                  <Cuboid size={14} /> Explore
                </button>
                <button className={compare ? 'active' : ''} onClick={() => setCompare(!compare)}>
                  <Layers size={14} /> Compare
                </button>
                <button
                  className={walking ? 'active' : ''}
                  aria-pressed={walking}
                  onClick={() => {
                    setCompare(false);
                    viewer.current?.setWalkMode(!walking);
                  }}
                >
                  <Footprints size={14} /> {walking ? 'Exit walk' : 'Walk inside'}
                </button>
              </div>
              <button
                className={`route-toggle ${showRoute ? 'active' : ''}`}
                onClick={() => {
                  if (!state.verification) act('verify', {}, 'Checking clear routes');
                  else setShowRoute(!showRoute);
                }}
                disabled={busy}
              >
                <Footprints size={14} /> Clear routes{' '}
                <span className="toggle-track">
                  <i />
                </span>
              </button>
            </div>
            {compare && (
              <div className="compare-pane">
                <div className="compare-heading">
                  <span>Source evidence</span>
                  <button
                    className="icon-button"
                    aria-label="Close source comparison"
                    onClick={() => setCompare(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {source ? (
                  <>
                    <img src={source.localUrl || source.url} alt={source.label} />
                    <div className="compare-footer">
                      <select
                        aria-label="Choose source to compare"
                        value={source.id}
                        onChange={(e) => setActiveSource(e.target.value)}
                      >
                        {photos.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Open source image"
                      >
                        <ArrowUpRight size={14} />
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="empty-source">
                    Run the listing pipeline to collect source imagery.
                  </div>
                )}
                <p>
                  Use camera views to compare architecture. Inferred details remain approximate.
                </p>
              </div>
            )}
            <div className="viewport-side">
              <button
                className="floating-button"
                aria-label="Reset camera to dollhouse view"
                title="Dollhouse overview"
                onClick={() => setView('overview')}
              >
                <Maximize2 size={17} />
              </button>
              <button
                className="floating-button"
                aria-label="Inspect current view with Argon"
                title={reviewHint}
                onClick={review}
                disabled={busy || !canInspect}
              >
                <Eye size={17} />
              </button>
            </div>
            <div className="viewport-bottom">
              <div className="camera-presets">
                {scene.cameras
                  .filter(
                    (c) => c.id === 'overview' || Math.abs((c.floorZ || 0) - activeFloorZ) < 0.01,
                  )
                  .map((c) => (
                    <button
                      key={c.id}
                      className={camera === c.id ? 'active' : ''}
                      onClick={() => setView(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
              </div>
              <div className="viewer-hint">
                <MousePointer2 size={12} />{' '}
                {walking
                  ? 'WASD move · ← → turn · ↑ ↓ look · Drag to look · Esc exit'
                  : 'Drag to orbit · Scroll to zoom'}
              </div>
            </div>
            {notification && (
              <div className="toast" role="status">
                <Check size={15} />
                {notification}
              </div>
            )}
            {selected && object?.movable && (
              <div className="selection-pill">
                <span style={{ background: object.color }} />
                <strong>{object.name}</strong>
                <button onClick={() => setTab('plan')}>
                  Edit on plan <ArrowRight size={12} />
                </button>
                <button aria-label="Clear selection" onClick={() => setSelected(null)}>
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
          <div className="studio-bottom">
            <div className="prompt-header">
              <div>
                <Sparkles size={16} />
                <strong>Imagine it here.</strong>
                <span>Tell your home what you need.</span>
              </div>
              <button className="check-button" onClick={() => setShowChecks(!showChecks)}>
                <ShieldCheck size={15} />
                {!state.verification
                  ? 'Checks'
                  : stale
                    ? 'Recheck changes'
                    : state.verification.passed
                      ? 'Routes clear'
                      : `${issues.filter((i) => i.severity === 'error').length} issue${issues.length === 1 ? '' : 's'} to review`}
                <ChevronDown size={13} />
              </button>
            </div>
            <form
              className="prompt-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (prompt.trim())
                  act(
                    'furnish',
                    { prompt: prompt.trim(), floorZ: activeFloorZ },
                    'Argon is planning your arrangement',
                  );
              }}
            >
              <input
                aria-label="Describe how to furnish your home"
                placeholder="Add a sofa and a work desk. Keep the kitchen and stairs reachable."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                aria-label="Apply furnishing request"
                disabled={busy || !prompt.trim()}
              >
                {pending.includes('planning') ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <ArrowRight size={20} />
                )}
              </button>
            </form>
            <div className="prompt-suggestions">
              <button
                disabled={busy}
                onClick={() => {
                  const p =
                    'Add a two-seat sofa and a work desk. Keep the entrance, kitchen, living room and stairs reachable.';
                  setPrompt(p);
                  act(
                    'furnish',
                    { prompt: p, floorZ: activeFloorZ },
                    'Argon is planning your arrangement',
                  );
                }}
              >
                <Plus size={11} /> Sofa + work space
              </button>
              <button disabled={busy} onClick={() => act('verify', {}, 'Checking clear routes')}>
                <Footprints size={11} /> Check my layout
              </button>
              <button disabled={busy || !canInspect} title={reviewHint} onClick={review}>
                <Eye size={11} /> Inspect this view
              </button>
            </div>
          </div>
          {showChecks && (
            <div className="checks-panel">
              <div className="checks-heading">
                <div>
                  <span className="eyebrow">MAKE ROOM FOR REAL LIFE</span>
                  <h3>Will it work?</h3>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close checks"
                  onClick={() => setShowChecks(false)}
                >
                  <X size={17} />
                </button>
              </div>
              <p className="checks-caption">
                Geometry checks use a {Math.round(scene.navigation.clearance * 100)} cm route width.
                This is a layout aid, not an accessibility certification.
              </p>
              {stale && (
                <p className="stale-message">
                  The scene has changed since these checks. Run them again.
                </p>
              )}
              {state.verification ? (
                <>
                  <div className="route-results">
                    {state.verification.routes.map((r) => (
                      <div key={r.targetId}>
                        <span className={`result-dot ${r.passed ? 'pass' : 'fail'}`}>
                          {r.passed ? <Check size={11} /> : <X size={11} />}
                        </span>
                        <span>{r.label}</span>
                        <strong>{r.passed ? 'Clear' : 'Blocked'}</strong>
                      </div>
                    ))}
                  </div>
                  {issues.length > 0 && (
                    <div className="issues">
                      {issues.map((i) => (
                        <div key={i.id} className={`issue ${i.severity}`}>
                          <strong>{i.type[0].toUpperCase() + i.type.slice(1)}</strong>
                          <p>{i.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="checks-empty">
                  <Footprints size={22} />
                  <p>Check the paths through your home after arranging furniture.</p>
                </div>
              )}
              {state.visualReview && !state.workflow?.review && (
                <div className="visual-review">
                  <div className="eyebrow">ARGON VISUAL REVIEW</div>
                  {state.visualReviewRevision !== scene.revision && (
                    <p className="stale-message">
                      This review describes an earlier scene revision. Inspect the current view
                      again after changes.
                    </p>
                  )}
                  <p>
                    {typeof state.visualReview === 'string'
                      ? state.visualReview
                      : JSON.stringify(state.visualReview, null, 2)}
                  </p>
                </div>
              )}
              {!!state.visualIssues?.length && !state.workflow?.review && (
                <div className="visual-observations">
                  <div className="eyebrow">VISUAL OBSERVATIONS · NOT GEOMETRY TESTS</div>
                  {state.visualIssues.map((issue) => (
                    <div className="issue warning" key={issue.id}>
                      <p>{issue.message}</p>
                      {issue.evidence && <p>{issue.evidence}</p>}
                    </div>
                  ))}
                </div>
              )}
              {state.workflow?.review && (
                <VisualReviewPanel
                  review={state.workflow.review}
                  sceneRevision={scene.revision}
                  iterations={state.workflow.iterations}
                  maxIterations={state.workflow.maxIterations}
                  pending={busy}
                  onRepair={() => act('visual-repair', {}, 'Repairing and inspecting the scene')}
                  onPlan={() => setPlanReviewOpen(true)}
                />
              )}
              <div className="checks-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => act('verify', {}, 'Checking clear routes')}
                >
                  Run checks
                </button>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => act('repair', {}, 'Repairing the arrangement')}
                >
                  <WandSparkles size={14} /> Repair layout
                </button>
              </div>
              <button
                className="walk-button"
                disabled={!state.verification?.routes.some((r) => r.passed) || !!stale}
                onClick={() => {
                  setShowRoute(true);
                  setTimeout(() => viewer.current?.walk(), 120);
                }}
              >
                <Footprints size={14} /> Rehearse a walk through
              </button>
              <details className="stress-test">
                <summary>Demonstration tools</summary>
                <p>Add a deliberately obstructing object to demonstrate detection and repair.</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    act('stress-test', {}, 'Adding a labelled stress-test obstruction')
                  }
                >
                  Add doorway stress test
                </button>
              </details>
            </div>
          )}
        </section>
      </div>
      <footer className={`pipeline ${pipeline ? 'expanded' : ''}`}>
        <button className="pipeline-summary" onClick={() => setPipeline(!pipeline)}>
          <span className="pipeline-label">
            <span className={`pipeline-light ${busy ? 'working' : ''}`} />
            {pending || state.busy
              ? 'Your home is taking shape'
              : state.workflow?.phase === 'awaiting-approval'
                ? 'Waiting for your approval'
                : 'Behind your home'}
          </span>
          <div className="pipeline-mini">
            {['Sources', 'Plan', 'Items', 'Approve', 'Build', 'Test', 'Review'].map((s, i) => (
              <span key={s}>
                {i > 0 && <ChevronRight size={11} />}
                <span>{s}</span>
              </span>
            ))}
          </div>
          <span className="pipeline-status">
            {busy ? (
              <>
                <LoaderCircle size={13} className="spin" /> Working
              </>
            ) : state.events.length ? (
              `${doneEvents} steps complete`
            ) : (
              'Event-built starter scene'
            )}
            <ChevronDown size={13} />
          </span>
        </button>
        {pipeline && (
          <div className="pipeline-content">
            <div className="pipeline-description">
              <h3>A home, built in the open.</h3>
              <p>
                Each step records its real output. Starter geometry and cached inputs are labelled;
                model activity is shown when it runs.
              </p>
              <button disabled={busy} onClick={() => setUrlOpen(true)}>
                <Link2 size={13} /> Analyze a listing
              </button>
            </div>
            <div className="event-list">
              {state.events.length ? (
                state.events.map((event) => (
                  <div className={`event ${event.status}`} key={event.id}>
                    <span className="event-icon">
                      {event.status === 'running' ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : event.status === 'done' ? (
                        <Check size={13} />
                      ) : event.status === 'failed' ? (
                        <X size={13} />
                      ) : (
                        <span />
                      )}
                    </span>
                    <div>
                      <div className="event-title">
                        <strong>{event.label}</strong>
                        <span>
                          {event.status === 'cached' ? 'Cached / starter' : event.status}
                          {event.model ? ` · ${event.model}` : ''}
                        </span>
                      </div>
                      <p>{event.detail}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="event-empty">
                  The event-built Brannan starter is ready to explore. Start the URL pipeline above
                  to run the agents.
                </div>
              )}
            </div>
          </div>
        )}
      </footer>
      {(error || loadError) && (
        <div className="error-banner" role="alert">
          <span>{error || `Connection interrupted: ${loadError}`}</span>
          <button
            onClick={() => {
              setError('');
              poll();
            }}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spin" size={15} />
          <span>{pending || state.lastAction || 'Building your home…'}</span>
        </div>
      )}
      {planReviewOpen && state.workflow?.plan && (
        <ApprovalDialog
          key={JSON.stringify([state.workflow.plan, state.workflow.assets])}
          workflow={state.workflow}
          sources={scene.sources}
          pending={busy}
          onClose={() => setPlanReviewOpen(false)}
          onApprove={(mode, items) => act('approve', { mode, items }, 'Approving your selections')}
          onAnalyze={() => {
            setPlanReviewOpen(false);
            act('build', { url: scene.listingUrl }, 'Analyzing the source evidence');
          }}
        />
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <button
              className="modal-close icon-button"
              onClick={() => setHelp(false)}
              aria-label="Close help"
            >
              <X size={20} />
            </button>
            <div className="eyebrow">WELCOME TO LISTING2LIVING</div>
            <h2 id="help-title">Step inside your next home.</h2>
            <p>Explore both floors of Brannan, then make room for the way you live.</p>
            <ul>
              <li>
                <strong>Explore:</strong> drag to orbit, scroll to zoom, or choose a camera view.
                Select Main floor or Second floor to change levels.
              </li>
              <li>
                <strong>Walk inside:</strong> W/S move forward and backward; A/D move sideways.
                Left/right arrows turn, up/down arrows look up and down. Drag to look around, walk
                onto the stairs to change floors, and press Escape to exit.
              </li>
              <li>
                <strong>Arrange:</strong> add furniture, then drag it on the floor plan. Select it
                to change its position, rotation, or finish.
              </li>
              <li>
                <strong>Verify:</strong> check paths through the home, inspect a rendered view with
                Argon, and repair the arrangement.
              </li>
              <li>
                <strong>Understand:</strong> compare source evidence and expand the workflow to see
                which work is live or cached.
              </li>
            </ul>
            <div className="help-note">
              This event-built reconstruction is a planning prototype. Dimensions and appearance
              include estimates. It is not a survey or building-code assessment.
            </div>
            <button className="primary-button" onClick={() => setHelp(false)}>
              Make yourself at home <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
