import { constants } from "node:fs";
import { lstat, open, readlink, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  CAPCUT_SIDECAR_MAX_BYTES,
  describeCapcutProjectSelection,
  planCapcutProjectImport,
  selectCapcutTimelineDraft,
  type CapcutProjectImportPlan,
} from "./capcutProject";

export const CAPCUT_DRAFT_MAX_BYTES = 20 * 1024 * 1024;

export interface CapcutProjectIOPlan extends CapcutProjectImportPlan {
  sourceSelection: { path: string; kind: "file" | "directory" };
  /** Captured canonical directory. Subsequent reads reject a retargeted root. */
  realProjectDirectory: string;
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function assertContained(root: string, path: string): void {
  const displacement = relative(root, path);
  if (
    displacement === ".." ||
    displacement.startsWith(`..${sep}`) ||
    isAbsolute(displacement)
  )
    throw new Error("剪映草稿路径逃离所选项目目录");
}

/** Missing sidecars are optional only when their nearest existing location is
 * still confined. A dangling link to a missing external file is not absence. */
async function verifyMissingPath(root: string, path: string): Promise<void> {
  let cursor = path;
  for (let depth = 0; depth < 256; depth++) {
    try {
      assertContained(root, await realpath(cursor));
      return;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        cursor = resolve(dirname(cursor), await readlink(cursor));
        continue;
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor)
      throw new Error("无法验证剪映草稿缺失路径的项目目录边界");
    cursor = parent;
  }
  throw new Error("剪映草稿路径层级超过验证限制");
}

async function confinedRealpath(root: string, path: string): Promise<string> {
  try {
    const canonical = await realpath(path);
    assertContained(root, canonical);
    return canonical;
  } catch (error) {
    if (isMissing(error)) await verifyMissingPath(root, path);
    throw error;
  }
}

/** Read bounded bytes from one regular, confined file without decoding its payload. */
async function readConfinedFile(
  root: string,
  path: string,
  limit: number,
): Promise<Buffer> {
  const canonical = await confinedRealpath(root, path);
  const handle = await open(
    canonical,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("剪映草稿路径不是普通文件");
    if (before.size > limit) throw new Error("剪映草稿文件超过读取大小限制");
    // Revalidate after open as well: a directory/symlink may have changed while
    // resolving. Never read bytes until the open descriptor matches this path.
    const afterPath = await realpath(path);
    assertContained(root, afterPath);
    const visible = await stat(afterPath);
    if (before.dev !== visible.dev || before.ino !== visible.ino)
      throw new Error("剪映草稿文件在读取前发生变化，请重试");
    const chunks: Buffer[] = [];
    let length = 0;
    while (length <= limit) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - length));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > limit) throw new Error("剪映草稿文件超过读取大小限制");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error("剪映草稿文件在读取期间发生变化，请重试");
    return Buffer.concat(chunks, length);
  } finally {
    await handle.close();
  }
}

function utf8(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    throw new Error("剪映草稿包含非 UTF-8 字节，当前读取接口尚不支持该载体");
  }
}

async function optionalSidecar(root: string, path: string) {
  try {
    return utf8(await readConfinedFile(root, path, CAPCUT_SIDECAR_MAX_BYTES));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/**
 * Read project/layout sidecars only. No decryption, source modification or
 * directory enumeration. A malformed/unreadable modern manifest never silently
 * falls back to a potentially empty root draft.
 */
export async function discoverSelectedCapcutProject(
  selectedPath: string,
  kind: "file" | "directory",
): Promise<CapcutProjectIOPlan> {
  const selection = describeCapcutProjectSelection(selectedPath, kind);
  const root = await realpath(selection.projectDirectory);
  if (!(await stat(root)).isDirectory())
    throw new Error("剪映项目路径不是目录");
  const manifest = await optionalSidecar(root, selection.manifestPath);
  const layout =
    manifest === undefined
      ? undefined
      : await optionalSidecar(root, selection.layoutPath);
  return {
    ...planCapcutProjectImport(selectedPath, kind, manifest, layout),
    sourceSelection: { path: selectedPath, kind },
    realProjectDirectory: root,
  };
}

/**
 * Read one selected draft as UTF-8 text. For a classic selected directory only,
 * try draft_content.json when draft_info.json does not exist. An explicit file
 * selection has no fallback, and a modern manifest always selects its listed
 * timeline payload rather than the root draft or plaintext temporary backups.
 */
export async function readSelectedCapcutTimeline(
  plan: CapcutProjectIOPlan,
  chosenTimelineId?: string,
): Promise<{ text: string; name: string; path: string }> {
  const root = await realpath(plan.selection.projectDirectory);
  if (root !== plan.realProjectDirectory)
    throw new Error("所选剪映项目目录已发生变化，请重新选择项目");
  let path = selectCapcutTimelineDraft(plan, chosenTimelineId);
  let bytes: Buffer;
  try {
    bytes = await readConfinedFile(root, path, CAPCUT_DRAFT_MAX_BYTES);
  } catch (error) {
    if (
      plan.kind !== "single-draft" ||
      plan.sourceSelection.kind !== "directory" ||
      basename(path) !== "draft_info.json" ||
      !isMissing(error)
    )
      throw error;
    path = join(dirname(path), "draft_content.json");
    bytes = await readConfinedFile(root, path, CAPCUT_DRAFT_MAX_BYTES);
  }
  const choice = plan.timelines.find((timeline) => timeline.draftPath === path);
  return {
    text: utf8(bytes),
    name: choice?.name || basename(plan.selection.projectDirectory),
    path,
  };
}
