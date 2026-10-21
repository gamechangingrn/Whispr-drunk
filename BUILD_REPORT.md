# Willfull 0.1.0 build report

21 October 2026. Windows x64; i5-14600K; RTX 4060 8 GB; 32 GB system RAM.

## Delivered implementation

- Electron 44.9.2 / React desktop interface with dictation, history, dictionary, snippets, local model management, settings, and command previews.
- Global hold-to-talk, hands-free, cancel, command-apply, and paste-last shortcuts, with configurable primary bindings.
- Real 16 kHz mono microphone capture through a compiled .NET Framework / Win32 helper. The first implementation uses WinMM rather than the proposed C++/WASAPI helper. It includes device-change refresh and capture-stall detection.
- Embedded Python 3.12.10, CPU PyTorch 2.9.1, Fermion 0.2.12, and pinned Phonon-2 packed Windows kernels. No system Python or compiler is required by the packaged app.
- Local Qwen3.5 4B Q4_K_M on Vulkan GPU and 2B CPU profile through pinned llama.cpp b11756. CPU mode explicitly disables device, operation, and KV offload.
- Conservative cleanup guards, protected vocabulary/snippets, explicit numerical correction handling, direct case commands, preview-before-apply text editing, target/selection revalidation, and clipboard recovery.
- Microphone audio is buffered during a cold speech load. CPU mode exchanges speech/editor residency to limit physical memory. History is disabled by default.

## Observed verification

| Check | Result and boundary |
| --- | --- |
| TypeScript | Pass, no type errors |
| Unit regressions | 33 pass: text protection, numeric corrections, matching, negations, and explicit case commands |
| Speech protocol | 4 tests pass, including cancellation, segmentation, bounded state, and invalid frames |
| Real speech fixtures | 3 public English recordings; 0 normalized word errors across 70 reference words; too small to establish general accuracy |
| Speech timing | Approximately 0.42 seconds release-to-final for one 6-second fixture; cold engine load approximately 1.32 seconds; component measurements only |
| Speech memory | Peak working set approximately 981 MB in the fixture run |
| Native integration | 12 checks pass, including real PCM capture/cancel, shortcut validation, memory aggregation and refusal guards |
| Actual Windows insertion | Isolated text box: selected text replaced, prior clipboard text restored, changed caret rejected |
| Electron integration | Live native helper + real speech/editor workers, SQLite personalization, invalid IPC rejection, process memory, UI views and supplied command-state fixture |
| GPU editor | 98/100 authored output constraints after guards; median approximately 314 ms, p95 approximately 438 ms; generation-only, not dictation-to-insertion |
| GPU editor memory | Approximately 742 MB steady working set, 1.25 GB loading peak, approximately 4 GB private commit, approximately 2.9 GB extra VRAM |
| CPU editor | 14/15 real smoke constraints before the later direct-case-command fix; median approximately 1.42 seconds, p95 approximately 2.50 seconds; approximately 2.02 GB editor working set |
| Full app memory | About 1,960–2,090 MiB aggregate working-set samples with speech and GPU editing loaded, including Electron and helpers |
| Runtime dependencies | Offline imports pass without admin rights on this machine; app-local signed Microsoft runtime DLL provenance is retained |
| UI review | Independent reviewer confirmed all listed finish fixes resolved; this verifies supplied UI states, not microphone command accuracy |

Detailed evidence: `.artifacts/`, `test-results/`, and `workers/speech/test-results.json`. The editor corpus contains synthetic authored text fixtures; speech fixtures are actual public recordings. No microphone audio was listened to or audibly reviewed.

## Material limits

The 100 editor checks are constraint tests, not proof of semantic equivalence. One known spoken correction can retain both the withdrawn and intended names. An email-style transformation dropped a deadline in testing; the subsequent command guard rejects omitted relative dates/deadlines. The CPU model missed an uppercase instruction; explicit uppercase/lowercase operations are now deterministic and covered by unit tests. No new full model score is claimed after those final safeguards.

The physical-memory target is distinct from Windows private commit and dedicated/shared GPU memory. Loading peaks, driver behavior, longer selected text, and concurrent GPU use can change memory and latency. CPU mode deliberately unloads the unused engine, which introduces reload time; recording is buffered while speech reloads.

External insertion was verified in an isolated Windows text box. Word, VS Code, browser editors, messaging apps, elevated windows, physical hotkeys, unplug/reconnect, sleep/resume, long dictation, a 60-clip accent/noise corpus, and clean Windows VM installation have not all been verified. Unsupported or changed targets retain a copyable result. Do not describe this release as universally compatible or production-certified.

## Packages

`release/win-unpacked/Willfull.exe` is the full local app; keep its directory together. The offline ZIP contains speech plus both text-editor profiles. The smaller NSIS installer contains speech and offers explicit editor downloads through Models. Packages are unsigned. Consult README.md for controls and recovery.
