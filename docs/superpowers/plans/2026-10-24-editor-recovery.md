# Editor Recovery Implementation Plan

> Use superpowers:subagent-driven-development; preserve current workspace and no commits.

**Goal:** Review changes before saving and recover bounded saved originals safely.
**Architecture:** Session-scoped text version service with relational repository + private raw files; existing atomic save hook; CodeMirror inline preview/history workflow.
**Tech Stack:** Nest/SQLite/TypeScript/React/CodeMirror merge.
**Spec:** docs/superpowers/specs/2026-10-24-editor-recovery-design.md

## Global Constraints
10MiB existing edit limit.10 versions/file;100 records/100MiB per owner;1000 records/1GiB global. Backup default on; failure blocks remote replace. Version bytes on disk, metadata SQLite. Restore loads draft and retains current remote revision. Existing session/identity/encoding protections remain. No git commits; SSH deployment preserving all data.

## Review Focus
- Session target/fingerprint changes cannot expose old bytes.
- Local symlinks, corruption and crash remnants fail safely and stay bounded.
- Final replace uncertainty never triggers automatic retry or backup loss.
- Edits made during request and cancelled history previews cannot be discarded by stale responses.
- Restore uses current remote revision, not historical version hash; CRLF retained.

## Tasks
- [ ] Backend: write failing tests, schema18/repository/private version store + existing save hook + scoped routes/types, backup exclusion and lifecycle. Update historical migration fixtures. Targeted tests and report; owns backend/tests only.
- [ ] Frontend: write failing component tests; add fileApi methods/contracts; CodeMirror unified preview and inline history; preserve draft/current revision, public controls. Own web + frontend tests only.
- [ ] Parent integrate dependency/lock, review, full tests/lint/types/format/pack, docs, SSH deployment and temporary-file NAS verification.

User override2026-10-24: frontend and remaining roadmap implementation written via subagents; verification/deployment deferred at explicit request. Backend task completed earlier, current aggregate unverified.
