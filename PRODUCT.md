# Willfull

<!-- impeccable:product-schema 1 -->

## Platform

web

This schema value describes the Electron renderer. The delivered product is a Windows desktop application, not a hosted website. macOS and Linux are outside the first release.

## Stack

Confirmed: Electron.js. Proposed implementation choices: TypeScript and React for the renderer; a C++ Windows integration helper; an embedded Python speech worker; llama.cpp for local text editing. These supporting choices are recommendations, not additional user-confirmed requirements.

## Users

An English-speaking Windows user who wants system-wide voice dictation comparable to Wispr Flow, with useful advanced editing features and local processing.

## Product Purpose

Turn speech into accurate, usable text in the user's active application. Minimize the interruption between speaking and continuing work. Include personal vocabulary, reusable snippets, cleanup, and voice-driven text editing.

## Positioning

Local speech recognition and text processing, using the user's CPU and GPU. The requested reference is Wispr Flow's workflow and useful advanced capabilities.

## Operating Context

Confirmed on 20 October 2026: English only; Windows first; prioritize quality and allow approximately 2–3 GB total application system RAM. This supersedes the initial roughly 1 GB ballpark.

Development machine inspected: Intel Core i5-14600K, NVIDIA RTX 4060 with 8,188 MiB reported VRAM, approximately 32 GB installed system RAM, Windows build 26200. These are development-machine observations, not minimum requirements or measured app performance.

## Capabilities and Constraints

- Electron is required.
- Select speech recognition from Fermion's speech-model catalog; Phonon-2 is the researched recommendation.
- CPU operation is required; GPU acceleration may be used where it improves the experience.
- All speech and text processing must run locally.
- Treat memory as the complete application and worker process tree; report VRAM separately.
- Use morluto/rea where useful to investigate reference behavior. It is an analysis toolkit rather than an existing dictation implementation.
- The user approved implementation on 21 October 2026 with “Make the app with the plan. Go.” Build, package, and verify the application within the confirmed scope.

## Brand Commitments

Willfull is a working name inferred from the workspace directory, not a confirmed final product name. Wispr Flow is a functional reference, not permission to reuse its branding or a confirmed visual design.

## Evidence on Hand

The starting workspace was empty. Primary-source model, runtime, Electron, Windows, and reference-feature research is recorded in PLAN.md. Implementation and verification evidence is recorded in the source tree and build reports; distinguish real speech fixture tests, microphone capture, process memory measurements, and visual inspection from live external-app insertion or audible review.

## Product Principles

- Preserve what the user meant, especially names, numbers, and corrections.
- Make microphone and processing state visible.
- Make insertion reliable and recoverable.
- Keep processing local and resource use measurable.
- Prove the complete dictation path before expanding the interface.

## Open Decisions

Final branding and visual direction; startup preference; exact default shortcut after conflict testing; history-retention default; final rewrite-model artifact after task benchmarks. The implementation plan proposes defaults without representing them as confirmed answers.
