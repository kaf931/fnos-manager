# AI assistant execution ledger

2026-10-21: written design and implementation plan approved; execute inline in current session. Existing workspace is not a Git repository, so no Git initialization, commits or worktree are required. Existing production schema v2 and user records must be retained. Reference research and interfaces are in the approved spec/plan.

Task 1 started: settings and additive migration. Production-model access is not configured; use local protocol mocks and real test SSH servers for implementation verification.

Tasks 1–5: RED tests observed then GREEN. Settings migration/owner/privacy: 13 targeted tests; provider and real SSH executor: 6; conversation: 3; Nest/API and existing terminal integration: 11. Full initial suite 247/247, lint passed. Task 6 frontend implements public panels, settings dialog, password visibility and pure stale-request model.

Ruling: explicit action DTO uses {confirmed:true}, rather than an empty object — gives each side-effect endpoint a meaningful validation contract and rejects injected command fields — clients must send that boolean; no extra confirmation popup is introduced.
Ruling: cap protocol context at 512 KiB before every model request — prevents unbounded session growth and expensive accidental context expansion — user must reconnect once exhausted.
Ruling: this feature releases as 0.2.12 — distinct production version for the new schema and AI functionality — runtime and manifest must match.

2026-10-21 refinement requested and authorized during release: use one application scrollbar stylesheet; fixed pending command queue above a borderless composer card (8px gap); model discovery through the configured compatible /models API with fallback to configured model; icon send/stop switch. User explicitly confirmed silent auto-execution only after selecting it, default review, scoped to the current SSH session. Message DTO carries explicit executionMode; backend default is review, silent commands run sequentially with the same ownership, cancellation and size/time/round limits. No schema change is needed for these session-only options.

Fresh review found and resolved A→B→A stale capture (monotonic selection epoch, RED/GREEN), stale model discovery after configuration changes (request generation, RED/GREEN). Browser verification found missing AI container and disabled proposal controls after request finalization; fixed both and added template mount regression. Browser mock + real SSH verified review execution/summary and explicit silent execution, shared settings and exclusive panel switching. This does not establish connectivity to a production model provider.

Final baseline after refinements: 254 tests pass before final visual-only label/width adjustments; lint/typecheck/format and final packaging are rerun below. NAS was stopped briefly for staging, then restored without applying the staged older package when the user requested refinements. No user data was removed.

Release verification: 254/254 Node tests passed; lint, typecheck and format:check passed. Final `npm run pack` completed, runtime dependency audit reported 0 vulnerabilities. Final browser screenshot: docs/screenshots/terminal-ai-review.png; model selection fetched two mock models, review queue remained above input, explicit silent turn executed and summarized successfully. Physical mobile keyboard behavior and a real external model account are not verified in this release.

NAS release completed: 0.2.12 / schema v3. Replaced generated runtime only; v2→v3 additive migration succeeded, integrity_check=ok, foreign_key_check empty, database mode0600. Every existing business-table count matched pre-update: SSH connections1, scans1, entries9223, duplicate groups32/members64 (other business tables0). ai_settings initially0. State, icons, tasks, SSH, scans, wake and AI settings API returned200; non-admin AI settings403. Served index SHA256 5127764cb1498fb8e01d469052e7014097ec3c94c70a3d12628ca81eaeaf2edf matches final local package; referenced assets200. No production model credentials configured; provider connectivity remains user-configured.
