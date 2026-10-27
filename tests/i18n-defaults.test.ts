import { afterEach, describe, expect, it } from 'vitest';
import { createEditorClip, createEditorProject, createEditorTrack } from '../src/editor/localizedDefaults';
import { useLanguageStore } from '../src/i18n';
import type { MediaAsset } from '../src/core/types';
afterEach(() => useLanguageStore.getState().setLanguage('en'));
describe('localized new editor content', () => {
  it('creates English defaults and never rewrites an existing project on switch', () => {
    useLanguageStore.getState().setLanguage('en');
    const project = createEditorProject();
    expect(project.name).toBe('Untitled project');
    expect(project.tracks.map(track => track.name)).toEqual(['Text', 'Video 1', 'Audio 1']);
    expect(createEditorClip(undefined, project.tracks[0].id, 0, 30).text?.text).toBe('Enter text here');
    useLanguageStore.getState().setLanguage('zh-CN');
    expect(project.name).toBe('Untitled project');
    expect(createEditorProject().name).toBe('未命名项目');
    expect(createEditorTrack('audio').name).toBe('音频');
  });
  it('preserves supplied names and imported asset content', () => {
    useLanguageStore.getState().setLanguage('en');
    expect(createEditorTrack('text', '我的标题')).toHaveProperty('name', '我的标题');
    const asset = { name: '我的文件.mp4', kind: 'video', duration: 2 } as MediaAsset;
    expect(createEditorClip(asset, 'track', 0, 30).name).toBe(asset.name);
  });
});
