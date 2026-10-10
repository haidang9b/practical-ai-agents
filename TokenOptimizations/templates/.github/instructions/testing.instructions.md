---
applyTo: "**/*.test.*,**/*.spec.*,**/test_*.py,**/*_test.py,**/*_test.go,**/tests/**,**/__tests__/**"
description: Test-editing rules, loaded only when test files are created or modified.
---
- Run only the test file you touched: `node .tokenkit/tk.mjs run -- <runner> <file>`.
- Fix the first failure first; later failures are often cascades.
- Reuse existing fixtures and helpers (grep before writing new ones). Don't duplicate setup.
- Assert behavior, not implementation details. One behavior per test.
