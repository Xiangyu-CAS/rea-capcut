import { clone, id, validateProject } from "./model";
import type { MediaAsset, Project } from "./types";

export interface TemplateSlot {
  id: string;
  kind: "media" | "text";
  targetId: string;
  label: string;
}
export interface ProjectTemplate {
  format: "reacut-template";
  version: 1;
  name: string;
  cover: string;
  project: Project;
  slots: TemplateSlot[];
}
export interface TemplateSummary {
  id: string;
  name: string;
  cover: string;
  slots: number;
}
export interface TemplateReplacements {
  media: Record<string, MediaAsset>;
  text: Record<string, string>;
}

export function validateTemplate(input: unknown): ProjectTemplate {
  if (!input || typeof input !== "object") throw new Error("模板内容无效");
  const t = input as ProjectTemplate;
  if (t.format !== "reacut-template" || t.version !== 1)
    throw new Error("不支持的模板格式");
  if (
    typeof t.name !== "string" ||
    !t.name.trim() ||
    t.name.length > 120 ||
    t.name.includes("\0")
  )
    throw new Error("模板名称须为 1–120 字");
  if (
    typeof t.cover !== "string" ||
    t.cover.length > 1500000 ||
    (t.cover !== "" &&
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(t.cover))
  )
    throw new Error("模板封面须为有限大小的 PNG");
  const project = validateProject(t.project);
  if (!Array.isArray(t.slots) || t.slots.length > 200)
    throw new Error("模板最多包含 200 个占位");
  const keys = new Set<string>(),
    targets = new Set<string>();
  const slots = t.slots.map((s) => {
    if (
      !s ||
      !["media", "text"].includes(s.kind) ||
      typeof s.id !== "string" ||
      !s.id ||
      s.id.length > 256 ||
      keys.has(s.id) ||
      typeof s.targetId !== "string" ||
      targets.has(`${s.kind}:${s.targetId}`) ||
      typeof s.label !== "string" ||
      !s.label.trim() ||
      s.label.length > 120
    )
      throw new Error("模板占位无效或重复");
    if (
      s.kind === "media"
        ? !project.assets.some(
            (a) =>
              a.id === s.targetId &&
              project.clips.some((c) => c.assetId === a.id),
          )
        : !project.clips.some((c) => c.id === s.targetId && c.text)
    )
      throw new Error("模板占位引用无效");
    keys.add(s.id);
    targets.add(`${s.kind}:${s.targetId}`);
    return { id: s.id, kind: s.kind, targetId: s.targetId, label: s.label };
  });
  return {
    format: "reacut-template",
    version: 1,
    name: t.name.trim(),
    cover: t.cover,
    project,
    slots,
  };
}
export function defaultTemplate(project: Project, cover = ""): ProjectTemplate {
  const p = validateProject(project);
  // A template only distributes media actually used by its timeline.
  p.assets = p.assets.filter((a) => p.clips.some((c) => c.assetId === a.id));
  const slots: TemplateSlot[] = [
    ...p.assets.map((a) => ({
      id: id(),
      kind: "media" as const,
      targetId: a.id,
      label: a.name.slice(0, 120) || "素材",
    })),
    ...p.clips
      .filter((c) => c.text)
      .map((c) => ({
        id: id(),
        kind: "text" as const,
        targetId: c.id,
        label: c.text!.text.slice(0, 120).trim() || "文案",
      })),
  ].slice(0, 200);
  return validateTemplate({
    format: "reacut-template",
    version: 1,
    name: p.name.slice(0, 120),
    cover,
    project: p,
    slots,
  });
}
/** New identities and no save path: edits can never overwrite the template document. */
export function instantiateTemplate(input: ProjectTemplate): ProjectTemplate {
  const t = validateTemplate(input),
    p = t.project;
  const assets = new Map(p.assets.map((a) => [a.id, id()])),
    tracks = new Map(p.tracks.map((a) => [a.id, id()])),
    clips = new Map(p.clips.map((a) => [a.id, id()])),
    links = new Map(
      p.clips.filter((c) => c.linkId).map((c) => [c.linkId!, id()]),
    );
  p.id = id();
  p.name = t.name + " · 副本";
  p.createdAt = p.updatedAt = new Date().toISOString();
  p.assets.forEach((a) => {
    a.id = assets.get(a.id)!;
  });
  p.tracks.forEach((a) => {
    a.id = tracks.get(a.id)!;
  });
  p.clips.forEach((c) => {
    c.id = clips.get(c.id)!;
    c.trackId = tracks.get(c.trackId)!;
    if (c.assetId) c.assetId = assets.get(c.assetId)!;
    if (c.linkId) c.linkId = links.get(c.linkId)!;
    c.keyframes.forEach((k) => {
      k.id = id();
    });
  });
  t.slots.forEach((s) => {
    s.targetId = (s.kind === "media" ? assets : clips).get(s.targetId)!;
  });
  return validateTemplate(t);
}
/** Exact timeline preservation: reject short media, never silently trim/stretch other clips. */
export function replaceTemplateSlots(
  input: ProjectTemplate,
  replacements: TemplateReplacements,
): Project {
  const t = validateTemplate(input),
    p = t.project;
  for (const [kind, values] of [
    ["media", replacements.media],
    ["text", replacements.text],
  ] as const) {
    if (!values || typeof values !== "object" || Array.isArray(values))
      throw new Error("替换内容无效");
    for (const key of Object.keys(values))
      if (!t.slots.some((s) => s.id === key && s.kind === kind))
        throw new Error("未知模板占位");
  }
  for (const s of t.slots) {
    if (s.kind === "text" && Object.hasOwn(replacements.text, s.id)) {
      const value = replacements.text[s.id];
      if (
        typeof value !== "string" ||
        value.length > 20000 ||
        value.includes("\0")
      )
        throw new Error("替换文案无效");
      const c = p.clips.find((c) => c.id === s.targetId)!;
      if (p.tracks.find((tr) => tr.id === c.trackId)!.locked)
        throw new Error("请先在模板原工程解锁需要替换的轨道");
      c.text!.text = value;
      c.name = value.slice(0, 4096);
    }
    if (s.kind === "media" && Object.hasOwn(replacements.media, s.id)) {
      const a = replacements.media[s.id],
        old = p.assets.find((a) => a.id === s.targetId)!;
      if (!a || a.missing) throw new Error("替换素材不可用");
      const uses = p.clips.filter((c) => c.assetId === old.id);
      for (const c of uses) {
        const track = p.tracks.find((tr) => tr.id === c.trackId)!;
        if (track.locked) throw new Error("请先在模板原工程解锁需要替换的轨道");
        if (!(
          a.kind === old.kind ||
          (track.kind === "video" &&
            ["video", "image"].includes(a.kind) &&
            ["video", "image"].includes(old.kind))
        ))
          throw new Error(`占位“${s.label}”与新素材类型不匹配`);
        const required = c.sourceIn + c.duration * c.speed;
        if (
          a.kind !== "image" &&
          (!Number.isFinite(a.duration) || a.duration + 1e-6 < required)
        )
          throw new Error(
            `占位“${s.label}”至少需要 ${required.toFixed(3)} 秒源素材（包含入点和速度），未应用任何替换`,
          );
      }
      p.assets[p.assets.indexOf(old)] = { ...clone(a), id: old.id };
    }
  }
  // Paired detached audio/video must continue to reference the same recording.
  for (const c of p.clips.filter((c) => c.linkId && c.assetId)) {
    const group = p.clips.filter(
      (other) => other.linkId === c.linkId && other.assetId,
    );
    const changed = group.some((other) =>
      t.slots.some(
        (s) =>
          s.kind === "media" &&
          s.targetId === other.assetId &&
          Object.hasOwn(replacements.media, s.id),
      ),
    );
    if (
      changed &&
      new Set(
        group.map(
          (other) => p.assets.find((a) => a.id === other.assetId)!.path,
        ),
      ).size > 1
    )
      throw new Error(
        "关联画声必须一起替换为同一源文件，或先在模板原工程解除关联",
      );
  }
  return validateProject(p);
}
