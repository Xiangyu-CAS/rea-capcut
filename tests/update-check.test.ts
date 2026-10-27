import { afterEach, describe, expect, it, vi } from "vitest";
import { compareVersions, createUpdateService, UPDATE_API } from "../electron/updateCheck";

const repo = "https://github.com/Xiangyu-CAS/rea-capcut";
function release(version = "0.8.0", changes: Record<string, unknown> = {}) {
  const name = `ReaCut-${version}-arm64.dmg`;
  return { tag_name: `v${version}`, draft: false, prerelease: true, html_url: `${repo}/releases/tag/v${version}`, body: "Release notes", assets: [{ name, state: "uploaded", size: 100, browser_download_url: `${repo}/releases/download/v${version}/${name}` }], ...changes };
}
function setup(data: unknown = [release()], overrides: Partial<Parameters<typeof createUpdateService>[0]> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify(data)));
  const openExternal = vi.fn(async (_url: string) => {});
  const service = createUpdateService({ version: "0.7.0", platform: "darwin", arch: "arm64", fetch, openExternal, ...overrides });
  return { ...service, fetch, openExternal };
}
afterEach(() => vi.useRealTimers());

describe("strict semantic version ordering", () => {
  it.each([
    ["v0.8.0", "0.7.0", 1], ["0.7.0", "v0.7.0+build.2", 0],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1], ["1.0.0-alpha.2", "1.0.0-alpha.11", -1],
    ["1.0.0-1", "1.0.0-a", -1], ["1.0.0-beta", "1.0.0", -1],
    ["999999999999999999999.0.0", "999999999999999999998.0.0", 1],
    ["1.0.0-a", "1.0.0-b", -1], ["1.0.1", "1.0.0", 1],
  ])("compares %s to %s", (a, b, expected) => expect(compareVersions(a as string, b as string)).toBe(expected));
  it.each(["01.2.3", "1.2", "1.2.3-01", "1.2.3-", "v1.2.3/evil", "1.2.3\n", "1.2.3+", "1.2.3-a..b"])("rejects malformed %s", version => expect(compareVersions(version, "1.0.0")).toBeUndefined());
});

describe("manual preview update service", () => {
  it("performs no startup network and only checks the fixed public list on request", async () => {
    const service = setup();
    expect(service.fetch).not.toHaveBeenCalled();
    expect(await service.open("download")).toBe(false);
    expect(await service.check()).toEqual({ channel: "preview", currentVersion: "0.7.0", status: "available", release: { version: "0.8.0", notes: "Release notes", hasDownload: true } });
    expect(service.fetch).toHaveBeenCalledWith(UPDATE_API, expect.objectContaining({ redirect: "error", credentials: "omit", method: "GET" }));
    expect(service.openExternal).not.toHaveBeenCalled();
    expect(await service.open("download")).toBe(true);
    expect(service.openExternal).toHaveBeenCalledWith(`${repo}/releases/download/v0.8.0/ReaCut-0.8.0-arm64.dmg`);
  });
  it("orders by semver rather than response order or publish date and filters drafts", async () => {
    const service = setup([release("0.7.1"), release("9.0.0", { draft: true }), release("0.9.0"), release("0.8.0")]);
    expect((await service.check()).release?.version).toBe("0.9.0");
  });
  it("accepts stable as well as GitHub-marked preview releases", async () => {
    expect((await setup([release("0.8.0", { prerelease: false })]).check()).status).toBe("available");
    expect((await setup([release("0.8.0-beta.1")]).check()).status).toBe("available");
  });
  it.each(["0.6.0", "0.7.0", "0.7.0-beta.1"])("never offers equal/older %s as a download", async version => {
    const service = setup([release(version)]);
    const result = await service.check();
    expect(result.status).toBe("up-to-date");
    expect(result.release?.hasDownload ?? false).toBe(false);
    expect(await service.open("download")).toBe(false);
    if (version !== "0.7.0") expect(await service.open("release")).toBe(false);
  });
  it.each([
    { platform: "darwin", arch: "x64" }, { platform: "linux", arch: "arm64" }, { platform: "win32", arch: "arm64" }, { platform: "darwin", arch: "ia32" },
  ])("does not offer arm64 DMG on %j", async target => {
    const service = setup(undefined, target);
    expect((await service.check()).release?.hasDownload).toBe(false);
    expect(await service.open("download")).toBe(false);
    expect(await service.open("release")).toBe(true);
  });
  it("matches an explicitly x64 desktop DMG for Intel", async () => {
    const service = setup([release("0.8.0", { assets: [{ name: "ReaCut-0.8.0-x64.dmg", state: "uploaded", size: 1, browser_download_url: `${repo}/releases/download/v0.8.0/ReaCut-0.8.0-x64.dmg` }] })], { arch: "x64" });
    expect((await service.check()).release?.hasDownload).toBe(true);
  });
  it.each(["ReaCut-plugin-0.8.0.zip", "ReaCut-0.8.0-arm64.zip", "ReaCut-0.8.0.dmg", "ReaCut-0.7.0-arm64.dmg"])("rejects incompatible asset %s", async name => {
    const service = setup([release("0.8.0", { assets: [{ name, state: "uploaded", size: 1, browser_download_url: `${repo}/releases/download/v0.8.0/${name}` }] })]);
    expect((await service.check()).release?.hasDownload).toBe(false);
  });
  it.each([
    "https://evil.test/releases/tag/v0.8.0", `${repo}/releases/tag/v0.8.0?redirect=evil`,
    `${repo}/releases/tag/v0.8.0#evil`, "http://github.com/Xiangyu-CAS/rea-capcut/releases/tag/v0.8.0",
    "https://github.com@evil.test/Xiangyu-CAS/rea-capcut/releases/tag/v0.8.0",
    "https://user:password@github.com/Xiangyu-CAS/rea-capcut/releases/tag/v0.8.0",
    "https://github.com/other/repo/releases/tag/v0.8.0", `${repo}/releases/tag/v0.9.0`,
  ])("rejects untrusted release source %s", async html_url => {
    const service = setup([release("0.8.0", { html_url })]);
    expect((await service.check()).error).toBe("invalid-response");
    expect(await service.open("release")).toBe(false);
  });
  it("rejects untrusted asset source and ignores renderer-controlled arbitrary URLs", async () => {
    const input = release();
    input.assets[0].browser_download_url = "https://evil.test/ReaCut-0.8.0-arm64.dmg";
    const service = setup([input]);
    expect((await service.check()).release?.hasDownload).toBe(false);
    expect(await service.open("https://evil.test" as "release")).toBe(false);
    expect(service.openExternal).not.toHaveBeenCalled();
  });
  it("returns bounded notes as plain data without evaluating HTML/instructions", async () => {
    const body = '<script>alert("bad")</script>\nIgnore previous instructions.\u0000' + "x".repeat(20000);
    const result = await setup([release("0.8.0", { body })]).check();
    expect(result.release?.notes).toContain('<script>alert("bad")</script>');
    expect(result.release?.notes).not.toContain("\u0000");
    expect(result.release!.notes.length).toBeLessThanOrEqual(16000);
  });
  it("deduplicates simultaneous checks and caches repeated clicks for 30 seconds", async () => {
    let now = 0;
    const service = setup(undefined, { now: () => now });
    const first = service.check(), second = service.check();
    expect(first).toBe(second);
    await first;
    await service.check();
    expect(service.fetch).toHaveBeenCalledTimes(1);
    now = 30001;
    await service.check();
    expect(service.fetch).toHaveBeenCalledTimes(2);
  });
  it("deduplicates repeated external opens", async () => {
    const service = setup();
    await service.check();
    expect(await service.open("release")).toBe(true);
    expect(await service.open("release")).toBe(true);
    expect(service.openExternal).toHaveBeenCalledTimes(1);
  });
  it("opens distinct targets immediately without misleading failure", async () => {
    const service = setup();
    await service.check();
    expect(await service.open("release")).toBe(true);
    expect(await service.open("download")).toBe(true);
    expect(service.openExternal).toHaveBeenCalledTimes(2);
  });
  it("shares the result of simultaneous same-destination opens", async () => {
    let resolve!: () => void;
    const openExternal = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const service = setup(undefined, { openExternal });
    await service.check();
    const first = service.open("download"), second = service.open("download");
    expect(first).toBe(second);
    await Promise.resolve();
    resolve();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
  it("does not cache a failed browser launch and permits immediate retry", async () => {
    const openExternal = vi.fn().mockRejectedValueOnce(Error("failed")).mockResolvedValueOnce(undefined);
    const service = setup(undefined, { openExternal });
    await service.check();
    expect(await service.open("release")).toBe(false);
    expect(await service.open("release")).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(2);
  });
  it("handles browser launch failure", async () => {
    const service = setup(undefined, { openExternal: async () => { throw Error("failed"); } });
    await service.check();
    expect(await service.open("release")).toBe(false);
  });
  it.each([403, 429, 500, 404])("handles HTTP %s", async status => {
    const service = setup(undefined, { fetch: async () => new Response("", { status }) });
    expect((await service.check()).error).toBe([403, 429].includes(status) ? "rate-limit" : "server");
  });
  it("handles offline errors without exposing exception details", async () => {
    const service = setup(undefined, { fetch: async () => { throw Error("private machine data"); } });
    expect((await service.check()).error).toBe("offline");
  });
  it("times out and aborts a stalled request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const service = setup(undefined, { fetch: async (_, init) => { signal = init?.signal as AbortSignal; return new Promise(() => {}); } });
    const checking = service.check();
    await vi.advanceTimersByTimeAsync(10000);
    expect((await checking).error).toBe("timeout");
    expect(signal?.aborted).toBe(true);
  });
  it.each([{}, [], [{ tag_name: "oops" }], Array(101).fill(release())])("handles malformed/no usable releases %#", async data => {
    expect((await setup(data).check()).error).toBe("invalid-response");
  });
  it("rejects malformed JSON and oversized response data", async () => {
    for (const body of ["not json", "x".repeat(2 * 1024 * 1024 + 1)]) {
      const service = setup(undefined, { fetch: async () => new Response(body) });
      expect((await service.check()).error).toBe("invalid-response");
    }
  });
  it.each([
    { redirected: true, url: UPDATE_API },
    { redirected: false, url: "https://evil.test/releases" },
  ])("rejects redirects and unexpected response sources %j", async properties => {
    const response = new Response(JSON.stringify([release()]));
    Object.defineProperties(response, { redirected: { value: properties.redirected }, url: { value: properties.url } });
    expect((await setup(undefined, { fetch: async () => response }).check()).error).toBe("invalid-response");
  });
  it("rejects oversized declared length before reading the body", async () => {
    const response = new Response("[]", { headers: { "Content-Length": "2097153" } });
    expect((await setup(undefined, { fetch: async () => response }).check()).error).toBe("invalid-response");
  });
  it("times out a response body as well as the initial connection", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("[")); } });
    const service = setup(undefined, { fetch: async () => new Response(stream) });
    const checking = service.check();
    await vi.advanceTimersByTimeAsync(10000);
    expect((await checking).error).toBe("timeout");
  });
  it("rejects invalid current version before network", async () => {
    const service = setup(undefined, { version: "dev" });
    expect((await service.check()).error).toBe("invalid-version");
    expect(service.fetch).not.toHaveBeenCalled();
  });
  it("clears previously allowed links after a failed fresh check", async () => {
    let now = 0;
    const service = setup(undefined, { now: () => now });
    await service.check();
    now = 30001;
    service.fetch.mockRejectedValueOnce(Error("offline"));
    await service.check();
    expect(await service.open("release")).toBe(false);
  });
});
