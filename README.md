# Willfull

English dictation for Windows, built with Electron. Speech recognition, cleanup, personal vocabulary, snippets, and selected-text editing run locally. The speech engine is Fermion's packed **Phonon-2** CPU runtime. Optional Qwen3.5 editors use llama.cpp on CPU or Vulkan GPU.

## Run the Windows app

For an unpacked build, open `release/win-unpacked/Willfull.exe`. For an installer build, use the generated Windows installer in `release/`. Keep the complete unpacked directory together: its embedded Python, speech weights, native helper, and other resources are required. Packaged users do not need Python, Node.js, Docker, or a compiler.

Use 64-bit Windows 10/11 with .NET Framework 4.8, a microphone, and sufficient disk space for the bundled runtime and selected editor. Allow approximately 2–3 GB of application RAM; GPU editing also consumes separate VRAM. These are working targets, not a universal memory guarantee. The optional 4B editor download is 2.74 GB; the CPU 2B editor is 1.28 GB. A current graphics driver is required for Vulkan acceleration.

On first use, check the microphone in Settings, wait until Phonon-2 is ready, then focus a text field in another application. Hold the dictation shortcut, speak while the overlay says it is listening, and release. Willfull inserts the finalized result once. If Windows cannot identify or validate the destination, the result remains available to copy.

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+Space` | Hold to dictate; release to finish |
| `Ctrl+Alt+Enter` | Toggle hands-free dictation |
| `Ctrl+Alt+Shift+Space` | Hold to give an editing instruction for selected text |
| `Ctrl+Alt+A` | Apply the pending command edit while the original selection remains focused |
| `Ctrl+Alt+V` | Paste the last result into the current validated field |
| `Escape` | Cancel the active operation |

The dictation, command, and hands-free shortcuts can be changed in Settings. Apply and paste-last remain fixed in this version. Willfull never presses Enter to submit a message. Close the main window to keep the tray app available; use **Quit Willfull** in the tray menu to exit.

Literal mode keeps recognized wording plus configured substitutions and explicit layout commands such as “new line.” Clean mode adds local rewriting when its editor is installed. If cleanup fails an integrity check or times out, the conservative transcript is kept. Dictionary and snippet contents are protected from rewriting. Command mode shows a preview before application; context, selection, and focus checks can require manual copying when an editor exposes insufficient accessibility information.

## Privacy and storage

The microphone opens during recording and closes afterward. Audio stays in memory. Transcript history starts disabled; when enabled it is stored in the local SQLite database. Dictionary, snippets, and settings are stored locally under the Windows user-data directory; **Open data folder** reveals it. Diagnostic logs exclude transcript contents.

Model downloads require a deliberate setup action and verify pinned hashes. Once the required models are present, inference does not require internet access. The editor server binds to loopback with a per-launch credential. No cloud transcription account is needed.

## Develop from source

This repository contains the complete application source, native helper, tests, and pinned model setup scripts. Downloaded model weights, embedded runtimes, dependencies, generated test artifacts, and packaged builds are excluded from Git. Run the setup steps below to recreate them; packaged builds remain separate distribution artifacts.

Use an x64 Windows shell, Node.js 22.12+ or 24, and pnpm. PowerShell and the .NET Framework compiler build the helper; no C++ toolchain is required.

```powershell
pnpm install
pnpm native
pnpm setup:speech
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-runtime.ps1 -RepairLocalDependencies
pnpm build
pnpm start
```

`pnpm dev` starts the development server. Optional editors can be prepared with `pnpm setup:editor` for 4B or `node scripts/setup-editor-cpu.mjs` for 2B; the app's Models screen also installs the selected profile. Downloads resume from partial files. Choose CPU in Settings to use the 2B CPU profile, or Auto/GPU for Vulkan offload when available. Download size is distinct from runtime RAM.

```powershell
pnpm typecheck
pnpm test
node scripts/native-integration.mjs --microphone
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-speech.ps1
pnpm smoke
pnpm package
pnpm dist
```

`package` builds an unpacked directory; `dist` builds Windows installer/ZIP outputs. Build setup downloads dependencies; application inference is local. The runtime preflight can also check an unpacked package with `-PythonDirectory release/win-unpacked/resources/runtime/python`. Its explicit repair option copies verified installed release VC++ runtime DLLs into the embedded runtime and writes `app-local-dependencies.json`; it does not install a system prerequisite or require elevation.

## Verification and current limits

The Electron **44.9.2** integration run loaded the real speech worker and GPU editor, exercised IPC/personalization, rejected invalid actions, and rendered both desktop sizes without renderer errors. Aggregate process working-set samples with both engines loaded were approximately **1,960–2,090 MiB**. These are live samples rather than a peak or sustained-load guarantee. The GPU editor alone used about **742 MB steady working set**, with approximately **4 GB of private commit** and roughly **2.9 GB additional dedicated VRAM**; committed address space and physical working memory are different measurements. CPU mode unloads speech while editing and reloads it while buffering the next recording.

The speech smoke check recognized three public English fixtures with zero normalized word errors across 70 reference words. This tiny fixture result is not an accent, microphone, or general accuracy benchmark. Native tests captured real PCM; an isolated Windows text-box test verified real selection replacement, clipboard text restoration, and changed-caret refusal. The Electron coordinator also passed real microphone capture/stop during a cold speech load and cancellation. No audible speech review was performed. Clean Windows VM installation, physical microphone removal, sustained dictation, and broad editor compatibility remain separate acceptance checks. Generated Windows packages are unsigned.

The GPU editor passed 98/100 authored output constraints after guards in its last full evaluation; this is not a general semantic accuracy score. The CPU editor passed 14/15 smoke constraints before adding direct, deterministic uppercase/lowercase commands. Dates/deadlines omitted by a style edit are now rejected. A known remaining case can retain both sides of a spoken correction, so review important output. Command edits always require review/application; integrity checks reduce errors but cannot prove meaning is unchanged. See `BUILD_REPORT.md` and `test-results/` for the measured scope.

Troubleshooting:

- **Microphone unavailable:** enable Windows desktop microphone access, select an available input, and refresh devices. Reconnect failures require restarting the recording. The helper reports capture errors or a five-second input stall.
- **Result does not paste:** keep the same field, caret, selection, and text unchanged until insertion. Elevated apps, password fields, or inaccessible editors can require manual copying. Willfull runs as a normal user.
- **Command Apply fails:** return to the unchanged original selection and use `Ctrl+Alt+A`. Clicking another window changes the target and can invalidate the preview.
- **Clean mode keeps the original:** install the editor for the selected CPU/GPU profile, check model status, and inspect the visible notice. Integrity checks intentionally reject changed protected text, numbers, or negations; they cannot prove perfect semantic preservation.
- **`msvcp140.dll` or another VC++ error:** run the runtime preflight. If the machine lacks the source runtime, obtain the [official Microsoft x64 Visual C++ runtime](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist). Do not download individual DLLs from third-party sites.

See `PLAN.md` for the acceptance plan and `THIRD_PARTY_NOTICES.md` for model attribution and licenses. REA was used as a research reference; Wispr Flow code and server models are not bundled.
