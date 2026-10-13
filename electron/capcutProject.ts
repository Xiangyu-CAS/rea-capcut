import { posix, win32 } from "node:path";

/** These limits apply to sidecars, not media or the actual timeline payload. */
export const CAPCUT_SIDECAR_MAX_BYTES = 256 * 1024;
export const CAPCUT_MAX_TIMELINES = 256;

export interface CapcutProjectSelection {
  projectDirectory: string;
  manifestPath: string;
  layoutPath: string;
  directDraftPath: string;
  /** Present only when the user selected a particular timeline file/directory. */
  selectedTimelineId?: string;
}

export interface CapcutTimelineChoice {
  id: string;
  name: string;
  draftPath: string;
  isMain: boolean;
  isActive: boolean;
}

export interface CapcutProjectImportPlan {
  selection: CapcutProjectSelection;
  kind: "single-draft" | "multi-timeline";
  timelines: CapcutTimelineChoice[];
  mainTimelineId?: string;
  activeTimelineId?: string;
  recommendedTimelineId?: string;
  selectedTimelineId?: string;
  requiresTimelineChoice: boolean;
  warnings: string[];
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function pathApi(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")
    ? win32
    : posix;
}

function timelineId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)
  )
    throw new Error("剪映时间线 ID 不是安全的目录名称");
  return value;
}

/** No filesystem access. The caller must resolve symlinks before reading these paths. */
export function describeCapcutProjectSelection(
  selectedPath: string,
  selectedKind: "file" | "directory",
): CapcutProjectSelection {
  if (
    typeof selectedPath !== "string" ||
    selectedPath.includes("\0") ||
    selectedPath.length > 4096 ||
    (selectedKind !== "file" && selectedKind !== "directory")
  )
    throw new Error("剪映项目选择无效");
  const paths = pathApi(selectedPath);
  if (!paths.isAbsolute(selectedPath))
    throw new Error("请选择剪映项目的本机绝对路径");
  const normalized = paths.normalize(selectedPath);
  const folder =
    selectedKind === "directory" ? normalized : paths.dirname(normalized);
  let projectDirectory = folder;
  let selectedTimelineId: string | undefined;
  if (paths.basename(paths.dirname(folder)) === "Timelines") {
    selectedTimelineId = timelineId(paths.basename(folder));
    projectDirectory = paths.dirname(paths.dirname(folder));
  } else if (paths.basename(folder) === "Timelines") {
    projectDirectory = paths.dirname(folder);
  }
  const filename = selectedKind === "file" ? paths.basename(normalized) : "";
  const sidecarSelected =
    selectedKind === "file" &&
    ((filename === "project.json" && paths.basename(folder) === "Timelines") ||
      filename === "timeline_layout.json");
  return {
    projectDirectory,
    manifestPath: paths.join(projectDirectory, "Timelines", "project.json"),
    layoutPath: paths.join(projectDirectory, "timeline_layout.json"),
    directDraftPath:
      selectedKind === "file" && !sidecarSelected
        ? normalized
        : paths.join(
            selectedTimelineId ? folder : projectDirectory,
            "draft_info.json",
          ),
    ...(selectedTimelineId ? { selectedTimelineId } : {}),
  };
}

function readSidecar(value: unknown, description: string): JsonObject {
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    throw new Error(`${description}不是可读取的 JSON`);
  }
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > CAPCUT_SIDECAR_MAX_BYTES
  )
    throw new Error(`${description}超过读取大小限制`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`${description}不是可读取的 JSON`);
  }
  if (!object(parsed)) throw new Error(`${description}需要 JSON 对象`);
  return parsed;
}

/**
 * Builds a read-only selection plan from modern project/layout sidecars.
 * Observed schema: Jianying 11.0.12922, project version 0. This does not decode
 * draft payloads, discover files, read source media, or follow sidecar path fields.
 * A modern manifest replaces root draft selection; multiple timelines require a
 * user's explicit choice, even when main/active IDs suggest an initial choice.
 */
export function planCapcutProjectImport(
  selectedPath: string,
  selectedKind: "file" | "directory",
  manifest?: unknown,
  layout?: unknown,
): CapcutProjectImportPlan {
  const selection = describeCapcutProjectSelection(selectedPath, selectedKind);
  const warnings: string[] = [];
  if (manifest === undefined) {
    return {
      selection,
      kind: "single-draft",
      timelines: [],
      requiresTimelineChoice: false,
      warnings,
    };
  }
  const project = readSidecar(manifest, "剪映时间线清单");
  if (!Array.isArray(project.timelines))
    throw new Error("剪映项目缺少 timelines 时间线清单");
  if (project.timelines.length > CAPCUT_MAX_TIMELINES)
    throw new Error("剪映时间线数量超过导入限制");
  if (project.version !== 0)
    warnings.push("时间线清单版本尚未验证，导入前请核对所选时间线。");

  const seen = new Set<string>();
  const entries: { id: string; name: string }[] = [];
  for (const entry of project.timelines) {
    if (!object(entry)) throw new Error("剪映时间线条目不是对象");
    const id = timelineId(entry.id);
    if (seen.has(id.toLowerCase())) throw new Error("剪映时间线 ID 重复");
    seen.add(id.toLowerCase());
    if (typeof entry.is_marked_delete !== "boolean")
      throw new Error("剪映时间线缺少明确的删除状态");
    if (entry.is_marked_delete) continue;
    if (entry.name !== undefined && typeof entry.name !== "string")
      throw new Error("剪映时间线名称无效");
    if (typeof entry.name === "string" && entry.name.length > 512)
      throw new Error("剪映时间线名称过长");
    entries.push({ id, name: (entry.name as string | undefined) || id });
  }
  if (!entries.length) throw new Error("剪映项目没有可导入的未删除时间线");

  const mainId =
    project.main_timeline_id === undefined
      ? undefined
      : timelineId(project.main_timeline_id);
  const mainTimelineId = entries.find((entry) => entry.id === mainId)?.id;
  if (mainId && !mainTimelineId)
    warnings.push("主时间线已删除或不在清单中，请手动选择时间线。");
  let activeTimelineId: string | undefined;
  if (layout !== undefined) {
    try {
      const data = readSidecar(layout, "剪映时间线布局");
      const activeId =
        data.activeTimeline === undefined
          ? undefined
          : timelineId(data.activeTimeline);
      activeTimelineId = entries.find((entry) => entry.id === activeId)?.id;
      if (activeId && !activeTimelineId)
        warnings.push("活动时间线已删除或不在清单中，请手动选择时间线。");
    } catch {
      warnings.push("时间线布局无法验证，已忽略活动时间线提示。");
    }
  }
  const selectedTimelineId = selection.selectedTimelineId;
  if (
    selectedTimelineId &&
    !entries.some((entry) => entry.id === selectedTimelineId)
  )
    throw new Error("所选时间线已删除或不在项目清单中");
  const paths = pathApi(selection.projectDirectory);
  return {
    selection,
    kind: "multi-timeline",
    timelines: entries.map((entry) => ({
      ...entry,
      draftPath: paths.join(
        selection.projectDirectory,
        "Timelines",
        entry.id,
        "draft_info.json",
      ),
      isMain: entry.id === mainTimelineId,
      isActive: entry.id === activeTimelineId,
    })),
    mainTimelineId,
    activeTimelineId,
    recommendedTimelineId:
      selectedTimelineId || activeTimelineId || mainTimelineId || entries[0].id,
    selectedTimelineId,
    requiresTimelineChoice: entries.length > 1 && !selectedTimelineId,
    warnings,
  };
}

/** Resolve only an explicit choice or the one unambiguous timeline. */
export function selectCapcutTimelineDraft(
  plan: CapcutProjectImportPlan,
  chosenTimelineId?: string,
): string {
  if (plan.kind === "single-draft") return plan.selection.directDraftPath;
  const selected = chosenTimelineId ?? plan.selectedTimelineId;
  if (selected === undefined && plan.requiresTimelineChoice)
    throw new Error("该剪映项目有多条时间线，请明确选择要导入的时间线");
  const choice =
    selected === undefined
      ? plan.timelines[0]
      : plan.timelines.find((timeline) => timeline.id === timelineId(selected));
  if (!choice) throw new Error("所选时间线不在可导入清单中");
  return choice.draftPath;
}
