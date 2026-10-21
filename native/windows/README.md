# Windows helper

`scripts/build-native.ps1 -Release` compiles `bin/Willfull.Native.exe` with the x64 .NET Framework compiler included on the development machine. No runtime NuGet packages or external native DLLs are required. Target systems need Windows with .NET Framework 4.8; end users do not need a compiler.

The first working implementation uses C# P/Invoke and Windows **WinMM waveIn** shared microphone capture rather than the proposed C++/WASAPI backend. Windows performs device format conversion to 16 kHz mono signed 16-bit PCM. A future WASAPI implementation can retain the protocol. A hidden message window listens for `WM_DEVICECHANGE` and emits debounced device refresh events. This does not cover every audio routing change. Capture detects buffer/position errors and a five-second no-data stall; disconnect errors require restarting capture after selecting an available device. Actual hardware removal still needs interactive verification.

## Protocol

One UTF-8 JSON object per line on stdin/stdout. stdout contains protocol messages only. Commands: `{ "id": 1, "op": "devices" }`; responses: `{ "id": 1, "ok": true, "result": ... }` or `{ "id": 1, "ok": false, "error": "..." }`.

- `devices`: array with IDs (`-1` is the system mapper) and names.
- `busy`: `{active:boolean}` keeps Escape cancellation enabled during finalization, formatting and insertion independently of microphone state; main must clear it after completion/cancellation.
- `metrics`: `{pids:number[]}` returns aggregate working/private bytes plus per-process metadata. Deduplicated, maximum 64 PIDs; unavailable/exited processes are marked without text/content capture.
- `focus`: current target snapshot including window/PID, UIA field identity, password flag, text fingerprint, and caret/selection where supported. No foreground activation.
- `selection`: `{text,target,available}`. Up to 8,192 selected characters. No clipboard-copy fallback.
- `configure`: partial `hotkey`, `commandHotkey`, `toggleHotkey` strings. Supports modifiers Ctrl/Alt/Shift/Win and one letter, digit, F1–F24, Space or Enter. Rejects internal collisions, invalid keys and Win+L. This does not detect every other application's hooks or reserved shortcuts.
- `start`: `{sessionId,deviceId?}`. Returns actual `captureReady:true` once the native input device starts. Rejects concurrent sessions.
- `stop`: matching `sessionId`; drains completed buffers before replying. `cancel` discards pending audio.
- `paste`: `{text,target}`. Requires a captured identifiable field, same window/field/content/caret, no password, no read-only/elevated target, and released modifiers. Sends Ctrl+V once; never Enter. Refuses uncertain destinations.
- `shutdown`: closes microphone and exits on command or stdin EOF.

Events: `ready`, `devices-changed`, `audio` (`sessionId`, `pcm` base64, `sampleRate:16000`, `level`), `hotkey` (`action`,`mode`,`target?`), and recoverable helper/capture errors. Audio frames are 100 ms. Ordered hotkey processing preserves down/up sequence; the hook thread does no UIA or pipe writes.

Defaults: Ctrl+Alt+Space hold-to-dictate; Ctrl+Alt+Shift+Space hold-to-command; Ctrl+Alt+Enter toggle; Ctrl+Alt+A emits `apply`; Ctrl+Alt+V emits `paste-last` with the current target; Escape cancels active recording. Trigger repeats/down/up are consumed. Injected events are ignored to prevent feedback.

## Insertion boundaries

Clipboard transactions materialize supported string/byte/stream/image/file-list formats and report unsupported formats. Restoration checks the clipboard sequence and waits 450 ms after paste; there is no universal paste-consumed acknowledgment. `inserted:true` means Windows accepted input injection. `verifiedInTarget:false` explicitly does **not** prove the destination consumed text. Concurrent user copying prevents restoration over the newer clipboard. Automatic insertion refuses absent UIA identity and returns a manual-copy error.

`InsertionSmoke.cs` is an isolated visible scratch-field integration fixture, not shipped with the app. This session's OS refused foreground activation even with a test-only thread attachment attempt, so the fixture stopped safely before sending paste. It must be rerun in an interactive desktop session. Production helper does not use thread attachment or force foreground focus.

## Observed checks

- Release compilation succeeded with the installed x64 compiler.
- Actual capture enumerated the physical CMF headset microphone and a virtual microphone.
- Opened default microphone, received five frames (16,000 PCM bytes), drained stop, and exited normally. Captured frames were silent; no speech/audio quality claim follows.
- Hardware hotkeys and real destination insertion still require interactive verification.
