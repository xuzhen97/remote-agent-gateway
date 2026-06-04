# Skill Bundle + Single-File CLI Distribution Design

> Date: 2026-06-04  
> Status: Design approved for spec review  
> Scope: Redesign CLI distribution so the `rag-agent` skill contains its own bundled single-file CLI artifact and can be copied to other repositories as a self-contained unit.

## Background

The current CLI implementation works well for repository-local development:

- Source code lives in `apps/cli/`
- Development wrappers live in `bin/rag` and `bin/rag.bat`
- Local developers can run `node bin/rag ...`

However, this is not the right distribution model for a portable agent skill.

The problem is not the CLI source layout — that is fine for maintenance — but the distribution boundary. For distribution, the user wants:

1. The skill to be the distributable unit
2. The CLI to be included inside the skill itself
3. The CLI artifact to be a single file
4. The copied skill to work in another repository without depending on the original monorepo layout
5. The only runtime dependency to be Node.js

That means the canonical distributed entrypoint must no longer be the repository-level `bin/rag` wrapper. Instead, it must be a bundled single-file CLI artifact that lives inside the skill directory itself.

## Goals

1. Keep CLI source code in `apps/cli/` as a multi-file maintainable application.
2. Produce a bundled single-file CLI artifact at `skills/rag-agent/dist/rag.js`.
3. Make `skills/rag-agent/` the complete distributable unit.
4. Ensure the skill can be copied to another repository or skill directory and still work.
5. Require only Node.js at runtime in the target environment.
6. Make `pnpm install:pi-skill` automatically build the bundled CLI before copying the skill.
7. Update README and skill references so distributed usage is documented around `node ./dist/rag.js ...`.
8. Preserve repository-local development ergonomics (`apps/cli`, `apps/cli/dist`, `bin/rag`, `bin/rag.bat`).

## Non-goals

- Do not move CLI source code into `skills/rag-agent/`.
- Do not remove `apps/cli/`.
- Do not remove repository-local wrappers (`bin/rag`, `bin/rag.bat`).
- Do not make `pnpm link --global` the primary installation or distribution strategy.
- Do not require the destination repository to know anything about `apps/cli/` or repository root `bin/`.
- Do not require pnpm in the destination repository; only Node.js is required at runtime.

## Core Distribution Model

### Source layout

```text
apps/cli/
├── src/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

This remains the only CLI source tree.

### Distribution layout

```text
skills/rag-agent/
├── SKILL.md
├── references/
└── dist/
    └── rag.js
```

This becomes the only canonical distribution unit.

### Canonical distributed entrypoint

```bash
node ./dist/rag.js ...
```

Relative path here is relative to the skill directory.

This is the standard invocation model for skill-driven usage.

## Architecture Decisions

| Topic | Decision |
|---|---|
| CLI source location | `apps/cli/` |
| Distribution artifact | `skills/rag-agent/dist/rag.js` |
| Artifact format | Single-file bundled Node CLI |
| Runtime dependency | Node.js only |
| Skill-distribution root | `skills/rag-agent/` |
| Repository wrappers | Kept for development only |
| Install workflow | `install:pi-skill` auto-builds then copies |
| Standard skill invocation | `node ./dist/rag.js ...` |
| `rag` on PATH | Optional convenience only |
| `pnpm link --global` | Optional/future packaging path, not primary distribution model |

## Build Architecture

### Developer build

`pnpm build:cli`

Purpose:
- compile the CLI for repository-local development
- output to `apps/cli/dist/`
- support local testing and wrapper-based execution

This is a developer build, not the final distributable artifact.

### Distribution build

`pnpm build:skill`

Purpose:
- bundle `apps/cli/src/index.ts`
- output a single-file Node CLI to `skills/rag-agent/dist/rag.js`
- produce the artifact that is copied with the skill

This is the actual skill-distribution build.

### Installer behavior

`pnpm install:pi-skill`

This command must:
1. build the bundled CLI artifact first
2. verify `skills/rag-agent/dist/rag.js` exists
3. delete the existing installed `rag-agent` skill directory if present
4. copy the whole `skills/rag-agent/` directory into Pi's user skill directory

That means `install:pi-skill` is not a copy-only command anymore. It becomes a build-and-install command.

## Build Implementation Details

## New build script

Add:

```text
scripts/build-skill-cli.ts
```

Responsibilities:
- read `apps/cli/src/index.ts`
- bundle with esbuild
- emit `skills/rag-agent/dist/rag.js`
- clean stale bundled output first
- write a Node shebang banner

### Recommended esbuild configuration

```ts
await esbuild.build({
  entryPoints: [path.join(ROOT, 'apps/cli/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: path.join(ROOT, 'skills/rag-agent/dist/rag.js'),
  minify: false,
  sourcemap: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [],
});
```

### Why this shape

- `platform: 'node'` — target the actual runtime environment
- `target: 'node22'` — align with current project engine requirements
- `format: 'esm'` — consistent with the current codebase
- `outfile` goes directly to the skill distribution directory — no second copy step for the artifact itself
- `sourcemap: false` — keep distribution simple; optional to revisit later
- shebang makes the file itself CLI-friendly even though the canonical invocation remains `node ./dist/rag.js ...`

## Script Responsibilities After Migration

### `pnpm build:cli`

Output:

```text
apps/cli/dist/*
```

Role:
- developer build
- local debugging
- repository-local wrapper support

### `pnpm build:skill`

Output:

```text
skills/rag-agent/dist/rag.js
```

Role:
- distributable skill bundle build
- portable agent CLI artifact
- source of truth for copied/installable skill bundles

### `pnpm install:pi-skill`

Role:
- build distributable artifact
- copy full skill bundle into Pi skill directory

## Invocation Model Changes

### Repository-local development entrypoints

These remain valid for developers:

```bash
node bin/rag doctor
node bin/rag clients list
```

These are developer convenience entrypoints only.

### Distributed skill entrypoint

The canonical entrypoint for the distributed skill becomes:

```bash
node ./dist/rag.js doctor
node ./dist/rag.js clients list
node ./dist/rag.js jobs run --client <clientId> -- node -v
```

This is the invocation style the skill documentation must treat as standard.

### PATH-based `rag`

This may still exist as optional convenience if the user configures it, but it must not be treated as the default or required distribution path.

## Skill Documentation Strategy

The skill must stop assuming the repository root exists.

### `skills/rag-agent/SKILL.md`

Primary execution flow must become:

```bash
node ./dist/rag.js --help
node ./dist/rag.js doctor
node ./dist/rag.js clients list
```

It should explicitly state:

1. use the bundled CLI first
2. if `./dist/rag.js` is missing, the skill installation is incomplete
3. `rag` on PATH is optional convenience only

### `skills/rag-agent/references/cli.md`

Must distinguish three concepts clearly:

1. **Source code location** — `apps/cli/` (for developers)
2. **Repository-local wrapper** — `bin/rag`, `bin/rag.bat` (developer convenience)
3. **Distributed skill artifact** — `skills/rag-agent/dist/rag.js` (canonical distribution entrypoint)

It must document the main distributed usage as:

```bash
node ./dist/rag.js ...
```

### `skills/rag-agent/references/workflows.md`

All workflow examples must be updated from `rag ...` to:

```bash
node ./dist/rag.js ...
```

because workflows are the most likely examples an agent will copy directly.

### `skills/rag-agent/references/api-map.md`

The API mapping itself does not materially change, but examples should be framed around the bundled entrypoint.

## README Strategy

README must explicitly distinguish two modes.

### Mode 1: Repository-local development usage

```bash
pnpm build:cli
node bin/rag doctor
```

This is for maintainers and contributors.

### Mode 2: Skill distribution usage

```bash
pnpm build:skill
pnpm install:pi-skill
```

README must clearly state that:

- `skills/rag-agent/` is the distributable unit
- after build, it contains `dist/rag.js`
- the directory can be copied into another repository or skill directory
- the copied bundle depends only on Node.js at runtime

Recommended wording:

> `skills/rag-agent/` is the distributable unit. After build, it contains its own bundled CLI artifact at `dist/rag.js` and can be copied into another repository or Pi skill directory without depending on the original monorepo layout.

## Installer Design

### Current target path

Installer still copies to:

```text
~/.pi/agent/skills/rag-agent/
```

### Post-install bundle shape

```text
~/.pi/agent/skills/rag-agent/
├── SKILL.md
├── references/
└── dist/
    └── rag.js
```

This ensures the installed skill is self-contained.

## Migration Strategy

This should be implemented in four stages.

### Stage 1: Add the distribution build pipeline

Add `scripts/build-skill-cli.ts` and `pnpm build:skill`.

Outcome:
- `skills/rag-agent/dist/rag.js` exists after build

### Stage 2: Upgrade `install:pi-skill`

Change it from copy-only to build-then-copy.

Outcome:
- installed skill always includes a fresh bundled CLI artifact

### Stage 3: Rewrite skill-facing documentation

Update:
- `skills/rag-agent/SKILL.md`
- `skills/rag-agent/references/cli.md`
- `skills/rag-agent/references/workflows.md`
- `skills/rag-agent/references/api-map.md`

Outcome:
- all distributed usage documentation points to `node ./dist/rag.js ...`

### Stage 4: Rewrite README around dual-mode usage

Outcome:
- development and distribution paths are clearly separated

## Compatibility and Boundaries

### Keep

- `apps/cli/` source tree
- `apps/cli/dist/` developer build output
- `bin/rag`
- `bin/rag.bat`
- `apps/cli/package.json` `bin` field if desired for future improvements

### Reposition

- PATH-based `rag` → optional convenience only
- `pnpm link --global` → optional/future packaging path only
- `node bin/rag ...` → repository-local development entrypoint only

### Canonical distribution truth

The standard distributed invocation must be:

```bash
node ./dist/rag.js ...
```

Any documentation or code path that still depends on:

```bash
node ../../apps/cli/dist/index.js ...
node /path/to/remote-agent-gateway/bin/rag ...
```

must be treated as non-distribution-local and therefore not canonical for skill bundle usage.

## Files to Add or Modify

### Add

```text
scripts/build-skill-cli.ts
```

### Modify

```text
package.json
scripts/install-pi-skill.ts
README.md
skills/rag-agent/SKILL.md
skills/rag-agent/references/cli.md
skills/rag-agent/references/workflows.md
skills/rag-agent/references/api-map.md
```

### Keep without semantic promotion

```text
apps/cli/*
bin/rag
bin/rag.bat
```

## Open Questions

None. The desired distribution model is now explicit:

- source stays in `apps/cli/`
- build emits `skills/rag-agent/dist/rag.js`
- install auto-builds
- bundled CLI is invoked with `node ./dist/rag.js ...`
- the skill bundle is portable and depends only on Node.js at runtime
