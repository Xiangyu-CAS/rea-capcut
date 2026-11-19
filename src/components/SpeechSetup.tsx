import { useEffect, useRef, useState } from "react";
import { useTranslation, useUITranslation } from "../i18n";
import { localizeMessage } from "../i18n/messages";
import type { SpeechDependencyCheck, SpeechInfo } from "../core/speech";
import type { EditorAPI } from "../core/types";

export function useSpeechSetup() {
  const [info, setInfo] = useState<SpeechInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const run = async (operation: (api: EditorAPI) => Promise<SpeechInfo>) => {
    const id = ++request.current;
    setChecking(true);
    setError("");
    try {
      const next = window.editorAPI ? await operation(window.editorAPI) : null;
      if (id === request.current) setInfo(next);
    } catch (error) {
      if (id === request.current) setError((error instanceof Error ? error.message : String(error))
        .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
      if (id === request.current) setChecking(false);
    }
  };
  useEffect(() => {
    void run(api => api.getSpeechInfo());
    return () => { request.current++; };
  }, []);
  return { info, checking, error, run };
}

export function SpeechSetupControls({ setup, disabled = false }: {
  setup: ReturnType<typeof useSpeechSetup>; disabled?: boolean;
}) {
  const ui = useUITranslation(), { t } = useTranslation();
  const { info, checking, run } = setup;
  const inactive = disabled || checking;
  const modelSize = info?.modelBytes ? ` · ${(info.modelBytes / 1024 ** 2).toFixed(1)} MiB` : "";
  const status = (check?: SpeechDependencyCheck) => check ? ({
    ready: ui("就绪", "Ready"),
    missing: ui("缺失", "Missing"),
    error: ui("检查失败", "Check failed"),
    unsupported: ui("当前系统不支持", "Unsupported on this system"),
  }[check.state]) : ui("尚未检查", "Unchecked");
  const models = info?.models ?? [];
  return <div className="speech-setup">
    <p className="small speech-path">Python: {info?.python ?? "—"}</p>
    <p className="small speech-path">MLX Whisper: {info?.model ?? "—"}{modelSize}</p>
    <ul className="speech-checks">
      {([
        [ui("Python 与 Metal", "Python and Metal"), info?.checks?.python],
        [ui("本地模型文件", "Local model files"), info?.checks?.model],
        ["FFmpeg / FFprobe", info?.checks?.media],
      ] as const).map(([label, check]) => <li key={label}>
        <strong>{label} · {status(check)}</strong>
        {check?.detail && <span className="muted small speech-path">{localizeMessage(check.detail)}</span>}
      </li>)}
    </ul>
    <div className="button-row">
      <button disabled={inactive || info?.overrides?.python} onClick={() => void run(api => api.chooseSpeechDependency("python"))}>{t("speech.python")}</button>
      <button disabled={inactive || info?.overrides?.model} onClick={() => void run(api => api.chooseSpeechDependency("model"))}>{t("speech.model")}</button>
      <button disabled={inactive} onClick={() => void run(api => api.getSpeechInfo())}>{ui("重新检测", "Check again")}</button>
    </div>
    {models.length > 0 && <label>{ui("已缓存模型", "Cached models")}
      <select aria-label={ui("已缓存模型", "Cached models")} value={info?.cachedModelId ?? ""} disabled={inactive || info?.overrides?.model}
        onChange={event => { if (event.target.value) void run(api => api.selectCachedSpeechModel(event.target.value)); }}>
        <option value="">{ui("选择已缓存模型", "Choose a cached model")}</option>
        {models.map(model => <option key={model.id} value={model.id}>{model.name} · {(model.bytes / 1024 ** 2).toFixed(1)} MiB</option>)}
      </select>
    </label>}
    {info?.configured && <button disabled={inactive} onClick={() => void run(api => api.resetSpeechDependencies())}>{ui("恢复自动检测", "Restore automatic detection")}</button>}
    {(info?.overrides?.python || info?.overrides?.model) && <p className="muted small">
      {ui("当前启动环境指定了 Python 或模型，优先于应用设置。", "A launch environment variable takes precedence for Python or the model.")}
    </p>}
    <p className="muted small">{ui(
      "自动检测约定的本地 Python 环境以及 Hugging Face 的 MLX Whisper 缓存。也可以选择已安装的环境和模型文件夹。",
      "Checks the standard local Python environment and Hugging Face's MLX Whisper cache. You can also choose an installed environment and model folder.",
    )}</p>
  </div>;
}

export default function SpeechSetup() {
  const { t } = useTranslation();
  const setup = useSpeechSetup();
  return <>
    <p>{t("speech.offline")}</p>
    <SpeechSetupControls setup={setup} />
    {setup.checking && <p role="status">{t("speech.checking")}</p>}
    {setup.error && <p role="alert" className="inline-warning">{localizeMessage(setup.error)}</p>}
  </>;
}
