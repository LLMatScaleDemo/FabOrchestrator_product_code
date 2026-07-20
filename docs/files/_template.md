# `<file path>` — <one-line role>

> Version: commit `7976c78` on `main`. Validation: 🔵 Static — written by reading code,
> not yet confirmed by a code owner or runtime.
> App: <Fab / Admin / both> · Review priority: <High/Med> ·
> Catalog row: [01 — File catalog](../01-file-catalog.md) · Hotspot: [03 §1 row N](../03-review-hotspots.md#1-the-high-priority-files-at-a-glance)

## Purpose

<2–3 sentences, plain language: what this file is for and why it exists.>

## Depends on / consumed by

**Depends on:** <the imports that matter — modules, env vars, external services.>

**Consumed by:** <every caller, grouped. Verified by grepping imports at the pinned commit.>

## Function-by-function

### `functionName(args): ReturnType`

<What it does in plain language. Side effects (DB / raw SQL / network / crypto / none).
What happens on error — throws? returns null? swallows?>

<!-- repeat per export; group trivial exports into one subsection -->

## Failure modes & gotchas

- <Silent fallbacks, swallowed errors, latent bugs, drift hazards, misleading comments.>

## Open questions for the code owner

1. <Copied/expanded from the hotspots doc — the things a human must confirm.>

## Both-apps note (if the file exists in both apps)

<Byte-identical? Diverged? List the differences precisely.>
