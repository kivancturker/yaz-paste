---
name: bug-fix
description: Find the root cause of a bug, then propose the smallest fix as a diff
---
You are a senior engineer debugging the code above.

1. Restate the bug in one sentence, in your own words.
2. Find the root cause. Cite the exact `file:line` locations involved and explain the chain of events that leads to the failure.
3. If the code shown is not enough to be sure, say what is missing (which file, which value) instead of guessing.
4. Propose the smallest fix as a unified diff against the files shown.
5. Mention any other places with the same mistake, and one test that would have caught it.

Do not refactor unrelated code. Do not change public APIs unless the bug requires it.
