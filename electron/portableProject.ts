import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { ExportProgress, Project } from "../src/core/types";
import { validateProject } from "../src/core/model";

export interface PortableDocument { format: "reacut-portable"; version: 1; project: Project }
const savedCopies = new Map<string, { size: number; mtime: number; relative: string }>();
const tasks = new Map<string, { controller: AbortController; done: Promise<void> }>();
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative); };
const abort = (signal: AbortSignal) => { if (signal.aborted) throw new Error("已取消项目打包"); };

/** Resolve only the format we write; ordinary .reacut projects remain unchanged. */
export async function resolvePortableDocument(input: unknown, projectFile: string): Promise<Project> {
  if (!input || typeof input !== "object" || (input as any).format !== "reacut-portable") return validateProject(input);
  const document = input as PortableDocument;
  if (document.version !== 1) throw new Error("不支持的素材包版本");
  const project = validateProject(document.project);
  const directory = await realpath(path.dirname(projectFile));
  const mediaDirectory = await realpath(path.join(directory, "media"));
  if (!inside(directory, mediaDirectory)) throw new Error("素材包目录指向包外位置");
  for (const asset of project.assets) {
    if (!/^media\/[a-f\d-]{36}\.[a-z\d]{1,12}$/i.test(asset.path)) throw new Error("素材包包含无效的相对路径");
    const candidate = path.resolve(directory, ...asset.path.split("/"));
    let resolved = candidate;
    try { resolved = await realpath(candidate); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!inside(mediaDirectory, resolved)) throw new Error("素材包引用了包外文件");
    asset.path = resolved; asset.url = `file://${resolved}`;
    delete asset.thumbnail; delete asset.previewUrl; delete asset.previewError; delete asset.waveform;
  }
  return project;
}

export async function collectPortableProject(input: Project, parent: string, signal: AbortSignal, progress: (fraction: number, message: string) => void): Promise<string> {
  const project = validateProject(input);
  if (!path.isAbsolute(parent) || !(await stat(parent)).isDirectory()) throw new Error("请选择有效的目标文件夹");
  const unique = new Map<string, { source: string; destination: string; bytes: number; mtime: number; ids: string[] }>();
  const assetPaths = new Map<string, string>();
  let total = 0;
  for (const asset of project.assets) {
    abort(signal);
    if (!path.isAbsolute(asset.path)) throw new Error(`素材“${asset.name}”不是本地文件`);
    let resolved: string;
    try { resolved = await realpath(asset.path); } catch { throw new Error(`找不到素材“${asset.name}”，请重新链接后打包`); }
    const metadata = await stat(resolved);
    if (!metadata.isFile()) throw new Error(`素材“${asset.name}”不是普通文件`);
    if (!unique.has(resolved)) {
      const extension = path.extname(resolved).slice(1).toLowerCase();
      const destination = `media/${randomUUID()}.${/^[a-z\d]{1,12}$/.test(extension) ? extension : "bin"}`;
      unique.set(resolved, { source: resolved, destination, bytes: metadata.size, mtime: metadata.mtimeMs, ids: [] }); total += metadata.size;
    }
    const entry = unique.get(resolved)!; entry.ids.push(asset.id); assetPaths.set(asset.id, entry.destination);
  }
  abort(signal);
  const temporary = await mkdtemp(path.join(parent, ".reacut-collect-"));
  let completedBytes = 0, count = 0, lastUpdate = 0;
  const manifest: { file: string; bytes: number; sha256: string; assetIds: string[] }[] = [];
  try {
    await mkdir(path.join(temporary, "media"));
    for (const entry of unique.values()) {
      abort(signal);
      const hash = createHash("sha256"), source = createReadStream(entry.source);
      let copied = 0;
      source.on("data", chunk => {
        hash.update(chunk); copied += chunk.length;
        if (Date.now() - lastUpdate > 100) { lastUpdate = Date.now(); progress(total ? Math.min(.98, (completedBytes + copied) / total * .98) : 0, `正在收集素材 ${count + 1} / ${unique.size}`); }
      });
      await pipeline(source, createWriteStream(path.join(temporary, entry.destination), { flags: "wx", mode: 0o600 }), { signal });
      const after = await stat(entry.source);
      if (after.size !== entry.bytes || after.mtimeMs !== entry.mtime || copied !== entry.bytes) throw new Error("素材在打包期间发生变化，请完成修改后重试");
      completedBytes += copied; count++;
      manifest.push({ file: entry.destination, bytes: copied, sha256: hash.digest("hex"), assetIds: entry.ids });
    }
    abort(signal);
    project.assets = project.assets.map(asset => ({ id: asset.id, name: asset.name, kind: asset.kind, path: assetPaths.get(asset.id)!, url: assetPaths.get(asset.id)!, duration: asset.duration, width: asset.width, height: asset.height, fps: asset.fps, hasAudio: asset.hasAudio }));
    const document: PortableDocument = { format: "reacut-portable", version: 1, project };
    await writeFile(path.join(temporary, "项目.reacut"), JSON.stringify(document, null, 2), { mode: 0o600 });
    await writeFile(path.join(temporary, "manifest.json"), JSON.stringify({ format: "reacut-media-manifest", version: 1, files: manifest }, null, 2), { mode: 0o600 });
    await writeFile(path.join(temporary, "使用说明.txt"), "请移动整个文件夹，保留 media 子目录。用 ReaCut 打开 项目.reacut 即可继续编辑。\n这是工程与原始素材的副本，不会改变原项目。字体仍以目标电脑及应用内置字体为准。\nmanifest.json 记录首次收集时的文件校验值；后续编辑保存不会更新这份历史清单。\n");
    abort(signal);
    const name = project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 60).replace(/[. ]+$/, "") || "ReaCut项目";
    const destination = path.join(parent, `${name}-素材包-${randomUUID().slice(0, 8)}`);
    await rename(temporary, destination);
    return destination;
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}

export function startPortablePackage(project: Project, parent: string, callback: (event: ExportProgress) => void): { jobId: string } {
  const jobId = randomUUID(), controller = new AbortController();
  const emit = (event: Omit<ExportProgress, "jobId">) => { try { callback({ jobId, ...event }); } catch { /* Window may have closed. */ } };
  const done = Promise.resolve().then(async () => {
    emit({ status: "preparing", progress: 0, message: "正在检查素材" });
    try {
      const destination = await collectPortableProject(project, parent, controller.signal, (fraction, message) => emit({ status: "rendering", progress: fraction, message }));
      emit({ status: "complete", progress: 1, path: destination });
    } catch (error) { emit({ status: controller.signal.aborted ? "cancelled" : "error", progress: 0, message: error instanceof Error ? error.message : String(error) }); }
    finally { tasks.delete(jobId); }
  });
  tasks.set(jobId, { controller, done });
  return { jobId };
}
export async function cancelPortablePackage(jobId: string): Promise<void> { const task = tasks.get(jobId); task?.controller.abort(); await task?.done; }
export async function cancelPortablePackages(): Promise<void> { const current = [...tasks.values()]; current.forEach(task => task.controller.abort()); await Promise.all(current.map(task => task.done)); }

/** Keep a reopened package portable after edits, including newly imported files. */
export async function savePortableDocument(input: Project, file: string): Promise<void> {
  const project = validateProject(input), directory = await realpath(path.dirname(file));
  const media = await realpath(path.join(directory, "media"));
  if (!inside(directory, media)) throw new Error("素材包目录指向包外位置");
  const copied: string[] = [], destinations = new Map<string, string>();
  const pendingCache = new Map<string, { size: number; mtime: number; relative: string }>();
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  try {
    for (const asset of project.assets) {
      const lexical = path.resolve(asset.path), cacheKey = `${path.resolve(file)}\0${lexical}`;
      const cached = savedCopies.get(cacheKey);
      let source: string, metadata;
      try { source = await realpath(lexical); metadata = await stat(source); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        // A missing direct package reference stays editable; dangling symlinks do not.
        let relative: string | undefined;
        if (path.dirname(lexical) === media && /^[a-f\d-]{36}\.[a-z\d]{1,12}$/i.test(path.basename(lexical))) {
          const entry = await lstat(lexical).catch(e => { if (e.code !== "ENOENT") throw e; return null; });
          if (!entry) relative = `media/${path.basename(lexical)}`;
        }
        if (!relative && cached) {
          const target = path.join(directory, cached.relative);
          try { if (await realpath(target) === target && (await stat(target)).size === cached.size) relative = cached.relative; } catch { /* A missing copy cannot recover the source. */ }
        }
        if (!relative) throw new Error(`找不到素材“${asset.name}”，请重新链接后保存`);
        asset.path = relative; asset.url = relative;
        delete asset.thumbnail; delete asset.previewUrl; delete asset.previewError; delete asset.waveform; delete asset.missing;
        continue;
      }
      if (!metadata.isFile()) throw new Error(`素材“${asset.name}”不是普通文件`);
      let relative = destinations.get(source);
      if (!relative && path.dirname(source) === media && /^[a-f\d-]{36}\.[a-z\d]{1,12}$/i.test(path.basename(source))) relative = `media/${path.basename(source)}`;
      if (!relative && cached && cached.size === metadata.size && cached.mtime === metadata.mtimeMs) {
        const target = path.join(directory, cached.relative);
        try { if ((await realpath(target)) === target && (await stat(target)).size === cached.size) relative = cached.relative; } catch { /* Recreate removed cache. */ }
      }
      if (!relative) {
        const extension = path.extname(source).slice(1).toLowerCase();
        relative = `media/${randomUUID()}.${/^[a-z\d]{1,12}$/.test(extension) ? extension : "bin"}`;
        const target = path.join(directory, relative); copied.push(target);
        await pipeline(createReadStream(source), createWriteStream(target, { flags: "wx", mode: 0o600 }));
        const after = await stat(source);
        if (after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs) throw new Error("素材在保存期间发生变化，请重试");
      }
      destinations.set(source, relative);
      pendingCache.set(cacheKey, { size: metadata.size, mtime: metadata.mtimeMs, relative });
      asset.path = relative; asset.url = relative;
      delete asset.thumbnail; delete asset.previewUrl; delete asset.previewError; delete asset.waveform; delete asset.missing;
    }
    await writeFile(temporaryFile, JSON.stringify({ format: "reacut-portable", version: 1, project }, null, 2), { mode: 0o600 });
    await rename(temporaryFile, file);
    pendingCache.forEach((value, key) => savedCopies.set(key, value));
    while (savedCopies.size > 20000) savedCopies.delete(savedCopies.keys().next().value!);
    // The initial collection manifest is a historical checksum, not a current-project index.
  } catch (error) { await Promise.all([...copied, temporaryFile].map(target => rm(target, { force: true }))); throw error; }
}
