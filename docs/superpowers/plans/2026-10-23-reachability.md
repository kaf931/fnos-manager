# Device Reachability Implementation Plan

> Use superpowers:subagent-driven-development. Continue current workspace, no commits.

**Goal:** Accurate bounded reachability in network wake cards.
**Architecture:** Dedicated probe service + relational status persistence, explicit WakeService hooks; existing shared UI.
**Tech Stack:** Nest/TypeScript/SQLite/React.
**Spec:** docs/superpowers/specs/2026-10-23-reachability-design.md

## Global Constraints
Private unicast IPv4 only. Broadcast address never probed. No-response is not power-off proof. 4 concurrent probes,3s probe timeout,5s cooldown,120s stale. Followups5/15/30s stop online. No SSH login, power or wake retry. Keep data, version0.2.53, SSH deployment only.

## Review Focus
- Changed connection/IP or deleted device during probe must not publish stale results.
- All selected IDs owner validated before probes; global concurrent/cooldown limits.
- Shutdown cancels timers/processes and awaits writes.
- Backup includes IP not reachability; historical migration fixtures remain representative.
- Hidden menu polling stops, duplicate refresh and stale responses do not repaint old UI.

## Tasks
- [x] Backend implementer: failing tests, probe/service/repository/schema17, WakeService/API/DTO/backup wiring, migration fixtures. Publish domain contract early; backend report and targeted test evidence. Own backend and backend tests only.
- [x] Parent frontend: failing UI tests then status helper/manual refresh/action/editor/discovery wiring using domain contract. Run targeted UI tests/typecheck.
- [x] Review all changes; fix blocking issues; full tests/lint/format/types/pack. Update docs and SSH deploy, verify DB/counts/routes and safe real probes; mark complete.
