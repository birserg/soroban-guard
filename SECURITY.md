# Security Policy

**Scope:** soroban-guard checks SEP-41 *conformance* (does the contract
behave per spec?). It is not a security audit: a passing report says
nothing about admin powers, upgradeability, or economic safety.

**Rules for operators:** testnet only. Never place mainnet secret keys in
`.env` or anywhere near this tool.

**Reporting a vulnerability:** please use GitHub's private vulnerability
reporting (Security tab → Report a vulnerability) so details stay private
until fixed. Do not open public issues for security reports.
