import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile, rm, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { expect } from '@playwright/test';
import { probeFile, runMediaTool } from '../electron/media';
const root = process.cwd();
const binary = process.env.REACUT_TEST_APP;
const launcher = process.env.REACUT_TEST_LAUNCHER;
const sourceWorkflow = !binary && !launcher;
const output = path.join(root, '.test-output', sourceWorkflow ? 'plugin-electron' : 'plugin-electron-packaged');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const destination = path.join(output, 'batch');
const fixtureMain = path.join(output, 'dialog-fixture.cjs');
const footage = path.join(output, 'synthetic-voiceover.mp4');
const short = path.join(output, 'short.mp4');
const positions = path.join(output, 'fixture-positions.json');
const editorTargets = {
  clip: '.tl-clip-text',
  media: '.media-item-video',
  range: '.source-seek input:not(:disabled)',
  markIn: '.source-marks label:first-child button:not(:disabled)',
  markOut: '.source-marks label:nth-child(2) button:not(:disabled)',
  useRange: '.source-edit-actions button:not(.primary):not(:disabled)',
  preview: '.assistant-preview:not(:disabled)',
  previewPosition: '.agent-preview-seek',
  apply: '.assistant-apply:not(:disabled)',
  result: '.assistant-panel > .assistant-proposal .assistant-apply-status',
};
if (sourceWorkflow) {
  await mkdir(destination);
  const boundsScript = `(() => {
    const targets = ${JSON.stringify(editorTargets)};
    const controls = Object.fromEntries(Object.entries(targets).flatMap(([name, selector]) => {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      return rect && rect.width && rect.height ? [[name, { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewport: innerWidth, value: node.value, text: name === 'result' ? node.textContent : undefined }]] : [];
    }));
    const canvas = document.querySelector('.player-panel canvas');
    const pixel = canvas?.getContext('2d')?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return { ...controls, playingSyntheticVideo: !!pixel && pixel[0] < 30 && pixel[1] < 30 && pixel[2] > 220 };
  })()`;
  await writeFile(fixtureMain, `
    const { app, dialog } = require('electron');
    const { writeFile } = require('node:fs/promises');
    let calls = 0;
    dialog.showOpenDialog = async (_window, options) => {
      if (!options.properties.includes('openDirectory')) throw new Error('Unexpected dialog in plugin workflow test');
      return ++calls === 1 ? { canceled: true, filePaths: [] } :
        { canceled: false, filePaths: [${JSON.stringify(destination)}] };
    };
    app.on('browser-window-created', (_event, window) => {
      const contents = window.webContents;
      const capture = contents.capturePage.bind(contents);
      contents.capturePage = async (...args) => {
        const frame = await capture(...args);
        const bounds = await contents.executeJavaScript(${JSON.stringify(boundsScript)});
        await writeFile(${JSON.stringify(positions)}, JSON.stringify(bounds));
        return frame;
      };
    });
    require(${JSON.stringify(path.join(root, 'dist-electron/main.cjs'))});
  `);
  await runMediaTool('ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=13',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=13',
    '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',footage]);
  await runMediaTool('ffmpeg', ['-v','error','-y','-i',footage,'-t','1','-c','copy',short]);
}
const env: NodeJS.ProcessEnv = { ...process.env, REACUT_USER_DATA: path.join(output, 'user-data'), VITE_DEV_SERVER_URL: '' };
if (binary) { env.PATH = ''; delete env.REACUT_FFMPEG; delete env.REACUT_FFPROBE; }
if (launcher && binary) env.REACUT_APP = binary;
const child = spawn(launcher ? (process.env.REACUT_TEST_PYTHON || '/usr/bin/python3') : binary || path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  launcher ? [launcher] : binary ? ['--reacut-plugin'] : [fixtureMain, '--reacut-plugin'],
  { env, stdio: ['pipe','pipe','pipe'] });
let errors = '';
child.stderr.on('data', b => { errors += b.toString(); });
let nextId = 0;
const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
createInterface({ input: child.stdout }).on('line', line => {
  try { const r = JSON.parse(line); const item = pending.get(r.id); if (!item) return; clearTimeout(item.timer); pending.delete(r.id); r.error ? item.reject(new Error(JSON.stringify(r.error))) : item.resolve(r.result); } catch { /* Electron logging */ }
});
const rpc = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out ${method}: ${errors.slice(-1000)}`)); }, 70000);
  pending.set(id, { resolve, reject, timer });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = (name: string, args: object = {}) => rpc('tools/call', { name, arguments: args });
const success = async (name: string, args: object = {}) => {
  const result = await call(name, args);
  assert(!result.isError, result.content?.map((part: { text?: string }) => part.text).join(' '));
  return result.structuredContent;
};
async function clickEditor(target: keyof typeof editorTargets, fraction = 0.5) {
  let rect: { left: number; top: number; width: number; height: number; viewport: number } | undefined;
  await expect.poll(async () => {
    await success('reacut_frame');
    rect = JSON.parse(await readFile(positions, 'utf8'))[target];
    return !!rect;
  }, { message: `Editor control is visible: ${target}` }).toBe(true);
  assert(rect);
  const x = (rect.left + fraction * rect.width) * 1440 / rect.viewport;
  const y = (rect.top + rect.height / 2) * 1440 / rect.viewport;
  await success('reacut_input', { type: 'mouseMove', x, y });
  await success('reacut_input', { type: 'mouseDown', x, y });
  await success('reacut_input', { type: 'mouseUp', x, y });
}
async function exportResult(jobId: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const status = await success('reacut_export_status', { jobId });
    if (!['preparing', 'rendering'].includes(status.status)) return status;
    await delay(100);
  }
  assert.fail('Batch render did not terminate');
}
const checks: string[] = [];
try {
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'ReaCut test', version: '1' }, capabilities: {} });
  assert.equal(init.serverInfo.name, 'reacut');
  assert.match(init.instructions, /Use reacut_edit for requests to edit/);
  const tools = (await rpc('tools/list')).tools;
  assert.equal(tools.length, 19);
  assert.equal(tools.find((t: any) => t.name === 'reacut_transcribe').annotations.readOnlyHint, true);
  assert.equal(tools.find((t: any) => t.name === 'reacut_propose_edit').annotations.destructiveHint, false);
  assert.deepEqual(tools.find((t: any) => t.name === 'reacut_frame')._meta.ui.visibility, ['app']);
  const resource = await rpc('resources/read', { uri: 'ui://reacut/editor-v1.html' });
  assert.match(resource.contents[0].text, /中文 \/ 粘贴/);
  assert.equal(resource.contents[0]._meta['openai/ui'].preferredDisplayMode, 'fullscreen');
  checks.push('MCP initialization, tools, app-only visibility, bundled fullscreen resource');
  const open = await success('reacut_open');
  await expect.poll(async () => (await success('reacut_state')).projectReady).toBe(true);
  let state = await success('reacut_state');
  assert.equal(state.id, open.id);
  assert(state && state.clips.length === 0);
  assert.equal(state.agent.open, true);
  const firstRevision = state.revision;
  const unavailable = await call('reacut_transcribe', { revision: firstRevision, source: 'clip:missing' });
  assert.equal(unavailable.isError, true);
  assert.match(unavailable.content[0].text, /audio or video source with sound/);
  assert.equal((await success('reacut_state')).revision, firstRevision);
  let result = await call('reacut_edit', { revision: firstRevision, actions: [
    { type: 'setProject', name: 'Codex 插件验收', width: 640, height: 360 },
    { type: 'addText', text: '在 Codex 内剪辑', start: 0, duration: 5, fontSize: 50 },
  ] });
  assert.equal(result.isError, undefined);
  state = result.structuredContent;
  assert.equal(state.clips.length, 1);
  assert.equal(state.name, 'Codex 插件验收');
  assert.equal(state.agent.plan.status, 'applied');
  assert.equal(state.agent.plan.source, 'chatgpt');
  assert.equal(state.revision, firstRevision + 1);
  assert((await call('reacut_edit', { revision: firstRevision, actions: [{ type: 'deleteClip', clipId: state.clips[0].id }] })).isError);
  assert((await call('reacut_edit', { revision: state.revision, actions: [{ type: 'setProject', name: 'Must roll back' }, { type: 'execute', code: 'bad' }] })).isError);
  assert.equal((await call('reacut_state')).structuredContent.name, 'Codex 插件验收');
  assert.equal((await call('reacut_control', { command: 'undo' })).structuredContent.clips.length, 0);
  state = (await call('reacut_control', { command: 'redo' })).structuredContent;
  assert.equal(state.clips.length, 1);
  checks.push('Revision conflict, atomic invalid batch, undo and redo');
  const catalog = await call('reacut_catalog');
  assert(catalog.structuredContent.assets.some((a: any) => a.id === 'bg-ocean'));
  state = (await call('reacut_import', { builtinId: 'bg-ocean' })).structuredContent;
  assert(state.assets.length === 1);
  state = (await call('reacut_edit', { revision: state.revision, actions: [{ type: 'addAsset', assetId: state.assets[0].id, start: 0, duration: 5 }] })).structuredContent;
  assert.equal(state.clips.length, 2);
  assert((await call('reacut_import', { paths: ['relative.mp4'] })).isError);
  assert((await call('reacut_input', { type: 'mouseDown', x: -1, y: 0 })).isError);
  assert((await call('reacut_input', { type: 'key', key: 'x', shell: 'bad' })).isError);
  checks.push('Bundled media import and timeline insert; invalid paths and input rejected');
  if (sourceWorkflow) {
    state = await success('reacut_import', { paths: [footage] });
    const asset = state.assets.find((item: any) => item.kind === 'video');
    const title = state.clips.find((clip: any) => clip.text?.text === '在 Codex 内剪辑');
    await clickEditor('clip');
    await clickEditor('media');
    await clickEditor('range', 0.24);
    await clickEditor('markIn');
    await clickEditor('range', 0.45);
    await clickEditor('markOut');
    await clickEditor('useRange');
    state = await success('reacut_state');
    assert.deepEqual(state.selectedIds, [title.id]);
    assert.equal(state.agent.media.length, 1);
    const { assetId, range } = state.agent.media[0];
    assert.equal(assetId, asset.id);
    assert(range.sourceIn > 2 && range.sourceIn < 4 && range.duration > 2 && range.duration < 4);
    const actions = [
      { type: 'setText', clipId: title.id, text: 'Next shot' },
      { type: 'addAsset', assetId, start: 5, ...range },
    ];
    const before = state;
    assert((await call('reacut_propose_edit', { revision: firstRevision, actions })).isError);
    const staged = await success('reacut_propose_edit', { revision: before.revision, actions, summary: 'Use the selected source range after the title.' });
    assert.equal(staged.revision, before.revision);
    assert.deepEqual(staged.clips, before.clips);
    assert.equal(staged.agent.plan.status, 'pending');
    assert.equal(staged.agent.plan.source, 'chatgpt');
    await clickEditor('preview');
    await expect.poll(async () => (await success('reacut_state')).agent.plan.previewing).toBe(true);
    await clickEditor('previewPosition', 0.78);
    await expect.poll(async () => {
      await success('reacut_frame');
      return Number(JSON.parse(await readFile(positions, 'utf8')).previewPosition?.value);
    }).toBeGreaterThan(5);
    const preview = await success('reacut_frame');
    await writeFile(path.join(output, 'agent-preview.jpg'), Buffer.from(preview.data, 'base64'));
    state = await success('reacut_state');
    assert.equal(state.revision, before.revision);
    assert.equal(state.playhead, before.playhead);
    assert.deepEqual(state.clips, before.clips);
    await clickEditor('apply');
    await expect.poll(async () => (await success('reacut_state')).agent.plan.status).toBe('applied');
    const reviewed = await success('reacut_state');
    assert.equal(reviewed.revision, before.revision + 1);
    const beforeDirect = await success('reacut_control', { command: 'undo' });
    assert.deepEqual(beforeDirect.clips, before.clips);
    state = await success('reacut_edit', { revision: beforeDirect.revision, actions, summary: 'Used the selected range after the title.' });
    assert.notEqual(state.agent.plan.id, staged.agent.plan.id);
    assert.equal(state.agent.plan.source, 'chatgpt');
    assert.equal(state.agent.plan.status, 'applied');
    assert.equal(state.revision, beforeDirect.revision + 1);
    assert.equal(state.agent.plan.previewing, false);
    const inserted = state.clips.find((clip: any) => clip.assetId === assetId);
    assert.equal(inserted.start, 5);
    assert.equal(inserted.sourceIn, range.sourceIn);
    assert.equal(inserted.duration, range.duration);
    assert(state.clips.some((clip: any) => clip.text?.text === 'Next shot'));
    await success('reacut_control', { command: 'seek', time: 5.5 });
    await expect.poll(async () => {
      await success('reacut_frame');
      const controls = JSON.parse(await readFile(positions, 'utf8'));
      return controls.playingSyntheticVideo && !controls.apply && !controls.previewPosition && /^(Applied|已应用)$/.test(controls.result?.text?.trim());
    }).toBe(true);
    await writeFile(path.join(output, 'agent-applied.jpg'), Buffer.from((await success('reacut_frame')).data, 'base64'));
    const undone = await success('reacut_control', { command: 'undo' });
    assert.equal(undone.agent.plan.status, 'undone');
    assert.deepEqual(undone.clips, before.clips);
    const older = await success('reacut_control', { command: 'undo' });
    assert.equal(older.agent.plan.status, 'undone');
    const restored = await success('reacut_control', { command: 'redo' });
    assert.equal(restored.agent.plan.status, 'undone');
    assert.deepEqual(restored.clips, before.clips);
    state = await success('reacut_control', { command: 'redo' });
    assert.equal(state.agent.plan.status, 'applied');
    assert.deepEqual(state.clips.find((clip: any) => clip.assetId === assetId), inserted);
    const unchanged = await success('reacut_edit', { revision: state.revision, actions: [{ type: 'setProject', name: state.name }] });
    assert.equal(unchanged.agent.plan.status, 'unchanged');
    assert.equal(unchanged.revision, state.revision);
    assert.deepEqual(unchanged.changes, []);
    assert.deepEqual(unchanged.clips, state.clips);
    checks.push('Selected source range supports direct ChatGPT editing and optional preview; both update the open timeline with one-step undo');
  } else {
    const staged = await success('reacut_propose_edit', { revision: state.revision, actions: [{ type: 'addText', text: 'Review first', start: 5, duration: 1 }] });
    assert.equal(staged.agent.plan.status, 'pending');
    assert.equal(staged.revision, state.revision);
    assert.deepEqual(staged.clips, state.clips);
    checks.push('Packaged editor opens Agent by default and receives a reviewable edit from the launcher');
  }
  await call('reacut_control', { command: 'seek', time: 1 });
  await new Promise(r => setTimeout(r, 1200));
  let frame = (await call('reacut_frame')).structuredContent;
  assert.equal(frame.width, 1440); assert(frame.data.length > 10000);
  await writeFile(path.join(output, 'editor.jpg'), Buffer.from(frame.data, 'base64'));
  const screenshot = await call('reacut_screenshot');
  assert.equal(screenshot.content[0].type, 'image');
  await call('reacut_input', { type: 'menu', command: 'export' });
  await new Promise(r => setTimeout(r, 400));
  frame = (await call('reacut_frame')).structuredContent;
  await writeFile(path.join(output, 'export.jpg'), Buffer.from(frame.data, 'base64'));
  checks.push('Actual hidden-window editor capture and export dialog via app bridge');
  if (sourceWorkflow) {
    const selection = { templateId: 'talk', source: 'builtin' };
    assert((await success('reacut_templates')).templates.some((entry: any) => entry.templateId === 'talk'));
    const original = await success('reacut_template_slots', selection);
    assert.deepEqual(await success('reacut_template_slots', selection), original);
    const mediaSlot = original.slots.find((slot: any) => slot.kind === 'media');
    const textSlot = original.slots.find((slot: any) => slot.kind === 'text');
    assert.equal(mediaSlot.requiredSourceSeconds, 12);
    state = await success('reacut_state');
    assert(state.projectReady);
    const create = (value: string, file: string, revision = state.revision) =>
      call('reacut_create_from_template', { ...selection, revision, name: value,
        media: [{ slotId: mediaSlot.slotId, path: file }], text: [{ slotId: textSlot.slotId, value }] });
    assert((await create('Unsaved project protection', footage)).isError);
    assert((await call('reacut_save', { revision: state.revision, name: 'initial' })).isError);
    assert((await success('reacut_output_folder')).cancelled);
    assert.equal((await success('reacut_output_folder')).folder, await realpath(destination));
    assert((await call('reacut_save', { revision: state.revision, name: '../outside' })).isError);
    assert.equal((await success('reacut_save', { revision: state.revision, name: 'initial' })).current, true);
    const inserted = state.clips.find((clip: any) => clip.name === 'synthetic-voiceover.mp4');
    assert(inserted);
    const editExport = await success('reacut_export_start', { revision: state.revision, name: 'chatgpt-edit',
      range: { start: inserted.start, end: inserted.start + inserted.duration }, width: 320, height: 180 });
    const editOutput = await exportResult(editExport.jobId);
    assert.equal(editOutput.status, 'complete', editOutput.message);
    const editProbe = await probeFile(editOutput.path);
    assert(editProbe.streams.some(stream => stream.codec_type === 'audio'));
    assert(Math.abs(Number(editProbe.format.duration) - inserted.duration) < 0.08);
    checks.push('The staged and applied source range exports to a playable MP4 with audio');
    assert((await create('Stale revision', footage, firstRevision)).isError);
    assert((await create('Short replacement', short)).isError);
    assert.equal((await success('reacut_state')).id, state.id);
    assert((await call('reacut_create_from_template', { ...selection, revision: state.revision,
      text: [{ slotId: textSlot.slotId, value: 'A' }, { slotId: textSlot.slotId, value: 'B' }] })).isError);
    checks.push('Stable slots, dirty and stale revision checks, picker cancellation, short and duplicate replacements rejected');

    state = (await create('Batch episode 1', footage)).structuredContent;
    assert(state?.clips.some((clip: any) => clip.text?.text === 'Batch episode 1'));
    assert(state.assets.some((asset: any) => asset.kind === 'video'));
    const projectId = state.id;
    const base = await success('reacut_control', { command: 'undo' });
    assert(!base.clips.some((clip: any) => clip.text?.text === 'Batch episode 1'));
    state = await success('reacut_control', { command: 'redo' });
    const saved = await success('reacut_save', { revision: state.revision, name: 'episode-1' });
    const savedProject = JSON.parse(await readFile(saved.path, 'utf8'));
    assert.equal(savedProject.id, projectId);
    assert.equal(savedProject.assets[0].path, footage);
    assert((await call('reacut_save', { revision: state.revision, name: 'episode-1' })).isError);
    const export1 = await success('reacut_export_start', { revision: state.revision, name: 'episode-1', range: { start: 2, end: 6 } });
    const result = await exportResult(export1.jobId);
    assert.equal(result.status, 'complete', result.message);
    const probe = await probeFile(result.path);
    assert.equal(probe.streams.find(stream => stream.codec_type === 'video')?.codec_name, 'h264');
    assert(probe.streams.some(stream => stream.codec_type === 'audio'));
    assert.equal(Number(probe.format.duration), 4);
    assert((await call('reacut_export_start', { revision: state.revision, name: 'episode-1' })).isError);
    assert((await call('reacut_export_status', { jobId: '00000000-0000-0000-0000-000000000000' })).isError);
    checks.push('Batch replacement in one undo, real project save, active export polling and four-second H.264/AAC output');

    state = (await create('Batch episode 2', footage)).structuredContent;
    assert(state && state.id !== projectId);
    assert.equal((await success('reacut_save', { revision: state.revision, name: 'episode-2' })).current, true);
    const cancelled = await success('reacut_export_start', { revision: state.revision, name: 'cancelled', width: 3840, height: 2160, quality: 'high' });
    await success('reacut_export_cancel', { jobId: cancelled.jobId });
    assert.equal((await exportResult(cancelled.jobId)).status, 'cancelled');
    await assert.rejects(stat(path.join(destination, 'cancelled.mp4')), { code: 'ENOENT' });
    const export2 = await success('reacut_export_start', { revision: state.revision, name: 'episode-2', format: 'mov', width: 320, height: 180 });
    const finished = await exportResult(export2.jobId);
    assert.equal(finished.status, 'complete', finished.message);
    assert.equal(Number((await probeFile(finished.path)).format.duration), 12);
    assert.deepEqual(await success('reacut_template_slots', selection), original);
    assert(!(await readdir(destination)).some(file => file.startsWith('.reacut-')));
    checks.push('Second project reuses output grant, cancelled jobs leave no output, independent MOV export preserves the template');
  }
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ checks, init, toolNames: tools.map((t: any) => t.name), state }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2));
} finally {
  child.stdin.end();
  const killer = setTimeout(() => child.kill('SIGKILL'), 10000);
  await new Promise(resolve => child.once('exit', resolve));
  clearTimeout(killer);
  await writeFile(path.join(output, 'stderr.log'), errors);
}

const recovered = JSON.parse(await readFile(path.join(output, 'user-data/autosave.reacut'), 'utf8'));
assert.equal(recovered.name, sourceWorkflow ? 'Batch episode 2' : 'Codex 插件验收');
assert.equal(recovered.clips.length, sourceWorkflow ? 5 : 2);
console.log('Disconnect flushed the latest project and terminated the editor.');
