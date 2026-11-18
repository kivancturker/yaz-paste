---
name: write-tests
description: Write focused unit tests (xUnit for .NET, Vitest/Jest for Node) for the code shown
---
Write unit tests for the code above.

- Match the project's stack: **xUnit** (with FluentAssertions/NSubstitute or Moq only if the code already uses them) for .NET; **Vitest** or **Jest** for Node/TypeScript, whichever the project uses.
- Cover the happy path, edge cases (empty, null, boundaries, invalid input) and error paths.
- One behaviour per test, with a descriptive name (`Method_State_ExpectedResult` in .NET, `it('…')` in JS).
- Mock only external boundaries (database, HTTP, clock, file system), not the code under test.
- If something is hard to test, explain why and suggest the smallest refactor that would help.

Output complete test files ready to paste, with the file path for each.
