# Willfull: local Windows dictation app

Research and implementation proposal · 20–21 October 2026 · planning only

## 1. Confirmed brief

Build an Electron desktop app with a Wispr Flow-like dictation workflow, English speech recognition, and useful advanced editing features. Everything that processes speech or text runs locally. Windows comes first. Prefer quality and allow approximately **2–3 GB total application system RAM**, superseding the initial 1 GB ballpark. CPU operation must work; GPU use is welcome.

The starting workspace was empty. The inspected development machine has an i5-14600K, RTX 4060 with 8 GB VRAM, and approximately 32 GB RAM. None of the proposed latency or memory targets below has been measured yet.

## 2. Model decision

### Speech: Phonon-2

Use **FermionResearch/Phonon-2**, with the official packed Windows CPU engine as the first backend. The catalog lists a 164 MB download and about 178 MB on disk. Fermion reports 5.21% average word error across seven English datasets. This makes it the strongest candidate in the supplied catalog; published evaluation does not establish this app's accent, microphone, or Windows performance. [Catalog](https://www.fermionresearch.com/docs/speech-models/), [model card](https://huggingface.co/FermionResearch/Phonon-2).

Speech-specific documentation confirms x64 Windows CPU support. The current runtime includes packed GEMM, encoder, and decoder DLLs, while still using CPU PyTorch for parts of preprocessing. Bundle a pinned embedded Python 3.12 worker and its required libraries; users should not install Python, pip, WSL, or Docker. [Backend support](https://www.fermionresearch.com/docs/backends/#speech-platforms), [CPU engine](https://github.com/fermionresearch/phonon/blob/43b98dd54f13277715d9273b921792aba9aa94ce/docs/cpu.md).

Start with runtime `fermion-research==0.2.12` and model revision `fb09063c9dc8e130d97b3a2191ed5aed6b71bb31`, subject to compatibility validation. Runtime wheel SHA-256 inspected during research: `2316c710d03a2b3832271fcff91d997aded5fbe9aca51cadd75f8a16a2f03c71`. Record all dependencies and artifact hashes in the eventual build manifest.

Require packed-kernel self-tests to pass. Reject an unnoticed dense full-precision fallback: its weights alone can consume roughly 2.5 GB. Keep one warmed worker, with an optional unload-on-idle setting. A small model archive is not a total-RAM guarantee.

Use the CPU for ASR by default. Official CUDA deployment is currently documented through Linux containers; native Windows GPU ASR remains an optional experiment after the CPU app works. Accelerating the same speech weights does not inherently improve recognition quality. [CUDA deployment](https://github.com/fermionresearch/phonon/blob/43b98dd54f13277715d9273b921792aba9aa94ce/docs/cuda.md).

### Cleanup and commands: a separate local model

Speech recognition alone cannot deliver arbitrary instructions such as “make this shorter” or “turn this into an email.” Use a separate **llama.cpp** text worker.

- Proposed quality profile for this machine: **Qwen3.5-4B, Q4_K_M**, text-only, offloaded to the RTX 4060, with thinking disabled.
- Proposed CPU profile: **Qwen3.5-2B, Q4_K_M**, also with thinking disabled. If simultaneous residency exceeds the budget, unload ASR before loading the editor and show that transition explicitly. Include reload time in measurements.
- Benchmark the GPU candidate against **Qwen3-4B-Instruct-2507**, a dedicated non-thinking model, before freezing the shipped artifact. Choose by correction fidelity, latency, and memory on dictation tasks, rather than general reasoning scores.

These are concrete starting candidates, not proven winners. Convert pinned official weights reproducibly with a compatible pinned llama.cpp build, or use a verified reproducible GGUF artifact; record source revision, conversion, quantization, licenses, and checksums. Load no vision projector. Use a 2,048-token context for ordinary cleanup and a maximum 4,096-token context for short selected-text commands; bound output and generation time. Do not inherit a server's large default prompt-cache allocation. [4B model](https://huggingface.co/Qwen/Qwen3.5-4B), [2B model](https://huggingface.co/Qwen/Qwen3.5-2B), [non-thinking comparison](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507), [llama.cpp controls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

## 3. Product scope

| Capability | Intended behavior |
| --- | --- |
| Global dictation | Hold shortcut to speak; release to finish. Separate toggle for hands-free. Escape cancels. |
| Recording overlay | Compact, nonactivating control with microphone level, clear state, elapsed time, and optional replaceable partial transcript. |
| Insert into applications | Paste one finalized result into the validated target. Retain a recoverable result if the target changed or insertion failed. |
| Literal mode | Keep the recognized wording; apply only explicit formatting commands and configured deterministic substitutions. |
| Clean mode | Remove fillers and repetitions, handle spoken corrections, punctuation, and lists while preserving meaning. |
| Personal vocabulary | Explicit term spellings and recognized-form-to-preferred-form rules, import/export, and opt-in learning from confirmed corrections. Do not claim unsupported decoder biasing. |
| Snippets | Whole-phrase spoken triggers expand saved text; longest match wins. Protect exact snippet contents from rewriting. |
| App styles | Configurable email, messaging, document, and code-oriented presets; conservative defaults. |
| Command mode | Separate shortcut: capture selected text, dictate an instruction, preview the edit, then apply explicitly. Support shorten, rewrite, tone, list, and grammar commands. |
| History and recovery | Raw and final text, search, copy, retry, delete, paste-last, and configurable retention. |
| Local models and diagnostics | Model status, download/import, CPU/GPU selection, resource measurements, microphone test, and useful recoverable errors. |

Wispr's own documentation supports dictionary, snippets, styles, and command editing as useful reference capabilities. Its desktop workflow inserts completed text after dictation ends; partial text can stay in our overlay. Do not reproduce subscriptions, team administration, cloud sync, external web search, or meeting recording in the initial release. [Dictation](https://docs.wisprflow.ai/articles/6409258247-starting-your-first-dictation), [dictionary](https://docs.wisprflow.ai/articles/4052411709-Teach-Flow-your-words-with-the-dictionary), [snippets](https://docs.wisprflow.ai/articles/5784437944-create-and-use-snippets), [styles](https://docs.wisprflow.ai/articles/2368263928-how-to-setup-flow-styles), [commands](https://docs.wisprflow.ai/articles/4816967992-how-to-use-command-mode).

## 4. Architecture

**Electron main process:** lifecycle, tray, typed IPC, session coordinator, worker supervision, settings and local database. Renderer: React + TypeScript for onboarding, history, dictionary, snippets, settings, and command preview. The settings window is created on demand and can be destroyed while the tray app continues operating.

**Windows C++ helper:** true key-down/key-up detection; WASAPI shared microphone capture; resampling to 16 kHz mono; device-change handling; focused-control metadata; clipboard transactions and insertion. This keeps capture independent of a settings renderer. Electron globalShortcut provides activation callbacks rather than a complete hold/release interface; use the native helper for push-to-talk. Keep low-level hook callbacks minimal and process events on a queue. [Electron shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut/), [Windows hooks](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc), [WASAPI](https://learn.microsoft.com/en-us/windows/win32/coreaudio/capturing-a-stream).

**Speech worker:** embedded Python with official Fermion kernels; persistent model; bounded audio; replaceable partial hypotheses; finalized segment IDs. Supervise and restart on failure. Communicate through inherited local pipes with length-prefixed typed messages, request IDs, version negotiation, backpressure, and timeouts. Audio never travels through renderer JavaScript.

**Text worker:** packaged llama.cpp runtime, CPU build plus optional CUDA libraries. If using llama-server, bind only to loopback, choose an ephemeral port and per-launch credential, and accept requests solely through Electron main. Limit context, parallelism, cache, and lifetime. Failure leaves literal or deterministically formatted dictation available.

**Storage:** SQLite in the OS user-data directory for settings, dictionary, snippets, and optional history. Model files are immutable cached artifacts with verified hashes. Keep the application directory read-only at runtime. Transcript content stays out of diagnostic logs.

Proposed source boundaries: `src/main`, `src/preload`, `src/renderer`, `src/shared`, `native/windows`, `workers/speech`, `resources/models`, `tests`, and `scripts/packaging`. Electron sandbox and context isolation stay enabled; renderer Node integration stays disabled. Validate every privileged IPC request and deny arbitrary navigation. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

## 5. Session, formatting, and insertion correctness

State machine: `idle → starting → recording → finalizing → formatting → inserting → complete`, with cancellation and explicit failures from every active state. Every worker result carries a session ID; cancellation invalidates late results. Show “starting” until microphone capture is actually ready. Never synthesize Enter or submit a message.

Reuse the official streaming session semantics: partials replace the entire current hypothesis, finalized segments are immutable, and the completed transcript commits once. The current implementation repeatedly decodes a bounded phrase rather than retaining a neural streaming state; prevent unbounded audio growth and duplicate final segments. Use silence boundaries and the documented 30-second segment limit. Flush promptly on shortcut release rather than waiting for the silence timer. Prioritize capture and finalization; discard superseded partial-decode jobs rather than building a queue. [Streaming protocol](https://www.fermionresearch.com/docs/speech-streaming/).

Processing order: recognize → parse explicit formatting commands → apply personal substitutions → protect exact snippets/terms → optional cleanup/style pass → validate protected content and numerical meaning → restore protected values → insert. If cleanup times out or fails validation, retain the conservative result and make the fallback visible. Validation reduces errors; it cannot prove perfect semantic preservation. These preservation rules apply to automatic cleanup; explicit command edits may change values and require preview/apply. Store the original transcript when history is enabled. Test filler removal and explicit self-corrections rather than treating “remove every um” as universally safe.

Snapshot the original window, focused field, caret, and selection at activation, as far as the target exposes them. The overlay must not take focus. Revalidate before insertion, including same-field edits while recognition was running; when the destination changed, keep the transcript and offer explicit paste. Revalidate selected text again when applying a command preview. If a target cannot expose enough information, use a documented conservative policy and manual-paste recovery rather than claiming perfect target verification. Do not force foreground focus back to an earlier window.

Treat paste as a transaction: preserve supported clipboard formats, insert only once after activation keys are released, and restore only if a clipboard sequence check shows no intervening user copy. Clipboard consumption is asynchronous, so test destination behavior before restoring. Do not blindly replace a control's entire ValuePattern value. Undo should be one native paste undo where the destination supports it; never issue a blind global Ctrl+Z after the user has moved on. [Clipboard sequence](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardsequencenumber), [SendInput limitations](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).

Standard-user insertion into elevated or protected targets may be blocked. Keep a copyable result and explain the actual failure; do not run the whole app as administrator. Detect password fields and avoid capturing their contents or inserting automatically.

## 6. Local-first behavior

Microphone opens only for an active session. Surrounding-field context is opt-in and bounded; command mode reads the explicitly targeted selection. Context is discarded at session end. No screenshot capture or continuous application monitoring is needed.

Proposed default: audio is memory-only; history starts disabled with a clear local-retention choice in onboarding. An optional debug recording requires a deliberate action and a visible destination. All model inference and editing work with networking disabled after setup.

Model setup supports a deliberate download with progress, resume, cancellation, hash verification, and storage-size disclosure, plus offline import. Runtime/model downloads can be much larger than the 164 MB speech archive. Disable telemetry and automatic remote calls; model/update checks require user initiation. Ship a fully offline installation bundle as an alternative to the smaller downloader installer.

## 7. Resource and experience targets

These are **acceptance targets**, not research results. Measure a packaged release build on the inspected machine, with settings open and closed, and publish cold and warm measurements separately.

| Measure | Initial target / test condition |
| --- | --- |
| Warm hold-to-capture-ready | p95 ≤150 ms, measured to actual capture readiness |
| First visible partial | p95 ≤750 ms for sustained speech, if enabling partials passes the resource gate |
| Release-to-insertion, literal | p95 ≤800 ms for 5–30-second utterances |
| Release-to-insertion, clean GPU | p95 ≤1.8 seconds for 5–30-second utterances; maximum 512 input tokens and 256 output tokens for the cleanup request |
| Total system RAM | Aim ≤2 GB during dictation and ≤3 GB during cleanup/commands; report loading peaks separately and count every child process |
| GPU memory | Proposed rewrite budget ≤4 GB VRAM; measure dedicated and shared GPU memory separately |
| Idle CPU | Approximately ≤1% machine CPU over a one-minute tray-idle sample |
| Reliability | Zero duplicate commits, wrong-target insertions, or submitted messages in the acceptance scenarios |

Report process-tree private bytes and working sets, system available-memory delta, peak loading use, and dedicated/shared VRAM. Do not measure only Electron or hide model reload peaks. Treat the system-RAM limit as soft as requested, but disclose overruns and improve scheduling before accepting them. If GPU VRAM is busy, unload or choose CPU explicitly rather than spilling unpredictably into shared system RAM.

Timing protocol: use a monotonic clock and record shortcut key-down, capture-ready, speech onset, first nonempty partial, key-up, final ASR, cleanup completion, paste dispatch, and confirmed text appearance in instrumented target fixtures. Where appearance cannot be observed reliably, label the result dispatch latency. Run at least 100 warm trials for each final CPU/GPU profile and at least 30 cold starts; report sample counts, p50, p95, maximum, and failures separately. Fix audio fixtures, prompt, quantization, context, batch settings, and effective CPU thread count. Record driver/runtime versions and power mode. Test both idle foreground conditions and a documented representative background workload. Report CPU cleanup, GPU cleanup, worker restarts, and model swaps separately; GPU targets do not imply CPU targets. Cold loading and memory peaks remain visible in the report.

## 8. Build order and exit gates

1. **Packaged runtime proof.** With a small known audio fixture, prove official packed Phonon-2 inference from an embedded worker, validate kernels, and measure load/steady RAM and cold/warm timings. Add a minimal packaged Electron host to account for its baseline. If this exceeds 3 GB, optimize the real bottleneck before committing to the full stack; do not silently change the selected model.
2. **End-to-end dictation.** Real hold/release → real microphone → local recognition → one insertion into Notepad. Add cancellation, focus checks, clipboard recovery, worker restart, tray, and basic overlay. Test from the installed package.
3. **Personalization and cleanup.** Dictionary, snippets, explicit formatting, local persistence, history controls, literal mode, and clean mode. Benchmark rewrite candidates on the same fixtures; freeze the winning artifact and resource profile.
4. **Advanced editing.** Selected-text command mode, preview/apply, app-style rules and optional bounded context. Test CPU-only and GPU profiles, including contention and fallback.
5. **Desktop finish and delivery.** Onboarding, permission/device errors, model manager, keyboard accessibility, diagnostics, Windows installer, portable package, and offline bundle. Inspect the UI at common Windows scales. Validate an offline installation under a fresh non-admin Windows profile with no Python, MSVC runtime, CUDA Toolkit, or build tools preinstalled. Bundle the required redistributables or supported app-local DLLs and check CPU instruction support and GPU driver requirements at startup. A GPU driver is a system prerequisite; the CUDA Toolkit is not. Report signing status honestly.

Each gate produces executable evidence, logs without user text, and a resource/latency report. A polished UI alone is not an accepted dictation app.

## 9. Verification

Build a fixed English corpus with at least 60 utterances across clear/quiet speech, accents including Indian English, technical names, numbers/currencies/dates, pauses, self-corrections, background noise, and 30-second boundaries. Keep held-out cases distinct from prompt-tuning examples. Include silence-only and non-speech recordings to test false output. Record raw WER, final-text edit distance, name/number preservation, and manual meaning review separately.

For cleanup and commands, use at least 100 text fixtures covering corrections, negation, lists, emails, snippets, contractions, amounts, dates, and selected-text instructions. Require exact protected-value preservation on the fixture set; inspect semantic changes manually. Compare 2B/4B profiles with the same prompts, quantization, context, hardware, and timeout. Report failures rather than conflating general benchmarks with product quality.

Test insertion in Notepad, Chrome/Edge plain inputs and contenteditable, VS Code, Word, and a messaging compose box. Cover multiline/Unicode, selection replacement, modifier release, autorepeat, Escape, focus changes during recognition, concurrent clipboard copying, microphone reconnect, sleep/resume, worker crash, GPU contention, and elevated-target fallback. Run 100 consecutive sessions and a 20-minute dictation to detect leaks and boundary errors. Verify offline operation by blocking outbound networking and monitoring attempted connections.

Automated tests focus on session cancellation, deduplication, processing order, guard failures, dictionary/snippet matching, database migration, and protocol parsing. Native audio, insertion, packaged dependencies, and human meaning review require real integration evidence.

## 10. REA and licensing

`morluto/rea` is **Reverse Engineer Anything**, a MIT-licensed analysis MCP/CLI, not a Wispr Flow clone or source for its paid processing. The audited revision is `1629266e3c08c90fed6bba5383528af7986a12b7` (package 6.7.0). Keep it a development-only investigation tool. If a compatible local reference app is available, use it for targeted evidence about shortcuts, recording lifecycle, IPC, and insertion behavior. Public feature documentation already supports planning; recovering client code cannot reveal server-side models. [Repository](https://github.com/morluto/rea/tree/1629266e3c08c90fed6bba5383528af7986a12b7), [desktop inspection](https://github.com/morluto/rea/blob/1629266e3c08c90fed6bba5383528af7986a12b7/docs/desktop-applications.md).

Bundle Phonon-2 CC-BY-4.0 attribution, Fermion runtime Apache-2.0 notices, and the licenses of the exact text models, llama.cpp, Electron, and all redistributed dependencies. Implement our own feature behavior and visual identity. No actual Wispr binary was inspected during this planning pass.

## Current status

Implementation was authorized on 21 October 2026. A working Electron app, embedded Phonon-2 runtime, native Windows helper, local GPU/CPU text editors, personalization, SQLite persistence, and packaging scripts now exist. See BUILD_REPORT.md for actual verification and limits. This document remains the original acceptance plan; unperformed broad compatibility, sustained-use, clean-VM, and full benchmark checks must not be inferred from the narrower passing tests.
