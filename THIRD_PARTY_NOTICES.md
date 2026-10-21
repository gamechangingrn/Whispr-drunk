# Third-party notices

Willfull's original application code is MIT licensed. Models and bundled dependencies retain the licenses supplied by their authors. This document identifies the principal components and where their accompanying notices are retained; it is not a claim that every transitive dependency has been independently audited.

## Speech model and runtime

**Phonon-2 — Fermion Research, copyright 2026 Fermion Research.** Weights are licensed under Creative Commons Attribution 4.0 International. They derive from NVIDIA's Parakeet TDT 0.6B v3, copyright NVIDIA Corporation. Fermion retrained and quantized encoder weights and quantized remaining parameters; Willfull uses the released weights without retraining. Preserve the upstream `NOTICE`, `LICENSE-WEIGHTS-CC-BY-4.0.txt`, and `LICENSE-CODE-Apache-2.0.txt` next to the model. Willfull adds Windows audio capture, session coordination, formatting, and application insertion around the runtime.

- Source: https://huggingface.co/FermionResearch/Phonon-2
- Model revision: `fb09063c9dc8e130d97b3a2191ed5aed6b71bb31`.
- Base model: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- Weights license: https://creativecommons.org/licenses/by/4.0/
- Local notices: `resources/models/phonon-2/NOTICE` and its two `LICENSE-*` files; the same directory is included as `resources/models/phonon-2` in the Windows package.

**Fermion runtime 0.2.12:** Apache License 2.0. Upstream source: https://github.com/fermionresearch/phonon . The installed wheel retains `fermion_research-0.2.12.dist-info/licenses/LICENSE` and `NOTICE` inside embedded Python's `Lib/site-packages`. The wheel and packed kernel provenance are recorded in the runtime/model manifests.

## Optional editing models

Qwen3.5-4B and Qwen3.5-2B, by the Qwen team, use Apache License 2.0. Willfull uses text inference without a vision projector. GGUF Q4_K_M quantizations are published by Unsloth; these are quantized derivatives of the Qwen weights rather than Willfull-trained models.

| Artifact | Pinned source |
| --- | --- |
| 4B Q4_K_M | https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/tree/e87f176479d0855a907a41277aca2f8ee7a09523 |
| 2B Q4_K_M | https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/tree/f6d5376be1edb4d416d56da11e5397a961aca8ae |
| Original 4B model/license | https://huggingface.co/Qwen/Qwen3.5-4B |
| Original 2B model/license | https://huggingface.co/Qwen/Qwen3.5-2B |

Exact sizes, revisions and hashes are in `resources/editor-manifest.json` and `resources/editor-cpu-manifest.json`. Preserve the corresponding Apache 2.0 license when redistributing these optional artifacts.

**llama.cpp b11756:** MIT License, copyright 2023–2026 The ggml authors. Source/license: https://github.com/ggml-org/llama.cpp/blob/b11756/LICENSE . The Windows runtime is the upstream x64 Vulkan/CPU release. Preserve its bundled license and component notices, including those for backend libraries.

## Application and embedded runtime

| Component | License / retained source |
| --- | --- |
| Electron | MIT; shipped Electron `LICENSE` and `LICENSES.chromium.html` cover Electron and its embedded Chromium/Node components. https://github.com/electron/electron |
| React / React DOM | MIT. https://github.com/facebook/react |
| sql.js | MIT; SQLite is public domain. https://github.com/sql-js/sql.js |
| Zod | MIT. https://github.com/colinhacks/zod |
| Lucide icons | ISC. https://github.com/lucide-icons/lucide |
| DM Sans font | SIL Open Font License 1.1, copyright The DM Sans Project Authors. License is retained by `@fontsource-variable/dm-sans/LICENSE`. https://github.com/googlefonts/dm-fonts |
| Python 3.12.10 | Python Software Foundation License Version 2 and incorporated third-party terms, retained in embedded Python's `LICENSE.txt`. https://www.python.org |
| PyTorch 2.9.1+cpu | BSD-3-Clause plus incorporated component terms, retained in `torch-2.9.1+cpu.dist-info/LICENSE` and `NOTICE`. https://pytorch.org |
| NumPy / SciPy | BSD-3-Clause plus bundled numerical-library notices retained in wheel metadata. https://numpy.org / https://scipy.org |
| Transformers | Apache-2.0 and its accompanying notices. https://github.com/huggingface/transformers |
| soundfile | BSD-3-Clause; its unmodified dynamically loaded libsndfile is LGPL-2.1-or-later. Preserve `soundfile-0.13.1.dist-info/LICENSE` and `_soundfile_data/COPYING`; users can replace the separately shipped libsndfile DLL. https://github.com/bastibe/python-soundfile / https://github.com/libsndfile/libsndfile |

Embedded Python wheel `.dist-info` license/notice files and `resources/runtime/manifest.json` retain further dependency identity and license information. Model/runtime download archives remain separate from the application's MIT license. Development tools are not all shipped in the application.

## Microsoft runtime components

Windows, WinMM, UI Automation, and .NET Framework are platform components. Microsoft Visual C++ release runtime DLLs copied app-locally remain unmodified Microsoft proprietary redistributables, under the publisher's applicable Microsoft redistribution rights. `resources/runtime/python/app-local-dependencies.json` records copied file versions, SHA-256 values, and the installed source paths. No Microsoft debug runtime is copied.

Microsoft documents [application-local deployment](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files) and the [Visual Studio redistribution terms](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution). Those terms govern distribution; this notice grants no additional Microsoft license. App-local runtime copies must be serviced when preparing updates.

## Reference projects

REA (https://github.com/morluto/rea), MIT, was inspected as a development/research reference. It is not a dictation implementation, is not required by Willfull at runtime, and its executable is not bundled. Wispr Flow is a product reference only; its proprietary application code, trademarks, subscriptions and cloud models are not included.
