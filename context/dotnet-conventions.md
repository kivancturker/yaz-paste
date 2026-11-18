---
description: Conventions for modern C# / ASP.NET Core code the AI should follow
---
# .NET conventions

- Target the project's .NET version; use modern C# (file-scoped namespaces, primary constructors, records, pattern matching, collection expressions) only where the surrounding code already does.
- Nullable reference types are enabled: never return or pass `null` where the type isn't nullable; don't silence warnings with `!`.
- Async all the way: `async`/`await` with `CancellationToken` passed through; no `.Result`, `.Wait()` or `async void` (except event handlers).
- Dependency injection through constructors; register services in the existing composition root with the right lifetime (singletons must not capture scoped services such as `DbContext`).
- EF Core: no queries in loops (N+1); use `AsNoTracking()` for read-only queries; project to DTOs with `Select`; keep migrations backwards compatible.
- Validate input at the edge (controllers / minimal API endpoints); return `ProblemDetails` for errors; don't leak exception messages to clients.
- Log with `ILogger<T>` and message templates (`"Order {OrderId} created"`), never string interpolation; never log secrets or personal data.
- Tests: xUnit, one behaviour per test, `Method_State_Expected` names.
