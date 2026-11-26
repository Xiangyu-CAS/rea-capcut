import { createProject, projectDuration, validateProject } from "../core/model";
import { applyPanelProjectPatch, panelProject, type PanelCommandOptions, type PanelFileAction, type PanelProjectPatch, type PanelSnapshot, type PanelView } from "../core/pluginPanel";
import { assistantMediaSelection } from "../core/assistantEdits";
import type { EditorAPI, ExportProgress } from "../core/types";
import { agentPlanStatus, useEditorStore } from "./store";
import { useLanguageStore } from "../i18n";

export function createPanelBridge(api: EditorAPI, getRevision: () => number, isReady: () => boolean, checkRevision: (revision: unknown) => void) {
  let lastGroup: { id: string; revision: number } | undefined;
  let exportJob: ExportProgress | undefined;
  api.onExportProgress(event => {
    if (event.jobId === exportJob?.jobId) exportJob = event;
  });

  function snapshot(knownRevision?: number): PanelSnapshot {
    const state = useEditorStore.getState();
    const revision = getRevision();
    const plan = state.agentPlan;
    return {
      revision, ready: isReady(), dirty: state.dirty, canUndo: state.past.length > 0, canRedo: state.future.length > 0,
      selectedIds: state.selectedIds, playhead: state.playhead, playing: state.playing,
      agentMedia: assistantMediaSelection(state.project, state.agentMedia),
      project: knownRevision === revision ? undefined : panelProject(state.project),
      plan: plan ? {
        id: plan.id, status: agentPlanStatus(plan, state.project), descriptions: plan.preview.descriptions, focus: plan.focus,
        project: state.agentPreviewId === plan.id ? panelProject(plan.preview.project) : undefined,
      } : undefined,
      export: exportJob && { status: exportJob.status, progress: exportJob.progress, message: exportJob.message },
    };
  }

  function sync(args: Partial<PanelView> & { revision: number; patch?: PanelProjectPatch; group?: string }) {
    checkRevision(args.revision);
    const state = useEditorStore.getState();
    const project = args.patch ? validateProject(applyPanelProjectPatch(state.project, args.patch)) : state.project;
    const agentMedia = args.agentMedia && assistantMediaSelection(project, args.agentMedia);
    if (agentMedia?.length !== args.agentMedia?.length) throw new Error("The selected media or source range is unavailable.");
    if (args.patch) {
      if (args.group) {
        // The iframe may commit several times while one field is focused.
        // Only join contiguous revisions produced by that same focus session.
        state.beginTransaction();
        if (lastGroup?.id === args.group && lastGroup.revision === args.revision)
          useEditorStore.setState({ transactionRecorded: true });
      }
      try {
        state.commit(project);
      } finally {
        if (args.group) state.endTransaction();
      }
      lastGroup = args.group ? { id: args.group, revision: getRevision() } : undefined;
    }
    const current = useEditorStore.getState();
    if (args.selectedIds) {
      const clips = new Set(current.project.clips.map(clip => clip.id));
      current.select(args.selectedIds.filter(id => clips.has(id)));
    }
    if (args.playhead !== undefined) current.seek(args.playhead);
    if (args.playing !== undefined) current.setPlaying(args.playing);
    if (agentMedia) useEditorStore.setState({ agentMedia });
    return snapshot(args.revision);
  }

  async function command(args: PanelCommandOptions & { revision: number; action: PanelFileAction }) {
    checkRevision(args.revision);
    const state = useEditorStore.getState();
    switch (args.action) {
      case "import": {
        const assets = await api.importMedia();
        checkRevision(args.revision);
        state.addAssets(assets);
        break;
      }
      case "open":
      case "new": {
        if (state.dirty) throw new Error(useLanguageStore.getState().language === "zh-CN"
          ? "请先保存当前项目。" : "Save the current project first.");
        if (args.action === "new") state.setProject(createProject());
        else {
          const opened = await api.openProject();
          checkRevision(args.revision);
          if (opened) state.setProject(opened.project, opened.path);
        }
        break;
      }
      case "save": {
        const savedPath = await api.saveProject(state.project, state.path);
        if (savedPath && getRevision() === args.revision) state.markSaved(savedPath);
        break;
      }
      case "export": {
        if (exportJob?.status === "preparing" || exportJob?.status === "rendering")
          throw new Error("An export is already running.");
        if (!projectDuration(state.project)) throw new Error("Add a clip before exporting.");
        const format = args.format ?? "mp4";
        const outputPath = await api.chooseExportPath(state.project.name, format);
        if (outputPath) {
          const project = state.project;
          const { jobId } = await api.exportProject(project, {
            path: outputPath, width: project.width + project.width % 2, height: project.height + project.height % 2,
            fps: project.fps, quality: "standard", format,
          });
          exportJob = { jobId, status: "preparing", progress: 0 };
        }
        break;
      }
      case "cancelExport":
        if (exportJob) await api.cancelExport(exportJob.jobId);
        break;
      case "undo":
        state.undo();
        break;
      case "redo":
        state.redo();
        break;
      case "previewPlan":
        state.setAgentPreview(args.planId || null);
        break;
      case "applyPlan":
        if (args.planId) state.applyAgentPlan(args.planId);
        break;
      case "switchTimeline":
        if (args.timelineId) state.openTimeline(args.timelineId);
        break;
    }
    return snapshot(args.revision);
  }

  return { snapshot, sync, command };
}
