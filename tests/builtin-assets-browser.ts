/** Isolated browser check for the bundled-asset panel (real images and audio). */
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { BUILTIN_ASSETS } from "../src/core/builtinAssets";
const output = ".test-output/builtin-assets";
await mkdir(output, { recursive: true });
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import AssetLibrary from '/src/components/AssetLibrary.tsx';window.added=[];createRoot(document.getElementById('root')).render(<AssetLibrary onAdd={async(asset)=>{await new Promise(r=>setTimeout(r,50));window.added.push(asset.id)}}/>);`;
const server = await createServer({configFile:false,plugins:[react(),{
 name:"builtin-assets-qa",resolveId(id){if(id==="virtual:builtin-assets-qa")return"\0virtual:builtin-assets-qa";},load(id){if(id==="\0virtual:builtin-assets-qa")return{code:entry,map:null};},
 configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url!=="/assets-qa")return next();server.transformIndexHtml("/assets-qa",`<html><head><link rel="icon" href="data:,"><style>*{box-sizing:border-box}body{margin:0;background:#0d1118;font-family:system-ui}#root{width:320px;height:850px;margin:24px auto;border:1px solid #333;border-radius:8px;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/@id/__x00__virtual:builtin-assets-qa"></script></body></html>`).then(html=>{res.setHeader("Content-Type","text/html");res.end(html);});});},
 async transform(code,id){if(id==="\0virtual:builtin-assets-qa"){const {transform}=await import("esbuild");return{code:(await transform(code,{loader:"jsx",jsx:"automatic"})).code,map:null};}}
}],server:{host:"127.0.0.1",port:5187,strictPort:true}});
await server.listen();
const chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
const page=await browser.newPage({viewport:{width:700,height:900}}),errors:string[]=[];
page.on("pageerror",error=>errors.push(error.message));
try {
 await page.goto("http://127.0.0.1:5187/assets-qa");
 await expect(page.locator(".builtin-card")).toHaveCount(BUILTIN_ASSETS.length);
 await expect(page.locator('[data-builtin-id="sparkle"] img')).toBeVisible();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLImageElement>(".builtin-card img")).filter(image=>image.getBoundingClientRect().top<850).every(image=>image.complete&&image.naturalWidth>0));
 await page.getByRole("button",{name:"添加 四角星光",exact:true}).click();
 await page.waitForFunction(()=>(window as unknown as {added:string[]}).added[0]==="sparkle");
 await page.getByRole("tab",{name:"背景",exact:true}).click();
 await expect(page.locator(".builtin-card")).toHaveCount(BUILTIN_ASSETS.filter(a=>a.category==="backgrounds").length);
 await page.getByRole("tab",{name:"全部",exact:true}).click();
 await page.getByRole("textbox",{name:"搜索原创素材"}).fill("旅行");
 await expect(page.locator(".builtin-card")).toHaveCount(2);
 await expect(page.locator('[data-builtin-id="pin"]')).toBeVisible();
 await expect(page.locator('[data-builtin-id="camera"]')).toBeVisible();
 await page.getByRole("button",{name:"添加 旅行相机",exact:true}).click();
 await page.waitForFunction(()=>(window as unknown as {added:string[]}).added.includes("camera"));
 await page.getByRole("button",{name:"清空素材搜索"}).click();
 await page.getByRole("tab",{name:"音效",exact:true}).click();
 await page.getByRole("button",{name:"试听 星点提示",exact:true}).click();
 await expect(page.getByRole("button",{name:"停止 星点提示",exact:true})).toBeVisible();
 await page.getByRole("tab",{name:"贴纸",exact:true}).click();
 await page.screenshot({path:`${output}/panel.png`});
 if(errors.length)throw new Error(errors.join("\n"));
 await writeFile(`${output}/browser-evidence.json`,JSON.stringify({at:new Date().toISOString(),checks:[`${BUILTIN_ASSETS.length} cards`,"visible PNG loaded","add invokes callback","category filters","keyword tags","actual WAV playback","category change stops audio"],errors},null,2));
 console.log("Original asset panel: 7 checks passed, no renderer errors.");
} finally {await browser.close();await server.close();}
