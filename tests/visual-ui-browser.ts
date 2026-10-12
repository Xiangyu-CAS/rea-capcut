/** Standalone control, accessibility and undo transaction checks. */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const source = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import VisualTools from'/src/components/VisualTools.tsx';import{useEditorStore}from'/src/editor/store.ts';import{createProject,createClip}from'/src/core/model.ts';
const project=createProject();const asset={id:'image',name:'源画面.png',path:'demo-image',url:'data:image/png;base64,AA==',kind:'image',width:80,height:40,duration:0,fps:0,hasAudio:false};project.assets=[asset];project.clips=[createClip(asset,project.tracks.find(t=>t.kind==='video').id,0,30)];useEditorStore.getState().setProject(project);window.qa=useEditorStore;
function Harness(){const state=useEditorStore(),[mode,setMode]=useState('crop'),[locked,setLocked]=useState(false);return <main style={{height:'100vh',background:'#14171e',padding:35,color:'#c6d2e1',fontFamily:'-apple-system,sans-serif'}}><div style={{display:'flex',gap:16,maxWidth:900,margin:'auto'}}><section style={{padding:25,width:320,border:'1px solid #343e4b',borderRadius:10,background:'#1c222c'}}><header style={{display:'flex',gap:8,marginBottom:20}}>{['crop','chroma','mask'].map(value=><button onClick={()=>setMode(value)} key={value}>{value==='crop'?'裁剪':value==='chroma'?'抠像':'蒙版'}</button>)}<button onClick={()=>setLocked(!locked)}>锁定</button></header><VisualTools mode={mode} clip={state.project.clips[0]} asset={asset} locked={locked} onUpdate={patch=>state.updateClip(state.project.clips[0].id,patch)}/></section><article style={{padding:25,flex:1,color:'#8b9db3',fontSize:13,lineHeight:2}}><h2 style={{color:'#dce7f2',fontSize:19}}>画面工具 · 本地控件验收</h2><p>裁剪源画面、移除指定颜色、使用形状蒙版。</p><p>所有参数均通过编辑器状态保存，连续编辑合并为一次撤销。</p><pre style={{background:'#1c222c',padding:18,borderRadius:8,fontSize:11,whiteSpace:'pre-wrap'}}>{JSON.stringify({crop:state.project.clips[0].crop,chromaKey:state.project.clips[0].chromaKey,mask:state.project.clips[0].mask,undo:state.past.length},null,2)}</pre></article></div></main>};createRoot(document.getElementById('root')).render(<Harness/>);
`;
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    {
      name: "visual-ui-harness",
      resolveId(id) {
        if (id === "virtual:visual-ui") return "\0virtual:visual-ui";
      },
      load(id) {
        if (id === "\0virtual:visual-ui") return source;
      },
      transform(code, id) {
        if (id === "\0virtual:visual-ui")
          return import("esbuild")
            .then((esbuild) =>
              esbuild.transform(code, { loader: "jsx", jsx: "automatic" }),
            )
            .then((result) => ({ code: result.code, map: null }));
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/visual-ui") return next();
          server
            .transformIndexHtml(
              "/visual-ui",
              '<html><head><link rel="icon" href="data:,"><style>body{margin:0}button{cursor:pointer;background:#2d3b48;color:#cad9e7;padding:7px;border:1px solid #425467;border-radius:4px}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:visual-ui"></script></body></html>',
            )
            .then((html) => {
              res.setHeader("Content-Type", "text/html");
              res.end(html);
            });
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5182, strictPort: true },
});
await server.listen();
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
const page = await browser.newPage({ viewport: { width: 1250, height: 850 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const state = () => page.evaluate(() => (window as any).qa.getState());
try {
  await page.goto("http://127.0.0.1:5182/visual-ui");
  await page.waitForSelector(".visual-tools");
  await expect(
    page.getByRole("spinbutton", { name: "裁剪宽度" }),
  ).toBeDisabled();
  assert.equal((await state()).project.clips[0].crop, undefined);
  await page.getByRole("checkbox", { name: "启用画面裁剪" }).check();
  await page.getByRole("combobox", { name: "裁剪比例" }).selectOption("1:1");
  assert.deepEqual((await state()).project.clips[0].crop, {
    x: 0.25,
    y: 0,
    width: 0.5,
    height: 1,
  });
  const width = page.getByRole("spinbutton", { name: "裁剪宽度" });
  await expect(width).toHaveAttribute("min", "1");
  await width.fill("0");
  await width.blur();
  assert.equal((await state()).project.clips[0].crop.width, 0.01);
  await page.getByRole("combobox", { name: "裁剪比例" }).selectOption("1:1");
  const past = (await state()).past.length;
  await width.focus();
  for (const value of ["45", "40", "35", "30"]) await width.fill(value);
  await width.blur();
  assert.equal(
    (await state()).past.length,
    past + 1,
    "several edits while focused must produce one undo step",
  );
  assert.equal((await state()).project.clips[0].crop.width, 0.3);
  await page.getByRole("spinbutton", { name: "左侧位置" }).fill("95");
  await page.getByRole("spinbutton", { name: "左侧位置" }).blur();
  assert.equal(
    (await state()).project.clips[0].crop.x,
    0.7,
    "invalid source overflow must be clamped",
  );
  await page.getByRole("button", { name: "重置为完整画面" }).click();
  assert.equal((await state()).project.clips[0].crop, undefined);
  await page.getByRole("button", { name: "抠像", exact: true }).click();
  await expect(page.getByRole("slider", { name: "颜色容差" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "启用色度抠像" }).check();
  await page.getByRole("button", { name: "蓝幕", exact: true }).click();
  assert.equal((await state()).project.clips[0].chromaKey.color, "#0000ff");
  await page.getByRole("button", { name: "清除色度抠像" }).click();
  assert.equal((await state()).project.clips[0].chromaKey, undefined);
  await page.getByRole("button", { name: "蒙版", exact: true }).click();
  await page.getByRole("checkbox", { name: "启用形状蒙版" }).check();
  const maskWidth = page.getByRole("spinbutton", { name: "蒙版宽度" });
  await expect(maskWidth).toHaveAttribute("min", "1");
  await maskWidth.fill("0");
  await maskWidth.blur();
  assert.equal((await state()).project.clips[0].mask.width, 0.01);
  await page.getByRole("button", { name: "椭圆", exact: true }).click();
  await page.getByRole("spinbutton", { name: "蒙版宽度" }).fill("60");
  await page.getByRole("spinbutton", { name: "蒙版宽度" }).blur();
  await page.getByRole("checkbox", { name: "反选蒙版" }).check();
  assert.deepEqual((await state()).project.clips[0].mask, {
    shape: "ellipse",
    width: 0.6,
    height: 1,
    feather: 0,
    invert: true,
  });
  await page.getByRole("button", { name: "锁定", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "启用形状蒙版" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "清除蒙版" })).toBeDisabled();
  await page.getByRole("button", { name: "锁定", exact: true }).click();
  assert.deepEqual(errors, []);
  mkdirSync("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/visual-tools-components.png",
  });
  console.log(
    "Visual tool browser controls and undo transaction checks passed",
  );
} finally {
  await browser.close();
  await server.close();
}
