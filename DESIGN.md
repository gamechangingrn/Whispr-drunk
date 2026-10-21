---
name: Willfull
description: A calm Windows workspace for local voice dictation.
colors:
  forest: "#315c42"
  forest-deep: "#254a34"
  forest-wash: "#e7eee3"
  warm-canvas: "#fcfcf9"
  sage-sidebar: "#f3f4ef"
  white-surface: "#ffffff"
  deep-ink: "#252b28"
  quiet-ink: "#6c736c"
  fine-line: "#e5e8df"
  focus-sage: "#8aa58b"
  error-clay: "#a13a32"
typography:
  headline:
    fontFamily: "DM Sans Variable, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontFamily: "DM Sans Variable, Segoe UI, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    letterSpacing: "-0.03em"
  body:
    fontFamily: "DM Sans Variable, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "DM Sans Variable, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.3
rounded:
  key: "4px"
  control: "7px"
  workspace: "12px"
  symbol: "16px"
spacing:
  compact: "4px"
  small: "8px"
  control: "12px"
  standard: "16px"
  group: "24px"
  section: "32px"
  workspace: "38px"
components:
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.white-surface}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.forest-deep}"
  button-secondary:
    backgroundColor: "{colors.white-surface}"
    textColor: "{colors.forest}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  navigation-selected:
    backgroundColor: "#e3eadf"
    textColor: "#2b513a"
    rounded: "{rounded.control}"
    height: "42px"
  dictation-workspace:
    backgroundColor: "{colors.white-surface}"
    rounded: "{rounded.workspace}"
---

# Design System: Willfull

## Overview

**Creative North Star: "A quiet writing desk"**

Willfull is an operational desktop tool. A warm canvas, a slim sage sidebar, deep ink, and a restrained forest accent give recording state and written output the clearest places in the interface. The voice workspace leads; management views use direct lists and inline forms.

These are the implemented defaults for the working Willfull name. DM Sans is bundled locally. No illustration, remote font, sample transcript, invented usage metric, or simulated successful desktop connection is required to make the interface usable.

**Key Characteristics:**

- Warm neutral surfaces and a single forest action color.
- One bundled type family with a fixed desktop scale.
- Recording and processing state remain visible.
- Inline management, recoverable text, and deliberate command review.

## Colors

Forest carries primary actions and selection. Warm neutrals separate navigation, work, and transcript output.

**The Action Color Rule.** Use forest for actionable emphasis and meaningful state, with a muted neutral vocabulary for supporting information.

Primary: forest `#315c42`, hover forest-deep `#254a34`, and forest-wash `#e7eee3`. Neutral surfaces: warm-canvas `#fcfcf9`, sage-sidebar `#f3f4ef`, and white-surface `#ffffff`. Foreground: deep-ink `#252b28`, quiet-ink `#6c736c`. Fine-line `#e5e8df` defines structural boundaries. Error-clay `#a13a32` identifies recoverable failures.

Secondary foregrounds are individually darkened to retain readable contrast on their actual light surfaces. Disabled controls intentionally reduce opacity. The transparent recording window reverses the palette onto a dark forest surface.

## Typography

DM Sans Variable is the sole authored family, served from the installed local font package. Segoe UI is a fallback. Headlines use 28px/550 with restrained negative tracking; capture headings use 21px/500. Output uses 13px with a generous 1.7 line-height. Operational help, shortcut explanations, model status, and desktop status use at least 11px; interaction labels retain a clear weight step. Secondary decorative metadata can run denser.

**The Written Output Rule.** Preserve whitespace and wrap long words in dictation, snippet, and command text. Written content should remain selectable, readable, and recoverable.

## Layout

The standard 1160×810 desktop surface uses a 208px sidebar, a 54px titlebar, a 31px statusbar, and a scrollable main area with 38px horizontal padding. Content caps at 1060px. At 1040px the sidebar becomes 187px and padding 27px. A further 850px rule supports compact widths. The shipped minimum is 900×620.

At heights below 720px, recording controls compress vertically so the transcript stays closer to the primary task. Persistent navigation and desktop status remain outside the content scroller.

The Home surface contains one dictation workspace and a two-column shortcut/practice area. Dictionary and Snippets use searchable lists with inline editors. Models use two direct rows and actual resource readings. Settings use divider-led rows. The command preview uses two text columns with an explicit keyboard application instruction.

## Elevation & Depth

Most structure is flat, carried by a border or a tonal surface. The selected segmented control has a small offset ambient shadow. Toasts, the command dialog, and the transparent recording overlay receive soft offset shadows because they float above a work surface.

The only modal is selected-text review, where interruption protects an explicit edit. Its background is a quiet dark forest scrim. Ordinary adding and editing remain inline.

## Shapes

Controls use 7px corners; keyboard keys use 4px; the dictation workspace uses 12px. Microphone and model symbols use 12–16px soft corners. The toggle keeps a standard switch shape. Iconography uses Lucide with a consistent fine stroke; the Willfull mark is a simple five-line waveform.

## Components

Buttons have one primary, secondary, and destructive vocabulary. Each uses named actions, visible keyboard focus, hover/active states, and disabled state. Primary buttons pair white text with forest; secondary buttons use a white surface and fine border.

Inputs use white surfaces, 7px corners, a fine green-neutral stroke, explicit labels, and a sage focus ring. Search places the same Lucide search icon next to an ordinary text input. Inline editors show their save/cancel actions together.

The recording workspace displays the actual session phase, audio level, transcript, insertion destination, and recovery notice. Partial transcript text stays in Willfull. Final text wins over the raw transcript after completion.

The command preview shows original and proposed text side by side. It instructs the user to return to the destination and press `Ctrl+Alt+A`, keeping native target validation possible. Copy and Dismiss remain available in the review.

Motion is limited to recording-level changes, loading indicators, progress, and short state feedback. Transitions use `cubic-bezier(.16, 1, .3, 1)` around 160–250ms. Reduced-motion preference disables these transitions.

## Do's and Don'ts

### Do

- Do render actual desktop state, real model setup progress, and explicit disconnected states.
- Do use direct list rows for saved words, snippets, history, and model status.
- Do keep the microphone state, cancel control, and latest result easy to find.
- Do preserve selectable text and visibly communicate insertion failures.

### Don't

- Don't invent successful setup, transcripts, hardware readings, or usage statistics.
- Don't add a dashboard of repeated feature cards to an operational view.
- Don't auto-apply a command edit from a foreground preview window.
- Don't load fonts or visual dependencies from a remote service at runtime.
