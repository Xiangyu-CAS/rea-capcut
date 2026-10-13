import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CAPCUT_SIDECAR_MAX_BYTES } from "../electron/capcutProject";
import {
  CAPCUT_DRAFT_MAX_BYTES,
  discoverSelectedCapcutProject,
  readSelectedCapcutTimeline,
} from "../electron/capcutProjectIO";

const main = "11111111-1111-4111-8111-111111111111";
const active = "22222222-2222-4222-8222-222222222222";
let fixture: string;
let project: string;
const nativePayload = "OpaqueBase64CarrierUnchanged+/==";

async function createModern() {
  await mkdir(join(project, "Timelines", main), { recursive: true });
  await mkdir(join(project, "Timelines", active), { recursive: true });
  await writeFile(
    join(project, "Timelines", "project.json"),
    JSON.stringify({
      version: 0,
      main_timeline_id: main,
      timelines: [
        { id: main, name: "空主时间线", is_marked_delete: false },
        { id: active, name: "实际剪辑时间线", is_marked_delete: false },
      ],
    }),
  );
  await writeFile(
    join(project, "timeline_layout.json"),
    JSON.stringify({ activeTimeline: active }),
  );
  await writeFile(join(project, "draft_info.json"), "empty-root");
  await writeFile(
    join(project, "Timelines", main, "draft_info.json"),
    "empty-main",
  );
  await writeFile(
    join(project, "Timelines", active, "draft_info.json"),
    nativePayload,
  );
}

async function oversized(path: string, limit: number) {
  const handle = await open(path, "w");
  try {
    await handle.truncate(limit + 1);
  } finally {
    await handle.close();
  }
}

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), "reacut-capcut-selection-"));
  project = join(fixture, "project");
  await mkdir(project);
});
afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

describe("bounded read-only Capcut project loader", () => {
  it("reads only the explicitly chosen modern timeline and preserves its opaque text", async () => {
    await createModern();
    const before = await readFile(join(project, "draft_info.json"));
    const plan = await discoverSelectedCapcutProject(project, "directory");
    expect(plan.timelines).toHaveLength(2);
    expect(plan.mainTimelineId).toBe(main);
    expect(plan.activeTimelineId).toBe(active);
    await expect(readSelectedCapcutTimeline(plan)).rejects.toThrow("明确选择");
    expect(await readSelectedCapcutTimeline(plan, active)).toEqual({
      text: nativePayload,
      name: "实际剪辑时间线",
      path: join(project, "Timelines", active, "draft_info.json"),
    });
    expect(await readFile(join(project, "draft_info.json"))).toEqual(before);
  });

  it("honors an explicit timeline file rather than a different active hint", async () => {
    await createModern();
    const selected = join(project, "Timelines", main, "draft_info.json");
    const plan = await discoverSelectedCapcutProject(selected, "file");
    expect(plan.requiresTimelineChoice).toBe(false);
    expect((await readSelectedCapcutTimeline(plan)).text).toBe("empty-main");
  });

  it("uses classic draft_info first and draft_content only when info is absent", async () => {
    await writeFile(join(project, "draft_content.json"), "classic-content");
    const plan = await discoverSelectedCapcutProject(project, "directory");
    expect(plan.kind).toBe("single-draft");
    expect((await readSelectedCapcutTimeline(plan)).text).toBe("classic-content");
    await writeFile(join(project, "draft_info.json"), "classic-info");
    expect((await readSelectedCapcutTimeline(plan)).text).toBe("classic-info");
    const explicit = await discoverSelectedCapcutProject(
      join(project, "draft_content.json"),
      "file",
    );
    expect((await readSelectedCapcutTimeline(explicit)).text).toBe(
      "classic-content",
    );
  });

  it("never substitutes another file for an explicit missing file", async () => {
    await writeFile(join(project, "draft_content.json"), "must-not-substitute");
    const plan = await discoverSelectedCapcutProject(
      join(project, "draft_info.json"),
      "file",
    );
    await expect(readSelectedCapcutTimeline(plan)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps a selected timeline directory fallback inside that directory", async () => {
    const timelineDirectory = join(project, "Timelines", main);
    await mkdir(timelineDirectory, { recursive: true });
    await writeFile(join(project, "draft_content.json"), "unselected-root");
    await writeFile(
      join(timelineDirectory, "draft_content.json"),
      "selected-directory-content",
    );
    const plan = await discoverSelectedCapcutProject(
      timelineDirectory,
      "directory",
    );
    const result = await readSelectedCapcutTimeline(plan);
    expect(result.path).toBe(join(timelineDirectory, "draft_content.json"));
    expect(result.text).toBe("selected-directory-content");
  });

  it("does not fall back to the root or temporary backup if a modern timeline is missing", async () => {
    await createModern();
    await rm(join(project, "Timelines", active, "draft_info.json"));
    await writeFile(
      join(project, "Timelines", active, "template.tmp"),
      "stale-plaintext-backup",
    );
    await writeFile(join(project, "draft_content.json"), "unrelated-root");
    const plan = await discoverSelectedCapcutProject(project, "directory");
    await expect(readSelectedCapcutTimeline(plan, active)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("distinguishes absent sidecars from malformed JSON or a directory pseudo-file", async () => {
    await createModern();
    await rm(join(project, "timeline_layout.json"));
    const absent = await discoverSelectedCapcutProject(project, "directory");
    expect(absent.activeTimelineId).toBeUndefined();
    await writeFile(join(project, "timeline_layout.json"), "{malformed");
    const malformedLayout = await discoverSelectedCapcutProject(
      project,
      "directory",
    );
    expect(malformedLayout.warnings).toContain(
      "时间线布局无法验证，已忽略活动时间线提示。",
    );
    await writeFile(join(project, "Timelines", "project.json"), "{malformed");
    await expect(
      discoverSelectedCapcutProject(project, "directory"),
    ).rejects.toThrow("不是可读取的 JSON");
    await rm(join(project, "Timelines", "project.json"));
    await mkdir(join(project, "Timelines", "project.json"));
    await expect(
      discoverSelectedCapcutProject(project, "directory"),
    ).rejects.toThrow("不是普通文件");
  });

  it("enforces byte limits for sidecars and payloads before decoding", async () => {
    await createModern();
    await oversized(
      join(project, "Timelines", "project.json"),
      CAPCUT_SIDECAR_MAX_BYTES,
    );
    await expect(
      discoverSelectedCapcutProject(project, "directory"),
    ).rejects.toThrow("大小限制");
    await createModern();
    await oversized(join(project, "timeline_layout.json"), CAPCUT_SIDECAR_MAX_BYTES);
    await expect(
      discoverSelectedCapcutProject(project, "directory"),
    ).rejects.toThrow("大小限制");
    await rm(join(project, "timeline_layout.json"));
    const plan = await discoverSelectedCapcutProject(project, "directory");
    await oversized(
      join(project, "Timelines", active, "draft_info.json"),
      CAPCUT_DRAFT_MAX_BYTES,
    );
    await expect(readSelectedCapcutTimeline(plan, active)).rejects.toThrow(
      "大小限制",
    );
  });

  it("rejects a classic payload directory without attempting draft_content fallback", async () => {
    await mkdir(join(project, "draft_info.json"));
    await writeFile(join(project, "draft_content.json"), "not-a-fallback");
    const plan = await discoverSelectedCapcutProject(project, "directory");
    await expect(readSelectedCapcutTimeline(plan)).rejects.toThrow("不是普通文件");
  });

  it("diagnoses non-UTF8 carriers rather than silently replacing bytes", async () => {
    await writeFile(join(project, "draft_info.json"), Buffer.from([0xff, 0xfe, 0x00]));
    const plan = await discoverSelectedCapcutProject(project, "directory");
    await expect(readSelectedCapcutTimeline(plan)).rejects.toThrow("非 UTF-8");
  });

  it.skipIf(process.platform === "win32")(
    "rejects external manifest, layout and payload symlinks",
    async () => {
      await createModern();
      const outside = join(fixture, "outside");
      await writeFile(outside, JSON.stringify({ version: 0, timelines: [] }));
      for (const target of [
        join(project, "Timelines", "project.json"),
        join(project, "timeline_layout.json"),
      ]) {
        const original = await readFile(target);
        await rm(target);
        await symlink(outside, target);
        await expect(
          discoverSelectedCapcutProject(project, "directory"),
        ).rejects.toThrow("逃离");
        await rm(target);
        await writeFile(target, original);
      }
      const plan = await discoverSelectedCapcutProject(project, "directory");
      const target = join(project, "Timelines", active, "draft_info.json");
      await rm(target);
      await symlink(outside, target);
      await expect(readSelectedCapcutTimeline(plan, active)).rejects.toThrow("逃离");
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not treat dangling external links as optional absence",
    async () => {
      await mkdir(join(project, "Timelines"));
      await symlink(
        join(fixture, "missing-outside-file"),
        join(project, "Timelines", "project.json"),
      );
      await writeFile(join(project, "draft_info.json"), "must-not-use-root");
      await expect(
        discoverSelectedCapcutProject(project, "directory"),
      ).rejects.toThrow("逃离");
    },
  );

  it.skipIf(process.platform === "win32")(
    "allows confined symlinks but detects a retargeted selected project root",
    async () => {
      await writeFile(join(project, "actual.json"), "inside-project");
      await symlink("actual.json", join(project, "draft_info.json"));
      const plan = await discoverSelectedCapcutProject(project, "directory");
      expect((await readSelectedCapcutTimeline(plan)).text).toBe("inside-project");
      const alias = join(fixture, "selected-project");
      await symlink(project, alias);
      const selected = await discoverSelectedCapcutProject(alias, "directory");
      await rm(alias);
      const other = join(fixture, "other-project");
      await mkdir(other);
      await writeFile(join(other, "draft_info.json"), "different-project");
      await symlink(other, alias);
      await expect(readSelectedCapcutTimeline(selected)).rejects.toThrow(
        "目录已发生变化",
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps access-denied errors distinct from absent modern manifests",
    async () => {
      await createModern();
      const path = join(project, "Timelines", "project.json");
      await chmod(path, 0);
      try {
        await expect(
          discoverSelectedCapcutProject(project, "directory"),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        await chmod(path, 0o600);
      }
    },
  );
});
