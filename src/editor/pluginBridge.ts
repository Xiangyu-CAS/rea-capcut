import { useEditorStore } from './store';
import { previewAssistantEdits } from '../core/assistantEdits';
import { projectDuration } from '../core/model';
import { BUILTIN_ASSETS } from '../core/builtinAssets';
import { TEMPLATE_EXAMPLES } from '../core/templateExamples';
import { instantiateTemplate, replaceTemplateSlots } from '../core/projectTemplates';
import type { CreateFromTemplateRequest, PluginExportRequest, PluginOutputs, TemplateSelection } from '../core/pluginWorkflow';
import { localizeBuiltinTemplate, TEMPLATE_NAMES } from '../components/templateLabels';
import { useLanguageStore } from '../i18n';

let projectReady = false;
export function setPluginProjectReady(ready: boolean) {
  projectReady = ready;
}

/** A narrow bridge shared by the MCP tools and the editor. Never evaluates code. */
export function installPluginBridge() {
  const plugin = window.reacutPlugin, api = window.editorAPI;
  if (!plugin || !api) return;
  let revision = 0;
  useEditorStore.subscribe((state, previous) => {
    if (state.project !== previous.project) revision++;
  });
  const snapshot = () => {
    const s = useEditorStore.getState();
    return { revision, projectReady, name: s.project.name, id: s.project.id, width: s.project.width,
      height: s.project.height, fps: s.project.fps, duration: projectDuration(s.project),
      selectedIds: s.selectedIds, playhead: s.playhead, playing: s.playing, dirty: s.dirty,
      tracks: s.project.tracks, clips: s.project.clips,
      assets: s.project.assets.map(({ id, name, kind, duration, width, height, missing }) =>
        ({ id, name, kind, duration, width, height, missing })) };
  };
  const loadTemplate = async ({ templateId, source }: TemplateSelection, instantiate = false) => {
    const template = await api.loadTemplate(templateId, source === 'builtin');
    return localizeBuiltinTemplate(instantiate ? instantiateTemplate(template) : template,
      source === 'builtin' ? templateId : undefined, useLanguageStore.getState().language);
  };

  plugin.onCommand(async (request) => {
    const s = useEditorStore.getState();
    const a = request.args;
    const checkRevision = (expected: unknown) => {
      if (expected !== revision) throw new Error('Project changed. Read state and use its current revision.');
      if (!projectReady) throw new Error('Finish opening or restoring the project in the editor first.');
      if (useEditorStore.getState().transactionOpen) throw new Error('Finish the active drag or parameter edit first.');
    };
    if (request.action === 'selectInput') {
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) { focused.select(); return { handled: true }; }
      return { handled: false };
    }
    if (request.action === 'flush') {
      if (projectReady) await api.autosaveProject(s.project);
      return { saved: projectReady };
    }
    if (request.action === 'state') return snapshot();
    if (request.action === 'catalog') return { assets: BUILTIN_ASSETS };
    if (request.action === 'templates') {
      const chinese = useLanguageStore.getState().language === 'zh-CN';
      return { templates: [
        ...TEMPLATE_EXAMPLES.map(template => ({ source: 'builtin', templateId: template.id,
          name: chinese ? template.name : TEMPLATE_NAMES[template.id] })),
        ...(await api.listTemplates()).map(template => ({ source: 'library', templateId: template.id,
          name: template.name, slotCount: template.slots })),
      ] };
    }
    if (request.action === 'template_slots') {
      const selection = a as TemplateSelection;
      const template = await loadTemplate(selection);
      return { ...selection, name: template.name, slots: template.slots.map(({ id, kind, label, targetId }) => {
        const clips = template.project.clips.filter(clip => kind === 'text' ? clip.id === targetId : clip.assetId === targetId);
        const locked = clips.some(clip => template.project.tracks.find(track => track.id === clip.trackId)?.locked);
        return kind === 'text' ? { slotId: id, kind, label, locked, value: clips[0].text?.text } :
          { slotId: id, kind, label, locked, mediaKind: template.project.assets.find(asset => asset.id === targetId)?.kind,
            requiredSourceSeconds: Math.max(...clips.map(clip => clip.sourceIn + clip.duration * clip.speed)) };
      }) };
    }
    if (request.action === 'create_from_template') {
      const options = a as CreateFromTemplateRequest;
      checkRevision(options.revision);
      if (s.dirty) throw new Error('Save the current project before opening a new template project.');
      const template = await loadTemplate(options, true);
      const name = options.name === undefined ? template.project.name : options.name.trim();
      if (!name) throw new Error('Enter a project name.');
      const media = options.media ?? [], text = options.text ?? [];
      const supplied = new Set<string>();
      for (const [kind, entries] of [['media', media], ['text', text]] as const) {
        for (const { slotId } of entries) {
          if (supplied.has(slotId) || !template.slots.some(slot => slot.id === slotId && slot.kind === kind))
            throw new Error('Unknown, duplicate, or mismatched template slot.');
          supplied.add(slotId);
        }
      }
      checkRevision(options.revision);
      const paths = [...new Set(media.map(item => item.path))];
      const imported = paths.length ? await api.importMedia(paths) : [];
      if (imported.length !== paths.length) throw new Error('Some replacement media could not be imported.');
      const replacements = new Map(paths.map((path, index) => [path, imported[index]]));
      const base = { ...template.project, name };
      const replaced = replaceTemplateSlots(template, {
        media: Object.fromEntries(media.map(item => [item.slotId, replacements.get(item.path)!])),
        text: Object.fromEntries(text.map(item => [item.slotId, item.value])),
      });
      checkRevision(options.revision);
      s.setProject(base);
      s.commit({ ...replaced, name });
      useEditorStore.setState({ dirty: true });
      return snapshot();
    }
    if (request.action === 'output_folder') {
      const folder = await plugin.outputs.chooseFolder();
      return { folder, cancelled: folder === null };
    }
    if (request.action === 'save') {
      checkRevision(a.revision);
      const path = await plugin.outputs.save(s.project, a.name);
      const latest = useEditorStore.getState();
      const current = latest.project === s.project && latest.path === s.path;
      if (current) latest.markSaved(path);
      return { path, savedRevision: a.revision, current, ...snapshot() };
    }
    if (request.action === 'export_start') {
      const options = a as PluginExportRequest;
      checkRevision(options.revision);
      const { project } = s;
      const { jobId } = await plugin.outputs.exportStart(project, options.name, {
        width: options.width ?? project.width + project.width % 2,
        height: options.height ?? project.height + project.height % 2,
        fps: options.fps ?? project.fps,
        format: options.format ?? 'mp4',
        quality: options.quality ?? 'standard',
        range: options.range,
      });
      return { jobId, revision: options.revision };
    }
    if (request.action === 'export_status') return plugin.outputs.exportStatus(a.jobId);
    if (request.action === 'export_cancel') return plugin.outputs.exportCancel(a.jobId);
    if (request.action === 'edit') {
      if (!Number.isInteger(a.revision) || a.revision !== revision) throw new Error('项目已变化，请重新读取状态后再编辑');
      if (s.transactionOpen) throw new Error('用户正在拖动或调整参数，请稍后重试');
      const result = previewAssistantEdits(s.project, a.actions);
      s.commit(result.project);
      return { ...snapshot(), changes: result.descriptions };
    }
    if (request.action === 'import') {
      const assets = a.builtinId ? [await window.editorAPI!.importBuiltinAsset(a.builtinId)] :
        await window.editorAPI!.importMedia(a.paths);
      useEditorStore.getState().addAssets(assets);
      return snapshot();
    }
    if (request.action === 'control') {
      if (a.command === 'undo') s.undo();
      else if (a.command === 'redo') s.redo();
      else if (a.command === 'play') s.setPlaying(true);
      else if (a.command === 'pause') s.setPlaying(false);
      else if (a.command === 'seek') {
        if (typeof a.time !== 'number' || !Number.isFinite(a.time) || a.time < 0 || a.time > projectDuration(s.project)) throw new Error('无效播放位置');
        s.seek(a.time);
      } else throw new Error('不支持的编辑器操作');
      return snapshot();
    }
    throw new Error('不支持的插件操作');
  });
}

declare global {
  interface Window {
    reacutPlugin?: {
      onCommand: (callback: (request: { action: string; args: Record<string, any> }) => Promise<unknown>) => void;
      outputs: PluginOutputs;
    };
  }
}
