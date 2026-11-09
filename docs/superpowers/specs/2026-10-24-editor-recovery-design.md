# Online file editor recovery

Approved roadmap item5. Preserve existing uncommitted work and NAS data; implement inline with shared UI and strict types.

Existing read/save checks ownership/session, regular files only, <=10MiB, supported encodings/BOM and hash+metadata revision, final same-directory OpenSSH atomic replace. Keep all protections. No automatic overwrite on conflict.

UI save opens inline read-only unified diff preview inside same editor dialog. Original loaded file vs exact captured draft, confirm save/back to editing; never loses edits on errors/disconnect. Default checkbox '保留修改前版本' enabled, can disable for save; not persisted preference. Changes made after preview must invalidate/recreate preview; freeze editing while preview. Use CodeMirror official @codemirror/merge unifiedMergeView, no accept/reject chunk controls, collapse unchanged, bounded diffConfig scanLimit500 timeout100. Preserve CRLF/BOM/codecs. Existing keyboard Mod-S triggers preview, not bypass.

History button opens inline list (no nested dialog). Rows time,size,encoding; max10 per file. Selecting version loads read-only diff current remote baseline vs selected original. '载入编辑' after discard confirmation if dirty, replaces draft only; retains CURRENT remote revision for future save. Cancel returns draft untouched. Version payload revision must never replace current remote revision. Normal save of restored draft backs up current remote original by default. Session invalidation disables all remote actions, leaves draft available. Modal public controls/styles, no separate duplicated design system.

Server persist metadata in SQLite schema18 text_file_versions, raw bytes private files under dataDir/editor-versions (dir0700/file0600, random opaque IDs, no user paths in local storage names). Bind history to owner, saved connection ID, actual host/port/username and accepted host fingerprint plus normalized remote path (hash okay); not merely connection ID. No credentials stored in version metadata. Reconnect same identity retrieves history; different account/target/path/fingerprint cannot. Deleting connection removes associated metadata; orphan raw bytes cleaned safely on startup/capture. Directory traversal/symlinks locally rejected. No raw version data in configuration exports.

Limits: per file10 versions, per owner100 records and100MiB, application1000 records and1GiB. Oldest eligible records pruned by repository+storage workflow with explicit ordering; never silently skip requested backup to allow write. If requested capture fails, no remote mutation. Capture exact original bytes inside existing save write lock after initial revision+permission checks and before final replace; before-write failure may leave a useful checkpoint, no false claim remote save succeeded. File/index crash remnants reconciled at startup, no growth from repeated failures; fail closed on unreadable backup store. Lifecycle must drain pending version writes before DB close.

APIs under existing session files guard:
POST .../files/text body existing+backup?:boolean (default true in production).
GET .../files/text/versions?path=... -> {items: TextFileVersion[]}.
GET .../files/text/versions/:versionId?path=... -> RemoteTextFile.
DELETE .../files/text/versions/:versionId?path=... ->204 (remove local checkpoint only).
TextFileVersion {id:string,createdAt:string,size:number,encoding:string,bom:boolean} shared browser-safe domain.
Read/list/delete require valid connected owned session and access to current regular remote file. A vanished/renamed file is not recreated implicitly by restore.

Test raw-byte encoding/BOM preservation, backup failure leaves remote intact, conflict creates no misleading write, quota pruning/restart/corruption, owner/path/fingerprint isolation and DTO/CSRF, UI preview/back/save failure/restore revision/disconnect. Safe NAS test temporary remote file only, clean test histories/files after; no power tasks. Full verification then SSH stop/replace/start update runtime0.2.53 preserving data; record actual registry0.2.52.
