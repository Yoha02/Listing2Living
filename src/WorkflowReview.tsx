import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Eye,
  FileCheck2,
  Info,
  Layers,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import type { AssetProposal, Source, Vec3, WorkflowState, VisualAssessment } from '../shared/types';

interface ApprovalItem {
  id: string;
  selected: boolean;
  dimensions: Vec3;
}
interface ApprovalProps {
  workflow: WorkflowState;
  sources: Source[];
  pending: boolean;
  onApprove: (mode: 'reviewed' | 'suggested', items?: ApprovalItem[]) => void;
  onClose: () => void;
  onAnalyze: () => void;
}
const cm = (n: number) => Math.round(n * 1000) / 10;
export function ApprovalDialog({
  workflow,
  sources,
  pending,
  onApprove,
  onClose,
  onAnalyze,
}: ApprovalProps) {
  const [items, setItems] = useState<AssetProposal[]>(() =>
      workflow.assets.map((a) => ({ ...a, dimensions: [...a.dimensions] })),
    ),
    [selectedPhoto, setSelectedPhoto] = useState<Source | null>(null);
  const editable = workflow.phase === 'awaiting-approval';
  const sourcePlan = sources.find((source) => source.kind === 'plan');
  const suggested = useMemo(
    () => workflow.assets.filter((a) => a.origin === 'suggested').slice(0, 3),
    [workflow.assets],
  );
  const selectedCount = items.filter((a) => a.selected).length,
    invalid = items.some(
      (a) => a.selected && a.dimensions.some((d) => !Number.isFinite(d) || d < 0.01 || d > 20),
    );
  const update = (id: string, patch: Partial<AssetProposal>) =>
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const dimension = (id: string, axis: number, value: string) => {
    const n = Number(value);
    setItems((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const dimensions = [...a.dimensions] as Vec3;
        dimensions[axis] = Number.isFinite(n) ? n / 100 : 0;
        return { ...a, dimensions };
      }),
    );
  };
  return (
    <div className="approval-backdrop">
      <section
        className="approval-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
      >
        <header className="approval-header">
          <div className="approval-emblem">
            <FileCheck2 size={24} strokeWidth={1.4} />
          </div>
          <div>
            <div className="eyebrow">
              {editable ? 'A SMALL PAUSE BEFORE WE BUILD' : 'YOUR HOME’S BLUEPRINT'}
            </div>
            <h2 id="approval-title">
              {editable ? 'Make sure it feels right.' : 'The plan behind your place.'}
            </h2>
            <p>
              {editable
                ? 'Argon has interpreted the plan and proposed the pieces. You decide what goes into your home.'
                : 'Review the dimensions, evidence, and original item proposals used for this reconstruction.'}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Minimize plan review">
            <X size={20} />
          </button>
        </header>
        <div className="approval-body">
          <section className="blueprint-section">
            <div className="section-number">01</div>
            <div className="approval-section-main">
              <div className="approval-section-heading">
                <div>
                  <span className="eyebrow">THE SPACE</span>
                  <h3>A plan we can build from.</h3>
                </div>
                <span className="normalization-tag">Normalized to metres</span>
              </div>
              <p className="approval-summary">
                {workflow.plan?.summary || 'Source interpretation is available below.'}
              </p>
              {sourcePlan && (
                <details className="approval-source-plan">
                  <summary>
                    <Layers size={15} />
                    <strong>View original floor plan</strong>
                    <span>Source evidence</span>
                    <ChevronDown size={14} />
                  </summary>
                  <figure>
                    <button
                      className="approval-plan-image"
                      onClick={() => setSelectedPhoto(sourcePlan)}
                      aria-label="Enlarge the original floor plan"
                    >
                      <img
                        src={sourcePlan.localUrl || sourcePlan.url}
                        alt={sourcePlan.label}
                        loading="lazy"
                      />
                      <span>
                        <Eye size={12} /> Enlarge to inspect dimensions
                      </span>
                    </button>
                    <figcaption>
                      <strong>{sourcePlan.label}</strong>
                      <p>
                        Compare the original dimensions with the room cards below. Ceiling heights
                        and unlabelled details in the reconstruction may be estimates.
                      </p>
                      <a href={sourcePlan.url} target="_blank" rel="noreferrer">
                        Open original source <ArrowUpRight size={12} />
                      </a>
                    </figcaption>
                  </figure>
                </details>
              )}
              <div className="room-cards">
                {workflow.plan?.rooms.map((room) => (
                  <div className="room-card" key={room.roomId}>
                    <div>
                      <strong>{room.name}</strong>
                      <span className={`basis-tag ${room.dimensionBasis}`}>
                        {room.dimensionBasis === 'plan'
                          ? 'Plan dimensions'
                          : 'Estimated dimensions'}
                      </span>
                    </div>
                    <div className="room-measures">
                      <span>
                        {room.width.toFixed(2)} <i>×</i> {room.depth.toFixed(2)} <small>m</small>
                      </span>
                      <span>
                        {room.ceilingHeight.toFixed(2)} m <small>ceiling</small>
                      </span>
                    </div>
                    <p>{room.evidence}</p>
                    <span className="confidence-note">
                      {room.confidence} confidence · Ceiling height may be inferred
                    </span>
                  </div>
                ))}
              </div>
              {workflow.plan?.scaleNote && (
                <div className="scale-note">
                  <Info size={14} />
                  <span>{workflow.plan.scaleNote}</span>
                </div>
              )}
              {!!workflow.plan?.uncertainties.length && (
                <details className="uncertainty-list" open>
                  <summary>
                    <ShieldCheck size={14} /> What still needs judgement <ChevronDown size={13} />
                  </summary>
                  <ul>
                    {workflow.plan.uncertainties.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </section>
          <section className="assets-section">
            <div className="section-number">02</div>
            <div className="approval-section-main">
              <div className="approval-section-heading">
                <div>
                  <span className="eyebrow">THE THINGS THAT MAKE IT HOME</span>
                  <h3>{editable ? 'Choose what comes inside.' : 'The proposed pieces.'}</h3>
                </div>
                <span className="selection-count">{selectedCount} selected</span>
              </div>
              <p className="approval-summary">
                Items observed in photos and suggested furniture are labelled separately.
                Photo-derived sizes are estimates; adjust them before building.
              </p>
              {items.length > 0 ? (
                <div className="proposal-grid">
                  {items.map((item) => {
                    const source =
                      item.sourceIds
                        .map((id) => sources.find((s) => s.id === id))
                        .find((s) => s && s.kind === 'photo') ||
                      item.sourceIds.map((id) => sources.find((s) => s.id === id)).find(Boolean);
                    const isSuggested = suggested.some((s) => s.id === item.id);
                    return (
                      <article
                        key={item.id}
                        className={`proposal-card ${item.selected ? 'selected' : ''}`}
                      >
                        <div className="proposal-top">
                          <label className="proposal-choice">
                            <input
                              type="checkbox"
                              checked={item.selected}
                              disabled={!editable || pending}
                              onChange={(e) => update(item.id, { selected: e.target.checked })}
                            />
                            <span>
                              <Check size={12} />
                            </span>
                            <strong>{item.name}</strong>
                          </label>
                          <span className={`origin-label ${item.origin}`}>
                            {item.origin === 'photo' ? 'From a photo' : 'Suggested piece'}
                          </span>
                        </div>
                        <div className="proposal-content">
                          {source ? (
                            <button
                              className="proposal-source"
                              aria-label={`Inspect source for ${item.name}`}
                              onClick={() => setSelectedPhoto(source)}
                            >
                              <img
                                src={source.localUrl || source.url}
                                alt={`Source evidence for ${item.name}`}
                              />
                              <span>
                                <Eye size={11} /> Source image
                              </span>
                            </button>
                          ) : (
                            <div className="proposal-no-source">
                              <Layers size={28} strokeWidth={1} />
                              <span>
                                {item.origin === 'suggested'
                                  ? 'A fresh addition'
                                  : 'No source preview'}
                              </span>
                            </div>
                          )}
                          <div className="proposal-description">
                            <span className="proposal-kind">
                              {item.kind} <span>·</span> {item.confidence} confidence
                            </span>
                            <p>{item.sourceDescription}</p>
                            {isSuggested && (
                              <span className="suggested-set">
                                <Sparkles size={10} /> Included in the quick-start set
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="dimension-inputs">
                          {(['Width', 'Depth', 'Height'] as const).map((axis, index) => (
                            <label key={axis}>
                              <span>{axis}</span>
                              <div>
                                <input
                                  type="number"
                                  min="1"
                                  max="2000"
                                  step="1"
                                  value={cm(item.dimensions[index])}
                                  aria-label={`${item.name} ${axis.toLowerCase()} in centimetres`}
                                  disabled={!editable || pending}
                                  onChange={(e) => dimension(item.id, index, e.target.value)}
                                />
                                <span>cm</span>
                              </div>
                            </label>
                          ))}
                        </div>
                        <details className="dimension-reason">
                          <summary>
                            How this size was estimated <ChevronDown size={11} />
                          </summary>
                          <p>{item.dimensionReasoning}</p>
                        </details>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="proposal-empty">
                  <Layers size={24} />
                  <p>
                    No movable items were identified. You can build the empty space and furnish it
                    afterwards.
                  </p>
                </div>
              )}
              {suggested.length > 0 && editable && (
                <div className="quick-start-note">
                  <Sparkles size={16} />
                  <div>
                    <strong>Want to step inside sooner?</strong>
                    <p>
                      The quick-start set uses {suggested.map((a) => a.name).join(', ')} with their
                      proposed dimensions.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
        <footer className="approval-footer">
          <div>
            <ShieldCheck size={14} />
            <span>
              {editable
                ? 'Blender waits for your approval. Nothing here is built automatically.'
                : 'Structural and source changes need another plan review before rebuilding.'}
            </span>
          </div>
          {editable ? (
            <div className="approval-footer-actions">
              {suggested.length > 0 && (
                <button
                  className="secondary-button"
                  disabled={pending}
                  onClick={() => onApprove('suggested')}
                >
                  <Sparkles size={14} /> Use {suggested.length} suggested{' '}
                  {suggested.length === 1 ? 'item' : 'items'}
                </button>
              )}
              <button
                className="primary-button"
                disabled={pending || invalid}
                onClick={() =>
                  onApprove(
                    'reviewed',
                    items.map((a) => ({
                      id: a.id,
                      selected: a.selected,
                      dimensions: a.dimensions,
                    })),
                  )
                }
              >
                {pending ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Approve{' '}
                {selectedCount === 0
                  ? 'empty space'
                  : `${selectedCount} ${selectedCount === 1 ? 'item' : 'items'}`}{' '}
                & build
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <button className="primary-button" disabled={pending} onClick={onAnalyze}>
              Analyze sources again <ArrowRight size={14} />
            </button>
          )}
          {invalid && (
            <p className="dimension-error">
              Selected item dimensions must be between 1 and 2,000 cm.
            </p>
          )}
        </footer>
      </section>
      {selectedPhoto && (
        <div className="source-lightbox" onClick={() => setSelectedPhoto(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <header>
              <span>{selectedPhoto.label}</span>
              <button
                className="icon-button"
                aria-label="Close source preview"
                onClick={() => setSelectedPhoto(null)}
              >
                <X size={19} />
              </button>
            </header>
            <img src={selectedPhoto.localUrl || selectedPhoto.url} alt={selectedPhoto.label} />
            <a href={selectedPhoto.url} target="_blank" rel="noreferrer">
              Open original source <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function VisualReviewPanel({
  review,
  sceneRevision,
  iterations,
  maxIterations,
  pending,
  onRepair,
  onPlan,
}: {
  review: VisualAssessment;
  sceneRevision: number;
  iterations: number;
  maxIterations: number;
  pending: boolean;
  onRepair: () => void;
  onPlan: () => void;
}) {
  const needsPlan = review.findings.some(
      (f) => f.category === 'structure' || f.category === 'evidence',
    ),
    canRepair =
      review.findings.some((f) => f.category === 'placement' || f.category === 'appearance') &&
      iterations < maxIterations,
    stale = review.revision !== sceneRevision;
  return (
    <section className="assessment">
      <div className="eyebrow">ARGON’S RENDERED-VIEW REVIEW</div>
      <h4>
        {review.status === 'ready-for-human-review'
          ? 'Ready for your judgement.'
          : review.status === 'insufficient-evidence'
            ? 'A little more evidence is needed.'
            : 'A few things to revisit.'}
      </h4>
      <p>{review.summary}</p>
      {stale && (
        <div className="stale-message">
          This assessment is from revision {review.revision}. The current scene is revision{' '}
          {sceneRevision}; inspect it again before relying on these findings.
        </div>
      )}
      <div className="rubric-scores">
        {(['layout', 'objects', 'materials'] as const).map((key) => (
          <div key={key}>
            <span>{key[0].toUpperCase() + key.slice(1)}</span>
            <strong>
              {Math.round(review.scores[key])}
              <small>/100</small>
            </strong>
            <div className="rubric-track">
              <i style={{ width: `${Math.max(0, Math.min(100, review.scores[key]))}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="rubric-note">
        Provisional visual rubric · review threshold {review.threshold}/100. These are model
        judgements, not measured accuracy or a realism percentage.
      </p>
      <div className="assessment-findings">
        {review.findings.map((f) => (
          <div key={f.id} className={`assessment-finding ${f.severity}`}>
            <div>
              <span>{f.category}</span>
              <span>{f.severity === 'major' ? 'Needs attention' : 'Small improvement'}</span>
            </div>
            <strong>{f.message}</strong>
            <p>{f.recommendation}</p>
            {(f.category === 'structure' || f.category === 'evidence') && (
              <span className="human-review-label">
                <FileCheck2 size={11} /> Returns to plan review
              </span>
            )}
          </div>
        ))}
      </div>
      {needsPlan && (
        <button className="secondary-button assessment-button" onClick={onPlan}>
          <FileCheck2 size={14} /> Review source & plan
        </button>
      )}
      {canRepair && (
        <button
          className="primary-button assessment-button"
          disabled={pending || stale}
          onClick={onRepair}
        >
          <WandSparkles size={14} /> Repair & inspect again
        </button>
      )}
      <div className="iteration-note">
        {iterations} of {maxIterations} automatic visual repair passes used.
        {iterations >= maxIterations ? ' Further changes need your review.' : ''}
      </div>
    </section>
  );
}
