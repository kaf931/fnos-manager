# VNC Floating Toolbar Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. User approved NAS Manager styling with noVNC-like expand/collapse interaction.

**Goal:** Keep normal VNC controls in the existing workspace rail and expose the same controls in a collapsible fullscreen overlay.

**Architecture:** One RFB instance and shared control renderer; fullscreen changes presentation only. Fullscreen contains all overlays, including clipboard, keyboard input, special-key dropdown and connection logs. Shared icons, buttons, dialog surfaces, panel headers and scrollbars remain authoritative.

**Tech Stack:** React, TypeScript, Semi Dropdown, noVNC 1.7, Fullscreen API.

- [x] Add regression tests for toolbar collapse, fullscreen overlay containment, clipboard/input/log visibility, shared connection continuity and unique tooltip IDs.
- [x] Add a focused floating toolbar component, reuse VncControls with scoped tooltips and popup container, move dialog/input into the fullscreen surface, and reuse VncLogPanel inside fullscreen.
- [x] Run focused and full tests, lint, format, types and package sequentially. Obtain a fresh read-only review.
- [x] Deploy using SSH stop/replace/start, preserve data, verify NAS UI, database, runtime and key APIs, record results.

**Execution ledger:**
- Expanded scope (user 2026-10-24): implement all remaining native client tool functions, not merely the existing subset. Add owner-scoped SQLite preferences and controlled settings UI; wire modifier keys, viewport drag, quality/compression, view-only, scale modes, shared/repeater reconnect options, auto reconnect, cursor fallback/logging, conditional power and disconnect. Existing NAS connection host/port/auth and fixed authenticated WS bridge remain authoritative. Clipboard/logs/settings use a common panel in normal and fullscreen modes. Do not execute remote power or special keys during real-device verification.
- Expanded scope verification: 658 full tests, lint, format, types and final package passed. Strict owner prefs migration19→20 tested, NAS migration retained all old business-table counts. Fresh reviewer lifecycle findings fixed with failing-then-passing regressions (disconnect generation, settings save/load revision, hidden power confirmation, countdown cancellation). Real NAS browser settings/read-only/clipboard panels/fullscreen/modifier menu/explicit disconnect and reconnect passed; no remote power/special keys executed. Final frontend and server checksums match NAS, 9 APIs200, DB integrity/FKs clean, saved defaults restored, all test connections/unsent drafts cleaned, viewport reset. Details in integration document.
- Parallel ownership: backend agent owns preference domain/migration/API/repository/tests; UI agent owns vnc-controls/settings panel/tests; main owns remote-desktop runtime/clipboard/workspace integration/CSS/deployment. No shared global builds while parallel edits are incomplete.
- Ruling: Work in the user's current dirty workspace without committing or resetting — current implementation exists in uncommitted files; creating a pristine checkout would omit required work.
- Ruling: Implement the current integrated VNC tool set in both layouts, not the complete upstream application or power controls — the accepted scope is presentation and consistent controls, with no new host-control permissions.
- Ruling: Keep fullscreen exit button and Esc; manually collapse the floating rail to a handle — always-available explicit controls avoid surprising automatic disappearance.
- Ruling: User subsequently requested removing the separate top-right exit button. Keep exit in the floating toolbar and Esc; remove the redundant markup/style, preserve tooltip labels.
- Ruling: Measured 390px fullscreen layout revealed a 6px toolbar/log-panel overlap; move the mobile panel beyond the 50px floating toolbar with an 8px gap, respecting safe-area-left.
- Verification: 641 tests passed; relevant lint/format, full type checks and packaging passed. Fresh read-only reviewer found no important issue; real-browser popup, clipboard, mobile panel and short-height checks remain for deployment validation.
- Final verification: Browser fullscreen expansion/collapse, dropdown, clipboard, input and logs passed. 390×740 log-panel gap is 8px; 740×320 toolbar buttons stay within the viewport. Separate top-right exit absent; toolbar exit and Esc passed. Viewport reset, temporary connection closed. NAS runtime0.2.53/registry0.2.52 preserved data, 8 key APIs200 and database integrity/FKs clean; dist hash matches local. Details in docs/integrations/vnc.md.
