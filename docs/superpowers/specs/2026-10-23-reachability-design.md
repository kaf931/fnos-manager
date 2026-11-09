# Device reachability

Continue approved roadmap item4 in existing workspace, preserve unrelated work and data.

Device broadcast address is not a host. Add optional `ip` private unicast IPv4 (empty allowed) to WakeDevice, editor, discovery import and config backup. If empty, use associated remote SSH connection host only if private unicast IPv4; otherwise unknown with no target. Do not DNS resolve or authenticate/execute SSH for probing.

Use bounded Linux ping via execFile argument array, never shell. Echo reply => online; ordinary no-reply => offline (UI: 未响应, explicitly not proof powered off); missing ping, permission/error, invalid target => unknown. State has checkedAt and reason enum; no raw process output. Per probe timeout3s, four global concurrent probes maximum; deduplicate same device in flight, rate-limit repeated manual probes (5s per device). Validate all IDs/owner before work; limit50 IDs. Return current saved results. Status older than120s shows unknown with last detection time. Persist last result/target in SQLite with FK cascade; changed IP/connection/MAC invalidates cached/inflight result. SSH host changes also invalidate by target comparison.

POST /wake/check {ids:string[]} -> WakeDevice[] (requested rows, each includes optional `presence` and `checking:boolean`). GET devices stays read-only, exposes latest result and bounded followup activity. Presence {state:'online'|'offline'|'unknown',checkedAt:string,reason:'reply'|'no_reply'|'unavailable'|'no_target'}.

Successful WOL send schedules background check after5s,15s,30s (stop once online). No retry of WOL and no claiming wake success from UDP send. Queues cancelled on remove/edit/service shutdown, no poll restarted on server startup. Scheduled wake uses same path. Lifecycle tracked, no unhandled rejection or DB write after close. Persisted results excluded from backup; ip included.

UI reuses shared card meta and action icons. Show status/time (tooltip), checking feedback, manual per-card check action and refresh checks devices in bounded chunks, entering menu loads + checks; only poll list while visible/automatic rechecks running, cleanup timers when leaving. Avoid status-repaint layout jumps, preserve existing device actions and search. Optional device IP field, scan auto populates it. No custom CSS.

Schema17 adds one relational status table and optional device IP via safe migration, existing device records remain. Tests cover private IP validation, no broadcast probe, result classification, concurrency/rate/ownership/edit/delete/shutdown races, followup stopping, persistence/migration, backup roundtrip and frontend feedback. Deploy SSH stop/replace/start preserving data; safe NAS probes only, no real wake/power commands required.
