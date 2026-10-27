import type { UpdateCheckResult, UpdateError, UpdateOpenTarget } from "../src/core/updateTypes";

const REPOSITORY = "Xiangyu-CAS/rea-capcut";
export const UPDATE_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_NOTES = 16000;
const CACHE_MS = 30000;
const TIMEOUT_MS = 10000;

type Version = { core: bigint[]; pre: string[] };
/** Strict SemVer 2.0, with an optional Git tag v prefix. Build metadata is ignored. */
function parseVersion(input: string): Version | undefined {
  if (input.length > 200) return;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(input);
  if (!match) return;
  const pre = match[4]?.split(".") ?? [];
  if (pre.some(value => /^\d+$/.test(value) && value.length > 1 && value.startsWith("0"))) return;
  return { core: match.slice(1, 4).map(BigInt), pre };
}
/** Undefined means either input is invalid; never guess at a malformed version. */
export function compareVersions(left: string, right: string): number | undefined {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) return;
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function verifiedURL(input: unknown, path: string[]): string | undefined {
  if (typeof input !== "string") return;
  try {
    const url = new URL(input);
    if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash) return;
    if (url.pathname.split("/").map(decodeURIComponent).join("/") !== `/${path.join("/")}`) return;
    // Reconstruct instead of passing remote text to the OS.
    return `https://github.com/${path.map(encodeURIComponent).join("/")}`;
  } catch { return; }
}
interface SelectedRelease { version: string; notes: string; page: string; download?: string }
function selectRelease(data: unknown, platform: string, arch: string): SelectedRelease {
  if (!Array.isArray(data) || data.length > 100) throw new CheckError("invalid-response");
  const valid: SelectedRelease[] = [];
  for (const item of data) {
    if (!record(item) || item.draft !== false || typeof item.prerelease !== "boolean" || typeof item.tag_name !== "string" || !parseVersion(item.tag_name)) continue;
    const tag = item.tag_name;
    const page = verifiedURL(item.html_url, [...REPOSITORY.split("/"), "releases", "tag", tag]);
    if (!page) continue;
    const version = tag.replace(/^v/, "");
    const expectedName = platform === "darwin" && (arch === "arm64" || arch === "x64") ? `ReaCut-${version}-${arch}.dmg` : undefined;
    let download: string | undefined;
    if (expectedName && Array.isArray(item.assets)) {
      for (const asset of item.assets) {
        if (!record(asset) || asset.name !== expectedName || asset.state !== "uploaded" || typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
        download = verifiedURL(asset.browser_download_url, [...REPOSITORY.split("/"), "releases", "download", tag, expectedName]);
        if (download) break;
      }
    }
    valid.push({ version, page, download, notes: typeof item.body === "string" ? item.body.slice(0, MAX_NOTES).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : "" });
  }
  if (!valid.length) throw new CheckError("invalid-response");
  valid.sort((a, b) => compareVersions(b.version, a.version)!);
  return valid[0];
}
class CheckError extends Error {
  constructor(readonly code: UpdateError) { super(code); }
}
async function readJSON(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_RESPONSE_BYTES) throw new CheckError("invalid-response");
  const reader = response.body?.getReader();
  if (!reader) throw new CheckError("invalid-response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new CheckError("invalid-response");
      chunks.push(value);
    }
  } finally {
    // Cancel a truncated or failed response as well as releasing its lock.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CheckError("invalid-response"); }
}
export interface UpdateServiceOptions {
  version: string;
  platform: string;
  arch: string;
  fetch: typeof globalThis.fetch;
  openExternal: (url: string) => Promise<unknown>;
  /** Injectable clock for deterministic cache tests. */
  now?: () => number;
}
/** Construction performs no I/O. Call check only in response to a user's action. */
export function createUpdateService(options: UpdateServiceOptions) {
  const now = options.now ?? Date.now;
  let pending: Promise<UpdateCheckResult> | undefined;
  let cached: UpdateCheckResult | undefined;
  let expires = 0;
  let selected: SelectedRelease | undefined;
  const opening = new Map<string, Promise<boolean>>();
  const lastSuccessfulOpen = new Map<string, number>();
  const base = { channel: "preview" as const, currentVersion: options.version };
  async function performCheck(): Promise<UpdateCheckResult> {
    selected = undefined;
    if (!parseVersion(options.version)) return { ...base, status: "error", error: "invalid-version" };
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = (async () => {
        const response = await options.fetch(UPDATE_API, {
          method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
          headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
          signal: controller.signal,
        });
        // Native fetch exposes the final URL. Empty URL is allowed for injected Responses.
        if (response.redirected || (response.url && response.url !== UPDATE_API)) throw new CheckError("invalid-response");
        if (response.status === 403 || response.status === 429) throw new CheckError("rate-limit");
        if (!response.ok) throw new CheckError("server");
        return selectRelease(await readJSON(response), options.platform, options.arch);
      })();
      const release = await Promise.race([request, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new CheckError("timeout")); }, TIMEOUT_MS);
      })]);
      const comparison = compareVersions(release.version, options.version)!;
      // Do not expose an older release, even as a manual download option.
      if (comparison < 0) return { ...base, status: "up-to-date" };
      selected = comparison === 0 ? { ...release, download: undefined } : release;
      return { ...base, status: comparison > 0 ? "available" : "up-to-date", release: { version: release.version, notes: release.notes, hasDownload: Boolean(selected.download) } };
    } catch (error) {
      return { ...base, status: "error", error: error instanceof CheckError ? error.code : controller.signal.aborted ? "timeout" : "offline" };
    } finally {
      if (timeout) clearTimeout(timeout);
      // Close unread HTTP error/oversized bodies too; never leave background I/O.
      controller.abort();
    }
  }
  return {
    check(): Promise<UpdateCheckResult> {
      if (pending) return pending;
      if (cached && now() < expires) return Promise.resolve(cached);
      pending = performCheck().then(result => { cached = result; expires = now() + CACHE_MS; return result; }).finally(() => { pending = undefined; });
      return pending;
    },
    open(target: UpdateOpenTarget): Promise<boolean> {
      if (target !== "release" && target !== "download") return Promise.resolve(false);
      const url = target === "release" ? selected?.page : selected?.download;
      if (!url) return Promise.resolve(false);
      // Deduplicate by verified destination, not globally: Release then Download
      // is a legitimate sequence. A coalesced successful click is still success.
      const pendingOpen = opening.get(url);
      if (pendingOpen) return pendingOpen;
      const lastSuccess = lastSuccessfulOpen.get(url);
      if (lastSuccess !== undefined && now() - lastSuccess < 1000) return Promise.resolve(true);
      const operation = Promise.resolve().then(() => options.openExternal(url)).then(() => {
        lastSuccessfulOpen.set(url, now());
        return true;
      }).catch(() => false).finally(() => { opening.delete(url); });
      opening.set(url, operation);
      return operation;
    },
  };
}
