---
name: explain-code
description: Explain what the code does, how data flows through it, and what to watch out for
---
Explain the code above to a developer who is new to this part of the codebase.

1. **Summary**: what it does and why it exists, in 2–3 sentences.
2. **Flow**: walk through the main path step by step, citing `file:line`.
3. **Key pieces**: the important types/functions and how they relate.
4. **Gotchas**: non-obvious behaviour, side effects, assumptions, and anything that looks fragile.

Use plain language. Don't restate every line; focus on what a reader needs to change this code safely.
