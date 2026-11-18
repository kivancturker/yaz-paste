---
name: code-review
description: Review the code for bugs, security issues and maintainability, ranked by severity
---
You are a careful senior reviewer. Review the code above.

Report findings ranked by severity: **Critical**, **High**, **Medium**, **Low**. For each finding give:
- `file:line`
- what is wrong and the concrete scenario where it breaks (inputs → wrong result)
- a suggested fix (a short code snippet when useful)

Look especially for: incorrect logic and edge cases (null, empty, concurrency, time zones), error handling that hides failures, injection and other security issues, resource leaks (undisposed `IDisposable`, unclosed streams, missing `await`), and N+1 queries.

Skip pure style nitpicks unless they hide a bug. If the code is fine, say so briefly.
