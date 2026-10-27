import { useUITranslation } from "../i18n";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AudioLines,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Film,
  LockKeyhole,
  Link2,
  Magnet,
  MoreHorizontal,
  MousePointer2,
  Music2,
  Pencil,
  Plus,
  Redo2,
  Scissors,
  Trash2,
  Type,
  Undo2,
  UnlockKeyhole,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Clip, Project, Track, TrackKind } from "../core/types";
import { linkedIds, trimLinked } from "../core/timelineEdits";
import { snapToFrame } from "../core/model";
import "./Timeline.css";

export interface TimelineProps {
  project: Project;
  selectedIds: string[];
  playhead: number;
  playing: boolean;
  zoom: number;
  onSeek: (time: number) => void;
  onSelect: (ids: string[]) => void;
  onClipUpdate: (id: string, patch: Partial<Clip>) => void;
  onMoveClips: (ids: string[], delta: number, trackId?: string) => void;
  onTrim: (id: string, edge: "start" | "end", time: number) => void;
  onSplit: () => void;
  onDelete: () => void;
  onZoom: (zoom: number) => void;
  onTrackUpdate: (id: string, patch: Partial<Track>) => void;
  onAddTrack: (kind: TrackKind) => void;
  onTrackDelete?: (id: string) => void;
  onTrackMove?: (id: string, direction: "up" | "down") => void;
  onDropAsset?: (assetId: string, time: number, trackId: string) => void;
  snapping?: boolean;
  onSnappingChange?: (value: boolean) => void;
  magnetic?: boolean;
  onMagneticChange?: (value: boolean) => void;
  onDuplicate?: () => void;
  onAddText?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

const GUTTER = 158;
const ROW = 70;
const RULER = 30;
export const ASSET_DRAG_TYPE = "application/x-reacut-asset";
export function formatTimelineTime(seconds: number, fps = 30) {
  const frames = Math.max(0, Math.round(seconds * fps));
  const secs = Math.floor(frames / fps);
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}:${String(frames % fps).padStart(2, "0")}`;
}
export function snapTimelineTime(
  time: number,
  candidates: number[],
  threshold: number,
) {
  let nearest = time;
  let distance = threshold;
  for (const candidate of candidates) {
    const diff = Math.abs(candidate - time);
    if (diff < distance) {
      nearest = candidate;
      distance = diff;
    }
  }
  return nearest;
}
export function formatRulerTime(seconds: number, fractional = false) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${fractional ? remainder.toFixed(1).padStart(4, "0") : String(Math.round(remainder)).padStart(2, "0")}`;
}
export function rulerInterval(pixelsPerSecond: number) {
  return (
    [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(
      (n) => n * pixelsPerSecond >= 76,
    ) ?? 1200
  );
}
/** Separate overlapping intervals into visual sublanes without changing project tracks. */
export function layoutTrackClips(clips: Clip[]) {
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    let lane = ends.findIndex((end) => end <= clip.start + 0.00001);
    if (lane < 0) lane = ends.length;
    ends[lane] = clip.start + clip.duration;
    lanes.set(clip.id, lane);
  }
  return {
    lanes,
    count: Math.max(1, ends.length),
    height: Math.max(ROW, ends.length * 62 + 8),
  };
}
export function canMoveToTrack(clip: Clip, track: Track, project: Project) {
  if (track.locked) return false;
  if (clip.text) return track.kind === "text";
  const kind =
    project.assets.find((a) => a.id === clip.assetId)?.kind ??
    project.tracks.find((t) => t.id === clip.trackId)?.kind;
  return kind === "audio"
    ? track.kind === "audio"
    : kind === "video"
      ? track.kind === "video"
      : kind === "image" && ["video", "image"].includes(track.kind);
}
export function waveformSamples(
  clip: Clip,
  waveform: number[],
  count: number,
  sourceDuration: number,
) {
  if (!waveform.length || sourceDuration <= 0)
    return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_, i) => {
    const at =
      clip.sourceIn + (i / Math.max(1, count - 1)) * clip.duration * clip.speed;
    const index = Math.max(
      0,
      Math.min(
        waveform.length - 1,
        Math.floor((at / sourceDuration) * waveform.length),
      ),
    );
    return waveform[index];
  });
}
function TrackIcon({ kind }: { kind: TrackKind }) {
  return kind === "audio" ? (
    <Music2 size={15} />
  ) : kind === "text" ? (
    <Type size={15} />
  ) : (
    <Film size={15} />
  );
}
type Gesture =
  | {
      kind: "move";
      ids: string[];
      delta: number;
      primaryId: string;
      trackId: string;
      targetTrackId: string;
    }
  | { kind: "trim"; id: string; edge: "start" | "end"; time: number }
  | { kind: "marquee"; x: number; y: number; width: number; height: number };

export default function Timeline(props: TimelineProps) {
  const ui = useUITranslation();
  const { project, selectedIds, playhead, zoom, onSeek, onSelect } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLElement>(null);
  const frozenLayoutsRef = useRef<Array<
    ReturnType<typeof layoutTrackClips> & { id: string; top: number }
  > | null>(null);
  const renameDraftRef = useRef("");
  const renameCancelledRef = useRef(false);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    trackId: string;
    time: number;
  } | null>(null);
  const [trackActions, setTrackActions] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleteTrackId, setDeleteTrackId] = useState<string | null>(null);
  const [trackMenu, setTrackMenu] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [localSnap, setLocalSnap] = useState(true);
  const [localMagnetic, setLocalMagnetic] = useState(false);
  const snapping = props.snapping ?? localSnap;
  const magnetic = props.magnetic ?? localMagnetic;
  const pps = Math.max(5, Math.min(400, zoom));
  const duration = Math.max(
    30,
    (viewportWidth - GUTTER) / pps,
    ...project.clips.map((c) => c.start + c.duration + 10),
    playhead + 8,
  );
  const bodyWidth = duration * pps;
  const interval = rulerInterval(pps);
  const ticks = Array.from(
    { length: Math.ceil(duration / interval) + 1 },
    (_, i) => i * interval,
  );
  const setActiveGesture = (g: Gesture | null) => {
    if (g && g.kind !== "marquee" && !frozenLayoutsRef.current)
      frozenLayoutsRef.current = trackLayouts.map((layout) => ({
        ...layout,
        lanes: new Map(layout.lanes),
      }));
    if (!g) frozenLayoutsRef.current = null;
    gestureRef.current = g;
    setGesture(g);
  };
  const trimPreview = gesture?.kind === "trim" ? trimLinked(project, gesture.id, gesture.edge, gesture.time) : project;
  const displayClip = (clip: Clip) => {
    if (gesture?.kind === "move" && gesture.ids.includes(clip.id))
      return {
        ...clip,
        start: Math.max(0, clip.start + gesture.delta),
        trackId:
          gesture.targetTrackId !== gesture.trackId &&
          canMoveToTrack(
            clip,
            project.tracks.find((t) => t.id === gesture.targetTrackId)!,
            project,
          )
            ? gesture.targetTrackId
            : clip.trackId,
      };
    if (gesture?.kind === "trim") return trimPreview.clips.find(c => c.id === clip.id) ?? clip;
    return clip;
  };
  const clips = project.clips.map(displayClip);
  let trackTop = 0;
  const trackLayouts = project.tracks.map((track) => {
    const live = layoutTrackClips(clips.filter((c) => c.trackId === track.id));
    const frozen =
      gesture && gesture.kind !== "marquee"
        ? frozenLayoutsRef.current?.find((layout) => layout.id === track.id)
        : undefined;
    const layout = frozen
      ? {
          ...live,
          height: frozen.height,
          count: frozen.count,
          lanes: frozen.lanes,
        }
      : live;
    const result = { ...layout, id: track.id, top: trackTop };
    trackTop += layout.height;
    return result;
  });
  const tracksHeight = trackTop;
  const actionTrack = project.tracks.find(
    (track) => track.id === trackActions?.id,
  );
  const actionIndex = project.tracks.findIndex(
    (track) => track.id === actionTrack?.id,
  );
  const deletionTrack = project.tracks.find(
    (track) => track.id === deleteTrackId,
  );
  const deletionCount = project.clips.filter(
    (clip) => clip.trackId === deleteTrackId,
  ).length;
  const beginRename = (track: Track) => {
    if (track.locked) return;
    setTrackActions(null);
    renameDraftRef.current = track.name;
    renameCancelledRef.current = false;
    setRenamingId(track.id);
  };
  const finishRename = () => {
    const track = project.tracks.find((track) => track.id === renamingId);
    const name = renameDraftRef.current.trim();
    if (!renameCancelledRef.current && track && !track.locked && name)
      props.onTrackUpdate(track.id, { name });
    setRenamingId(null);
  };
  const requestTrackDelete = (track: Track) => {
    if (track.locked || !props.onTrackDelete) return;
    setTrackActions(null);
    if (project.clips.some((clip) => clip.trackId === track.id))
      setDeleteTrackId(track.id);
    else props.onTrackDelete(track.id);
  };
  useEffect(() => {
    renameCancelledRef.current = true;
    setRenamingId(null);
    setTrackActions(null);
    setDeleteTrackId(null);
    setTrackMenu(false);
    pointerCleanupRef.current?.();
    gestureRef.current = null;
    frozenLayoutsRef.current = null;
    setGesture(null);
    setSnapLine(null);
  }, [project.id]);
  useEffect(() => {
    if (!trackActions) return;
    actionsMenuRef.current
      ?.querySelector<HTMLButtonElement>("button:not([disabled])")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".tl-track-action-menu,.tl-track-more")
      )
        setTrackActions(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTrackActions(null);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
    };
  }, [trackActions]);
  useEffect(() => {
    if (!deleteTrackId) return;
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Tab") {
        const buttons = Array.from(
          confirmRef.current?.querySelectorAll<HTMLButtonElement>(
            "button:not([disabled])",
          ) ?? [],
        );
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (
          (event.shiftKey && current <= 0) ||
          (!event.shiftKey && current === buttons.length - 1)
        ) {
          event.preventDefault();
          buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus();
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDeleteTrackId(null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [deleteTrackId]);
  useEffect(() => () => pointerCleanupRef.current?.(), []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    observer.observe(el);
    setViewportWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  const listenForGesture = (
    move: (event: PointerEvent) => void,
    finish: () => void,
  ) => {
    pointerCleanupRef.current?.();
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      pointerCleanupRef.current = null;
    };
    const end = () => {
      cleanup();
      finish();
    };
    const cancel = () => {
      cleanup();
      setActiveGesture(null);
      setSnapLine(null);
    };
    pointerCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  };
  const locate = (clientX: number, clientY: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, clientX - rect.left + el.scrollLeft - GUTTER),
      y: clientY - rect.top + el.scrollTop - RULER,
    };
  };
  const targetTrack = (clientY: number) => {
    const y = locate(0, clientY).y;
    const index = trackLayouts.findIndex(
      (layout) => y < layout.top + layout.height,
    );
    return project.tracks[index < 0 ? project.tracks.length - 1 : index];
  };
  const snap = (time: number, excluded: string[], offset = 0) => {
    const candidates = [
      0,
      playhead,
      ...project.clips
        .filter((c) => !excluded.includes(c.id))
        .flatMap((c) => [c.start, c.start + c.duration]),
    ];
    const value = snapping
      ? snapTimelineTime(time + offset, candidates, 8 / pps) - offset
      : time;
    setSnapLine(Math.abs(value - time) > 0.0001 ? value + offset : null);
    return value;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        props.onZoom(
          Math.max(5, Math.min(400, pps * (event.deltaY < 0 ? 1.12 : 0.89))),
        );
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [pps, props.onZoom]);
  useEffect(() => {
    if (!props.playing || gestureRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - GUTTER - 32)
      el.scrollLeft = Math.max(0, x - (el.clientWidth - GUTTER) * 0.3);
    else if (x < el.scrollLeft) el.scrollLeft = x;
  }, [playhead, pps, props.playing]);

  const startClip = (
    event: ReactPointerEvent,
    clip: Clip,
    trim?: "start" | "end",
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    const groupIds = linkedIds(project, [clip.id]);
    const ids = selectedIds.includes(clip.id)
      ? additive && !trim
        ? selectedIds.filter((id) => !groupIds.includes(id))
        : [clip.id, ...selectedIds.filter(id => id !== clip.id)]
      : additive
        ? [...new Set([...selectedIds, ...groupIds])]
        : groupIds;
    onSelect(ids);
    if (additive && !ids.includes(clip.id)) return;
    const startX = event.clientX,
      startY = event.clientY;
    if (project.clips.some(c => ids.includes(c.id) && project.tracks.find(t => t.id === c.trackId)?.locked)) return;
    const movable = ids.filter(
      (id) =>
        !project.tracks.find(
          (t) => t.id === project.clips.find((c) => c.id === id)?.trackId,
        )?.locked,
    );
    const earliest = Math.min(
      ...project.clips
        .filter((c) => movable.includes(c.id))
        .map((c) => c.start),
    );
    const el = scrollRef.current!;
    const startScroll = el.scrollLeft;
    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.clientX > rect.right - 28) el.scrollLeft += 12;
      if (e.clientX < rect.left + GUTTER + 20) el.scrollLeft -= 12;
      const delta = (e.clientX - startX + el.scrollLeft - startScroll) / pps;
      if (
        !gestureRef.current &&
        Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 3
      )
        return;
      if (trim) {
        let time = snap(
          (trim === "start" ? clip.start : clip.start + clip.duration) + delta,
          groupIds,
        );
        time =
          trim === "start"
            ? Math.max(
                0,
                Math.min(clip.start + clip.duration - 1 / project.fps, time),
              )
            : Math.max(clip.start + 1 / project.fps, time);
        const asset = project.assets.find((a) => a.id === clip.assetId);
        if (asset && asset.kind !== "image") {
          if (trim === "start")
            time = Math.max(clip.start - clip.sourceIn / clip.speed, time);
          else
            time = Math.min(
              clip.start + (asset.duration - clip.sourceIn) / clip.speed,
              time,
            );
        }
        setActiveGesture({
          kind: "trim",
          id: clip.id,
          edge: trim,
          time: snapToFrame(time, project.fps),
        });
      } else {
        let adjusted = Math.max(-earliest, delta);
        const startSnap = snap(clip.start + adjusted, movable);
        if (Math.abs(startSnap - clip.start - adjusted) > 0.0001)
          adjusted = startSnap - clip.start;
        else {
          const endSnap = snap(clip.start + adjusted, movable, clip.duration);
          adjusted = endSnap - clip.start;
        }
        adjusted = Math.max(-earliest, adjusted);
        const candidate = targetTrack(e.clientY);
        const compatible =
          candidate && canMoveToTrack(clip, candidate, project);
        setActiveGesture({
          kind: "move",
          ids: movable,
          delta: snapToFrame(adjusted, project.fps),
          primaryId: clip.id,
          trackId: clip.trackId,
          targetTrackId: compatible ? candidate.id : clip.trackId,
        });
      }
    };
    const finish = () => {
      const g = gestureRef.current;
      if (
        g?.kind === "move" &&
        (Math.abs(g.delta) > 0.001 || g.targetTrackId !== g.trackId)
      )
        props.onMoveClips(
          g.ids,
          g.delta,
          g.targetTrackId !== g.trackId ? g.targetTrackId : undefined,
        );
      if (g?.kind === "trim") props.onTrim(g.id, g.edge, g.time);
      setActiveGesture(null);
      setSnapLine(null);
    };
    listenForGesture(move, finish);
  };
  const scrub = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSeek(Math.max(0, locate(event.clientX, event.clientY).x / pps));
    const move = (e: PointerEvent) =>
      onSeek(Math.max(0, locate(e.clientX, e.clientY).x / pps));
    const finish = () => {};
    listenForGesture(move, finish);
  };
  const startSelection = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const start = locate(event.clientX, event.clientY);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const previous = additive ? selectedIds : [];
    let moved = false;
    const move = (e: PointerEvent) => {
      const current = locate(e.clientX, e.clientY);
      if (Math.abs(current.x - start.x) + Math.abs(current.y - start.y) < 5)
        return;
      moved = true;
      const x = Math.min(start.x, current.x),
        y = Math.min(start.y, current.y),
        width = Math.abs(start.x - current.x),
        height = Math.abs(start.y - current.y);
      setActiveGesture({ kind: "marquee", x, y, width, height });
      const found = project.clips
        .filter((c) => {
          const row = project.tracks.findIndex((t) => t.id === c.trackId);
          return (
            !project.tracks[row]?.locked &&
            c.start * pps < x + width &&
            (c.start + c.duration) * pps > x &&
            trackLayouts[row] &&
            trackLayouts[row].top +
              8 +
              (trackLayouts[row].lanes.get(c.id) ?? 0) * 62 +
              54 >
              y &&
            trackLayouts[row].top +
              8 +
              (trackLayouts[row].lanes.get(c.id) ?? 0) * 62 <
              y + height
          );
        })
        .map((c) => c.id);
      onSelect([...new Set([...previous, ...found])]);
    };
    const finish = () => {
      if (!moved) {
        onSeek(start.x / pps);
        if (!additive) onSelect([]);
      }
      setActiveGesture(null);
    };
    listenForGesture(move, finish);
  };
  const selectedUnlocked = selectedIds.some((id) => {
    const c = project.clips.find((c) => c.id === id);
    return c && !project.tracks.find((t) => t.id === c.trackId)?.locked;
  });
  const onDrop = (event: React.DragEvent, track: Track) => {
    event.preventDefault();
    setDropTarget(null);
    const id =
      event.dataTransfer.getData(ASSET_DRAG_TYPE) ||
      event.dataTransfer.getData("assetid");
    const asset = project.assets.find((a) => a.id === id);
    if (
      asset &&
      !asset.missing &&
      !track.locked &&
      (asset.kind === track.kind ||
        (asset.kind === "image" && track.kind === "video"))
    )
      props.onDropAsset?.(
        id,
        snapToFrame(
          Math.max(0, locate(event.clientX, event.clientY).x / pps),
          project.fps,
        ),
        track.id,
      );
  };

  return (
    <section
      className="tl"
      aria-label={ui("多轨时间线", "Multitrack timeline")}
      style={
        {
          "--tl-row": `${ROW}px`,
          "--tl-gutter": `${GUTTER}px`,
        } as CSSProperties
      }
    >
      <div className="tl-toolbar">
        <div className="tl-toolbar-group">
          <button
            title={ui("撤销 · ⌘Z", "Undo · ⌘Z")}
            aria-label={ui("撤销", "Undo")}
            onClick={props.onUndo}
            disabled={!props.canUndo}
          >
            <Undo2 size={17} />
          </button>
          <button
            title={ui("重做 · ⇧⌘Z", "Redo · ⇧⌘Z")}
            aria-label={ui("重做", "Redo")}
            onClick={props.onRedo}
            disabled={!props.canRedo}
          >
            <Redo2 size={17} />
          </button>
          <span className="tl-divider" />
          <span
            className="tl-tool-indicator"
            title={ui("选择工具 · 拖动空白区域可框选", "Selection tool · Drag an empty area to select clips")}
            aria-label={ui("选择工具", "Selection tool")}
          >
            <MousePointer2 size={16} />
          </span>
          <button
            title={ui("在播放位置分割 · ⌘B", "Split at playhead · ⌘B")}
            aria-label={ui("分割片段", "Split clip")}
            onClick={props.onSplit}
            disabled={
              !project.clips.some(
                (c) =>
                  !project.tracks.find((t) => t.id === c.trackId)?.locked &&
                  (!selectedIds.length || selectedIds.includes(c.id)) &&
                  c.start < playhead &&
                  c.start + c.duration > playhead,
              )
            }
          >
            <Scissors size={17} />
          </button>
          <button
            title={ui("复制选中片段", "Duplicate selected clips")}
            aria-label={ui("复制选中片段", "Duplicate selected clips")}
            onClick={props.onDuplicate}
            disabled={!selectedUnlocked || !props.onDuplicate}
          >
            <Copy size={16} />
          </button>
          <button
            title={ui("删除选中片段 · Backspace", "Delete selected clips · Backspace")}
            aria-label={ui("删除选中片段", "Delete selected clips")}
            onClick={props.onDelete}
            disabled={!selectedUnlocked}
          >
            <Trash2 size={16} />
          </button>
          <span className="tl-divider" />
          <button
            className={magnetic ? "is-active" : ""}
            title={
              magnetic
                ? ui("关闭磁性删除（删除后收拢间隙）", "Disable ripple delete (close gaps after deletion)")
                : ui("打开磁性删除（删除后收拢间隙）", "Enable ripple delete (close gaps after deletion)")
            }
            aria-label={ui("磁性删除", "Ripple delete")}
            aria-pressed={magnetic}
            onClick={() => {
              setLocalMagnetic(!magnetic);
              props.onMagneticChange?.(!magnetic);
            }}
          >
            <Magnet size={17} />
          </button>
          <button
            className={snapping ? "is-active" : ""}
            title={snapping ? ui("关闭时间线吸附", "Disable timeline snapping") : ui("打开时间线吸附", "Enable timeline snapping")}
            aria-label={ui("时间线吸附", "Timeline snapping")}
            aria-pressed={snapping}
            onClick={() => {
              setLocalSnap(!snapping);
              props.onSnappingChange?.(!snapping);
            }}
          >
            <span className="tl-snap-icon">][</span>
          </button>
        </div>
        <div className="tl-toolbar-end">
          <span className="tl-duration">
            {formatTimelineTime(playhead, project.fps)} <i>/</i>{" "}
            {formatTimelineTime(
              Math.max(0, ...project.clips.map((c) => c.start + c.duration)),
              project.fps,
            )}
          </span>
          <button
            title={ui("缩小时间线", "Zoom out timeline")}
            aria-label={ui("缩小时间线", "Zoom out timeline")}
            onClick={() => props.onZoom(Math.max(5, pps / 1.25))}
          >
            <ZoomOut size={16} />
          </button>
          <input
            aria-label={ui("时间线缩放", "Timeline zoom")}
            type="range"
            min="5"
            max="400"
            value={pps}
            onChange={(e) => props.onZoom(Number(e.target.value))}
          />
          <button
            title={ui("放大时间线", "Zoom in timeline")}
            aria-label={ui("放大时间线", "Zoom in timeline")}
            onClick={() => props.onZoom(Math.min(400, pps * 1.25))}
          >
            <ZoomIn size={16} />
          </button>
          <button
            className="tl-fit"
            title={ui("适配整个项目", "Fit entire project")}
            onClick={() => {
              const width =
                (scrollRef.current?.clientWidth ?? 900) - GUTTER - 60;
              props.onZoom(
                Math.max(
                  5,
                  Math.min(
                    400,
                    width /
                      Math.max(
                        10,
                        ...project.clips.map((c) => c.start + c.duration),
                      ),
                  ),
                ),
              );
              if (scrollRef.current) scrollRef.current.scrollLeft = 0;
            }}
          >
            {ui("适配", "Fit")}</button>
        </div>
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        <div
          className="tl-content"
          style={{
            width: bodyWidth + GUTTER,
            minWidth: "100%",
            minHeight: "100%",
          }}
        >
          <div className="tl-ruler" style={{ height: RULER }}>
            <div className="tl-ruler-label">
              {ui("时间线", "Timeline")}<span>{project.fps} FPS</span>
            </div>
            <div
              className="tl-ruler-body"
              onPointerDown={scrub}
              style={{ width: bodyWidth }}
            >
              {ticks.map((t) => (
                <div className="tl-tick" key={t} style={{ left: t * pps }}>
                  <span>{formatRulerTime(t, interval < 1)}</span>
                  <i />
                </div>
              ))}
              <div
                className="tl-ruler-playhead"
                style={{ left: playhead * pps }}
              >
                <div
                  className="tl-playhead-handle"
                  role="slider"
                  tabIndex={0}
                  aria-label={ui("播放位置", "Playhead position")}
                  aria-valuenow={playhead}
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuetext={formatTimelineTime(playhead, project.fps)}
                  onPointerDown={scrub}
                  onKeyDown={(event) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      onSeek(
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? Math.max(
                                0,
                                ...project.clips.map(
                                  (c) => c.start + c.duration,
                                ),
                              )
                            : Math.max(
                                0,
                                playhead +
                                  (event.key === "ArrowLeft" ? -1 : 1) *
                                    (event.shiftKey ? 1 : 1 / project.fps),
                              ),
                      );
                    }
                  }}
                />
              </div>
            </div>
          </div>
          {project.tracks.map((track, index) => (
            <div
              className={`tl-track tl-track-${track.kind} ${track.locked ? "is-locked" : ""} ${dropTarget?.trackId === track.id ? "is-drop-target" : ""}`}
              key={track.id}
              data-track-id={track.id}
              style={{ height: trackLayouts[index].height }}
            >
              <div className="tl-track-header">
                <div className="tl-track-title">
                  <TrackIcon kind={track.kind} />
                  {renamingId === track.id ? (
                    <input
                      className="tl-track-name-input"
                      aria-label={ui("轨道名称", "Track name")}
                      autoFocus
                      defaultValue={track.name}
                      maxLength={256}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => {
                        renameDraftRef.current = event.target.value;
                      }}
                      onBlur={finishRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          finishRename();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          renameCancelledRef.current = true;
                          setRenamingId(null);
                        }
                      }}
                    />
                  ) : (
                    <span
                      title={`${track.name}${track.locked ? "" : ui(" · 双击重命名", " · Double-click to rename")}`}
                      onDoubleClick={() => beginRename(track)}
                    >
                      {track.name}
                    </span>
                  )}
                  <span className="tl-track-number">
                    {trackLayouts[index].count > 1
                      ? ui(`${trackLayouts[index].count} 层`, `${trackLayouts[index].count} layers`)
                      : index + 1}
                  </span>
                </div>
                <div className="tl-track-controls">
                  <button
                    title={track.locked ? ui("解锁轨道", "Unlock track") : ui("锁定轨道", "Lock track")}
                    aria-label={`${track.locked ? ui("解锁", "Unlock ") : ui("锁定", "Lock ")}${track.name}`}
                    className={track.locked ? "is-active" : ""}
                    onClick={() =>
                      props.onTrackUpdate(track.id, { locked: !track.locked })
                    }
                  >
                    {track.locked ? (
                      <LockKeyhole size={13} />
                    ) : (
                      <UnlockKeyhole size={13} />
                    )}
                  </button>
                  <button
                    title={track.hidden ? ui("显示轨道", "Show track") : ui("隐藏轨道", "Hide track")}
                    aria-label={`${track.hidden ? ui("显示", "Show ") : ui("隐藏", "Hide ")}${track.name}`}
                    className={track.hidden ? "is-active" : ""}
                    onClick={() =>
                      props.onTrackUpdate(track.id, { hidden: !track.hidden })
                    }
                  >
                    {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  {track.kind !== "text" && (
                    <button
                      title={track.muted ? ui("取消静音", "Unmute ") : ui("静音轨道", "Mute track")}
                      aria-label={`${track.muted ? ui("取消静音", "Unmute ") : ui("静音", "Mute ")}${track.name}`}
                      className={track.muted ? "is-active" : ""}
                      onClick={() =>
                        props.onTrackUpdate(track.id, { muted: !track.muted })
                      }
                    >
                      {track.muted ? (
                        <VolumeX size={13} />
                      ) : (
                        <Volume2 size={13} />
                      )}
                    </button>
                  )}
                  <button
                    className="tl-track-more"
                    title={ui("轨道操作", "Track actions")}
                    aria-label={ui(`${track.name}轨道操作`, `${track.name} track actions`)}
                    aria-expanded={trackActions?.id === track.id}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setTrackActions(
                        trackActions?.id === track.id
                          ? null
                          : {
                              id: track.id,
                              x: Math.min(
                                window.innerWidth - 180,
                                Math.max(8, rect.left),
                              ),
                              y: Math.min(
                                window.innerHeight - 180,
                                Math.max(8, rect.bottom + 4),
                              ),
                            },
                      );
                    }}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>
              </div>
              <div
                className="tl-lane"
                style={{
                  width: bodyWidth,
                  backgroundSize: `${interval * pps}px 100%`,
                }}
                onPointerDown={startSelection}
                onDragOver={(event) => {
                  const id =
                    event.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
                    event.dataTransfer.types.includes("assetid");
                  const sourceKind = (
                    ["audio", "video", "image"] as const
                  ).find((kind) =>
                    event.dataTransfer.types.includes(
                      `application/x-reacut-kind-${kind}`,
                    ),
                  );
                  if (
                    track.locked ||
                    !id ||
                    (sourceKind &&
                      !(
                        sourceKind === track.kind ||
                        (sourceKind === "image" && track.kind === "video")
                      ))
                  )
                    return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDropTarget({
                    trackId: track.id,
                    time: Math.max(
                      0,
                      locate(event.clientX, event.clientY).x / pps,
                    ),
                  });
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  )
                    setDropTarget(null);
                }}
                onDrop={(event) => onDrop(event, track)}
              >
                {clips
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => {
                    const original = project.clips.find(
                      (c) => c.id === clip.id,
                    )!;
                    const asset = project.assets.find(
                      (a) => a.id === clip.assetId,
                    );
                    const selected = selectedIds.includes(clip.id);
                    const dragging =
                      gesture?.kind === "move" && gesture.ids.includes(clip.id);
                    return (
                      <div
                        key={clip.id}
                        data-clip-id={clip.id}
                        className={`tl-clip tl-clip-${track.kind} ${selected ? "is-selected" : ""} ${dragging ? "is-dragging" : ""} ${track.hidden ? "is-hidden" : ""} ${asset?.missing ? "is-missing" : ""}`}
                        style={{
                          left: clip.start * pps,
                          width: Math.max(4, clip.duration * pps),
                          top:
                            8 +
                            (trackLayouts[index].lanes.get(clip.id) ?? 0) * 62,
                        }}
                        onPointerDown={(event) => startClip(event, original)}
                        onDoubleClick={() => onSeek(clip.start)}
                        title={ui(`${clip.name}\n${formatTimelineTime(clip.start, project.fps)} · ${clip.duration.toFixed(2)} 秒${track.locked ? "\n轨道已锁定" : ""}`, `${clip.name}\n${formatTimelineTime(clip.start, project.fps)} · ${clip.duration.toFixed(2)} s${track.locked ? "\nTrack locked" : ""}`)}
                        tabIndex={0}
                        role="button"
                        aria-label={ui(`${clip.name}，${clip.duration.toFixed(1)} 秒`, `${clip.name}, ${clip.duration.toFixed(1)} seconds`)}
                        aria-pressed={selected}
                        aria-disabled={track.locked}
                        aria-keyshortcuts="Enter Alt+ArrowLeft Alt+ArrowRight"
                        onKeyDown={(event) => {
                          if (
                            event.target !== event.currentTarget ||
                            track.locked
                          )
                            return;
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();
                            onSelect(
                              event.shiftKey || event.metaKey || event.ctrlKey
                                ? [...new Set([...selectedIds, clip.id])]
                                : [clip.id],
                            );
                          }
                          if (
                            event.altKey &&
                            ["ArrowLeft", "ArrowRight"].includes(event.key)
                          ) {
                            event.preventDefault();
                            event.stopPropagation();
                            const ids = selected ? selectedIds : [clip.id];
                            onSelect(ids);
                            props.onMoveClips(
                              ids,
                              ((event.key === "ArrowLeft" ? -1 : 1) *
                                (event.shiftKey ? 10 : 1)) /
                                project.fps,
                            );
                          }
                        }}
                      >
                        {asset?.thumbnail && track.kind !== "audio" && (
                          <div
                            className="tl-filmstrip"
                            style={{
                              backgroundImage: `url("${asset.thumbnail.replace(/"/g, "%22")}")`,
                            }}
                          />
                        )}
                        <div className="tl-clip-title">
                          {track.kind === "audio" ? (
                            <AudioLines size={12} />
                          ) : track.kind === "text" ? (
                            <Type size={12} />
                          ) : (
                            <Film size={12} />
                          )}
                          {clip.linkId && <Link2 size={12} aria-label={ui("画声关联", "Linked video and audio")} />}
                          <span>{clip.name}</span>
                          {clip.speed !== 1 && <b>{clip.speed}×</b>}
                          {(clip.muted || track.muted) && <VolumeX size={12} />}
                        </div>
                        {track.kind === "text" && (
                          <div className="tl-text-preview">
                            {clip.text?.text ?? clip.name}
                          </div>
                        )}
                        {asset?.waveform &&
                          (track.kind === "audio" ||
                            (asset.hasAudio && clip.duration * pps > 80)) && (
                            <div className="tl-waveform" aria-hidden="true">
                              {waveformSamples(
                                clip,
                                asset.waveform,
                                Math.min(
                                  180,
                                  Math.max(
                                    4,
                                    Math.floor((clip.duration * pps) / 3),
                                  ),
                                ),
                                asset.duration,
                              ).map((value, i) => (
                                <i
                                  key={i}
                                  style={{
                                    height: `${Math.max(3, Math.min(100, value * 100))}%`,
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        {clip.fadeIn > 0 && (
                          <div
                            className="tl-fade-in"
                            style={{
                              width: Math.min(
                                (clip.duration * pps) / 2,
                                clip.fadeIn * pps,
                              ),
                            }}
                          />
                        )}
                        {clip.fadeOut > 0 && (
                          <div
                            className="tl-fade-out"
                            style={{
                              width: Math.min(
                                (clip.duration * pps) / 2,
                                clip.fadeOut * pps,
                              ),
                            }}
                          />
                        )}
                        {!track.locked && (
                          <>
                            <div
                              className="tl-trim tl-trim-start"
                              title={ui("拖动裁剪入点 · 左右键逐帧调整", "Drag to trim in point · Arrow keys adjust by frame")}
                              role="slider"
                              tabIndex={selected ? 0 : -1}
                              aria-label={ui(`${clip.name} 入点`, `${clip.name} in point`)}
                              aria-valuenow={clip.start}
                              aria-valuetext={formatTimelineTime(
                                clip.start,
                                project.fps,
                              )}
                              aria-valuemin={0}
                              aria-valuemax={
                                clip.start + clip.duration - 1 / project.fps
                              }
                              onKeyDown={(event) => {
                                if (
                                  ["ArrowLeft", "ArrowRight"].includes(
                                    event.key,
                                  )
                                ) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  props.onTrim(
                                    clip.id,
                                    "start",
                                    clip.start +
                                      (event.key === "ArrowLeft" ? -1 : 1) *
                                        (event.shiftKey ? 1 : 1 / project.fps),
                                  );
                                }
                              }}
                              onPointerDown={(event) =>
                                startClip(event, original, "start")
                              }
                            />
                            <div
                              className="tl-trim tl-trim-end"
                              title={ui("拖动裁剪出点 · 左右键逐帧调整", "Drag to trim out point · Arrow keys adjust by frame")}
                              role="slider"
                              tabIndex={selected ? 0 : -1}
                              aria-label={ui(`${clip.name} 出点`, `${clip.name} out point`)}
                              aria-valuenow={clip.start + clip.duration}
                              aria-valuetext={formatTimelineTime(
                                clip.start + clip.duration,
                                project.fps,
                              )}
                              aria-valuemin={clip.start + 1 / project.fps}
                              onKeyDown={(event) => {
                                if (
                                  ["ArrowLeft", "ArrowRight"].includes(
                                    event.key,
                                  )
                                ) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  props.onTrim(
                                    clip.id,
                                    "end",
                                    clip.start +
                                      clip.duration +
                                      (event.key === "ArrowLeft" ? -1 : 1) *
                                        (event.shiftKey ? 1 : 1 / project.fps),
                                  );
                                }
                              }}
                              onPointerDown={(event) =>
                                startClip(event, original, "end")
                              }
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                {dropTarget?.trackId === track.id && (
                  <div
                    className="tl-drop-marker"
                    style={{ left: dropTarget.time * pps }}
                  >
                    <Plus size={12} /> {ui("添加素材", "Add media")}</div>
                )}
                {track.locked && (
                  <span className="tl-lock-overlay">
                    <LockKeyhole size={12} /> {ui("轨道已锁定", "Track locked")}</span>
                )}
              </div>
            </div>
          ))}
          <div className="tl-track-add">
            <div className="tl-track-add-menu">
              <button
                onClick={() => setTrackMenu(!trackMenu)}
                aria-expanded={trackMenu}
              >
                <Plus size={13} /> {ui("添加轨道", "Add track")}<ChevronDown size={11} />
              </button>
              {trackMenu && (
                <div className="tl-popup">
                  {(["video", "audio", "text"] as TrackKind[]).map((kind) => (
                    <button
                      key={kind}
                      onClick={() => {
                        props.onAddTrack(kind);
                        setTrackMenu(false);
                      }}
                    >
                      <TrackIcon kind={kind} />
                      {kind === "video"
                        ? ui("视频轨道", "Video track")
                        : kind === "audio"
                          ? ui("音频轨道", "Audio track")
                          : ui("文字轨道", "Text track")}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {project.clips.length === 0 && (
              <span className="tl-empty-hint">
                <Film size={16} /> {ui("从素材库拖入视频、图片或音频，开始创作", "Drag video, images or audio from the library to get started")}</span>
            )}
          </div>
          <div
            className="tl-playhead"
            style={{
              left: GUTTER + playhead * pps,
              top: RULER,
              height: Math.max(tracksHeight, ROW),
            }}
          >
            <i />
          </div>
          {snapLine !== null && (
            <div
              className="tl-snap-line"
              style={{
                left: GUTTER + snapLine * pps,
                top: RULER,
                height: tracksHeight,
              }}
            />
          )}
          {gesture?.kind === "marquee" && (
            <div
              className="tl-marquee"
              style={{
                left: GUTTER + gesture.x,
                top: RULER + gesture.y,
                width: gesture.width,
                height: gesture.height,
              }}
            />
          )}
        </div>
      </div>
      {trackActions && actionTrack && (
        <div
          ref={actionsMenuRef}
          className="tl-track-action-menu"
          role="menu"
          aria-label={ui(`${actionTrack.name}轨道操作菜单`, `${actionTrack.name} track actions menu`)}
          style={{ left: trackActions.x, top: trackActions.y }}
          onKeyDown={(event) => {
            if (
              ["ArrowUp", "ArrowDown", "Home", "End", "Escape"].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") {
                document
                  .querySelector<HTMLButtonElement>(
                    `[data-track-id="${CSS.escape(actionTrack.id)}"] .tl-track-more`,
                  )
                  ?.focus();
                setTrackActions(null);
                return;
              }
              const buttons = Array.from(
                actionsMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not([disabled])",
                ) ?? [],
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowUp" ? -1 : 1) +
                        buttons.length) %
                      buttons.length
              ]?.focus();
            }
          }}
        >
          <button
            role="menuitem"
            disabled={actionTrack.locked}
            onClick={() => beginRename(actionTrack)}
          >
            <Pencil size={12} />
            {ui("重命名轨道", "Rename track")}</button>
          <button
            role="menuitem"
            disabled={
              actionTrack.locked ||
              actionIndex <= 0 ||
              project.tracks[actionIndex - 1]?.locked ||
              !props.onTrackMove
            }
            onClick={() => {
              props.onTrackMove?.(actionTrack.id, "up");
              setTrackActions(null);
            }}
          >
            <ArrowUp size={12} />
            {ui("向上移动轨道", "Move track up")}</button>
          <button
            role="menuitem"
            disabled={
              actionTrack.locked ||
              actionIndex >= project.tracks.length - 1 ||
              project.tracks[actionIndex + 1]?.locked ||
              !props.onTrackMove
            }
            onClick={() => {
              props.onTrackMove?.(actionTrack.id, "down");
              setTrackActions(null);
            }}
          >
            <ArrowDown size={12} />
            {ui("向下移动轨道", "Move track down")}</button>
          <div className="tl-menu-divider" />
          <button
            role="menuitem"
            className="is-danger"
            disabled={actionTrack.locked || !props.onTrackDelete}
            onClick={() => requestTrackDelete(actionTrack)}
          >
            <Trash2 size={12} />
            {ui("删除轨道", "Delete track")}</button>
        </div>
      )}
      {deletionTrack && (
        <div
          className="tl-confirm-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setDeleteTrackId(null);
          }}
        >
          <section
            ref={confirmRef}
            className="tl-confirm"
            role="dialog"
            aria-modal="true"
            aria-label={ui("删除轨道确认", "Confirm track deletion")}
          >
            <h3>{ui(`删除「${deletionTrack.name}」？`, `Delete “${deletionTrack.name}”?`)}</h3>
            <p>
              {ui(`这条轨道上的 ${deletionCount} 个片段也会被删除。素材库中的原素材会保留，可通过撤销恢复轨道和片段。`, `This also deletes ${deletionCount} clips on the track. Original library media is kept. Undo restores the track and clips.`)}
            </p>
            <footer>
              <button autoFocus onClick={() => setDeleteTrackId(null)}>
                {ui("取消", "Cancel")}</button>
              <button
                className="is-danger"
                disabled={deletionTrack.locked}
                onClick={() => {
                  props.onTrackDelete?.(deletionTrack.id);
                  setDeleteTrackId(null);
                }}
              >
                {ui("删除轨道和片段", "Delete track and clips")}</button>
            </footer>
          </section>
        </div>
      )}
      <div className="tl-status">
        <span>
          {gesture?.kind === "move"
            ? ui(`移动 ${gesture.ids.length} 个片段 · ${gesture.delta > 0 ? "+" : ""}${gesture.delta.toFixed(2)}s`, `Move ${gesture.ids.length} clips · ${gesture.delta > 0 ? "+" : ""}${gesture.delta.toFixed(2)}s`)
            : gesture?.kind === "trim"
              ? ui(`裁剪${gesture.edge === "start" ? "入点" : "出点"} · ${formatTimelineTime(gesture.time, project.fps)}`, `Trim ${gesture.edge === "start" ? "in" : "out"} point · ${formatTimelineTime(gesture.time, project.fps)}`)
              : selectedIds.length
                ? ui(`已选择 ${selectedIds.length} 个片段`, `${selectedIds.length} clips selected`)
                : ui("拖动移动/裁剪 · ⇧ 多选 · ⌥←/→ 逐帧微移", "Drag to move/trim · ⇧ Multiselect · ⌥←/→ Nudge by frame")}
        </span>
        <span>
          {ui(`${project.tracks.length} 条轨道`, `${project.tracks.length} tracks`)} <i>·</i> {ui(`${project.clips.length} 个片段`, `${project.clips.length} clips`)}{" "}
          <i>·</i> {snapping ? ui("吸附开启", "Snapping on") : ui("吸附关闭", "Snapping off")}
        </span>
      </div>
    </section>
  );
}
