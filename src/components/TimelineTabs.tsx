import { CopyPlus, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { MAX_PROJECT_TIMELINES, MAX_TIMELINE_NAME, projectTimelineLabels } from "../core/projectTimelines";
import type { Project } from "../core/types";
import { useUITranslation } from "../i18n";

export default function TimelineTabs({ project, onOpen, onCreate, onRename }: {
  project: Project;
  onOpen: (id: string) => void;
  onCreate: (name: string, defaultName: string, duplicate: boolean) => void;
  onRename: (name: string) => void;
}) {
  const ui = useUITranslation();
  const [name, setName] = useState<string | null>(null);
  const defaultName = ui("时间线 1", "Timeline 1");
  const labels = projectTimelineLabels(project, defaultName);
  const activeId = project.activeTimeline?.id ?? project.id;
  const active = labels.find(label => label.id === activeId)!;
  const limitReached = labels.length >= MAX_PROJECT_TIMELINES;

  return <div className="timeline-tabs">
    <div className="timeline-tab-list" role="group" aria-label={ui("工程时间线", "Project timelines")}>
      {labels.map(timeline => <button key={timeline.id} aria-pressed={activeId === timeline.id}
        type="button" title={timeline.name} onClick={() => { setName(null); onOpen(timeline.id); }}>
        {timeline.name}
      </button>)}
    </div>
    {name === null ? <>
      <button aria-label={ui("新建时间线", "New timeline")} title={ui("新建时间线", "New timeline")} disabled={limitReached}
        onClick={() => onCreate(ui(`时间线 ${labels.length + 1}`, `Timeline ${labels.length + 1}`), defaultName, false)}>
        <Plus size={14} />
      </button>
      <button aria-label={ui("复制时间线", "Duplicate timeline")} title={ui("复制时间线", "Duplicate timeline")} disabled={limitReached}
        onClick={() => {
          const suffix = ui(" 副本", " copy");
          onCreate(active.name.slice(0, MAX_TIMELINE_NAME - suffix.length) + suffix, defaultName, true);
        }}>
        <CopyPlus size={14} />
      </button>
      <button aria-label={ui("重命名时间线", "Rename timeline")} title={ui("重命名时间线", "Rename timeline")}
        onClick={() => setName(active.name)}><Pencil size={13} /></button>
    </> : <form onSubmit={event => { event.preventDefault(); onRename(name); setName(null); }}>
      <input autoFocus aria-label={ui("时间线名称", "Timeline name")} value={name} maxLength={MAX_TIMELINE_NAME}
        onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setName(null); } }} />
      <button type="submit" disabled={!name.trim()}>{ui("确定", "OK")}</button>
      <button type="button" onClick={() => setName(null)}>{ui("取消", "Cancel")}</button>
    </form>}
  </div>;
}
