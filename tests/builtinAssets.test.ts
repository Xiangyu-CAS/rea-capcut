import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { BUILTIN_ASSETS, filterBuiltinAssets, findBuiltinAsset } from "../src/core/builtinAssets";
const root = path.resolve("public/builtin-assets");
describe("bundled original assets", () => {
  it("uses unique safe names and searches names and tags across categories", () => {
    expect(new Set(BUILTIN_ASSETS.map(a => a.id)).size).toBe(BUILTIN_ASSETS.length);
    for(const a of BUILTIN_ASSETS) expect(a.fileName).toMatch(/^[a-z][a-z0-9-]+\.(png|wav)$/);
    expect(filterBuiltinAssets("all", " SPARKLE ").map(a=>a.id)).toEqual(["sparkle"]);
    expect(filterBuiltinAssets("stickers", "sparkle").map(a=>a.id)).toEqual(["sparkle"]);
    expect(filterBuiltinAssets("sounds", "转场").length).toBeGreaterThan(1);
    expect(findBuiltinAsset("../../etc/passwd")).toBeUndefined();
  });
  it("all manifest fingerprints match packaged bytes and editable SVG contains no external links", async () => {
    const manifest = JSON.parse(await readFile(path.join(root,"manifest.json"),"utf8"));
    expect(manifest.assets).toHaveLength(BUILTIN_ASSETS.length);
    for(const a of BUILTIN_ASSETS) {
      const record = manifest.assets.find((entry: {id:string})=>entry.id===a.id);
      const bytes=await readFile(path.join(root,a.fileName));
      expect(record.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(record.provenance).toBe("original-programmatic");
      if(a.kind==="image") {
        const svg=await readFile(path.join(root,`${a.id}.svg`),"utf8");
        expect(svg).not.toMatch(/<script|<foreignObject|(?:href|src)=|@import/i);
      }
    }
  });
  it("PNG renders contain artwork, preserve transparent overlays, and fill backgrounds", async () => {
    for(const a of BUILTIN_ASSETS.filter(a=>a.kind==="image")) {
      const image=await loadImage(path.join(root,a.fileName));
      expect([image.width,image.height]).toEqual([a.width,a.height]);
      const canvas=createCanvas(a.width,a.height),ctx=canvas.getContext("2d"); ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,a.width,a.height).data;
      let visible=0,transparent=0;
      for(let i=3;i<pixels.length;i+=4) { if(pixels[i]>0)visible++; if(pixels[i]===0)transparent++; }
      expect(visible).toBeGreaterThan(a.width*a.height*.01);
      if(a.transparent) {
        expect(transparent).toBeGreaterThan(a.width*a.height*.1);
        expect(pixels[3]).toBe(0);
      } else expect(transparent).toBe(0);
    }
  });
  it("PCM audio has correct duration, audible samples, no clipping and silence at edges", async () => {
    for(const a of BUILTIN_ASSETS.filter(a=>a.kind==="audio")) {
      const wav=await readFile(path.join(root,a.fileName));
      expect(wav.toString("ascii",0,4)).toBe("RIFF");
      expect(wav.readUInt32LE(24)).toBe(48000);
      expect(wav.readUInt16LE(22)).toBe(1);
      expect((wav.length-44)/2/48000).toBe(a.duration);
      let sum=0,peak=0; for(let i=44;i<wav.length;i+=2) {const s=wav.readInt16LE(i)/32768;sum+=s*s;peak=Math.max(peak,Math.abs(s));}
      expect(Math.sqrt(sum/((wav.length-44)/2))).toBeGreaterThan(.025);
      expect(peak).toBeLessThan(.95);
      expect(Math.abs(wav.readInt16LE(44))).toBeLessThan(2);
      expect(Math.abs(wav.readInt16LE(wav.length-2))).toBeLessThan(20);
    }
  });
});
