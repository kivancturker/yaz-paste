---
name: security-review
description: Look for security vulnerabilities and explain how to fix them
---
Perform a security review of the code above.

Check for: injection (SQL, command, LDAP, XSS, template), broken authentication or authorization (missing `[Authorize]`, missing ownership checks / IDOR), unsafe deserialization, path traversal, SSRF, secrets in code or logs, weak cryptography, insecure CORS/cookie/header settings, missing input validation, and vulnerable patterns in dependencies used here.

For each issue give:
- **Severity** (Critical/High/Medium/Low) and `file:line`
- a concrete attack scenario
- the fix, as code

Only report issues you can point to in the code shown. If something depends on code that isn't included, say what you'd need to see.
