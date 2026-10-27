import { localizeBuiltinTemplate, TEMPLATE_NAMES } from "./templateLabels";
import { useLanguageStore } from "../i18n";
import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  defaultTemplate,
  instantiateTemplate,
  replaceTemplateSlots,
  type ProjectTemplate,
  type TemplateReplacements,
  type TemplateSummary,
} from "../core/projectTemplates";
import { TEMPLATE_EXAMPLES } from "../core/templateExamples";
import { projectDuration } from "../core/model";
import type { Project } from "../core/types";
import { useEditorStore } from "../editor/store";
import "./TemplateDialog.css";

function coverFrame() {
  const source = document.querySelector<HTMLCanvasElement>(
    ".player-panel canvas",
  );
  if (!source?.width) return "";
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 270;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#101015";
  ctx.fillRect(0, 0, 480, 270);
  const scale = Math.min(480 / source.width, 270 / source.height),
    w = source.width * scale,
    h = source.height * scale;
  ctx.drawImage(source, (480 - w) / 2, (270 - h) / 2, w, h);
  return c.toDataURL("image/png");
}
export default function TemplateDialog({
  onClose,
  onCreate,
}: {
  onClose(): void;
  onCreate(base: Project, replaced: Project): boolean;
}) {
  const ui = useUITranslation();
  const [draft, setDraft] = useState(() =>
    defaultTemplate(useEditorStore.getState().project, coverFrame()),
  );
  const [enabled, setEnabled] = useState(() => draft.slots.map((s) => s.id));
  const [tab, setTab] = useState<"library" | "save">("library"),
    [entries, setEntries] = useState<TemplateSummary[]>([]);
  const [selected, setSelected] = useState<ProjectTemplate | null>(null),
    [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<TemplateReplacements>({
      media: {},
      text: {},
    }),
    [name, setName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [progress, setProgress] = useState<{
      progress: number;
      message: string;
    } | null>(null);
  const job = useRef<string | null>(null),
    alive = useRef(true),
    cancelled = useRef(false);
  const refresh = async () => {
    const list = await window.editorAPI!.listTemplates();
    if (alive.current) setEntries(list);
  };
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => {
      if (alive.current) setError(String(e));
    });
    const off = window.editorAPI?.onTemplateProgress((e) => {
      if (e.jobId === job.current) setProgress(e);
    });
    return () => {
      alive.current = false;
      off?.();
      if (job.current) void window.editorAPI?.cancelTemplate(job.current);
    };
  }, []);
  const run = async (fn: (jobId: string) => Promise<void>) => {
    if (job.current) return;
    job.current = crypto.randomUUID();
    cancelled.current = false;
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(null);
    try {
      await fn(job.current);
    } catch (e) {
      if (alive.current)
        setError(
          String(e).replace(
            /^Error: Error invoking remote method '[^']+': (?:Error: )?/,
            "",
          ),
        );
    } finally {
      job.current = null;
      if (alive.current) setBusy(false);
    }
  };
  const load = (id: string, builtin = false) =>
    void run(async () => {
      const t = localizeBuiltinTemplate(
        instantiateTemplate(await window.editorAPI!.loadTemplate(id, builtin)),
        builtin ? id : undefined,
        useLanguageStore.getState().language,
      );
      if (!alive.current || cancelled.current) return;
      setSelected(t);
      setSelectedId(builtin ? "" : id);
      setName(t.project.name);
      setValues({ media: {}, text: {} });
    });
  const save = () =>
    void run(async (jobId) => {
      await window.editorAPI!.saveTemplate(jobId, {
        ...draft,
        slots: draft.slots.filter((s) => enabled.includes(s.id)),
      });
      if (!alive.current || cancelled.current) return;
      await refresh();
      setTab("library");
      setNotice(ui("模板已保存到本机库，原工程保持不变", "Template saved to the local library. The original project is unchanged."));
    });
  const replace = (slotId: string) =>
    void run(async () => {
      const assets = await window.editorAPI!.importMedia();
      if (!alive.current || cancelled.current || !assets.length) return;
      if (assets.length !== 1)
        throw new Error(ui("每个占位请选择一个素材；其他占位可继续选择", "Choose one asset per slot. You can then choose assets for the other slots."));
      setValues((v) => ({ ...v, media: { ...v.media, [slotId]: assets[0] } }));
    });
  let candidate: Project | null = null,
    preflight = "";
  if (selected)
    try {
      candidate = replaceTemplateSlots(selected, values);
      candidate.name = name.trim();
      if (!candidate.name || candidate.name.length > 120)
        throw new Error(ui("工程名称须为 1–120 字", "Project names must contain 1–120 characters."));
    } catch (e) {
      preflight = String(e).replace(/^Error: /, "");
    }
  const create = () => {
    if (!selected || !candidate || preflight) return;
    const base = { ...selected.project, name: name.trim() };
    if (onCreate(base, candidate)) onClose();
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal modal-wide template-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={ui("工程模板", "Project templates")}
      >
        <header>
          <h2>{ui("工程模板", "Project templates")}</h2>
          <button disabled={busy} aria-label={ui("关闭工程模板", "Close project templates")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">
          <nav className="template-toolbar">
            <button
              disabled={busy}
              className={tab === "library" ? "active" : ""}
              onClick={() => setTab("library")}
            >
              {ui("模板库", "Template library")}
            </button>
            <button
              disabled={busy}
              className={tab === "save" ? "active" : ""}
              onClick={() => setTab("save")}
            >
              {ui("保存当前工程为模板", "Save current project as template")}
            </button>
          </nav>
          {tab === "save" ? (
            <fieldset disabled={busy}>
              <label>
                {ui("模板名称", "Template name")}
                <input
                  aria-label={ui("模板名称", "Template name")}
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              {draft.cover && (
                <img
                  className="template-cover"
                  src={draft.cover}
                  alt={ui("当前播放头模板封面", "Template cover from current playhead")}
                />
              )}
              <p className="muted small">
                {ui("封面取打开面板时的播放器画面。仅收集时间线使用的媒体副本；不含字体文件。勾选可替换项并给它命名，未勾选内容作为固定设计保留（最多 200 项）。", "The cover uses the player frame when this panel opens. Only media used on the timeline is copied; fonts are excluded. Select and name replaceable slots. Unchecked content remains fixed (up to 200 slots).")}
              </p>
              {draft.slots.map((s) => (
                <div className="template-slot" key={s.id}>
                  <input
                    type="checkbox"
                    aria-label={ui(`启用占位 ${s.label}`, `Enable slot ${s.label}`)}
                    checked={enabled.includes(s.id)}
                    onChange={(e) =>
                      setEnabled(
                        e.target.checked
                          ? [...enabled, s.id]
                          : enabled.filter((k) => k !== s.id),
                      )
                    }
                  />
                  <span>{s.kind === "media" ? ui("素材", "Media") : ui("文案", "Text")}</span>
                  <input
                    aria-label={ui(`占位名称 ${s.label}`, `Slot name ${s.label}`)}
                    maxLength={120}
                    value={s.label}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        slots: draft.slots.map((old) =>
                          old.id === s.id
                            ? { ...s, label: e.target.value }
                            : old,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
          ) : (
            <>
              <div className="template-toolbar">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async (id) => {
                      if (await window.editorAPI!.importTemplate(id)) {
                        await refresh();
                        if (alive.current && !cancelled.current)
                          setNotice(ui("模板包已复制到本机库", "Template package copied to the local library"));
                      }
                    })
                  }
                >
                  {ui("导入模板包…", "Import template package…")}
                </button>
                <span className="muted small">
                  {ui("本地模板 · 媒体随包保存 · 无需联网", "Local templates · Media included · No internet required")}
                </span>
              </div>
              <div className="template-cards">
                {TEMPLATE_EXAMPLES.map((t) => (
                  <button
                    disabled={busy}
                    key={t.id}
                    onClick={() => load(t.id, true)}
                  >
                    <img
                      src={`./template-previews/${t.id}.png`}
                      alt={ui("原创示例封面", "Original example cover")}
                    />
                    <strong>{ui(t.name, TEMPLATE_NAMES[t.id])}</strong>
                    <small>{ui(t.description, {
                      promo: "A 12-second landscape promo with three scenes and titles. Replace the media with product footage.",
                      talk: "A 12-second talking-head layout with three subtitles and a corner label. Replace the main scene with your footage.",
                      gallery: "A 12-second photo story with three scenes and captions, with independently editable zoom animations.",
                    }[t.id])}</small>
                    <small>{ui("原创示例 · 可自由编辑", "Original example · Fully editable")}</small>
                  </button>
                ))}
                {entries.map((t) => (
                  <button disabled={busy} key={t.id} onClick={() => load(t.id)}>
                    {t.cover && <img src={t.cover} alt={ui("已保存模板封面", "Saved template cover")} />}
                    <strong>{t.name}</strong>
                    <small>{ui(`${t.slots} 个占位 · 本机模板`, `${t.slots} slots · Local template`)}</small>
                  </button>
                ))}
              </div>
              {selected && (
                <fieldset disabled={busy} className="template-replacements">
                  <legend>{selected.name}</legend>
                  <label>
                    {ui("新工程名称", "New project name")}
                    <input
                      aria-label={ui("模板新工程名称", "Template project name")}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <p>
                    {selected.project.width} × {selected.project.height} ·{" "}
                    {ui(`${projectDuration(selected.project).toFixed(2)} 秒 · ${selected.slots.length} 个占位`, `${projectDuration(selected.project).toFixed(2)} seconds · ${selected.slots.length} slots`)}
                  </p>
                  <p className="muted small">
                    {ui("替换保留时间线、源入点、速度、裁剪与动画。新视频/音频长度不足会拒绝整批操作；画面等比适配，比例不同可能留边。默认保留原素材和文案。新工程中一次撤销可恢复本批替换。", "Replacements preserve the timeline, source in points, speed, crop and animation. If new video or audio is too short, the entire operation is rejected. Pictures fit proportionally and may have borders. Original media and text are kept by default. Undo once in the new project to revert this batch.")}
                  </p>
                  {selected.slots.map((s) => (
                    <div key={s.id} className="template-replacement">
                      {s.label}
                      {s.kind === "text" ? (
                        <textarea
                          aria-label={ui(`替换文案 ${s.label}`, `Replace text ${s.label}`)}
                          value={
                            values.text[s.id] ??
                            selected.project.clips.find(
                              (c) => c.id === s.targetId,
                            )!.text!.text
                          }
                          onChange={(e) =>
                            setValues({
                              ...values,
                              text: { ...values.text, [s.id]: e.target.value },
                            })
                          }
                        />
                      ) : (
                        <div>
                          <span>
                            {values.media[s.id]?.name ??
                              selected.project.assets.find(
                                (a) => a.id === s.targetId,
                              )!.name}
                          </span>
                          <button onClick={() => replace(s.id)}>
                            {ui("选择替换素材", "Choose replacement asset")}
                          </button>
                          {values.media[s.id] && (
                            <button
                              onClick={() => {
                                const media = { ...values.media };
                                delete media[s.id];
                                setValues({ ...values, media });
                              }}
                            >
                              {ui("恢复原素材", "Restore original asset")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {selectedId && (
                    <button
                      onClick={() =>
                        void run(async (id) => {
                          const file = await window.editorAPI!.exportTemplate(
                            id,
                            selectedId,
                          );
                          if (file && alive.current && !cancelled.current) {
                            setNotice(
                              ui(`模板包已导出：${file.split(/[\\/]/).pop()}`, `Template package exported: ${file.split(/[\\/]/).pop()}`),
                            );
                            await window.editorAPI!.revealPath(file);
                          }
                        })
                      }
                    >
                      {ui("导出原模板包…", "Export original template package…")}
                    </button>
                  )}
                  {!selectedId && (
                    <p className="muted small">
                      {ui("原创示例新建工程后，可保存到本机模板库并导出。", "Create a project from an original example, then save it to the local template library to export it.")}
                    </p>
                  )}
                </fieldset>
              )}
            </>
          )}
          {progress && (
            <div className="export-progress">
              <p>{localizeMessage(progress.message) }</p>
              <progress value={progress.progress} max={1} />
            </div>
          )}
          {(error || preflight) && (
            <p role="alert" className="inline-warning">
              {localizeMessage(error || preflight) }
            </p>
          )}
          {notice && <p role="status">{localizeMessage(notice) }</p>}
        </div>
        <footer>
          {busy ? (
            <button
              onClick={() => {
                cancelled.current = true;
                if (job.current)
                  void window.editorAPI?.cancelTemplate(job.current);
              }}
            >
              {ui("取消操作", "Cancel operation")}
            </button>
          ) : (
            <>
              <button onClick={onClose}>{ui("关闭", "Close")}</button>
              {tab === "save" ? (
                <button className="primary" onClick={save}>
                  {ui("保存模板及媒体副本", "Save template and media copies")}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!candidate || !!preflight}
                  onClick={create}
                >
                  {ui("新建独立工程并应用替换", "Create independent project with replacements")}
                </button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
