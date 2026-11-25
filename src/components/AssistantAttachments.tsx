import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AudioLines, Film, Image as ImageIcon, Type, X } from "lucide-react";
import { assistantMediaSelection } from "../core/assistantEdits";
import type { AssistantMediaSelection } from "../core/assistantTypes";
import type { MediaAsset, Project } from "../core/types";
import { useEditorStore } from "../editor/store";
import { useUITranslation } from "../i18n";

interface Attachment {
  key: string;
  kind: "timeline" | "source" | "reference";
  name: string;
  detail: string;
  asset?: MediaAsset;
  text?: string;
  range?: string;
  open?: () => void;
  remove?: { label: string; action: () => void; disabled?: boolean };
}

interface Props {
  project: Project;
  references: readonly MediaAsset[];
  busy: boolean;
  onPreviewMedia(selection: AssistantMediaSelection): void;
  onRemoveReference(assetId: string): void;
}

const visibleTimelineClips = 8;
const rangeLabel = (start: number, duration: number) => `${start.toFixed(2)}–${(start + duration).toFixed(2)} s`;

function AttachmentVisual({ attachment: { asset, text }, large = false }: { attachment: Attachment; large?: boolean }) {
  const [failed, setFailed] = useState<string>();
  const url = !asset?.missing && (asset?.thumbnail || (asset?.kind === "image" ? asset.url : undefined));
  const waveform = asset?.waveform;
  const Icon = text !== undefined ? Type : asset?.kind === "audio" ? AudioLines : asset?.kind === "image" ? ImageIcon : Film;
  return <span className={large ? "assistant-attachment-art large" : "assistant-attachment-art"} aria-hidden="true">
    {url && url.startsWith("reacut-media://asset?path=") && url !== failed ? (
      <img src={url} alt="" draggable={false} onError={() => setFailed(url)} />
    ) : large && text !== undefined ? (
      <span className="assistant-attachment-text">{text.slice(0, 200)}</span>
    ) : large && asset?.kind === "audio" && waveform?.length ? (
      <span className="assistant-attachment-wave">
        {Array.from({ length: 36 }, (_, index) => {
          const amplitude = waveform[Math.floor(index * waveform.length / 36)] ?? 0;
          return <i key={index} style={{ height: `${8 + 84 * Math.min(1, Math.max(0, amplitude))}%` }} />;
        })}
      </span>
    ) : (
      <Icon size={large ? 31 : 14} strokeWidth={1.55} />
    )}
  </span>;
}

export default function AssistantAttachments({ project, references, busy, onPreviewMedia, onRemoveReference }: Props) {
  const ui = useUITranslation();
  const selectedIds = useEditorStore(s => s.selectedIds);
  const agentMedia = useEditorStore(s => s.agentMedia);
  const removeAgentMedia = useEditorStore(s => s.removeAgentMedia);
  const tray = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const [hover, setHover] = useState<{ key: string; left: number; bottom: number; width: number } | null>(null);

  const { context, extraClips } = useMemo(() => {
    const assets = new Map(project.assets.map(asset => [asset.id, asset]));
    const selected = new Set(selectedIds);
    const clips = project.clips.filter(clip => selected.has(clip.id));
    const timeline: Attachment[] = clips.slice(0, visibleTimelineClips).map(clip => ({
      key: `timeline:${clip.id}`,
      kind: "timeline",
      name: clip.name,
      detail: `${ui("时间线", "Timeline")} · ${rangeLabel(clip.start, clip.duration)}`,
      asset: clip.assetId ? assets.get(clip.assetId) : undefined,
      text: clip.text?.text,
    }));
    const source: Attachment[] = assistantMediaSelection(project, agentMedia).map(selection => {
      const asset = assets.get(selection.assetId)!;
      const range = selection.range && rangeLabel(selection.range.sourceIn, selection.range.duration);
      return {
        key: `source:${asset.id}`,
        kind: "source",
        name: asset.name,
        detail: range ? `${ui("源素材", "Source")} · ${range}` : ui("源素材", "Source"),
        asset,
        range,
        open: () => onPreviewMedia(selection),
        remove: { label: ui(`移除素材 ${asset.name}`, `Remove media ${asset.name}`), action: () => removeAgentMedia(asset.id) },
      };
    });
    return { context: [...timeline, ...source], extraClips: Math.max(0, clips.length - visibleTimelineClips) };
  }, [project, selectedIds, agentMedia, onPreviewMedia, removeAgentMedia, ui]);

  const attachments = [...context, ...references.map((asset): Attachment => ({
    key: `reference:${asset.id}`, kind: "reference", name: asset.name, asset,
    detail: ui("参考帧", "Reference frame"),
    remove: { label: ui(`移除参考帧 ${asset.name}`, `Remove reference frame ${asset.name}`), action: () => onRemoveReference(asset.id), disabled: busy },
  }))];
  const active = hover && attachments.find(item => item.key === hover.key);

  function showPreview(key: string, target: HTMLElement) {
    const area = tray.current?.getBoundingClientRect();
    if (!area) return;
    const chip = target.getBoundingClientRect();
    const width = Math.min(236, area.width - 16);
    const left = Math.max(8, Math.min(chip.left - area.left, area.width - width - 8));
    setHover({ key, left, bottom: area.bottom - chip.top + 7, width });
  }

  function hidePreview(key: string) {
    setHover(current => current?.key === key ? null : current);
  }

  const previewVisible = !!active;
  useEffect(() => {
    if (!previewVisible) { setHover(null); return; }
    const hide = () => setHover(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      hide();
    };
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", escape);
    };
  }, [previewVisible]);

  if (!attachments.length) return null;

  return <div className="assistant-attachments" ref={tray}>
    <div className="assistant-context" role="group" aria-label={ui("剪辑上下文", "Edit context")} onScroll={() => setHover(null)}>
      {attachments.map(item => {
        const description = active?.key === item.key ? previewId : undefined;
        const contents = <><AttachmentVisual attachment={item} /><span className="assistant-attachment-name">{item.name}</span>
          {item.range && <span className="assistant-media-range">{item.range}</span>}</>;
        return <div key={item.key} className="assistant-attachment" data-kind={item.kind}
          onMouseEnter={event => showPreview(item.key, event.currentTarget)}
          onMouseLeave={() => hidePreview(item.key)}
          onFocus={event => showPreview(item.key, event.currentTarget)}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) hidePreview(item.key); }}>
          {item.open
            ? <button className="assistant-attachment-main" aria-describedby={description} onClick={item.open}>{contents}</button>
            : <span className="assistant-attachment-main" tabIndex={0} aria-describedby={description}>{contents}</span>}
          {item.remove && <button className="assistant-attachment-remove" aria-label={item.remove.label}
            disabled={item.remove.disabled} onClick={() => { hidePreview(item.key); item.remove?.action(); }}><X size={12} /></button>}
        </div>;
      })}
      {extraClips > 0 && <span className="assistant-attachment-more" aria-label={ui(`另有 ${extraClips} 个所选片段`, `${extraClips} more selected clips`)}>+${extraClips}</span>}
    </div>
    {active && hover && <div id={previewId} className="assistant-attachment-preview" role="tooltip"
      style={{ left: hover.left, bottom: hover.bottom, width: hover.width }}>
      <AttachmentVisual key={active.key} attachment={active} large />
      <div className="assistant-attachment-caption"><strong>{active.name}</strong><small>{active.detail}</small></div>
    </div>}
  </div>;
}
