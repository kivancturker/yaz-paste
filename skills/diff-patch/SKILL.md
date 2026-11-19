---
name: diff-patch
description: Make the change and answer only with exact unified diffs, ready for the Diff tab to rebuild the full files
---
Make the change described in the task to the code above, and write **every code change as a unified diff**: never
whole existing files, and never the same code twice. A tool applies your diffs to the real files and rebuilds the
complete files from them. It checks every line strictly, so a diff with one wrong context line is rejected.

**Used with other skills:** they decide what to do and what else the answer holds (a root cause, a plan, review
findings, an explanation). This skill decides how code changes are written, and it wins over any other code format
they ask for, such as complete contents for new files: new files are diffs too (see below).

## Answer layout

1. A short explanation (a few sentences): what you change and why. Don't restate the code.
2. The diffs: **one fenced ```` ```diff ```` block per file**.
3. Optional: anything the user must still do (run a migration, add a package, update config) and how to check the change.

If the change needs a file that isn't shown, or lines outside the parts shown, don't guess its content. Say which
file or lines you need, and diff only what you can see.

## Diff format

````
```diff
--- a/src/Shop.Api/Services/OrderService.cs
+++ b/src/Shop.Api/Services/OrderService.cs
@@ -38,8 +38,10 @@ public class OrderService(ShopDbContext db)
 
     public async Task<Order> CreateAsync(CreateOrder cmd)
     {
+        if (cmd.Items.Count == 0)
+            throw new ValidationException("An order needs at least one item.");
         var total = cmd.Items.Sum(i => i.Price * i.Quantity);
-        var average = total / cmd.Items.Count;
+        var average = total / Math.Max(1, cmd.Items.Count);
         var order = new Order { Total = total, Average = average };
         db.Orders.Add(order);
         await db.SaveChangesAsync();
```
````

- **Paths**: `--- a/<path>` and `+++ b/<path>`, with the path exactly as written in `<file path="…">` (relative to the project, `/` separators).
- **Hunk header**: `@@ -<old start>,<old count> +<new start>,<new count> @@`. Take the start line from the file:
  - in an excerpt (`<file … lines="40-85">`) the number before `: ` on each line is the real line number;
  - in a whole file, count from line 1.
- **Line prefixes**: unchanged lines start with one space, removed lines with `-`, added lines with `+`. A blank
  unchanged line is a single space, not an empty line.
- **Context**: 3 unchanged lines before and after each change. Use more when those lines are generic (`}`, `{`, blank
  lines, `return`, `else`, `break;`) so the block appears **only once** in the file. Context lines must exist in
  the file; don't invent them.
- **Several changes in one file**: several `@@` hunks in the same block, top to bottom, not overlapping. Merge changes
  that are less than 6 lines apart into one hunk.
- **New file**: `--- /dev/null`, `+++ b/<path>`, `@@ -0,0 +1,<lines> @@`, every line starting with `+`.
- **Deleted file**: `--- a/<path>`, `+++ /dev/null`, every line of the file starting with `-`.
- **Renamed file**: a block with `diff --git a/<old> b/<new>`, then `rename from <old>` and `rename to <new>`, then
  the `---`/`+++` lines and hunks for any content changes.

## Copy context and removed lines exactly

These lines are matched against the file character by character, so copy them from the code above:

- same indentation (tabs stay tabs, spaces stay spaces, same width), same quotes, same comments, same trailing `;` and `,`;
- **remove the excerpt line numbers** (`40: `) and never copy the `...` lines that mark gaps between excerpts;
- never shorten a line, and never write `...`, `// existing code`, `// rest unchanged` or similar inside a diff;
- don't reformat, re-indent or reorder lines you aren't changing: every changed line must be a `-`/`+` pair.

Added lines follow the file's existing style: the same indentation, naming and brace layout as the code around them.

## Before you answer, check

- [ ] Every file you changed has exactly one ```` ```diff ```` block, with the path from the prompt.
- [ ] Every unchanged and removed line is a verbatim copy of the file, with no line-number prefix.
- [ ] Each hunk's context appears only once in the file, or its start line is exact.
- [ ] No whole existing file and no repeated code outside the diffs.
