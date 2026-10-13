import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { collectPortableProject, resolvePortableDocument, savePortableDocument, startPortablePackage, cancelPortablePackage } from "../electron/portableProject";
import { createProject, createClip } from "../src/core/model";
import type { MediaAsset, Project } from "../src/core/types";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
 const root=await mkdtemp(path.join(os.tmpdir(),'reacut-portable-')); roots.push(root);
 const source=path.join(root,'original.png'); await writeFile(source, Buffer.from('synthetic source bytes'));
 const destination=path.join(root,'packages');await mkdir(destination);
 const project=createProject('可搬移项目');
 const asset:MediaAsset={id:'asset-1',name:'原始图片',kind:'image',path:source,url:`file://${source}`,width:640,height:360,fps:0,duration:0,hasAudio:false,thumbnail:'file:///private/cache.png',previewUrl:'file:///private/preview.mp4'};
 project.assets=[asset];project.clips=[createClip(asset,project.tracks.find(t=>t.kind==='video')!.id,0,30)];
 return {root,source,destination,project};
}
async function load(folder:string){const file=path.join(folder,'项目.reacut');return resolvePortableDocument(JSON.parse(await readFile(file,'utf8')),file);}
describe('portable project collection',()=>{
 it('copies original bytes once for shared references, removes caches, survives a move and missing original',async()=>{
  const {project,source,destination,root}=await setup();const original=JSON.stringify(project);
  project.assets.push({...project.assets[0],id:'asset-2',name:'共享引用'});
  const before=JSON.stringify(project);
  const folder=await collectPortableProject(project,destination,new AbortController().signal,()=>{});
  const document=JSON.parse(await readFile(path.join(folder,'项目.reacut'),'utf8'));
  expect(document.project.assets[0].path).toBe(document.project.assets[1].path);
  expect(document.project.assets[0].thumbnail).toBeUndefined();expect(document.project.assets[0].previewUrl).toBeUndefined();
  const manifest=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
  expect(manifest.files).toHaveLength(1);expect(manifest.files[0].sha256).toBe(createHash('sha256').update(await readFile(source)).digest('hex'));
  expect(JSON.stringify(project)).toBe(before);expect(original).toContain(source);
  const moved=path.join(root,'移动后的项目');await rename(folder,moved);await rm(source);
  const hydrated=await load(moved);expect(hydrated.assets[0].path.startsWith((await realpath(moved))+path.sep)).toBe(true);
  expect((await readFile(hydrated.assets[0].path)).toString()).toBe('synthetic source bytes');
 });
 it('resaves a moved package with new media then moves again, without repeating unchanged copies',async()=>{
  const {project,destination,root}=await setup();const folder=await collectPortableProject(project,destination,new AbortController().signal,()=>{});
  const opened=await load(folder);const newFile=path.join(root,'new.png');await writeFile(newFile,'new bytes');
  opened.assets.push({...opened.assets[0],id:'asset-new',path:newFile,url:'file://'+newFile});opened.name='修改后的便携项目';
  await savePortableDocument(opened,path.join(folder,'项目.reacut'));
  expect(await readdir(path.join(folder,'media'))).toHaveLength(2);
  await savePortableDocument(opened,path.join(folder,'项目.reacut'));
  expect(await readdir(path.join(folder,'media'))).toHaveLength(2);
  const moved=path.join(root,'再次移动');await rename(folder,moved);await rm(newFile);
  const result=await load(moved);expect(result.name).toBe(opened.name);expect(result.assets).toHaveLength(2);expect((await readFile(result.assets[1].path)).toString()).toBe('new bytes');
 });
 it('rejects source missing before creating a partial package',async()=>{
  const {project,source,destination}=await setup();await rm(source);
  await expect(collectPortableProject(project,destination,new AbortController().signal,()=>{})).rejects.toThrow('找不到素材');
  expect(await readdir(destination)).toEqual([]);
 });
 it('cleans temporary files if cancelled mid-copy without changing sources',async()=>{
  const {project,source,destination}=await setup();await writeFile(source,Buffer.alloc(4*1024*1024,7));
  const controller=new AbortController();
  await expect(collectPortableProject(project,destination,controller.signal,()=>controller.abort())).rejects.toThrow();
  expect(await readdir(destination)).toEqual([]);expect((await readFile(source)).length).toBe(4*1024*1024);
 });
 it.each(['../outside.png','/etc/passwd','media/../../outside.png','media\\file.png'])('rejects path traversal %s',async invalid=>{
  const {project,destination}=await setup();const folder=await collectPortableProject(project,destination,new AbortController().signal,()=>{});
  const document=JSON.parse(await readFile(path.join(folder,'项目.reacut'),'utf8'));document.project.assets[0].path=invalid;
  await expect(resolvePortableDocument(document,path.join(folder,'项目.reacut'))).rejects.toThrow('相对路径');
 });
 it('rejects a file symlink that escapes the chosen package',async()=>{
  const {project,source,destination}=await setup();const folder=await collectPortableProject(project,destination,new AbortController().signal,()=>{});
  const document=JSON.parse(await readFile(path.join(folder,'项目.reacut'),'utf8'));const target=path.join(folder,document.project.assets[0].path);
  await rm(target);await symlink(source,target);
  await expect(resolvePortableDocument(document,path.join(folder,'项目.reacut'))).rejects.toThrow('包外文件');
 });
 it('cancellation event is terminal and package output remains absent',async()=>{
  const {project,destination}=await setup();const events:string[]=[];
  const {jobId}=startPortablePackage(project,destination,event=>events.push(event.status));
  await cancelPortablePackage(jobId);expect(events.at(-1)).toBe('cancelled');expect(await readdir(destination)).toEqual([]);
 });
 it('can move a text-only package and preserves missing-media references for relinking',async()=>{
  const {project,destination}=await setup();const folder=await collectPortableProject(project,destination,new AbortController().signal,()=>{});
  const loaded=await load(folder);await rm(loaded.assets[0].path);expect((await load(folder)).assets[0].path).toBe(loaded.assets[0].path);
  project.assets=[];project.clips=[];const empty=await collectPortableProject(project,destination,new AbortController().signal,()=>{});
  expect((await load(empty)).assets).toEqual([]);
 });
});
