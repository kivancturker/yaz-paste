---
description: What a thorough code review should check
---
# Review checklist

- **Correctness**: edge cases (empty, null, zero, max values, duplicates), off-by-one errors, time zones and culture-specific parsing, concurrency and race conditions.
- **Errors**: failures handled and surfaced, not swallowed; resources disposed; transactions rolled back.
- **Security**: authorization on every endpoint and ownership checks on every resource; input validated; no injection; no secrets in code or logs.
- **Data**: migrations safe for existing data; no N+1 queries; indexes for new query patterns.
- **API**: breaking changes called out; consistent naming and status codes.
- **Tests**: new behaviour covered, including the failure paths.
- **Readability**: names say what things are; no dead code; comments explain why, not what.
