import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Eye,
  FileCheck2,
  Home,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  WandSparkles,
  X,
} from 'lucide-react';
import type { IntakeReport, RoomAssessment, SceneSpec, Source } from '../shared/types';

export interface SavedWorkspace {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
  roomCount: number;
}

export function WorkspacePicker({
  currentId,
  title,
  workspaces,
  pending,
  onSelect,
  onNew,
}: {
  currentId?: string;
  title: string;
  workspaces: SavedWorkspace[];
  pending: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [currentId]);
  return (
    <div className="workspace-picker">
      <button
        className="workspace-trigger"
        aria-expanded={open}
        aria-label="Choose a saved home"
        onClick={() => setOpen(!open)}
      >
        <span className="property-dot" />
        <span>{title}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <button
            className="picker-dismiss"
            aria-label="Close saved homes"
            onClick={() => setOpen(false)}
          />
          <section className="workspace-menu" aria-label="Saved property workspaces">
            <div className="eyebrow">YOUR SAVED HOMES</div>
            {workspaces.length ? (
              workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  className={`saved-workspace ${workspace.id === currentId ? 'active' : ''}`}
                  disabled={pending}
                  onClick={() => {
                    if (workspace.id !== currentId) onSelect(workspace.id);
                    setOpen(false);
                  }}
                >
                  <Home size={16} />
                  <span>
                    <strong>{workspace.title}</strong>
                    <small>
                      {workspace.roomCount} rooms · saved{' '}
                      {new Date(workspace.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </small>
                  </span>
                  {workspace.id === currentId && <Check size={14} />}
                </button>
              ))
            ) : (
              <p className="workspace-empty">
                Your current home is open. Saved homes will appear here.
              </p>
            )}
            <button
              className="workspace-new"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
            >
              <Plus size={15} /> Check another listing <ArrowRight size={14} />
            </button>
          </section>
        </>
      )}
    </div>
  );
}

export function sameListing(a: string, b: string) {
  try {
    const first = new URL(a),
      second = new URL(b);
    const zpid = (url: URL) =>
      /(^|\.)zillow\.com$/.test(url.hostname)
        ? url.pathname.match(/\/(\d+)_zpid\/?$/)?.[1]
        : undefined;
    if (zpid(first) && zpid(second)) return zpid(first) === zpid(second);
    return (
      first.hostname.replace(/^www\./, '') === second.hostname.replace(/^www\./, '') &&
      first.pathname.replace(/\/+$/, '') === second.pathname.replace(/\/+$/, '')
    );
  } catch {
    return a.trim() === b.trim();
  }
}

export function IntakeDialog({
  url,
  onUrl,
  intake,
  pending,
  checking,
  onCheck,
  onBuild,
  onClose,
}: {
  url: string;
  onUrl: (url: string) => void;
  intake?: IntakeReport;
  pending: boolean;
  checking: boolean;
  onCheck: () => void;
  onBuild: () => void;
  onClose: () => void;
}) {
  const matches = !!intake && sameListing(url, intake.url);
  const report = matches ? intake : undefined;
  const ready = report?.status === 'ready';
  const sources = report?.sources.filter((s) => s.kind !== 'listing') || [];
  return (
    <div
      className="intake-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <section
        className="intake-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div className="intake-emblem">
            <Home size={24} strokeWidth={1.4} />
          </div>
          <div>
            <div className="eyebrow">A NEW PLACE TO BEGIN</div>
            <h2 id="intake-title">First, get to know the home.</h2>
          </div>
          <button className="icon-button" aria-label="Close listing check" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <p className="intake-intro">
          Check a listing for usable photos and a floor plan. Your current home stays open while we
          gather the evidence.
        </p>
        <form
          className="intake-url"
          onSubmit={(e) => {
            e.preventDefault();
            onCheck();
          }}
        >
          <label>
            <Link2 size={17} />
            <input
              type="url"
              autoFocus
              required
              aria-label="Property listing URL"
              placeholder="Paste a property listing URL"
              value={url}
              onChange={(e) => onUrl(e.target.value)}
              disabled={pending}
            />
          </label>
          <button className="primary-button" type="submit" disabled={pending || !url.trim()}>
            {checking ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}
            {checking ? 'Checking listing…' : report ? 'Check again' : 'Check listing'}
          </button>
        </form>
        {checking ? (
          <div className="intake-progress" role="status">
            <LoaderCircle className="spin" size={25} />
            <div>
              <strong>Gathering the pieces.</strong>
              <p>
                Reading the listing, finding images, and checking whether there is enough evidence
                to begin.
              </p>
            </div>
          </div>
        ) : report ? (
          <div className="intake-result">
            <div className={`intake-outcome ${report.status}`}>
              {ready ? <FileCheck2 size={21} /> : <CircleHelp size={21} />}
              <div>
                <span>
                  {ready
                    ? 'SOURCES READY FOR YOUR REVIEW'
                    : report.status === 'failed'
                      ? 'WE COULD NOT READ THIS LISTING'
                      : 'MORE EVIDENCE IS NEEDED'}
                </span>
                <h3>{report.title || 'Listing check'}</h3>
                <p>{report.summary}</p>
              </div>
            </div>
            <div className="intake-checks">
              {report.checks.map((check) => (
                <div className={check.passed ? 'passed' : 'needs-input'} key={check.id}>
                  <span>{check.passed ? <Check size={13} /> : <CircleHelp size={13} />}</span>
                  <div>
                    <strong>{check.label}</strong>
                    <p>{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            {!!sources.length && (
              <div className="intake-sources">
                <div className="eyebrow">FOUND AT THIS PROPERTY · {sources.length} SOURCES</div>
                <div>
                  {sources.map((source) => (
                    <a
                      key={source.id}
                      href={source.localUrl || source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img src={source.localUrl || source.url} alt={source.label} loading="lazy" />
                      <span>{source.kind === 'plan' ? 'Floor plan' : source.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
            {!!report.roomHints.length && (
              <div className="intake-room-hints">
                <span>Rooms mentioned</span>
                {report.roomHints.map((hint) => (
                  <span key={hint}>{hint}</span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="intake-before">
            <div>
              <ImageIcon size={21} />
              <strong>Find the evidence</strong>
              <span>Photos, plans & room clues</span>
            </div>
            <ChevronDown size={16} />
            <div>
              <Eye size={21} />
              <strong>Review the proposal</strong>
              <span>Check rooms & choose items</span>
            </div>
            <ChevronDown size={16} />
            <div>
              <Home size={21} />
              <strong>Step inside</strong>
              <span>Build, inspect & refine</span>
            </div>
          </div>
        )}
        <footer>
          <p>
            {ready
              ? 'Next: interpret these sources. You will approve the room plan and furniture before Blender builds.'
              : 'A source check does not replace the home you are currently exploring.'}
          </p>
          <button className="primary-button" disabled={pending || !ready} onClick={onBuild}>
            Build from these sources <ArrowRight size={15} />
          </button>
        </footer>
      </section>
    </div>
  );
}

function EvidencePair({
  source,
  review,
  onOpen,
}: {
  source?: Source;
  review?: RoomAssessment;
  onOpen: () => void;
}) {
  return (
    <button
      className="room-evidence-pair"
      onClick={onOpen}
      aria-label="Enlarge room source and rendered view"
    >
      <span>
        {source ? (
          <img src={source.localUrl || source.url} alt={source.label} loading="lazy" />
        ) : (
          <span className="evidence-missing">
            <ImageIcon size={20} />
            No matched photo
          </span>
        )}
        <small>Source photo</small>
      </span>
      <span>
        {review?.renderUrl ? (
          <img src={review.renderUrl} alt={`Rendered ${review.roomName}`} loading="lazy" />
        ) : (
          <span className="evidence-missing">
            <Home size={20} />
            Not rendered yet
          </span>
        )}
        <small>Room render</small>
      </span>
    </button>
  );
}

export function RoomEvidencePanel({
  scene,
  reviews = [],
  floorZ,
  pending,
  canReview,
  onSource,
  onRefresh,
  onReview,
  onRepair,
}: {
  scene: SceneSpec;
  reviews?: RoomAssessment[];
  floorZ: number;
  pending: boolean;
  canReview: boolean;
  onSource: (source: Source) => void;
  onRefresh: () => void;
  onReview: () => void;
  onRepair: () => void;
}) {
  const [roomId, setRoomId] = useState(''),
    [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    setRoomId('');
    setExpanded(null);
  }, [scene.id, floorZ]);
  const rooms = scene.rooms.filter((room) => Math.abs(room.floorZ - floorZ) < 0.08);
  const linked = (id: string) =>
    scene.sources.filter(
      (source) =>
        source.kind === 'photo' &&
        (source.roomIds?.includes(id) ||
          scene.rooms.find((room) => room.id === id)?.sourceIds?.includes(source.id) ||
          reviews.find((review) => review.roomId === id)?.sourceIds.includes(source.id)),
    );
  const relevant = roomId ? rooms.filter((room) => room.id === roomId) : rooms;
  const photoCovered = rooms.filter((room) => linked(room.id).length > 0).length;
  const reviewed = rooms.filter((room) =>
    reviews.some((review) => review.roomId === room.id && review.revision === scene.revision),
  ).length;
  const sources = scene.sources.filter((source) => {
    if (source.kind === 'listing') return false;
    if (roomId)
      return (
        source.roomIds?.includes(roomId) ||
        scene.rooms.find((room) => room.id === roomId)?.sourceIds?.includes(source.id) ||
        reviews.find((review) => review.roomId === roomId)?.sourceIds.includes(source.id) ||
        (source.kind === 'plan' &&
          (source.floorZ === undefined || Math.abs(source.floorZ - floorZ) < 0.08))
      );
    if (source.floorZ !== undefined) return Math.abs(source.floorZ - floorZ) < 0.08;
    if (source.roomIds?.length) return rooms.some((room) => source.roomIds?.includes(room.id));
    const assignedRooms = scene.rooms.filter((room) => room.sourceIds?.includes(source.id));
    return (
      !assignedRooms.length || assignedRooms.some((room) => Math.abs(room.floorZ - floorZ) < 0.08)
    );
  });
  const canRefine = reviews.some(
    (review) => review.revision === scene.revision && review.scores.materials < 70,
  );
  const openRoom = rooms.find((room) => room.id === expanded);
  const openReview = reviews.find((review) => review.roomId === expanded);
  const openPhotos = expanded ? linked(expanded) : [];
  return (
    <>
      <div className="panel-heading">
        <div>
          <div className="eyebrow">BUILT FROM EVIDENCE</div>
          <h2>Room by room.</h2>
        </div>
      </div>
      <p className="panel-caption">
        See which details belong to each room, and where the model still needs evidence.
      </p>
      <div className="room-coverage">
        <span>
          <strong>
            {photoCovered}/{rooms.length}
          </strong>{' '}
          rooms have matched photos
        </span>
        <span>
          <strong>
            {reviewed}/{rooms.length}
          </strong>{' '}
          reviewed at this revision
        </span>
      </div>
      <div className="room-evidence-actions">
        <button disabled={pending} onClick={onRefresh}>
          <RefreshCw size={13} /> Find room evidence
        </button>
        <button
          disabled={pending || !canReview}
          title={
            canReview
              ? 'Render and compare every room with its matched photos'
              : 'Approve and build the home before reviewing its rooms'
          }
          onClick={onReview}
        >
          <Eye size={13} /> Review rooms
        </button>
      </div>
      <button
        className="room-refine-button"
        disabled={pending || !canRefine}
        title={
          canRefine
            ? 'Adjust source-informed finishes, render again, and keep changes only if the review improves'
            : 'A current room review with a materials score below 70 is needed'
        }
        onClick={onRepair}
      >
        <WandSparkles size={13} /> Refine room finishes
      </button>
      <p className="room-refine-note">
        Source-based finish changes only. Room shape and missing evidence still need your judgement.
      </p>
      <label className="room-filter">
        <span>Room on this floor</span>
        <select
          aria-label="Filter source evidence by room"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
        >
          <option value="">All rooms on this floor</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </label>
      <div className="room-review-list">
        {relevant.map((room) => {
          const review = reviews.find((candidate) => candidate.roomId === room.id);
          const photos = linked(room.id);
          const fresh = review?.revision === scene.revision;
          const status = !photos.length
            ? 'missing'
            : !review
              ? 'unreviewed'
              : !fresh
                ? 'stale'
                : review.status;
          const label =
            status === 'missing'
              ? 'Photo evidence missing'
              : status === 'unreviewed'
                ? 'Not reviewed yet'
                : status === 'stale'
                  ? 'Review needs updating'
                  : status === 'ready-for-human-review'
                    ? 'Ready for your judgement'
                    : status === 'needs-repair'
                      ? 'Needs refinement'
                      : 'More evidence needed';
          return (
            <article className="room-review-card" key={room.id}>
              <header>
                <h3>{room.name}</h3>
                <span className={`room-status ${status}`}>{label}</span>
              </header>
              <EvidencePair
                source={photos[0]}
                review={review}
                onOpen={() => setExpanded(room.id)}
              />
              {review ? (
                <>
                  <p>{review.summary}</p>
                  {!fresh && (
                    <p className="room-review-stale">
                      Revision {review.revision} review · current scene {scene.revision}
                    </p>
                  )}
                  {photos.length > 0 && (
                    <div className="room-score-row">
                      {(['layout', 'objects', 'materials'] as const).map((key) => (
                        <span key={key}>
                          {key}
                          <strong>
                            {Math.round(review.scores[key])}
                            <small>/100</small>
                          </strong>
                        </span>
                      ))}
                    </div>
                  )}
                  {!!review.recommendations.length && (
                    <details>
                      <summary>
                        What to improve <ChevronDown size={12} />
                      </summary>
                      <ul>
                        {review.recommendations.map((recommendation, i) => (
                          <li key={i}>{recommendation}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p>
                  {photos.length
                    ? `${photos.length} matched photo${photos.length === 1 ? '' : 's'} available. Render this room to compare it with the source.`
                    : 'This room has no matched source photo. Its appearance is an estimate and has not been verified.'}
                </p>
              )}
              {room.appearance && (
                <div className="room-finish-note">
                  <span style={{ background: room.appearance.wallColor }} />
                  <span style={{ background: room.appearance.floorColor }} />
                  <span>
                    {room.appearance.floorMaterial} floor ·{' '}
                    {room.appearance.basis === 'photo'
                      ? 'photo-informed finishes'
                      : 'inferred finishes'}
                  </span>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="room-rubric-note">
        Room scores are provisional model judgements, not measured accuracy. Missing photos never
        count as a verified match.
      </p>
      <details className="room-source-gallery" open={!!roomId}>
        <summary>
          Source images <span>{sources.length}</span>
          <ChevronDown size={13} />
        </summary>
        <div className="source-list">
          {sources.map((source) => (
            <button className="source-card" key={source.id} onClick={() => onSource(source)}>
              <img src={source.localUrl || source.url} alt={source.label} loading="lazy" />
              <span>
                {source.kind === 'plan'
                  ? 'FLOOR PLAN'
                  : source.roomIds?.length
                    ? 'MATCHED SOURCE PHOTO'
                    : 'SOURCE · ROOM NOT ASSIGNED'}
              </span>
              <strong>{source.label}</strong>
              <span className="source-open">
                Compare with your home <ArrowUpRight size={13} />
              </span>
            </button>
          ))}
        </div>
        {!sources.length && <p>No sources are assigned to this room yet.</p>}
      </details>
      <a className="listing-link" href={scene.listingUrl} target="_blank" rel="noreferrer">
        Open the original listing <ArrowUpRight size={14} />
      </a>
      <details className="source-details">
        <summary>What we know & what we estimate</summary>
        {scene.notes.map((note, i) => (
          <p key={i}>{note}</p>
        ))}
      </details>
      {openRoom && (
        <div className="room-compare-backdrop" onClick={() => setExpanded(null)}>
          <section
            className="room-compare-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="room-compare-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">ROOM EVIDENCE</span>
                <h2 id="room-compare-title">{openRoom.name}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close room comparison"
                onClick={() => setExpanded(null)}
              >
                <X size={19} />
              </button>
            </header>
            <div className="room-compare-images">
              <figure>
                {openPhotos[0] ? (
                  <img
                    src={openPhotos[0].localUrl || openPhotos[0].url}
                    alt={openPhotos[0].label}
                  />
                ) : (
                  <div className="large-evidence-empty">
                    <ImageIcon size={32} />
                    <p>No source photo is matched to this room.</p>
                  </div>
                )}
                <figcaption>
                  Original source · {openPhotos[0]?.label || 'Missing evidence'}
                </figcaption>
              </figure>
              <figure>
                {openReview?.renderUrl ? (
                  <img src={openReview.renderUrl} alt={`Rendered ${openRoom.name}`} />
                ) : (
                  <div className="large-evidence-empty">
                    <Home size={32} />
                    <p>This room has not been rendered for review.</p>
                  </div>
                )}
                <figcaption>
                  Reconstructed room{openReview ? ` · revision ${openReview.revision}` : ''}
                </figcaption>
              </figure>
            </div>
            <p>
              {openReview?.summary ||
                'Room comparisons appear here after the evidence and render are available.'}
            </p>
            {openPhotos.length > 1 && (
              <div className="room-additional-sources">
                {openPhotos.slice(1).map((source) => (
                  <button
                    key={source.id}
                    onClick={() => {
                      onSource(source);
                      setExpanded(null);
                    }}
                  >
                    <img src={source.localUrl || source.url} alt={source.label} />
                    <span>{source.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
