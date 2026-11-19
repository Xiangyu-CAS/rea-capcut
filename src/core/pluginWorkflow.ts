import type { ExportOptions, ExportProgress, Project } from "./types";

export interface TemplateSelection {
  source: "builtin" | "library";
  templateId: string;
}

export interface CreateFromTemplateRequest extends TemplateSelection {
  revision: number;
  name?: string;
  media?: { slotId: string; path: string }[];
  text?: { slotId: string; value: string }[];
}

export type PluginExportRequest = { name: string; revision: number } & Partial<Omit<ExportOptions, "path">>;

export interface PluginOutputs {
  chooseFolder: () => Promise<string | null>;
  save: (project: Project, name: string) => Promise<string>;
  exportStart: (project: Project, name: string, options: Omit<ExportOptions, "path">) => Promise<{ jobId: string }>;
  exportStatus: (jobId: string) => Promise<ExportProgress>;
  exportCancel: (jobId: string) => Promise<ExportProgress>;
}
