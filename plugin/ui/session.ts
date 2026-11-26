import type { App } from "@modelcontextprotocol/ext-apps";
import { PANEL_META, panelProjectPatch, type PanelCommandOptions, type PanelFileAction, type PanelSnapshot, type PanelView } from "../../src/core/pluginPanel";
import type { Project } from "../../src/core/types";
import { useEditorStore } from "../../src/editor/store";

export async function callPanel<T>(app: App, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(result.content.find(item => item.type === "text")?.text ?? "Editor operation failed.");
  }
  if (!result._meta || !Object.hasOwn(result._meta, PANEL_META)) throw new Error("The local ReaCut app needs a matching plugin build.");
  return result._meta[PANEL_META] as T;
}

type Changes = Partial<PanelView> & { project?: Project; group?: string };

export function connectEditor(app: App, update: (snapshot: PanelSnapshot) => void, onError: (error: unknown) => void) {
  let base: Project | undefined;
  let revision: number | undefined;
  let pending: Changes = {};
  let group: string | undefined;
  let queue = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;
  let applying = false;
  let composing = false;
  let stopped = false;
  let lastPlaybackSync = 0;

  function inOrder(operation: () => Promise<void>) {
    const next = queue.then(operation);
    queue = next.catch(onError);
    return next;
  }

  function apply(snapshot: PanelSnapshot) {
    const state = useEditorStore.getState();
    if (snapshot.project) base = snapshot.project;
    revision = snapshot.revision;
    applying = true;
    useEditorStore.setState({
      project: pending.project ?? base ?? state.project,
      selectedIds: pending.selectedIds ?? snapshot.selectedIds,
      agentMedia: pending.agentMedia ?? snapshot.agentMedia,
      playhead: pending.playhead ?? (state.playing && snapshot.playing ? state.playhead : snapshot.playhead),
      playing: pending.playing ?? snapshot.playing,
      dirty: !!pending.project || snapshot.dirty,
      ...(snapshot.project && state.project.id !== snapshot.project.id ? { clipboard: [] } : {}),
    });
    applying = false;
    update(snapshot);
  }

  async function read(force = false) {
    const snapshot = await callPanel<PanelSnapshot>(app, "reacut_panel_state", force || revision === undefined ? {} : { revision });
    // Keep both the revision and the base used to create any in-flight local change.
    if (force || (!composing && (!pending.project || snapshot.revision === revision))) apply(snapshot);
  }

  async function flush() {
    if (composing || !Object.keys(pending).length || revision === undefined || !base) return;
    const { project, group, ...view } = pending;
    pending = {};
    const patch = project && panelProjectPatch(base, project);
    if (!Object.keys(view).length && (!patch || !Object.keys(patch).length)) return;
    try {
      apply(await callPanel<PanelSnapshot>(app, "reacut_panel_sync", {
        revision, ...view, ...(patch && Object.keys(patch).length ? { patch, group } : {}),
      }));
    } catch (error) {
      // An edit may have been accepted before a connection failure. Always
      // reload the authoritative project before any further mutation.
      pending = {};
      await read(true).catch(onError);
      throw error;
    }
  }

  function schedule() {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void inOrder(flush).catch(() => {});
    }, 90);
  }

  const unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (applying || revision === undefined) return;
    if (state.transactionOpen !== previous.transactionOpen) group = state.transactionOpen ? crypto.randomUUID() : undefined;
    if (state.project !== previous.project) {
      pending.project = state.project;
      pending.group = group;
    }
    if (state.selectedIds !== previous.selectedIds) pending.selectedIds = state.selectedIds;
    if (state.agentMedia !== previous.agentMedia) pending.agentMedia = state.agentMedia;
    if (state.playhead !== previous.playhead) pending.playhead = state.playhead;
    if (state.playing !== previous.playing) pending.playing = state.playing;
    if (Object.keys(pending).length) schedule();
  });

  function poll() {
    if (stopped || reading || document.hidden) return;
    reading = true;
    void inOrder(async () => { await flush(); await read(); }).catch(() => {}).finally(() => { reading = false; });
  }

  poll();
  const interval = setInterval(poll, 450);
  return {
    setComposing(value: boolean) {
      composing = value;
      if (!value && Object.keys(pending).length) schedule();
    },
    playbackFrame(playhead: number, playing: boolean) {
      const state = useEditorStore.getState();
      if (!state.playing) return;
      applying = true;
      useEditorStore.setState({ playhead, playing });
      applying = false;
      if (!playing || performance.now() - lastPlaybackSync > 600) {
        lastPlaybackSync = performance.now();
        Object.assign(pending, { playhead, playing });
        schedule();
      }
    },
    command(action: PanelFileAction, options: PanelCommandOptions = {}) {
      return inOrder(async () => {
        await flush();
        if (revision !== undefined) apply(await callPanel<PanelSnapshot>(app, "reacut_panel_command", { action, revision, ...options }));
      });
    },
    async close() {
      stopped = true;
      clearInterval(interval);
      clearTimeout(timer);
      unsubscribe();
      await inOrder(flush).catch(() => {});
    },
  };
}
