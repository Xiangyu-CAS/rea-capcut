# Interface languages

Open **Settings** in the top-right toolbar (shown as **设置 / Settings** in
Chinese), or press **Cmd/Ctrl+,**. The **Language / 语言** selector applies
immediately and the choice is saved locally for the next launch.

On a fresh profile ReaCut uses the first supported OS/browser language (Chinese,
English or Turkish), falling back to English. An existing explicit preference
always wins. If local preference storage is unavailable, switching still works
for the current session.

## Coverage and content boundaries

English covers the editor libraries, player, timeline, Inspector, visual and
keyframe tools, subtitle/template workflows, assistant controls, export/recovery
and settings dialogs, application menus and application-owned picker labels.
Known application errors and progress messages are localized at the display
boundary. Unknown backend diagnostic details are preserved rather than hidden.
OS-provided picker controls and service submenus follow the operating system.

Existing project/track names, filenames, captions, user text, imported templates
and assistant conversations are **not translated or rewritten** when switching
languages. Newly created default content and built-in catalog metadata use the
selected language. Brand names and native language names remain unchanged.

Chinese is retained. Existing Turkish dictionary translations remain available;
new editor-panel strings currently fall back to English, not Chinese. This is
not a claim of complete Turkish coverage.

## Development

- Existing dictionary keys live in `src/i18n/locales`.
- `useUITranslation()` provides reactive, co-located Chinese/English UI pairs.
  `translateUI()` reads the current language for event callbacks and new defaults.
- Application-owned diagnostics use `localizeMessage()`; never apply it to
  arbitrary project or conversation text.
- Renderer language changes synchronise with native menus through a validated,
  sender-checked IPC enum. No arbitrary dialog labels or new file access are
  accepted from the renderer.

## Regression checks

```sh
npm run check
npm run test:i18n                 # source-browser UI; needs Chromium
npx tsx tests/i18n-electron.ts    # after build; needs Electron/display
```

Unit/React DOM tests cover dictionary parity, preference precedence and storage
failures, reactive language switching, all Inspector tabs, library metadata,
subtitle/dialog controls, known diagnostics and user-content preservation.
Browser checks cover all library tabs, discoverable Settings, Chinese/English
switching and reload persistence; Electron checks cover native menus/pickers,
invalid locale rejection and process-restart persistence. Legacy Chinese UI
workflows select Chinese explicitly, independently of the CI host locale.

The fix for issue #6 is included in the v0.7.0 preview release. The v0.6.0
attachments are not replaced. Downloading the new release does not automatically
update an existing installation; no in-app updater is included.
