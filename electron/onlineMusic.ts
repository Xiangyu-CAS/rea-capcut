import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MusicResult, MusicSearchResult } from "../src/core/onlineMusic";

const OV = "https://api.openverse.org/v1/audio/";
const CATALOG = "https://incompetech.com/music/royalty-free/pieces.json";
const TRACKS = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/";
const LICENSE = "https://creativecommons.org/licenses/by/4.0/";
const SOURCE = "https://incompetech.com/music/royalty-free/index.html?isrc=";
const MAX_AUDIO = 24 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;
type Item = MusicResult & { file?: string; searchable?: string };
type Dict = Record<string, unknown>;
const object = (value: unknown): Dict => value && typeof value === "object" ? value as Dict : {};
const field = (value: unknown, max = 180) => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : "";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const duration = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

async function body(response: Response, limit: number) {
  if (!response.body || Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Response too large or empty");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > limit) throw new Error("Response too large");
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const nonencoded = !response.headers.get("content-encoding");
  const expected = response.headers.get("content-length");
  if (nonencoded && expected !== null && Number(expected) !== bytes) throw new Error("Incomplete response");
  return Buffer.concat(chunks, bytes);
}

const translations: Record<string, string> = {
  "轻快": "upbeat", "欢快": "upbeat", "开心": "happy", "平静": "calm", "放松": "relaxing",
  "温柔": "gentle", "浪漫": "romantic", "紧张": "tense", "悬疑": "mysterious", "史诗": "epic",
  "钢琴": "piano", "吉他": "guitar", "电子": "electronic", "爵士": "jazz", "可爱": "playful",
  "美食": "upbeat", "探店": "upbeat", "旅行": "upbeat", "纪录片": "ambient", "安静": "calm",
};
function searchTerms(query: string) {
  const mapped = Object.entries(translations).filter(([from]) => query.includes(from)).map(([, to]) => to);
  const latin = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set([...mapped, ...latin.filter(x => !["music", "bgm", "for", "the", "and", "with"].includes(x))])];
}

export function createOnlineMusic(root: string, request: typeof fetch = fetch, now = Date.now) {
  const current = new Map<string, Item>();
  let catalog: Promise<Item[]> | undefined, catalogUntil = 0;
  let searchAt = -Infinity, searchInProgress = false, retryAt = 0, unavailableUntil = 0;
  const fetched = new Map<string, Promise<string>>();

  async function fetchResponse(url: string | URL, ms: number) {
    return request(url, { redirect: "error", signal: AbortSignal.timeout(ms), credentials: "omit" });
  }

  function readCatalog() {
    if (catalog && now() < catalogUntil) return catalog;
    catalogUntil = now() + HOUR;
    catalog = (async () => {
      const response = await fetchResponse(CATALOG, 6500);
      if (!response.ok) { await response.body?.cancel(); throw new Error("Catalog unavailable"); }
      const payload: unknown = JSON.parse((await body(response, 4 * 1024 * 1024)).toString());
      if (!Array.isArray(payload)) throw new Error("Invalid catalog");
      return payload.slice(0, 5000).flatMap(raw => {
        const item = object(raw), title = field(item.title), name = field(item.filename, 240), isrc = field(item.isrc);
        if (!title || !/^[^/\\:%]+\.mp3$/i.test(name) || name.startsWith(".") || !/^USUAN\d{7}$/i.test(isrc)) return [];
        const time = field(item.length).split(":").map(Number);
        const seconds = time.length === 3 ? duration(time.reduce((total, part) => total * 60 + part, 0)) : 0;
        return [{
          id: `incompetech-${isrc.toUpperCase()}`, title, creator: "Kevin MacLeod (incompetech.com)",
          file: TRACKS + encodeURIComponent(name), sourceUrl: SOURCE + isrc.toUpperCase(), license: "CC BY", licenseUrl: LICENSE,
          provider: "Incompetech", duration: seconds, downloadable: true,
          searchable: [title, field(item.feel), field(item.instruments), field(item.description, 500)].join(" ").toLowerCase(),
        } satisfies Item];
      });
    })().catch(error => { catalog = undefined; throw error; });
    return catalog;
  }

  async function searchOpenverse(query: string): Promise<{ status: MusicSearchResult["openverse"]; items: Item[] }> {
    if (retryAt > now()) return { status: "limited", items: [] };
    if (unavailableUntil > now()) return { status: "unavailable", items: [] };
    try {
      const url = new URL(OV);
      url.search = new URLSearchParams({ q: query, category: "music", license: "cc0,by", page_size: "8" }).toString();
      const response = await fetchResponse(url, 5000);
      if (response.status === 429) {
        const value = response.headers.get("retry-after");
        const seconds = value && /^\d+$/.test(value) ? Number(value) : (Date.parse(value ?? "") - now()) / 1000;
        retryAt = now() + Math.min(24 * HOUR, Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000);
        await response.body?.cancel();
        return { status: "limited", items: [] };
      }
      if (!response.ok) {
        unavailableUntil = now() + 15000;
        await response.body?.cancel();
        return { status: "unavailable", items: [] };
      }
      const results = object(JSON.parse((await body(response, 1024 * 1024)).toString())).results;
      if (!Array.isArray(results)) return { status: "unavailable", items: [] };
      return { status: "ok", items: results.slice(0, 8).flatMap(raw => {
        const item = object(raw), id = field(item.id), title = field(item.title), version = field(item.license_version);
        const license = item.license === "cc0" ? "CC0" : item.license === "by" ? "CC BY" : null;
        const creator = field(item.creator);
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || !title || !license ||
            !/^\d\.\d$/.test(version) || (license === "CC BY" && !creator)) return [];
        return [{ id: `openverse-${id}`, title, creator: creator || "Unknown",
          sourceUrl: `https://openverse.org/audio/${id}`, license, provider: "Openverse",
          licenseUrl: `https://creativecommons.org/${license === "CC0" ? "publicdomain/zero" : "licenses/by"}/${version}/`,
          duration: duration(item.duration) / 1000, downloadable: false } satisfies Item];
      }) };
    } catch { unavailableUntil = now() + 15000; return { status: "unavailable", items: [] }; }
  }

  async function search(input: unknown): Promise<MusicSearchResult> {
    if (typeof input !== "string" || input.length > 120 || /[\x00-\x1f\x7f]/.test(input)) throw new Error("Invalid music query");
    if (searchInProgress || now() - searchAt < 800) throw new Error("Please wait before searching again");
    searchInProgress = true;
    searchAt = now();
    const query = input.trim(), terms = searchTerms(query);
    const resolved = terms.join(" ") || query || "upbeat instrumental";
    try {
      const [ov, incompetech] = await Promise.all([searchOpenverse(resolved), readCatalog().catch(() => null)]);
      const normalized = query.toLowerCase();
      const q = terms.length ? terms : normalized ? [normalized] : ["upbeat", "bright"];
      const direct = (incompetech ?? []).map(item => {
        const haystack = item.searchable ?? "";
        const score = q.reduce((acc, word) => acc + (item.title.toLowerCase().includes(word) ? 4 : haystack.includes(word) ? 1 : 0), 0);
        return { item, score };
      }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map(entry => entry.item);
      const items = [...new Map([...direct, ...ov.items].map(item => [item.id, item])).values()];
      for (const item of items) current.set(item.id, item);
      while (current.size > 250) current.delete(current.keys().next().value!);
      return { openverse: ov.status, incompetech: !!incompetech, tracks: items.map(({ file: _file, searchable: _query, ...item }) => item) };
    } finally { searchInProgress = false; }
  }

  function get(id: unknown) {
    const item = typeof id === "string" ? current.get(id) : undefined;
    if (!item) throw new Error("Search again before using this track");
    return item;
  }

  async function download(id: unknown) {
    const item = get(id), url = item.file;
    if (!url || !url.startsWith(TRACKS)) throw new Error("Use the original source to download this track");
    const cached = fetched.get(item.id);
    if (cached) return { item, file: await cached };
    if (fetched.size >= 3) throw new Error("Other music downloads are still running");
    const job = (async () => {
      await mkdir(root, { recursive: true });
      const file = path.join(root, digest(item.id) + ".mp3");
      if ((await stat(file).catch(() => null))?.isFile()) return file;
      const response = await fetchResponse(url, 40000);
      if (!response.ok) { await response.body?.cancel(); throw new Error("Music download unavailable"); }
      const data = await body(response, MAX_AUDIO);
      if (data.length < 128 || !(data.subarray(0, 3).toString() === "ID3" ||
          (data[0] === 0xff && (data[1] & 0xe0) === 0xe0))) throw new Error("Download is not MP3 audio");
      const partial = file + "." + randomUUID() + ".tmp";
      try { await writeFile(partial, data, { flag: "wx", mode: 0o600 }); await rename(partial, file); }
      finally { await rm(partial, { force: true }); }
      return file;
    })();
    fetched.set(item.id, job);
    try { return { item, file: await job }; }
    finally { fetched.delete(item.id); }
  }
  return { search, get, download };
}
