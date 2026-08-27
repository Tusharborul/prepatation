# Preparation

A desktop assistant that listens to an interview or meeting, transcribes it in real time, and shows suggested answers in a transparent always-on-top overlay.

---

## Requirements

| | |
|---|---|
| Node.js | 18 or newer |
| npm | 9 or newer |
| OS | Windows 10/11, macOS 13+, or Linux |
| Gemini API key | Required — used for live audio transcription |
| Groq API key | Optional — used to generate the answers |

You also need to grant the app screen-recording and microphone permissions the first time you run it.

## 1. Install

```bash
git clone https://github.com/Tusharborul/prepatation.git
cd prepatation
npm install
```

## 2. Get your API keys

**Gemini (required).** Go to [Google AI Studio](https://aistudio.google.com/apikey) and create a key. Make sure the *Generative Language API* is enabled on the Google Cloud project the key belongs to, otherwise requests fail with a `403`.

**Groq (optional).** Go to [Groq Console](https://console.groq.com/keys) and create a key. If you skip this, Gemini handles both transcription and answers.

## 3. Run

```bash
npm start
```

On first launch, paste your keys into the main window. They are saved locally, so you only do this once.

## 4. Verify your setup

```bash
npm run check:providers
```

This confirms your keys are readable and the configured models are reachable. To run the integration tests:

```bash
npm test
```

## Where your data is stored

Keys, preferences, and session history are written to a local folder — never to a server:

| OS | Path |
|---|---|
| Windows | `%AppData%\preparation-config` |
| macOS | `~/Library/Application Support/preparation-config` |
| Linux | `~/.config/preparation-config` |

Delete that folder to reset the app completely.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Ask for next step / send screenshot | `Ctrl + Enter` |
| Show or hide the window | `Ctrl + \` |
| Toggle click-through | `Ctrl + M` |
| Move the window | `Ctrl + Arrow keys` |
| Previous / next response | `Ctrl + [` / `Ctrl + ]` |
| Scroll response | `Ctrl + Shift + Up` / `Down` |
| Emergency erase | `Ctrl + Shift + E` |

## Audio capture notes

- **Windows** — system audio is captured via loopback; no extra setup.
- **macOS** — uses the bundled `SystemAudioDump` helper. Grant Screen Recording permission in System Settings → Privacy & Security.
- **Linux** — microphone input only.

## Build an installer

```bash
npm run make
```

Output lands in `out/`. Squirrel is used on Windows, DMG on macOS, and AppImage on Linux.

## Troubleshooting

**`403` from Gemini.** The Generative Language API isn't enabled for your key's project, or the key was created in a restricted project. Create a fresh key from AI Studio.

**`413` or `429` from Groq.** You've hit the free-tier tokens-per-minute limit. Shorten your text in the AI Context screen and lower the screenshot image quality in Settings — the context is re-sent with every request.

**No audio is picked up.** Check that the app has microphone and screen-recording permission, and confirm the audio mode in Settings matches what you want to capture.

## License

GPL-3.0 — see [LICENSE](LICENSE).

This project is a fork of [cheating-daddy](https://github.com/sohzm/cheating-daddy) by sohzm, used under the terms of the GPL-3.0.
