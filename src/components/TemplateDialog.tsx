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
      const t = instantiateTemplate(
        await window.editorAPI!.loadTemplate(id, builtin),
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
      setNotice("模板已保存到本机库，原工程保持不变");
    });
  const replace = (slotId: string) =>
    void run(async () => {
      const assets = await window.editorAPI!.importMedia();
      if (!alive.current || cancelled.current || !assets.length) return;
      if (assets.length !== 1)
        throw new Error("每个占位请选择一个素材；其他占位可继续选择");
      setValues((v) => ({ ...v, media: { ...v.media, [slotId]: assets[0] } }));
    });
  let candidate: Project | null = null,
    preflight = "";
  if (selected)
    try {
      candidate = replaceTemplateSlots(selected, values);
      candidate.name = name.trim();
      if (!candidate.name || candidate.name.length > 120)
        throw new Error("工程名称须为 1–120 字");
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
        aria-label="工程模板"
      >
        <header>
          <h2>工程模板</h2>
          <button disabled={busy} aria-label="关闭工程模板" onClick={onClose}>
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
              模板库
            </button>
            <button
              disabled={busy}
              className={tab === "save" ? "active" : ""}
              onClick={() => setTab("save")}
            >
              保存当前工程为模板
            </button>
          </nav>
          {tab === "save" ? (
            <fieldset disabled={busy}>
              <label>
                模板名称
                <input
                  aria-label="模板名称"
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              {draft.cover && (
                <img
                  className="template-cover"
                  src={draft.cover}
                  alt="当前播放头模板封面"
                />
              )}
              <p className="muted small">
                封面取打开面板时的播放器画面。仅收集时间线使用的媒体副本；不含字体文件。勾选可替换项并给它命名，未勾选内容作为固定设计保留（最多
                200 项）。
              </p>
              {draft.slots.map((s) => (
                <div className="template-slot" key={s.id}>
                  <input
                    type="checkbox"
                    aria-label={`启用占位 ${s.label}`}
                    checked={enabled.includes(s.id)}
                    onChange={(e) =>
                      setEnabled(
                        e.target.checked
                          ? [...enabled, s.id]
                          : enabled.filter((k) => k !== s.id),
                      )
                    }
                  />
                  <span>{s.kind === "media" ? "素材" : "文案"}</span>
                  <input
                    aria-label={`占位名称 ${s.label}`}
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
                          setNotice("模板包已复制到本机库");
                      }
                    })
                  }
                >
                  导入模板包…
                </button>
                <span className="muted small">
                  本地模板 · 媒体随包保存 · 无需联网
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
                      alt="原创示例封面"
                    />
                    <strong>{t.name}</strong>
                    <small>{t.description}</small>
                    <small>原创示例 · 可自由编辑</small>
                  </button>
                ))}
                {entries.map((t) => (
                  <button disabled={busy} key={t.id} onClick={() => load(t.id)}>
                    {t.cover && <img src={t.cover} alt="已保存模板封面" />}
                    <strong>{t.name}</strong>
                    <small>{t.slots} 个占位 · 本机模板</small>
                  </button>
                ))}
              </div>
              {selected && (
                <fieldset disabled={busy} className="template-replacements">
                  <legend>{selected.name}</legend>
                  <label>
                    新工程名称
                    <input
                      aria-label="模板新工程名称"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <p>
                    {selected.project.width} × {selected.project.height} ·{" "}
                    {projectDuration(selected.project).toFixed(2)} 秒 ·{" "}
                    {selected.slots.length} 个占位
                  </p>
                  <p className="muted small">
                    替换保留时间线、源入点、速度、裁剪与动画。新视频/音频长度不足会拒绝整批操作；画面等比适配，比例不同可能留边。默认保留原素材和文案。新工程中一次撤销可恢复本批替换。
                  </p>
                  {selected.slots.map((s) => (
                    <div key={s.id} className="template-replacement">
                      {s.label}
                      {s.kind === "text" ? (
                        <textarea
                          aria-label={`替换文案 ${s.label}`}
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
                            选择替换素材
                          </button>
                          {values.media[s.id] && (
                            <button
                              onClick={() => {
                                const media = { ...values.media };
                                delete media[s.id];
                                setValues({ ...values, media });
                              }}
                            >
                              恢复原素材
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
                              `模板包已导出：${file.split(/[\\/]/).pop()}`,
                            );
                            await window.editorAPI!.revealPath(file);
                          }
                        })
                      }
                    >
                      导出原模板包…
                    </button>
                  )}
                  {!selectedId && (
                    <p className="muted small">
                      原创示例新建工程后，可保存到本机模板库并导出。
                    </p>
                  )}
                </fieldset>
              )}
            </>
          )}
          {progress && (
            <div className="export-progress">
              <p>{progress.message}</p>
              <progress value={progress.progress} max={1} />
            </div>
          )}
          {(error || preflight) && (
            <p role="alert" className="inline-warning">
              {error || preflight}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
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
              取消操作
            </button>
          ) : (
            <>
              <button onClick={onClose}>关闭</button>
              {tab === "save" ? (
                <button className="primary" onClick={save}>
                  保存模板及媒体副本
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!candidate || !!preflight}
                  onClick={create}
                >
                  新建独立工程并应用替换
                </button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
