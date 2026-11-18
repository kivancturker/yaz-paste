---
description: Conventions for TypeScript / Node.js code the AI should follow
---
# Node.js / TypeScript conventions

- TypeScript in strict mode: no `any` (use `unknown` and narrow), no non-null assertions to silence errors.
- ES modules and `async`/`await`; always handle promise rejections; never block the event loop with sync I/O in request paths.
- Validate external input (HTTP bodies, env vars, files) at the boundary, e.g. with zod.
- Keep functions small and pure where possible; side effects at the edges.
- Errors: throw `Error` subclasses with useful messages; don't swallow errors silently.
- Use the project's existing libraries and patterns before adding a dependency.
- Tests: the project's runner (Vitest or Jest); test behaviour, not implementation details.
