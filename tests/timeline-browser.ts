/** Browser interaction verification: npx tsx tests/timeline-browser.ts */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import Timeline from '/src/components/Timeline.tsx'; import MediaLibrary from '/src/components/MediaLibrary.tsx'; import EffectsPanel from '/src/components/EffectsPanel.tsx';
import {useEditorStore} from '/src/editor/store.ts'; import {createProject,createTrack,createClip} from '/src/core/model.ts';
const p=createProject('时间线交互验收'); p.tracks=[createTrack('video','主画面'),createTrack('video','画面 2'),createTrack('audio','音乐')];
const thumbnail='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><defs><linearGradient id="g"><stop stop-color="#486c70"/><stop offset="1" stop-color="#e4bf82"/></linearGradient></defs><rect width="240" height="140" fill="url(#g)"/><path d="M0 120 85 50 145 95 195 65 240 110V140H0" fill="#344d4a"/></svg>');
p.assets=[{id:'v',name:'山间日落.mp4',kind:'video',duration:12,path:'demo',url:thumbnail,fps:30,width:1920,height:1080,hasAudio:true,thumbnail,waveform:Array.from({length:100},(_,i)=>(Math.sin(i*.4)+1)/2)},{id:'a',name:'轻盈节奏.wav',kind:'audio',duration:20,path:'audio',url:'file:///audio.wav',fps:0,width:0,height:0,hasAudio:true,waveform:Array.from({length:100},(_,i)=>(Math.sin(i*.7)+1)/2)}];
p.clips=[{...createClip(p.assets[0],p.tracks[0].id,1,30),id:'first',duration:4},{...createClip(p.assets[0],p.tracks[0].id,3,30),id:'overlap',duration:3},{...createClip(p.assets[1],p.tracks[2].id,0,30),id:'music',duration:10}];
useEditorStore.getState().setProject(p);window.qa={store:useEditorStore};
function Harness(){const s=useEditorStore();return <main style={{height:'100vh',display:'flex',flexDirection:'column',background:'#101218',fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif',color:'white'}}><header style={{height:45,display:'flex',alignItems:'center',padding:'0 20px',fontSize:13}}>映刻 ReaCut <span style={{marginLeft:20,color:'#657184'}}>时间线与本地效果交互验收</span></header><div style={{height:360,display:'grid',gridTemplateColumns:'360px 1fr 340px'}}><MediaLibrary project={s.project} onImport={()=>{}} onAddAsset={s.addAssetClip} onRemoveAsset={s.removeAsset}/><div style={{display:'grid',placeItems:'center',background:'#13151b'}}><div style={{width:420,height:236,backgroundImage:'url("'+thumbnail+'")',backgroundSize:'cover',display:'grid',placeItems:'center',color:'#fff'}}>每一刻，都值得记录</div></div><EffectsPanel clip={s.project.clips.find(c=>c.id===s.selectedIds[0])} onApply={s.updateSelected}/></div><div style={{flex:1,minHeight:0}}><Timeline project={s.project} selectedIds={s.selectedIds} playhead={s.playhead} playing={s.playing} zoom={s.zoom} onSeek={s.seek} onSelect={s.select} onClipUpdate={s.updateClip} onMoveClips={s.moveClips} onTrim={s.trim} onSplit={s.split} onDelete={s.deleteSelected} onZoom={s.setZoom} onTrackUpdate={s.updateTrack} onAddTrack={s.addTrack} onTrackDelete={s.deleteTrack} onTrackMove={s.reorderTrack} onDropAsset={s.addAssetClip} onDuplicate={s.duplicate} onUndo={s.undo} onRedo={s.redo} canUndo={s.past.length>0} canRedo={s.future.length>0} snapping={s.snapping} onSnappingChange={s.setSnapping} magnetic={s.magnetic} onMagneticChange={s.setMagnetic}/></div></main>};
createRoot(document.getElementById('root')).render(<Harness/>);
`;
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    {
      name: "timeline-qa",
      resolveId(id) {
        if (id === "virtual:timeline-qa") return "\0virtual:timeline-qa";
      },
      load(id) {
        if (id === "\0virtual:timeline-qa") return { code: entry, map: null };
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/timeline-qa") return next();
          server
            .transformIndexHtml(
              "/timeline-qa",
              '<html><head><link rel="icon" href="data:,"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:timeline-qa"></script></body></html>',
            )
            .then((html) => {
              res.setHeader("Content-Type", "text/html");
              res.end(html);
            });
        });
      },
      transform(code, id) {
        if (id === "\0virtual:timeline-qa")
          return import("esbuild")
            .then((esbuild) =>
              esbuild.transform(code, { loader: "jsx", jsx: "automatic" }),
            )
            .then((result) => ({ code: result.code, map: null }));
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5181, strictPort: true },
});
await server.listen();
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("response", (response) => {
  if (response.status() >= 400)
    console.log("HTTP", response.status(), response.url());
});
page.on("console", (message) => {
  if (message.type() === "error") console.log("Browser:", message.text());
});
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const read = async () =>
  page.evaluate(() => (window as any).qa.store.getState().project);
const drag = async (x: number, y: number, toX: number, toY: number) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 12 });
  await page.mouse.up();
};
try {
  await page.goto("http://127.0.0.1:5181/timeline-qa");
  await page.waitForSelector(".tl-clip", { timeout: 8000 });
  const first = page
    .locator(".tl-clip")
    .filter({ hasText: "山间日落.mp4" })
    .first();
  const box = (await first.boundingBox())!;
  const overlapBox = (await page
    .locator(".tl-clip")
    .filter({ hasText: "山间日落.mp4" })
    .nth(1)
    .boundingBox())!;
  assert(
    overlapBox.y > box.y + box.height,
    "overlapping clips must remain separately accessible",
  );
  await first.click({ position: { x: 40, y: 25 } });
  await page.getByRole("button", { name: "应用黑白调色" }).click();
  assert.equal(
    (await read()).clips.find((c: any) => c.id === "first").adjustments
      .saturation,
    0,
  );
  // A purely vertical movement must move between compatible tracks without changing time.
  const target = (await page.locator(".tl-track").nth(1).boundingBox())!;
  const sourceTrackHeight = (await page
    .locator(".tl-track")
    .first()
    .boundingBox())!.height;
  await page.mouse.move(box.x + 40, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, target.y + 30, { steps: 12 });
  assert.equal(
    (await page.locator(".tl-track").first().boundingBox())!.height,
    sourceTrackHeight,
    "source row geometry must stay frozen during a cross-track drag",
  );
  assert.equal(
    (await page.locator(".tl-track").nth(1).boundingBox())!.y,
    target.y,
    "target row must remain under the pointer throughout the gesture",
  );
  await page.mouse.up();
  let p = await read();
  assert.equal(
    p.clips.find((c: any) => c.id === "first").trackId,
    p.tracks[1].id,
  );
  assert.equal(p.clips.find((c: any) => c.id === "first").start, 1);
  await page.locator('[data-clip-id="first"]').focus();
  await page.keyboard.press("Alt+ArrowRight");
  assert(
    Math.abs(
      (await read()).clips.find((c: any) => c.id === "first").start -
        (1 + 1 / 30),
    ) < 0.00001,
    "keyboard nudge must move exactly one frame",
  );
  await page.keyboard.press("Alt+ArrowLeft");
  assert.equal(
    (await read()).clips.find((c: any) => c.id === "first").start,
    1,
  );
  const moved = (await page
    .locator(".tl-track")
    .nth(1)
    .locator(".tl-clip")
    .boundingBox())!;
  await drag(moved.x + 40, moved.y + 25, moved.x + 100, moved.y + 25);
  p = await read();
  assert.equal(p.clips.find((c: any) => c.id === "first").start, 2);
  const current = (await page
    .locator(".tl-track")
    .nth(1)
    .locator(".tl-clip")
    .boundingBox())!;
  await drag(
    current.x + current.width - 2,
    current.y + 28,
    current.x + current.width - 62,
    current.y + 28,
  );
  p = await read();
  assert.equal(p.clips.find((c: any) => c.id === "first").duration, 3);
  const trimHandle = page.locator('[data-clip-id="first"] .tl-trim-end');
  await trimHandle.focus();
  await page.keyboard.press("ArrowLeft");
  assert(
    Math.abs(
      (await read()).clips.find((c: any) => c.id === "first").duration -
        (3 - 1 / 30),
    ) < 0.00001,
    "keyboard trim must remove one frame",
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(
    (await read()).clips.find((c: any) => c.id === "first").duration,
    3,
  );
  await page.getByRole("button", { name: "锁定画面 2", exact: true }).click();
  const locked = (await page
    .locator(".tl-track")
    .nth(1)
    .locator(".tl-clip")
    .boundingBox())!;
  await drag(locked.x + 40, locked.y + 25, locked.x + 100, locked.y + 25);
  assert.equal(
    (await read()).clips.find((c: any) => c.id === "first").start,
    2,
  );
  await page.locator('[data-clip-id="first"]').focus();
  await page.keyboard.press("Alt+ArrowRight");
  assert.equal(
    (await read()).clips.find((c: any) => c.id === "first").start,
    2,
    "keyboard cannot move locked clips",
  );
  await page.getByRole("button", { name: "解锁画面 2", exact: true }).click();
  await page.getByRole("tab", { name: "淡入淡出", exact: true }).click();
  await page
    .getByRole("button", { name: "淡入淡出", exact: true })
    .first()
    .click();
  p = await read();
  assert.equal(p.clips.find((c: any) => c.id === "first").fadeIn, 0.5);
  assert.equal(p.clips.find((c: any) => c.id === "first").fadeOut, 0.5);
  await page
    .getByRole("button", { name: "添加 山间日落.mp4 到时间线" })
    .focus();
  const before = (await read()).clips.length;
  await page.keyboard.press("Enter");
  assert.equal(
    (await read()).clips.length,
    before + 1,
    "keyboard addition must run once",
  );
  await page.getByRole("button", { name: "隐藏主画面", exact: true }).click();
  assert.equal((await read()).tracks[0].hidden, true);
  await page.getByRole("button", { name: "静音音乐", exact: true }).click();
  assert.equal((await read()).tracks[2].muted, true);
  const countBeforeDrop = (await read()).clips.length;
  await page
    .locator(".media-item")
    .first()
    .dragTo(page.locator(".tl-track").nth(1).locator(".tl-lane"), {
      targetPosition: { x: 600, y: 30 },
    });
  p = await read();
  assert.equal(
    p.clips.length,
    countBeforeDrop + 1,
    "dragging a material must insert it",
  );
  const dropped = p.clips[p.clips.length - 1];
  assert.equal(dropped.trackId, p.tracks[1].id);
  assert.equal(dropped.start, 10);
  const row = (await page.locator(".tl-track").nth(1).boundingBox())!;
  await drag(178, row.y + 3, 1150, row.y + row.height - 3);
  const selected = await page.evaluate(
    () => (window as any).qa.store.getState().selectedIds,
  );
  assert(
    selected.includes("first") && selected.includes(dropped.id),
    "marquee must select both clips",
  );
  const beforeZoom = await page.evaluate(
    () => (window as any).qa.store.getState().zoom,
  );
  await page.getByRole("button", { name: "缩小时间线", exact: true }).click();
  assert(
    (await page.evaluate(() => (window as any).qa.store.getState().zoom)) <
      beforeZoom,
  );
  const wheelBefore = await page.evaluate(
    () => (window as any).qa.store.getState().zoom,
  );
  await page
    .locator(".tl-scroll")
    .dispatchEvent("wheel", { deltaY: 100, ctrlKey: true });
  assert(
    (await page.evaluate(() => (window as any).qa.store.getState().zoom)) <
      wheelBefore,
    "control-wheel must zoom the timeline",
  );
  await page.getByRole("button", { name: "添加轨道", exact: true }).click();
  await page.getByRole("button", { name: "文字轨道", exact: true }).click();
  assert.equal(
    (await read()).tracks.filter((t: any) => t.kind === "text").length,
    1,
  );
  p = await read();
  const audioId = p.tracks.find((t: any) => t.kind === "audio").id;
  await page.getByRole("button", { name: "音乐轨道操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "重命名轨道", exact: true }).click();
  await page
    .getByRole("textbox", { name: "轨道名称", exact: true })
    .fill("背景音乐");
  await page
    .getByRole("textbox", { name: "轨道名称", exact: true })
    .press("Enter");
  assert.equal(
    (await read()).tracks.find((t: any) => t.id === audioId).name,
    "背景音乐",
  );
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "重命名轨道", exact: true }).click();
  await page
    .getByRole("textbox", { name: "轨道名称", exact: true })
    .fill("不要保存");
  await page
    .getByRole("textbox", { name: "轨道名称", exact: true })
    .press("Escape");
  assert.equal(
    (await read()).tracks.find((t: any) => t.id === audioId).name,
    "背景音乐",
  );
  const originalOrder = (await read()).tracks.map((t: any) => t.id);
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "向上移动轨道", exact: true })
    .click();
  assert.equal(
    (await read()).tracks.findIndex((t: any) => t.id === audioId),
    originalOrder.length - 2,
  );
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "向下移动轨道", exact: true })
    .click();
  assert.deepEqual(
    (await read()).tracks.map((t: any) => t.id),
    originalOrder,
  );
  await page.getByRole("button", { name: "锁定背景音乐", exact: true }).click();
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  for (const action of ["重命名轨道", "向上移动轨道", "删除轨道"])
    await expect(
      page.getByRole("menuitem", { name: action, exact: true }),
    ).toBeDisabled();
  await page.getByRole("button", { name: "解锁背景音乐", exact: true }).click();
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除轨道", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "删除轨道确认", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert((await read()).tracks.some((t: any) => t.id === audioId));
  await page
    .getByRole("button", { name: "背景音乐轨道操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除轨道", exact: true }).click();
  await page
    .getByRole("button", { name: "删除轨道和片段", exact: true })
    .click();
  p = await read();
  assert(!p.tracks.some((t: any) => t.id === audioId));
  assert(!p.clips.some((c: any) => c.id === "music"));
  assert.equal(p.assets.length, 2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  p = await read();
  assert(p.tracks.some((t: any) => t.id === audioId));
  assert(p.clips.some((c: any) => c.id === "music"));
  const emptyId = p.tracks.find((t: any) => t.kind === "text").id;
  await page
    .getByRole("button", { name: "文字 1轨道操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除轨道", exact: true }).click();
  assert(!(await read()).tracks.some((t: any) => t.id === emptyId));
  await expect(
    page.getByRole("dialog", { name: "删除轨道确认", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  // Create enough rows to exercise the sticky ruler independently of the content scroll.
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "添加轨道", exact: true }).click();
    await page.getByRole("button", { name: "视频轨道", exact: true }).click();
  }
  await page.locator(".tl-scroll").evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect
    .poll(() => page.locator(".tl-scroll").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  const scrollBox = (await page.locator(".tl-scroll").boundingBox())!,
    handleBox = (await page.locator(".tl-playhead-handle").boundingBox())!;
  assert(
    handleBox.y >= scrollBox.y && handleBox.y < scrollBox.y + 30,
    "playhead handle must remain in the sticky ruler after vertical scrolling",
  );
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.locator(".tl-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(
    page.getByRole("button", { name: "磁性删除", exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/timeline-components.png" });
  console.log(
    "Timeline browser interaction checks passed; screenshot: docs/screenshots/timeline-components.png",
  );
} catch (error) {
  console.error("Page errors:", errors);
  throw error;
} finally {
  await browser.close();
  await server.close();
}
