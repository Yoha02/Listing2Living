import { useRef, useState } from 'react';
import type { SceneSpec, SceneObject, Verification } from '../shared/types';
import type { WalkerPose } from '../shared/navigation';

interface Props {
  scene: SceneSpec;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  verification: Verification | null;
  showRoute: boolean;
  floorZ?: number;
  walkPose?: Pick<WalkerPose, 'position' | 'floorZ' | 'yaw'> | null;
}
export function PlanView({
  scene,
  selected,
  onSelect,
  onMove,
  verification,
  showRoute,
  floorZ = 0,
  walkPose,
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);
  const rooms = scene.rooms.filter((room) => Math.abs(room.floorZ - floorZ) < 0.01);
  const objects = scene.objects.filter(
    (object) => Math.abs(object.position[2] - object.dimensions[2] / 2 - floorZ) < 0.25,
  );
  const start =
    scene.navigation.levels?.find((level) => Math.abs(level.floorZ - floorZ) < 0.01)?.start ||
    scene.navigation.start;
  const pts = rooms.flatMap((r) => r.polygon);
  const minX = Math.min(...pts.map((p) => p[0])) - 0.6,
    maxX = Math.max(...pts.map((p) => p[0])) + 0.6;
  const minY = Math.min(...pts.map((p) => p[1])) - 0.6,
    maxY = Math.max(...pts.map((p) => p[1])) + 0.6;
  const point = (e: React.PointerEvent) => {
    const p = svg.current!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };
  const object = (o: SceneObject) => {
    const x = drag?.id === o.id ? drag.x : o.position[0],
      y = drag?.id === o.id ? -drag.y : -o.position[1];
    return (
      <g
        key={o.id}
        role="button"
        tabIndex={0}
        aria-label={o.name}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSelect(o.id);
        }}
        transform={`translate(${x} ${y}) rotate(${(-o.rotation * 180) / Math.PI})`}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect(o.id);
          if (o.movable) {
            const p = point(e);
            svg.current?.setPointerCapture(e.pointerId);
            setDrag({
              id: o.id,
              x: o.position[0],
              y: o.position[1],
              ox: p.x - o.position[0],
              oy: -p.y - o.position[1],
            });
          }
        }}
        className={o.movable ? 'plan-object movable' : 'plan-object'}
      >
        <rect
          x={-o.dimensions[0] / 2}
          y={-o.dimensions[1] / 2}
          width={o.dimensions[0]}
          height={o.dimensions[1]}
          rx={o.kind === 'plant' ? 0.16 : 0.06}
          fill={o.kind === 'rug' ? '#e8dfc9' : o.color}
          stroke={selected === o.id ? '#345d4b' : '#797b6d'}
          strokeWidth={selected === o.id ? 0.055 : 0.018}
        />
        {(o.kind === 'sofa' || o.kind === 'desk') && (
          <path
            d={`M ${-o.dimensions[0] / 2 + 0.08} ${-o.dimensions[1] / 2 + 0.18} h ${o.dimensions[0] - 0.16}`}
            stroke="#fff"
            strokeOpacity=".65"
            strokeWidth=".035"
          />
        )}
        {selected === o.id && <circle cy={-o.dimensions[1] / 2 - 0.12} r=".065" fill="#345d4b" />}
      </g>
    );
  };
  return (
    <svg
      ref={svg}
      className="floor-plan"
      viewBox={`${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`}
      aria-label="Interactive floor plan. Select and drag furniture to move it."
      onPointerMove={(e) => {
        if (!drag) return;
        const p = point(e);
        setDrag({ ...drag, x: p.x - drag.ox, y: -p.y - drag.oy });
      }}
      onPointerUp={() => {
        if (drag) {
          onMove(drag.id, drag.x, drag.y);
          setDrag(null);
        }
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerDown={() => onSelect(null)}
    >
      <defs>
        <pattern id="planWood" patternUnits="userSpaceOnUse" width=".35" height="1.4">
          <rect width=".35" height="1.4" fill="#f1eddf" />
          <path d="M 0 0 V 1.4 M 0 .7 H .35" stroke="#e5dfcc" strokeWidth=".012" />
        </pattern>
      </defs>
      {rooms.map((r) => (
        <g key={r.id}>
          <polygon
            points={r.polygon.map((p) => `${p[0]},${-p[1]}`).join(' ')}
            fill="url(#planWood)"
          />
          <text
            x={r.polygon.reduce((a, p) => a + p[0], 0) / r.polygon.length}
            y={-r.polygon.reduce((a, p) => a + p[1], 0) / r.polygon.length}
            textAnchor="middle"
            fill="#909482"
            fontSize=".16"
            pointerEvents="none"
          >
            {r.name}
          </text>
        </g>
      ))}
      {scene.walls
        .filter((wall) => Math.abs((wall.floorZ || 0) - floorZ) < 0.01)
        .map((w) => (
          <g key={w.id}>
            <line
              x1={w.start[0]}
              y1={-w.start[1]}
              x2={w.end[0]}
              y2={-w.end[1]}
              stroke="#59624f"
              strokeWidth={w.thickness}
            />
            {w.openings.map((o) => {
              const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
              const u = [(w.end[0] - w.start[0]) / len, (w.end[1] - w.start[1]) / len];
              return (
                <line
                  key={o.id}
                  x1={w.start[0] + u[0] * (o.offset - o.width / 2)}
                  y1={-(w.start[1] + u[1] * (o.offset - o.width / 2))}
                  x2={w.start[0] + u[0] * (o.offset + o.width / 2)}
                  y2={-(w.start[1] + u[1] * (o.offset + o.width / 2))}
                  stroke={o.type === 'window' ? '#c4d7cf' : '#f9f8f1'}
                  strokeWidth={w.thickness + 0.03}
                />
              );
            })}
          </g>
        ))}
      {scene.stairs.map((s) => (
        <g
          key={s.id}
          transform={`translate(${s.position[0]} ${-s.position[1]}) rotate(${(-s.rotation * 180) / Math.PI})`}
        >
          <rect
            x={-s.dimensions[0] / 2}
            y={-s.dimensions[1] / 2}
            width={s.dimensions[0]}
            height={s.dimensions[1]}
            fill="#e0dfd2"
            stroke="#858c7c"
            strokeWidth=".025"
          />
          {Array.from({ length: s.steps }, (_, i) => (
            <line
              key={i}
              x1={-s.dimensions[0] / 2}
              x2={s.dimensions[0] / 2}
              y1={-s.dimensions[1] / 2 + (i * s.dimensions[1]) / s.steps}
              y2={-s.dimensions[1] / 2 + (i * s.dimensions[1]) / s.steps}
              stroke="#a2a794"
              strokeWidth=".018"
            />
          ))}
        </g>
      ))}
      {objects.filter((o) => o.kind === 'rug').map(object)}
      {objects.filter((o) => o.kind !== 'rug').map(object)}
      {showRoute &&
        verification?.routes
          .filter((route) => Math.abs((route.floorZ || 0) - floorZ) < 0.01)
          .map((r) => (
            <polyline
              key={r.targetId}
              points={r.points.map((p) => `${p[0]},${-p[1]}`).join(' ')}
              fill="none"
              stroke={r.passed ? '#3c8268' : '#c57b59'}
              strokeWidth=".065"
              strokeDasharray=".1 .08"
              pointerEvents="none"
            />
          ))}
      <g transform={`translate(${start[0]} ${-start[1]})`}>
        <circle r=".09" fill="#467460" stroke="white" strokeWidth=".025" />
        <text y=".28" textAnchor="middle" fontSize=".14" fill="#63755f">
          {floorZ > 0 ? 'Landing' : 'Entry'}
        </text>
      </g>
      {walkPose && Math.abs(walkPose.floorZ - floorZ) < 0.1 && (
        <g
          aria-label="Your position"
          pointerEvents="none"
          transform={`translate(${walkPose.position[0]} ${-walkPose.position[1]})`}
        >
          <path
            d="M 0 0 L -.23 -.45 Q 0 -.58 .23 -.45 Z"
            fill="#45644f"
            opacity=".2"
            transform={`rotate(${(walkPose.yaw * 180) / Math.PI})`}
          />
          <circle r=".12" fill="#345d4b" stroke="#fff" strokeWidth=".04" />
          <text y=".32" textAnchor="middle" fontSize=".15" fill="#345d4b">
            You
          </text>
        </g>
      )}
    </svg>
  );
}
