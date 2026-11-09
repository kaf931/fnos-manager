# Remote Connections Implementation Plan

> Execute with superpowers:executing-plans in the current workspace; preserve existing dirty work.

**Goal:** Integrate SSH and VNC in the existing remote connection menu.
**Architecture:** Existing SSH stack plus owner-scoped VNC repository, authenticated binary relay and shared workspace tabs.
**Tech Stack:** NestJS, TypeScript, SQLite, React, noVNC.
**Spec:** docs/superpowers/specs/2026-10-24-remote-connections.md

- [x] Remove unshipped guacd/RDP implementation and dependencies.
- [x] Add VNC domain validation, SQLite migration/repository and CRUD routes; test owner isolation/migration.
- [x] Add authenticated WebSocket/TCP relay; test short tickets, ownership, origin, binary transfer, refused connections and disconnect cleanup.
- [x] Add protocol-aware shared form/list, folder tree and noVNC workspace; preserve SSH controls and standalone entry.
- [x] Verify fixture rendering, desktop/mobile UI and complete tests/build; document target requirements and unsupported server extensions.
- [x] Deploy runtime preserving data, verify schema/integrity/endpoints and record results.
