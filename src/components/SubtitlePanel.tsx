import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import {
  SubtitleAnimationForm,
  SubtitleStyleForm,
} from "./SubtitleBatchOptions";
import type {
  SubtitleAnimation,
  SubtitleStyleValues,
} from "../core/subtitleWorkflow";
import { DEFAULT_TEXT } from "../core/defaults";
import { useTranslation } from "../i18n/useTranslation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FolderOpen,
  LockKeyhole,
  Search,
  Subtitles,
} from "lucide-react";
import { useEditorStore } from "../editor/store";
import { clone } from "../core/model";
import {
  applySubtitleEdit,
  prepareSubtitleEdit,
  type SubtitleEdit,
  type SubtitleEditPlan,
} from "../core/subtitleEdits";
import type { Clip, Project } from "../core/types";
import "./SubtitlePanel.css";

interface Props {
  onSpeech: (mode: "asr" | "tts") => void;
  onImport: () => void | Promise<void>;
  onExport: () => void | Promise<void>;
}
interface CueDraft {
  project: Project;
  id: string;
  text: string;
  start: string;
  end: string;
}
const seconds = (value: number) => Number(value.toFixed(6)).toString();
const timeLabel = (value: number) =>
  `${Math.floor(value / 60)
    .toString()
    .padStart(2, "0")}:${(value % 60).toFixed(2).padStart(5, "0")}`;

export default function SubtitlePanel({ onImport, onExport, onSpeech }: Props) {
  const ui = useUITranslation();
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const [trackId, setTrackId] = useState("");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [draft, setDraft] = useState<CueDraft | null>(null);
  const [mode, setMode] = useState<
    "offset" | "replace" | "style" | "styleValues" | "animation"
  >("offset");
  const [styleValues, setStyleValues] = useState<SubtitleStyleValues>(() => ({
    fontSize: DEFAULT_TEXT.fontSize,
    color: DEFAULT_TEXT.color,
    background: DEFAULT_TEXT.background,
    bold: DEFAULT_TEXT.bold,
    align: DEFAULT_TEXT.align,
    stroke: DEFAULT_TEXT.stroke,
    strokeWidth: DEFAULT_TEXT.strokeWidth,
  }));
  const [animation, setAnimation] = useState<SubtitleAnimation>({
    entrance: "fade",
    exit: "fade",
    inDuration: 0.4,
    outDuration: 0.4,
    distance: 48,
  });
  const cueText = useRef<HTMLTextAreaElement>(null);
  const [offset, setOffset] = useState("0");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [plan, setPlan] = useState<SubtitleEditPlan | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const feedback = useRef<HTMLParagraphElement>(null);
  const knownTracks = useRef(new Set(project.tracks.map((t) => t.id)));
  const tracks = project.tracks.filter((t) => t.kind === "text");
  const activeTrack = tracks.find((t) => t.id === trackId);
  const clips = useMemo(
    () =>
      project.clips
        .filter((c) => c.trackId === trackId && c.text)
        .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)),
    [project, trackId],
  );
  const visible = clips.filter((c) =>
    c.text!.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const selected = checked.filter((id) => clips.some((c) => c.id === id));
  const locked = !!activeTrack?.locked;
  const stale = !!plan && plan.base !== JSON.stringify(project);

  useEffect(() => {
    const textTracks = project.tracks.filter((t) => t.kind === "text");
    const preferred =
      textTracks.find((t) => /字幕|subtitles?|captions?/i.test(t.name)) ?? textTracks[0];
    setTrackId(preferred?.id ?? "");
    setQuery("");
    setChecked([]);
    setDraft(null);
    setPlan(null);
    setError("");
    setNotice("");
  }, [project.id]);
  useEffect(() => {
    if (!project.tracks.some((t) => t.id === trackId && t.kind === "text")) {
      const preferred =
        project.tracks.find(
          (t) => t.kind === "text" && /字幕|subtitles?|captions?/i.test(t.name),
        ) ?? project.tracks.find((t) => t.kind === "text");
      setTrackId(preferred?.id ?? "");
    }
    // Newly imported cues become selected in the editor; follow their new track.
    const first = project.clips.find(
      (c) => c.id === useEditorStore.getState().selectedIds[0] && c.text,
    );
    if (
      first &&
      first.trackId !== trackId &&
      (!knownTracks.current.has(first.trackId) ||
        !project.clips.some((c) => c.trackId === trackId))
    )
      setTrackId(first.trackId);
    knownTracks.current = new Set(project.tracks.map((t) => t.id));
  }, [project, trackId]);
  useEffect(() => {
    setChecked([]);
    setDraft(null);
    setPlan(null);
    setError("");
    setNotice("");
    setReferenceId("");
  }, [trackId]);
  useEffect(() => {
    if (error) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  function attempt(action: () => void) {
    setError("");
    setNotice("");
    try {
      action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function fileAction(action: Props["onImport"]) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function editCue(clip: Clip) {
    useEditorStore.getState().select([clip.id]);
    useEditorStore.getState().seek(clip.start);
    setDraft({
      project: clone(project),
      id: clip.id,
      text: clip.text!.text,
      start: seconds(clip.start),
      end: seconds(clip.start + clip.duration),
    });
    setReferenceId(clip.id);
    setPlan(null);
    setError("");
    setNotice("");
  }
  function saveCue() {
    attempt(() => {
      if (!draft) return;
      if (!draft.start.trim() || !draft.end.trim())
        throw new Error(ui("请填写开始和结束时间", "Enter start and end times"));
      const next = prepareSubtitleEdit(draft.project, [draft.id], {
        type: "cue",
        text: draft.text,
        start: Number(draft.start),
        end: Number(draft.end),
      });
      const store = useEditorStore.getState();
      store.commit(applySubtitleEdit(store.project, next));
      setDraft(null);
      setNotice(
        next.changedIds.length ? ui("字幕已保存，可一次撤销", "Subtitle saved. Undo once to revert.") : ui("字幕未变化", "Subtitle unchanged"),
      );
    });
  }
  function prepare() {
    attempt(() => {
      let edit: SubtitleEdit;
      if (mode === "offset") {
        if (!offset.trim()) throw new Error(ui("请填写时间偏移量", "Enter a time offset"));
        edit = { type: "offset", seconds: Number(offset) };
      } else if (mode === "replace")
        edit = { type: "replace", find, replacement };
      else if (mode === "style") edit = { type: "style", referenceId };
      else if (mode === "styleValues")
        edit = { type: "styleValues", values: styleValues };
      else edit = { type: "animation", options: animation };
      const next = prepareSubtitleEdit(
        useEditorStore.getState().project,
        selected,
        edit,
      );
      if (!next.changedIds.length) {
        setPlan(null);
        setNotice(ui("没有需要修改的字幕", "No subtitles need changing"));
        return;
      }
      setPlan(next);
    });
  }
  function apply() {
    attempt(() => {
      if (!plan) return;
      const store = useEditorStore.getState();
      store.commit(applySubtitleEdit(store.project, plan));
      const surviving = selected.filter((id) =>
        plan.project.clips.some((c) => c.id === id),
      );
      store.select(surviving);
      setChecked(surviving);
      setNotice(ui(`已修改 ${plan.changedIds.length} 条字幕，可一次撤销`, `Updated ${plan.changedIds.length} subtitles. Undo once to revert.`));
      setPlan(null);
      setDraft(null);
    });
  }
  function splitCue() {
    attempt(() => {
      if (!draft || !cueText.current) return;
      const store = useEditorStore.getState();
      const next = prepareSubtitleEdit(draft.project, [draft.id], {
        type: "split",
        at: store.playhead,
        offset: cueText.current.selectionStart,
      });
      store.commit(applySubtitleEdit(store.project, next));
      store.select(next.changedIds);
      setChecked(next.changedIds);
      setDraft(null);
      setPlan(null);
      setNotice(ui("字幕已按播放头与文本光标拆分，可一次撤销", "Subtitle split at the playhead and text cursor. Undo once to revert."));
    });
  }
  function mergeSelection() {
    attempt(() => {
      setPlan(
        prepareSubtitleEdit(useEditorStore.getState().project, selected, {
          type: "merge",
        }),
      );
      setDraft(null);
    });
  }
  function setSelection(ids: string[]) {
    setChecked(ids);
    setPlan(null);
  }
  const draftStale =
    draft && JSON.stringify(draft.project) !== JSON.stringify(project);

  return (
    <section className="subtitle-panel" aria-label={ui("字幕编辑器", "Subtitle editor")}>
      <div className="subtitle-heading">
        <h3>{ui("字幕编辑", "Edit subtitles")}</h3>
        <span>{ui(`${clips.length} 条`, `${clips.length} subtitles`)}</span>
      </div>
      <div className="subtitle-file-actions">
        <button
          className="small-button"
          disabled={!window.editorAPI}
          onClick={() => onSpeech("asr")}
        >
          {t("speech.asr")}
        </button>
        <button
          className="small-button"
          disabled={!window.editorAPI}
          onClick={() => onSpeech("tts")}
        >
          {t("speech.tts")}
        </button>
        <button
          className="small-button"
          onClick={() => void fileAction(onImport)}
        >
          <FolderOpen size={14} />
          {ui("导入字幕文件", "Import subtitle file")}
        </button>
        <button
          className="small-button"
          onClick={() => void fileAction(onExport)}
          disabled={!project.clips.some((c) => c.text)}
          title={ui("导出项目中全部文字片段为 SRT", "Export all project text clips as SRT")}
        >
          <Download size={14} />
          {ui("导出全部 SRT", "Export all as SRT")}
        </button>
      </div>
      <p className="subtitle-hint">
        {ui("SRT 仅保存文案与时间，不携带样式或动画；动画需导出为视频。", "SRT contains only text and timing, not styles or animation. Export a video to include animation.")}
      </p>
      <label className="subtitle-track-label">
        {ui("文字轨道", "Text track")}
        <select
          aria-label={ui("字幕轨道", "Subtitle track")}
          value={trackId}
          onChange={(e) => setTrackId(e.target.value)}
        >
          {!tracks.length && <option value="">{ui("暂无文字轨道", "No text tracks")}</option>}
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.locked ? ui(" · 已锁定", " · Locked") : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="subtitle-search">
        <Search size={14} />
        <input
          aria-label={ui("搜索字幕", "Search subtitles")}
          placeholder={ui("搜索当前轨道字幕", "Search subtitles in this track")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="subtitle-selection">
        <label>
          <input
            type="checkbox"
            aria-label={ui("选择搜索结果", "Select search results")}
            disabled={locked || !visible.length}
            checked={
              visible.length > 0 &&
              visible.every((c) => selected.includes(c.id))
            }
            onChange={(e) =>
              setSelection(
                e.target.checked
                  ? [...new Set([...selected, ...visible.map((c) => c.id)])]
                  : selected.filter((id) => !visible.some((c) => c.id === id)),
              )
            }
          />
          {ui("选择搜索结果", "Select search results")}
        </label>
        <button
          className="subtitle-clear"
          disabled={!selected.length}
          onClick={() => setSelection([])}
        >
          {ui(`清空 (${selected.length})`, `Clear (${selected.length})`)}
        </button>
      </div>
      {locked && (
        <p className="subtitle-hint">
          <LockKeyhole size={13} />
          {ui("此轨道已锁定，仍可定位和查看字幕。", "This track is locked. You can still seek to and view subtitles.")}
        </p>
      )}
      <div className="subtitle-cues">
        {!visible.length && (
          <div className="subtitle-empty">
            <Subtitles size={27} />
            <p>
              {clips.length
                ? ui("没有匹配的字幕", "No matching subtitles")
                : ui("导入 SRT / WebVTT，或选择含字幕的文字轨道", "Import SRT / WebVTT, or choose a text track with subtitles")}
            </p>
          </div>
        )}
        {visible.map((clip) => (
          <div
            key={clip.id}
            className={`subtitle-cue ${draft?.id === clip.id ? "active" : ""}`}
            data-cue-id={clip.id}
          >
            <div className="subtitle-cue-line">
              <input
                type="checkbox"
                aria-label={ui(`选择字幕：${clip.text!.text.slice(0, 40)}`, `Select subtitle: ${clip.text!.text.slice(0, 40)}`)}
                checked={selected.includes(clip.id)}
                disabled={locked}
                onChange={(e) =>
                  setSelection(
                    e.target.checked
                      ? [...selected, clip.id]
                      : selected.filter((id) => id !== clip.id),
                  )
                }
              />
              <button
                className="subtitle-cue-content"
                onClick={() => editCue(clip)}
                title={ui("定位到此字幕并编辑", "Seek to this subtitle and edit")}
              >
                <span className="subtitle-time">
                  {timeLabel(clip.start)} —{" "}
                  {timeLabel(clip.start + clip.duration)}
                </span>
                <span>{clip.text!.text || ui("（空字幕）", "(Empty subtitle)")}</span>
              </button>
            </div>
            {draft?.id === clip.id && (
              <div className="subtitle-cue-form">
                <textarea
                  ref={cueText}
                  aria-label={ui("字幕内容", "Subtitle text")}
                  value={draft.text}
                  maxLength={20000}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
                <div className="subtitle-times">
                  <label>
                    {ui("开始 (秒)", "Start (seconds)")}
                    <input
                      aria-label={ui("字幕开始时间", "Subtitle start time")}
                      type="number"
                      min="0"
                      max="86400"
                      step={1 / project.fps}
                      value={draft.start}
                      disabled={locked}
                      onChange={(e) =>
                        setDraft({ ...draft, start: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {ui("结束 (秒)", "End (seconds)")}
                    <input
                      aria-label={ui("字幕结束时间", "Subtitle end time")}
                      type="number"
                      min="0"
                      max="86400"
                      step={1 / project.fps}
                      value={draft.end}
                      disabled={locked}
                      onChange={(e) =>
                        setDraft({ ...draft, end: e.target.value })
                      }
                    />
                  </label>
                </div>
                <p className="subtitle-hint">
                  {ui("拆分：先保存文案修改，将播放头移到分界时间，再把文本光标放在分句位置。", "To split: save text edits first, move the playhead to the split time, then place the text cursor where the sentence should split.")}
                </p>
                <button
                  className="small-button"
                  disabled={
                    locked ||
                    !!draftStale ||
                    draft.text !== clip.text!.text ||
                    Number(draft.start) !== clip.start ||
                    Math.abs(Number(draft.end) - clip.start - clip.duration) >
                      1e-8
                  }
                  onClick={splitCue}
                >
                  {ui("在播放头与文本光标拆分", "Split at playhead and text cursor")}
                </button>
                {draftStale && (
                  <p className="subtitle-warning">
                    {ui("项目已变化，重新点击此条字幕后再编辑。", "The project changed. Select this subtitle again before editing.")}
                  </p>
                )}
                <div className="subtitle-draft-actions">
                  <button
                    className="small-button"
                    onClick={() => setDraft(null)}
                  >
                    {ui("取消", "Cancel")}
                  </button>
                  <button
                    className="primary small-button"
                    disabled={locked || !!draftStale}
                    onClick={saveCue}
                  >
                    {ui("保存此条", "Save subtitle")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="subtitle-batch">
        <div className="subtitle-heading">
          <h4>{ui("批量修改", "Batch edit")}</h4>
          <span>{ui(`已选 ${selected.length} 条`, `${selected.length} selected`)}</span>
        </div>
        <div
          className="subtitle-batch-tabs"
          role="tablist"
          aria-label={ui("字幕批量操作", "Subtitle batch actions")}
        >
          {(
            [
              ["offset", ui("时间偏移", "Time offset")],
              ["replace", ui("查找替换", "Find and replace")],
              ["style", ui("统一样式", "Match style")],
              ["styleValues", ui("自定义样式", "Custom style")],
              ["animation", ui("入场与出场", "Entrance and exit")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={mode === key}
              className={mode === key ? "active" : ""}
              onClick={() => {
                setMode(key);
                setPlan(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="small-button"
          disabled={locked || selected.length < 2}
          onClick={mergeSelection}
        >
          {ui("合并所选字幕", "Merge selected subtitles")}
        </button>
        <p className="subtitle-hint">
          {ui("合并连续所选条目，以换行拼接文案；覆盖首条起点至最晚终点（含间隙/重叠）。采用首条样式，其动画按新时长拉伸。", "Merge consecutive selected subtitles, joining text with line breaks. The result spans the first start to the latest end, including gaps and overlaps. It uses the first subtitle’s style and stretches its animation to the new duration.")}
        </p>
        {mode === "styleValues" && (
          <SubtitleStyleForm
            value={styleValues}
            onChange={(v) => {
              setStyleValues(v);
              setPlan(null);
            }}
          />
        )}
        {mode === "animation" && (
          <SubtitleAnimationForm
            value={animation}
            onChange={(v) => {
              setAnimation(v);
              setPlan(null);
            }}
          />
        )}
        {mode === "offset" && (
          <label className="subtitle-batch-field">
            {ui("偏移秒数（负数提前）", "Offset in seconds (negative moves earlier)")}
            <input
              aria-label={ui("字幕偏移秒数", "Subtitle offset in seconds")}
              type="number"
              step={1 / project.fps}
              value={offset}
              onChange={(e) => {
                setOffset(e.target.value);
                setPlan(null);
              }}
            />
          </label>
        )}
        {mode === "replace" && (
          <div className="subtitle-replace">
            <input
              aria-label={ui("查找字幕文字", "Find subtitle text")}
              placeholder={ui("查找文字（区分大小写）", "Find text (case-sensitive)")}
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setPlan(null);
              }}
            />
            <input
              aria-label={ui("替换字幕文字", "Replace subtitle text")}
              placeholder={ui("替换为（可留空）", "Replace with (may be empty)")}
              value={replacement}
              onChange={(e) => {
                setReplacement(e.target.value);
                setPlan(null);
              }}
            />
          </div>
        )}
        {mode === "style" && (
          <>
            <label className="subtitle-batch-field">
              {ui("样式参考字幕", "Style reference subtitle")}
              <select
                aria-label={ui("字幕样式参考", "Subtitle style reference")}
                value={referenceId}
                onChange={(e) => {
                  setReferenceId(e.target.value);
                  setPlan(null);
                }}
              >
                <option value="">{ui("选择参考字幕", "Choose reference subtitle")}</option>
                {clips.map((c) => (
                  <option key={c.id} value={c.id}>
                    {timeLabel(c.start)} ·{" "}
                    {c.text!.text.slice(0, 30) || ui("空字幕", "Empty subtitle")}
                  </option>
                ))}
              </select>
            </label>
            <p className="subtitle-hint">
              {ui("复制字体、字号、颜色、描边与对齐；保留每条文案、位置和动画。", "Copy font family, size, color, outline and alignment. Keep each subtitle’s text, position and animation.")}
            </p>
          </>
        )}
        {plan ? (
          <div className="subtitle-plan">
            <p>
              {stale
                ? ui("项目已变化，请重新检查修改。", "The project changed. Check the changes again.")
                : ui(`将修改 ${plan.changedIds.length} 条字幕，可一次撤销。`, `${plan.changedIds.length} subtitles will change. Undo once to revert.`)}
            </p>
            <div>
              <button
                className="small-button"
                onClick={() =>
                  attempt(() => {
                    if (plan)
                      setPlan(
                        prepareSubtitleEdit(
                          useEditorStore.getState().project,
                          selected,
                          plan.edit,
                        ),
                      );
                  })
                }
              >
                {ui("重新检查", "Check again")}
              </button>
              <button
                className="primary small-button"
                disabled={stale || locked}
                onClick={apply}
              >
                {ui(`应用 ${plan.changedIds.length} 条修改`, `Apply ${plan.changedIds.length} changes`)}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="small-button subtitle-check"
            disabled={!selected.length || locked}
            onClick={prepare}
          >
            {ui("检查修改", "Check changes")}
          </button>
        )}
      </div>
      {error && (
        <p ref={feedback} className="subtitle-error" role="alert">
          {localizeMessage(error) }
        </p>
      )}
      {notice && (
        <p className="subtitle-notice" role="status">
          {localizeMessage(notice) }
        </p>
      )}
    </section>
  );
}
