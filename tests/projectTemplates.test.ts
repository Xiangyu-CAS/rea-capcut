import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
  createProject,
  createClip,
  clone,
  validateProject,
} from "../src/core/model";
import type { MediaAsset } from "../src/core/types";
import {
  defaultTemplate,
  instantiateTemplate,
  replaceTemplateSlots,
  validateTemplate,
} from "../src/core/projectTemplates";
import {
  readTemplate,
  writeTemplate,
  listTemplates,
  libraryTemplate,
  TEMPLATE_FILE,
} from "../electron/projectTemplates";
import { useEditorStore } from "../src/editor/store";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
function fixture() {
  const p = createProject("模板测试");
  p.width = 320;
  p.height = 180;
  const a: MediaAsset = {
    id: "source",
    name: "画面",
    kind: "video",
    path: "/synthetic/source.mp4",
    url: "file:///synthetic/source.mp4",
    duration: 12,
    width: 320,
    height: 180,
    fps: 30,
    hasAudio: true,
  };
  const c = createClip(a, p.tracks[1].id, 0, 30);
  c.duration = 4;
  c.sourceIn = 1;
  c.speed = 2;
  c.keyframes = [
    { id: "key", property: "x", time: 4, value: 40, easing: "easeOut" },
  ];
  c.crop = { x: 0.1, y: 0, width: 0.9, height: 1 };
  const txt = createClip(undefined, p.tracks[0].id, 0, 30);
  txt.text!.text = "独立文案";
  txt.duration = 4;
  p.assets = [a, { ...a, id: "unused", path: "/unused.mp4" }];
  p.clips = [c, txt];
  return defaultTemplate(p, createCanvas(32, 18).toDataURL("image/png"));
}
it("saves only referenced assets and exposes media/text slots", () => {
  const t = fixture();
  expect(t.project.assets).toHaveLength(1);
  expect(t.slots.map((s) => s.kind)).toEqual(["media", "text"]);
  expect(validateTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
});
it("assigns independent identities throughout every instance", () => {
  const t = fixture();
  const before = JSON.stringify(t),
    a = instantiateTemplate(t),
    b = instantiateTemplate(t);
  expect(a.project.id).not.toBe(b.project.id);
  for (const collection of ["assets", "tracks", "clips"] as const)
    expect(
      a.project[collection]
        .map((x) => x.id)
        .some((id) => b.project[collection].some((x) => x.id === id)),
    ).toBe(false);
  expect(a.project.clips[0].keyframes[0].id).not.toBe(
    t.project.clips[0].keyframes[0].id,
  );
  expect(a.slots[0].targetId).toBe(a.project.assets[0].id);
  expect(JSON.stringify(t)).toBe(before);
});
it("replaces media and text atomically while preserving timing, crop, curves and undo history", () => {
  const t = instantiateTemplate(fixture()),
    before = JSON.stringify(t),
    a = {
      ...t.project.assets[0],
      id: "new",
      name: "新视频",
      path: "/synthetic/new.mp4",
      width: 180,
      height: 320,
    };
  const p = replaceTemplateSlots(t, {
    media: { [t.slots[0].id]: a },
    text: { [t.slots[1].id]: "替换后文案" },
  });
  expect(p.assets[0].id).toBe(t.project.assets[0].id);
  expect(p.assets[0].path).toBe(a.path);
  expect(p.clips[0]).toEqual(t.project.clips[0]);
  expect(p.clips[1].text!.text).toBe("替换后文案");
  expect(JSON.stringify(t)).toBe(before);
  useEditorStore.getState().setProject(t.project);
  useEditorStore.getState().commit(p);
  useEditorStore.getState().undo();
  expect(useEditorStore.getState().project).toEqual(t.project);
  useEditorStore.getState().redo();
  expect(
    validateProject(
      JSON.parse(JSON.stringify(useEditorStore.getState().project)),
    ).assets[0].path,
  ).toBe(a.path);
});
it.each([0, 8.9, NaN, Infinity])(
  "rejects short/nonfinite replacement %s before any edits",
  (duration) => {
    const t = fixture();
    const before = JSON.stringify(t);
    expect(() =>
      replaceTemplateSlots(t, {
        media: { [t.slots[0].id]: { ...t.project.assets[0], duration } },
        text: { [t.slots[1].id]: "change" },
      }),
    ).toThrow();
    expect(JSON.stringify(t)).toBe(before);
  },
);
it("supports an image/video visual slot on a video track and rejects audio substitution", () => {
  const t = fixture();
  expect(
    replaceTemplateSlots(t, {
      media: {
        [t.slots[0].id]: { ...t.project.assets[0], kind: "image", duration: 0 },
      },
      text: {},
    }).assets[0].kind,
  ).toBe("image");
  expect(() =>
    replaceTemplateSlots(t, {
      media: {
        [t.slots[0].id]: {
          ...t.project.assets[0],
          kind: "audio",
          width: 0,
          height: 0,
        },
      },
      text: {},
    }),
  ).toThrow("类型");
});
it("rejects locked tracks, unknown slots, invalid text and duplicate template targets", () => {
  const t = fixture();
  t.project.tracks[1].locked = true;
  expect(() =>
    replaceTemplateSlots(t, {
      media: { [t.slots[0].id]: t.project.assets[0] },
      text: {},
    }),
  ).toThrow("解锁");
  expect(() =>
    replaceTemplateSlots(t, { media: {}, text: { unknown: "x" } }),
  ).toThrow("未知");
  expect(() =>
    replaceTemplateSlots(t, { media: {}, text: { [t.slots[1].id]: "\0" } }),
  ).toThrow();
  expect(() =>
    validateTemplate({
      ...t,
      slots: [...t.slots, { ...t.slots[0], id: "dup" }],
    }),
  ).toThrow("重复");
});
it("keeps paired audio/video replacements linked to the same source", () => {
  const t = fixture();
  const c = t.project.clips[0];
  c.linkId = "pair";
  const a = {
    ...t.project.assets[0],
    id: "audio",
    kind: "audio" as const,
    width: 0,
    height: 0,
  };
  t.project.assets.push(a);
  t.project.clips.push({
    ...clone(c),
    id: "audioClip",
    assetId: a.id,
    trackId: t.project.tracks[2].id,
  });
  const full = defaultTemplate(t.project);
  const mediaSlot = full.slots.find((s) => s.targetId === c.assetId)!,
    audioSlot = full.slots.find((s) => s.targetId === a.id)!;
  const media = {
    [mediaSlot.id]: { ...t.project.assets[0], path: "/new.mp4" },
  };
  expect(() => replaceTemplateSlots(full, { media, text: {} })).toThrow(
    "一起替换",
  );
  const p = replaceTemplateSlots(full, {
    media: { ...media, [audioSlot.id]: { ...a, path: "/new.mp4" } },
    text: {},
  });
  expect(p.clips[0].linkId).toBe(p.clips[2].linkId);
});
async function storage() {
  const root = await mkdtemp(path.join(os.tmpdir(), "reacut-template-"));
  roots.push(root);
  const parent = path.join(root, "library");
  await mkdir(parent);
  const t = fixture();
  t.project.assets[0].path = path.join(root, "source.mp4");
  await writeFile(t.project.assets[0].path, "synthetic bytes");
  return { root, parent, t };
}
describe("portable templates", () => {
  it("moves/export-imports with own media, no source paths, then makes an independent library copy", async () => {
    const { root, parent, t } = await storage();
    const folder = await writeTemplate(
      t,
      parent,
      new AbortController().signal,
      () => {},
    );
    const raw = await readFile(path.join(folder, TEMPLATE_FILE), "utf8");
    expect(raw).not.toContain(root);
    expect(
      await readFile(path.join(folder, "ReaCut-原创资源许可.txt"), "utf8"),
    ).toContain("Copyright (c) 2026 ReaCut contributors");
    const moved = path.join(root, "moved");
    await rename(folder, moved);
    await rm(t.project.assets[0].path);
    const read = await readTemplate(path.join(moved, TEMPLATE_FILE));
    const imported = await writeTemplate(
      read,
      parent,
      new AbortController().signal,
      () => {},
    );
    await rm(moved, { recursive: true });
    const loaded = await libraryTemplate(parent, path.basename(imported));
    expect((await readFile(loaded.project.assets[0].path)).toString()).toBe(
      "synthetic bytes",
    );
    expect(await listTemplates(parent)).toHaveLength(1);
  });
  it("cancels during copying with no visible partial library entry", async () => {
    const { parent, t } = await storage();
    await writeFile(t.project.assets[0].path, Buffer.alloc(4 * 1024 * 1024, 7));
    const controller = new AbortController();
    await expect(
      writeTemplate(t, parent, controller.signal, () => controller.abort()),
    ).rejects.toThrow();
    expect(await readdir(parent)).toEqual([]);
  });
  it.each(["../outside.mp4", "/tmp/outside.mp4", "media/../../outside.mp4"])(
    "rejects external template paths %s",
    async (value) => {
      const { parent, t } = await storage();
      const folder = await writeTemplate(
          t,
          parent,
          new AbortController().signal,
          () => {},
        ),
        file = path.join(folder, TEMPLATE_FILE);
      const raw = JSON.parse(await readFile(file, "utf8"));
      raw.project.assets[0].path = value;
      await writeFile(file, JSON.stringify(raw));
      await expect(readTemplate(file)).rejects.toThrow("相对路径");
    },
  );
  it("rejects escaped media symlinks and library traversal", async () => {
    const { parent, t } = await storage();
    const folder = await writeTemplate(
        t,
        parent,
        new AbortController().signal,
        () => {},
      ),
      file = path.join(folder, TEMPLATE_FILE);
    const raw = JSON.parse(await readFile(file, "utf8")),
      target = path.join(folder, raw.project.assets[0].path);
    await rm(target);
    await symlink(t.project.assets[0].path, target);
    await expect(readTemplate(file)).rejects.toThrow("包外");
    await expect(libraryTemplate(parent, "../source.mp4")).rejects.toThrow(
      "标识",
    );
    expect(await listTemplates(parent)).toEqual([]);
  });
  it("rejects oversized cover dimensions and unknown versions", async () => {
    const { parent, t } = await storage();
    t.cover = createCanvas(961, 1).toDataURL("image/png");
    await expect(
      writeTemplate(t, parent, new AbortController().signal, () => {}),
    ).rejects.toThrow("封面");
    expect(() => validateTemplate({ ...t, version: 2 })).toThrow("格式");
    expect(await readdir(parent)).toEqual([]);
  });
});
