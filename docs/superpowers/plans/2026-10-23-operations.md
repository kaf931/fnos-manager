# Unified Operations Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Preserve existing uncommitted changes; no commits.

**Goal:** Auditable, account-isolated safe operation summaries and UI.
**Architecture:** Explicit execution hooks backed by relational SQLite repository; Nest routes and shared React dialog.
**Tech Stack:** TypeScript/Nest/SQLite/React.
**Spec:** docs/superpowers/specs/2026-10-23-operations-design.md

## Global Constraints
- Defaults1000 retained terminal rows per owner; choices100/500/1000/5000.
- Never store command/output/credentials/full paths/raw errors.
- Never repeat side effects due to record failure. Preserve prior work and NAS data; SSH deployment only.

## Review Focus
- Both AI silent and confirmed execution recorded once.
- Batch partial failure and retry/undo reflect actual result.
- Owner filtering applies to settings and histories; no cross-user target leaks.
- Crash leaves interrupted/unknown outcome, never fake success.
- Schema14/15 upgrades preserve existing user records.

## Tasks
- [x] Backend: domain/operations.ts, persistence/operation.repository.ts, operations service, app/operations module/controller/dto; schema16; explicit hooks for all spec operations. Unit/API/lifecycle/integration tests.
  API GET /operations?page=1&pageSize=10&action=all&status=all returns {items,total,page,pageSize}. GET/PUT /operations/settings {retention:100|500|1000|5000}. Domain OperationRecord {id,ownerUid,action,target,status,startedAt,finishedAt,summary}; fixed enum actions. Publish exact types early.
- [x] Frontend web/operation-records.tsx mountOperationRecords({api,toast}).open(), system settings entry; filters/table/pagination/retention using existing public UI; component tests.
- [x] Integrate historical migration fixtures, independent review, full tests/typecheck/lint/format/pack, docs; SSH deploy and verify counts/integrity/interfaces.
