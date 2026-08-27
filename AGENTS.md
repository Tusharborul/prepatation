# Repo Guidelines

Electron desktop app that captures screen and audio, transcribes speech in real
time, and returns contextual AI answers in an overlay window. Plain JavaScript
with Lit web components; Electron Forge handles packaging.

## Getting started

```bash
npm install
npm start
```

## Layout

| Path | Purpose |
|---|---|
| `src/index.js` | Main process entry, app lifecycle, IPC handlers |
| `src/utils/gemini.js` | Gemini Live session and Groq completion logic |
| `src/utils/renderer.js` | Screen/audio capture in the renderer |
| `src/utils/prompts.js` | System prompts per profile |
| `src/storage.js` | Local JSON persistence for keys, prefs, history |
| `src/components/` | Lit components (`app/` shell, `views/` screens) |
| `scripts/` | Diagnostic and integration test scripts |

## Style

Run `npx prettier --write .` before committing. Settings live in `.prettierrc`
(four-space indent, print width 150, semicolons, single quotes). `src/assets` and
`node_modules` are excluded via `.prettierignore`. There is no linter; `npm run
lint` is a no-op.

## Tests

```bash
npm test              # transcription + reconnect + groq streaming
npm run check:providers   # verify API keys and model availability
npm run test:live         # live Gemini session smoke test
```

Tests run under Electron because they exercise main-process modules. Run the
suite before committing anything that touches `src/utils/gemini.js` or
`src/storage.js`.

## Things to be careful with

- **Config directory** — `src/storage.js` resolves `preparation-config` under the
  OS config path. Renaming it orphans existing user API keys.
- **Groq token budget** — the system prompt (including user context) is re-sent
  on every Groq request. Free tier is 8,000 tokens/minute, so prompt size
  directly limits how many answers per minute are possible.
- **Native AI binaries** — `src/utils/native-ai-runtime.js` downloads
  llama.cpp/whisper builds from an upstream release tag. Only relevant for local
  mode.
- **Transcription debounce** — fragments are buffered and flushed after a quiet
  period or on turn completion, so partial questions aren't sent to the model.

## License

GPL-3.0. Derived from [cheating-daddy](https://github.com/sohzm/cheating-daddy);
keep the `LICENSE` file and attribution intact in any redistribution.
