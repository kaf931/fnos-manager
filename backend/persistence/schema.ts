/** Relational schema. JSON is reserved for task variants and scan statistics. */
export const SCHEMA_VERSION = 33;
const baseSchema = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;
CREATE TABLE icons (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
  url TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('iframe','url')),
  container_id TEXT,
  icon_source TEXT NOT NULL DEFAULT '默认图标',
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  applied_revision INTEGER NOT NULL DEFAULT 0 CHECK(applied_revision>=0),
  position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0),
  updated_at INTEGER
) STRICT;
CREATE TABLE ssh_folders (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
  scope TEXT NOT NULL CHECK(scope IN ('assets','commands')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  parent_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE(owner_uid,scope,id),
  FOREIGN KEY(owner_uid,scope,parent_id) REFERENCES ssh_folders(owner_uid,scope,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE ssh_commands (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'commands' CHECK(scope='commands'),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  content TEXT NOT NULL CHECK(length(content)>0),
  parent_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(owner_uid,scope,parent_id) REFERENCES ssh_folders(owner_uid,scope,id)
) STRICT;
CREATE TABLE ssh_connections (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK(kind IN ('local','remote')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  username TEXT NOT NULL,
  auth_method TEXT CHECK(auth_method IN ('password','privateKey')),
  credentials TEXT CHECK(credentials IS NULL OR json_valid(credentials)),
  folder_id TEXT,
  folder_scope TEXT NOT NULL DEFAULT 'assets' CHECK(folder_scope='assets'),
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(owner_uid,id),
  FOREIGN KEY(owner_uid,folder_scope,folder_id) REFERENCES ssh_folders(owner_uid,scope,id)
) STRICT;
CREATE TABLE ssh_known_hosts (
  owner_uid TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  algorithm TEXT NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY(owner_uid,host,port,algorithm)
) STRICT;
CREATE TABLE wake_devices (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  mac TEXT NOT NULL,
  address TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 9 CHECK(port BETWEEN 1 AND 65535),
  system TEXT NOT NULL DEFAULT 'linux' CHECK(system IN ('linux','windows','macos')),
  connection_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  last_wake_at INTEGER,
  last_power_at INTEGER,
  last_power_action TEXT CHECK(last_power_action IN ('reboot','shutdown')),
  UNIQUE(owner_uid,id),
  FOREIGN KEY(owner_uid,connection_id) REFERENCES ssh_connections(owner_uid,id)
) STRICT;
CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT,
  name TEXT NOT NULL CHECK(length(name)>0),
  type TEXT NOT NULL CHECK(type IN ('device-wake','device-reboot','device-shutdown','app','docker','reboot','trash-clear','log-clear','cache-clear','backup','snapshot','script')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  schedule TEXT NOT NULL CHECK(json_valid(schedule)),
  options TEXT NOT NULL CHECK(json_valid(options)),
  timeout INTEGER NOT NULL CHECK(timeout>0),
  next_run_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(owner_uid,id)
) STRICT;
CREATE TABLE task_devices (
  task_id TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  device_id TEXT,
  selected_device_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  target_snapshot TEXT NOT NULL CHECK(json_valid(target_snapshot)),
  PRIMARY KEY(task_id,selected_device_id),
  FOREIGN KEY(owner_uid,task_id) REFERENCES tasks(owner_uid,id) ON DELETE CASCADE,
  FOREIGN KEY(owner_uid,device_id) REFERENCES wake_devices(owner_uid,id)
) STRICT;
CREATE TABLE task_runs (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK(trigger IN ('manual','schedule')),
  status TEXT NOT NULL CHECK(status IN ('running','success','failed','timeout','interrupted')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  exit_code INTEGER,
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  truncated INTEGER NOT NULL DEFAULT 0 CHECK(truncated IN (0,1)),
  device_results TEXT CHECK(device_results IS NULL OR json_valid(device_results)),
  position INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE scans (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('space','duplicates')),
  path TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','done','limited','failed','cancelled','interrupted')),
  created_at INTEGER,
  finished_at INTEGER,
  error TEXT,
  limited INTEGER NOT NULL DEFAULT 0 CHECK(limited IN (0,1)),
  statistics TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(statistics)),
  result_generation INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE scan_entries (
  id INTEGER PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0,
  collection TEXT NOT NULL CHECK(collection IN ('catalog','largestFiles','topDirectories','extensions')),
  position INTEGER NOT NULL,
  name TEXT,
  path TEXT,
  type TEXT,
  size INTEGER NOT NULL DEFAULT 0 CHECK(size>=0),
  modified_at REAL,
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  UNIQUE(scan_id,generation,collection,position)
) STRICT;
CREATE TABLE duplicate_groups (
  id INTEGER PRIMARY KEY NOT NULL,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  size INTEGER NOT NULL CHECK(size>=0),
  total_count INTEGER NOT NULL CHECK(total_count>=0),
  paths_truncated INTEGER NOT NULL CHECK(paths_truncated IN (0,1)),
  UNIQUE(scan_id,generation,position)
) STRICT;
CREATE TABLE duplicate_members (
  group_id INTEGER NOT NULL REFERENCES duplicate_groups(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY(group_id,position)
) STRICT;
CREATE TABLE rename_batches (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  path TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('rename','undo')),
  status TEXT NOT NULL CHECK(status IN ('running','completed','success','partial','failed','interrupted','undone')),
  created_at INTEGER,
  finished_at INTEGER,
  undo_of TEXT,
  undone_by TEXT,
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  position INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE rename_items (
  batch_id TEXT NOT NULL REFERENCES rename_batches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  old_name TEXT,
  new_name TEXT,
  status TEXT,
  details TEXT NOT NULL CHECK(json_valid(details)),
  PRIMARY KEY(batch_id,position)
) STRICT;
CREATE TABLE official_connection (
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  connected INTEGER NOT NULL CHECK(connected IN (0,1)),
  origin TEXT,
  file_storage INTEGER NOT NULL DEFAULT 0 CHECK(file_storage IN (0,1)),
  pending_at INTEGER,
  authorization_url TEXT
) STRICT;
CREATE INDEX ssh_folders_parent ON ssh_folders(owner_uid,scope,parent_id);
CREATE INDEX ssh_commands_parent ON ssh_commands(owner_uid,parent_id,position);
CREATE INDEX ssh_connections_owner ON ssh_connections(owner_uid,position);
CREATE INDEX ssh_connections_folder ON ssh_connections(owner_uid,folder_scope,folder_id);
CREATE INDEX wake_devices_owner ON wake_devices(owner_uid,position);
CREATE INDEX wake_devices_connection ON wake_devices(owner_uid,connection_id);
CREATE INDEX tasks_due ON tasks(enabled,next_run_at);
CREATE INDEX tasks_owner ON tasks(owner_uid,position);
CREATE INDEX task_devices_device ON task_devices(owner_uid,device_id);
CREATE INDEX task_runs_history ON task_runs(task_id,started_at DESC,id);
CREATE INDEX scans_owner ON scans(owner_uid,created_at DESC,id);
CREATE INDEX scan_entries_size ON scan_entries(scan_id,generation,collection,size DESC,id);
CREATE INDEX scan_entries_name ON scan_entries(scan_id,generation,collection,name,id);
CREATE INDEX scan_entries_modified ON scan_entries(scan_id,generation,collection,modified_at DESC,id);
CREATE INDEX rename_batches_owner ON rename_batches(owner_uid,created_at DESC,id);
INSERT INTO schema_migrations VALUES(5,CAST(unixepoch('subsec')*1000 AS INTEGER));
PRAGMA user_version=5;
`;

/** Additive migration shared by fresh schema and upgrades. */
export const aiSchema = `
CREATE TABLE ai_settings (
 owner_uid TEXT PRIMARY KEY NOT NULL CHECK(length(owner_uid)>0),
 base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 1 AND 2048),
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 api_key TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL
) STRICT;
`;

export const aiProfilesSchema = `
CREATE TABLE ai_providers (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
 owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 protocol TEXT NOT NULL CHECK(protocol IN ('openai','claude','ollama','gemini','glm','minimax','deepseek','mimo')),
 base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 1 AND 2048),
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 api_key TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_uid,id)
) STRICT;
CREATE INDEX ai_providers_owner ON ai_providers(owner_uid,created_at,id);
CREATE TABLE ai_chats (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 connection_id TEXT NOT NULL,
 connection_name TEXT NOT NULL,
 title TEXT NOT NULL,
 provider_id TEXT,
 model TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_uid,id)
) STRICT;
CREATE INDEX ai_chats_history ON ai_chats(owner_uid,updated_at DESC,id);
CREATE TABLE ai_chat_messages (
 owner_uid TEXT NOT NULL,
 chat_id TEXT NOT NULL,
 id TEXT NOT NULL,
 position INTEGER NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('user','assistant','notice')),
 content TEXT NOT NULL,
 PRIMARY KEY(chat_id,id),
 FOREIGN KEY(owner_uid,chat_id) REFERENCES ai_chats(owner_uid,id) ON DELETE CASCADE
) STRICT;
CREATE INDEX ai_chat_messages_order ON ai_chat_messages(chat_id,position);
CREATE TABLE ai_chat_proposals (
 owner_uid TEXT NOT NULL,
 chat_id TEXT NOT NULL,
 id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 tool_call_id TEXT NOT NULL,
 command TEXT NOT NULL,
 explanation TEXT NOT NULL,
 position INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','running','completed','rejected','expired')),
 stdout TEXT,
 stderr TEXT,
 exit_code INTEGER,
 result_status TEXT CHECK(result_status IN ('success','failed','timeout','cancelled')),
 truncated INTEGER CHECK(truncated IN (0,1)),
 PRIMARY KEY(chat_id,id),
 FOREIGN KEY(owner_uid,chat_id) REFERENCES ai_chats(owner_uid,id) ON DELETE CASCADE,
 FOREIGN KEY(chat_id,message_id) REFERENCES ai_chat_messages(chat_id,id) ON DELETE CASCADE
) STRICT;
CREATE TABLE ai_chat_protocol (
 owner_uid TEXT NOT NULL,
 chat_id TEXT NOT NULL,
 position INTEGER NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
 content TEXT,
 tool_call_id TEXT,
 tool_calls TEXT CHECK(tool_calls IS NULL OR json_valid(tool_calls)),
 PRIMARY KEY(chat_id,position),
 FOREIGN KEY(owner_uid,chat_id) REFERENCES ai_chats(owner_uid,id) ON DELETE CASCADE
) STRICT;
`;

export const aiReasoningSchema = `
CREATE TABLE ai_providers_new (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
 owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 protocol TEXT NOT NULL CHECK(protocol IN ('openai','claude','ollama','gemini','glm','minimax','deepseek','mimo')),
 base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 1 AND 2048),
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 api_key TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_uid,id)
) STRICT;

INSERT INTO ai_providers_new SELECT * FROM ai_providers;
DROP TABLE ai_providers;
ALTER TABLE ai_providers_new RENAME TO ai_providers;
CREATE INDEX ai_providers_owner ON ai_providers(owner_uid,created_at,id);

ALTER TABLE ai_chat_protocol ADD COLUMN reasoning TEXT
  CHECK(reasoning IS NULL OR (json_valid(reasoning) AND json_type(reasoning)='object'));
`;
export const catalogSchema = `
CREATE TABLE IF NOT EXISTS command_catalog (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
 owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 command TEXT NOT NULL CHECK(length(command) BETWEEN 1 AND 300 AND instr(command,char(10))=0 AND instr(command,char(13))=0),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 300),
 category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 40),
 position INTEGER NOT NULL CHECK(position>=0),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_uid,command),
 FOREIGN KEY(owner_uid) REFERENCES user_preferences(owner_uid) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS command_catalog_owner ON command_catalog(owner_uid,position,id);
CREATE TABLE IF NOT EXISTS user_preferences (
 owner_uid TEXT PRIMARY KEY NOT NULL CHECK(length(owner_uid)>0),
 theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('system','light','dark')),
 command_hints INTEGER NOT NULL DEFAULT 1 CHECK(command_hints IN (0,1)),
 catalog_initialized INTEGER NOT NULL DEFAULT 0 CHECK(catalog_initialized IN (0,1)),
 updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS icon_images (
 icon_id TEXT PRIMARY KEY NOT NULL,
 image BLOB NOT NULL CHECK(length(image) BETWEEN 8 AND 2097152),
 FOREIGN KEY(icon_id) REFERENCES icons(id) ON DELETE CASCADE
) STRICT;
`;
export const settingsSchema = `
ALTER TABLE user_preferences ADD COLUMN default_page TEXT NOT NULL DEFAULT 'icons' CHECK(default_page IN ('icons','tasks','terminal','storage','wake'));
ALTER TABLE user_preferences ADD COLUMN navigation_motion INTEGER NOT NULL DEFAULT 1 CHECK(navigation_motion IN (0,1));
`;
export const menuEntrySchema = `ALTER TABLE icons ADD COLUMN menu_page TEXT CHECK(menu_page IS NULL OR menu_page IN ('icons','tasks','terminal','storage','wake','settings'));`;
export const aiAttachmentsSchema = `
CREATE TABLE ai_chat_attachments (
 owner_uid TEXT NOT NULL,
 chat_id TEXT NOT NULL,
 id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 protocol_position INTEGER NOT NULL CHECK(protocol_position>=0),
 position INTEGER NOT NULL CHECK(position>=0 AND position<4),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 180),
 kind TEXT NOT NULL CHECK(kind IN ('text','image')),
 mime_type TEXT NOT NULL CHECK((kind='text' AND mime_type='text/plain') OR (kind='image' AND mime_type IN ('image/png','image/jpeg','image/webp'))),
 size INTEGER NOT NULL CHECK(size>0 AND size<=2097152 AND (kind!='text' OR size<=262144)),
 storage_key TEXT NOT NULL UNIQUE CHECK(length(storage_key)=36),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 PRIMARY KEY(chat_id,id),
 UNIQUE(chat_id,message_id,position),
 FOREIGN KEY(owner_uid,chat_id) REFERENCES ai_chats(owner_uid,id) ON DELETE CASCADE,
 FOREIGN KEY(chat_id,message_id) REFERENCES ai_chat_messages(chat_id,id) ON DELETE CASCADE,
 FOREIGN KEY(chat_id,protocol_position) REFERENCES ai_chat_protocol(chat_id,position) ON DELETE CASCADE
) STRICT;
CREATE INDEX ai_chat_attachments_message ON ai_chat_attachments(chat_id,message_id,position);
`;
export const aiAttachmentCleanupSchema = `
ALTER TABLE ai_chat_attachments ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0 CHECK(created_at>=0);
ALTER TABLE ai_chat_attachments ADD COLUMN deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at>=0);
UPDATE ai_chat_attachments SET created_at=(SELECT updated_at FROM ai_chats WHERE ai_chats.id=ai_chat_attachments.chat_id);
CREATE INDEX ai_chat_attachments_owner_live ON ai_chat_attachments(owner_uid,deleted_at,created_at,id);
`;
export const aiSkillsSchema = `
CREATE TABLE ai_skills (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0),
 owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 1024),
 instructions TEXT NOT NULL CHECK(length(instructions)>0 AND length(CAST(instructions AS BLOB))<=65536),
 license TEXT,
 compatibility TEXT CHECK(compatibility IS NULL OR length(compatibility)<=500),
 metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata) AND json_type(metadata)='object'),
 allowed_tools TEXT,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_uid,name)
) STRICT;
CREATE INDEX ai_skills_owner_enabled ON ai_skills(owner_uid,enabled,name);
`;
export const aiSkillPackagesSchema = `
ALTER TABLE ai_chat_proposals ADD COLUMN action TEXT CHECK(action IS NULL OR (json_valid(action) AND json_type(action)='object'));
ALTER TABLE ai_skills ADD COLUMN kind TEXT NOT NULL DEFAULT 'document' CHECK(kind IN('document','package'));
ALTER TABLE ai_skills ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE ai_skills ADD COLUMN package_id TEXT;
CREATE UNIQUE INDEX ai_skills_owner_id ON ai_skills(owner_uid,id);
CREATE TABLE ai_skill_packages (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL,
 skill_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 source_url TEXT,
 official INTEGER NOT NULL DEFAULT 0 CHECK(official IN(0,1)),
 created_at INTEGER NOT NULL,
 UNIQUE(owner_uid,skill_id,revision),
 FOREIGN KEY(owner_uid,skill_id) REFERENCES ai_skills(owner_uid,id) ON DELETE CASCADE
) STRICT;
CREATE TABLE ai_skill_package_files (
 package_id TEXT NOT NULL REFERENCES ai_skill_packages(id) ON DELETE CASCADE,
 path TEXT NOT NULL CHECK(length(path)>0),
 size INTEGER NOT NULL CHECK(size>=0 AND size<=4194304),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 text INTEGER NOT NULL CHECK(text IN(0,1)),
 PRIMARY KEY(package_id,path)
) STRICT;
CREATE TABLE ai_skill_authorizations (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL,
 skill_id TEXT NOT NULL,
 package_id TEXT NOT NULL REFERENCES ai_skill_packages(id) ON DELETE CASCADE,
 connection_id TEXT NOT NULL,
 origin TEXT NOT NULL,
 profile TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN('disconnected','pending','connected')),
 pending_at INTEGER,
 authorization_url TEXT,
 file_storage INTEGER NOT NULL DEFAULT 0 CHECK(file_storage IN(0,1)),
 token_saved INTEGER NOT NULL DEFAULT 0 CHECK(token_saved IN(0,1)),
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_uid,connection_id,origin,package_id),
 FOREIGN KEY(owner_uid,skill_id) REFERENCES ai_skills(owner_uid,id) ON DELETE CASCADE
) STRICT;
CREATE INDEX ai_skill_authorizations_owner ON ai_skill_authorizations(owner_uid,connection_id);
`;
export const aiArchiveAttachmentsSchema = `
ALTER TABLE ai_chat_attachments RENAME TO ai_chat_attachments_old;
DROP INDEX ai_chat_attachments_message;
DROP INDEX ai_chat_attachments_owner_live;
CREATE TABLE ai_chat_attachments (
 owner_uid TEXT NOT NULL,
 chat_id TEXT NOT NULL,
 id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 protocol_position INTEGER NOT NULL CHECK(protocol_position>=0),
 position INTEGER NOT NULL CHECK(position>=0 AND position<4),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 180),
 kind TEXT NOT NULL CHECK(kind IN ('text','image','archive')),
 mime_type TEXT NOT NULL CHECK((kind='text' AND mime_type='text/plain') OR (kind='archive' AND mime_type='application/zip') OR (kind='image' AND mime_type IN ('image/png','image/jpeg','image/webp'))),
 size INTEGER NOT NULL CHECK(size>0 AND size<=4194304 AND (kind!='image' OR size<=2097152) AND (kind!='text' OR size<=262144)),
 storage_key TEXT NOT NULL UNIQUE CHECK(length(storage_key)=36),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 created_at INTEGER NOT NULL DEFAULT 0 CHECK(created_at>=0),
 deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at>=0),
 PRIMARY KEY(chat_id,id),
 UNIQUE(chat_id,message_id,position),
 FOREIGN KEY(owner_uid,chat_id) REFERENCES ai_chats(owner_uid,id) ON DELETE CASCADE,
 FOREIGN KEY(chat_id,message_id) REFERENCES ai_chat_messages(chat_id,id) ON DELETE CASCADE,
 FOREIGN KEY(chat_id,protocol_position) REFERENCES ai_chat_protocol(chat_id,position) ON DELETE CASCADE
) STRICT;
CREATE INDEX ai_chat_attachments_message ON ai_chat_attachments(chat_id,message_id,position);

CREATE INDEX ai_chat_attachments_owner_live ON ai_chat_attachments(owner_uid,deleted_at,created_at,id);
INSERT INTO ai_chat_attachments(owner_uid,chat_id,id,message_id,protocol_position,position,name,kind,mime_type,size,storage_key,sha256,created_at,deleted_at) SELECT owner_uid,chat_id,id,message_id,protocol_position,position,name,kind,mime_type,size,storage_key,sha256,created_at,deleted_at FROM ai_chat_attachments_old;
DROP TABLE ai_chat_attachments_old;
`;
export const backupSchema = `
ALTER TABLE tasks ADD COLUMN pending_reason TEXT;
CREATE TABLE backup_receipts (
 owner_uid TEXT NOT NULL,
 request_id TEXT NOT NULL,
 request_digest TEXT NOT NULL,
 package_digest TEXT NOT NULL CHECK(length(package_digest)=64),
 selection_digest TEXT NOT NULL CHECK(length(selection_digest)=64),
 result TEXT NOT NULL CHECK(json_valid(result)),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(owner_uid,request_id)
) STRICT;
`;
export const notificationOptionsSchema = `
CREATE TABLE IF NOT EXISTS notification_options (
 owner_uid TEXT PRIMARY KEY NOT NULL REFERENCES notification_settings(owner_uid) ON DELETE CASCADE,
 options TEXT NOT NULL CHECK(json_valid(options))
) STRICT;
`;
export const notificationSchema = `
CREATE TABLE notification_settings (
 owner_uid TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), url TEXT NOT NULL, token TEXT NOT NULL,
 condition TEXT NOT NULL CHECK(condition IN ('errors','all')), scan_failures INTEGER NOT NULL CHECK(scan_failures IN (0,1)), revision INTEGER NOT NULL CHECK(revision>=1)
) STRICT;
CREATE TABLE notification_deliveries (
 id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL REFERENCES notification_settings(owner_uid) ON DELETE CASCADE, event_id TEXT NOT NULL, event_type TEXT NOT NULL CHECK(event_type IN ('test','task.result','scan.failed')),
 name TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), revision INTEGER NOT NULL CHECK(revision>=1),
 status TEXT NOT NULL CHECK(status IN ('pending','sending','success','failed','cancelled')), attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), created_at INTEGER NOT NULL,
 finished_at INTEGER, next_attempt_at INTEGER, http_status INTEGER, error TEXT,
 UNIQUE(owner_uid,event_id)
) STRICT;
CREATE INDEX notification_due ON notification_deliveries(status,next_attempt_at);
CREATE INDEX notification_owner ON notification_deliveries(owner_uid,created_at);
`;
export const notificationTemplatesSchema = `
CREATE TABLE notification_templates (
 id TEXT NOT NULL, owner_uid TEXT NOT NULL, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 config TEXT NOT NULL CHECK(json_valid(config)), revision INTEGER NOT NULL CHECK(revision>=1),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_uid,id), UNIQUE(owner_uid,name)
) STRICT;
INSERT INTO notification_templates
 SELECT 'default',s.owner_uid,'默认通知',json_patch(COALESCE(o.options,'{}'),json_object(
 'enabled',json(CASE WHEN s.enabled=1 THEN 'true' ELSE 'false' END),'url',s.url,'token',s.token,
 'condition',s.condition,'scanFailures',json(CASE WHEN s.scan_failures=1 THEN 'true' ELSE 'false' END)
 )),s.revision,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)
 FROM notification_settings s LEFT JOIN notification_options o ON o.owner_uid=s.owner_uid;
ALTER TABLE notification_deliveries RENAME TO notification_deliveries_old;
DROP INDEX notification_due;
DROP INDEX notification_owner;
CREATE TABLE notification_deliveries (
 id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, template_id TEXT NOT NULL DEFAULT 'default', template_name TEXT NOT NULL DEFAULT '默认通知', channel TEXT NOT NULL DEFAULT 'webhook',
 event_id TEXT NOT NULL, event_type TEXT NOT NULL CHECK(event_type IN ('test','task.result','scan.failed')),
 name TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), revision INTEGER NOT NULL CHECK(revision>=1),
 status TEXT NOT NULL CHECK(status IN ('pending','sending','success','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),created_at INTEGER NOT NULL,
 finished_at INTEGER,next_attempt_at INTEGER,http_status INTEGER,error TEXT,
 UNIQUE(owner_uid,template_id,event_id)
) STRICT;
INSERT INTO notification_deliveries(id,owner_uid,event_id,event_type,name,payload,revision,status,attempts,created_at,finished_at,next_attempt_at,http_status,error)
 SELECT id,owner_uid,event_id,event_type,name,payload,revision,status,attempts,created_at,finished_at,next_attempt_at,http_status,error FROM notification_deliveries_old;
DROP TABLE notification_deliveries_old;
DROP TABLE notification_options;
DROP TABLE notification_settings;
CREATE INDEX notification_due ON notification_deliveries(status,next_attempt_at);
CREATE INDEX notification_owner ON notification_deliveries(owner_uid,created_at);
`;
export const notificationInboxSchema = `ALTER TABLE notification_deliveries ADD COLUMN read_at INTEGER;`;
export const reminderSchema = `
CREATE TABLE reminders (
 id TEXT NOT NULL,owner_uid TEXT NOT NULL,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 content TEXT NOT NULL CHECK(length(content)<=8000),due_at INTEGER,
 repeat TEXT NOT NULL CHECK(repeat IN ('none','daily','weekly','monthly')),
 template_ids TEXT NOT NULL CHECK(json_valid(template_ids)),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 status TEXT NOT NULL CHECK(status IN ('open','completed')),next_at INTEGER,last_fired_at INTEGER,completed_at INTEGER,
 revision INTEGER NOT NULL CHECK(revision>=1),error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(owner_uid,id), CHECK(enabled=0 OR (due_at IS NOT NULL AND status='open'))
) STRICT;
CREATE INDEX reminders_due ON reminders(enabled,status,next_at);
ALTER TABLE notification_deliveries RENAME TO notification_deliveries_before_reminders;
DROP INDEX notification_due;DROP INDEX notification_owner;
CREATE TABLE notification_deliveries (
 id TEXT PRIMARY KEY NOT NULL, owner_uid TEXT NOT NULL, template_id TEXT NOT NULL DEFAULT 'default', template_name TEXT NOT NULL DEFAULT '默认通知', channel TEXT NOT NULL DEFAULT 'webhook',
 event_id TEXT NOT NULL, event_type TEXT NOT NULL CHECK(event_type IN ('test','task.result','scan.failed','reminder.due')),
 name TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), revision INTEGER NOT NULL CHECK(revision>=1),
 status TEXT NOT NULL CHECK(status IN ('pending','sending','success','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),created_at INTEGER NOT NULL,
 finished_at INTEGER,next_attempt_at INTEGER,http_status INTEGER,error TEXT,
 UNIQUE(owner_uid,template_id,event_id)
) STRICT;
INSERT INTO notification_deliveries SELECT * FROM notification_deliveries_before_reminders;
DROP TABLE notification_deliveries_before_reminders;
CREATE INDEX notification_due ON notification_deliveries(status,next_attempt_at);
CREATE INDEX notification_owner ON notification_deliveries(owner_uid,created_at);
`;
export const operationSchema = `
CREATE TABLE operation_records (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)>0), owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 action TEXT NOT NULL CHECK(action IN ('ssh.delete','ssh.rename','storage.rename','storage.undo','storage.duplicates.delete','storage.duplicates.move','backup.restore','device.reboot','device.shutdown','ai.command','ai.skill')),
 target TEXT NOT NULL CHECK(length(target)<=120), status TEXT NOT NULL CHECK(status IN ('running','success','partial','failed','interrupted')),
 started_at INTEGER NOT NULL, finished_at INTEGER, summary TEXT NOT NULL CHECK(length(summary)<=120),
 CHECK((status='running' AND finished_at IS NULL) OR (status!='running' AND finished_at IS NOT NULL))
) STRICT;
CREATE INDEX operation_owner_time ON operation_records(owner_uid,started_at DESC,id DESC);
CREATE TABLE operation_settings (owner_uid TEXT PRIMARY KEY NOT NULL CHECK(length(owner_uid)>0), retention INTEGER NOT NULL CHECK(retention IN (100,500,1000,5000))) STRICT;
`;
export const reachabilitySchema = `
ALTER TABLE wake_devices ADD COLUMN ip TEXT;
CREATE TABLE wake_presence (
 device_id TEXT PRIMARY KEY NOT NULL REFERENCES wake_devices(id) ON DELETE CASCADE,
 target TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('online','offline','unknown')),
 reason TEXT NOT NULL CHECK(reason IN ('reply','no_reply','unavailable','no_target')),
 checked_at INTEGER NOT NULL
) STRICT;
`;
export const textVersionsSchema = `
CREATE TABLE text_file_versions (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL,
 connection_id TEXT NOT NULL REFERENCES ssh_connections(id) ON DELETE CASCADE,
 identity_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 10485760),
 encoding TEXT NOT NULL,
 bom INTEGER NOT NULL CHECK(bom IN (0,1)),
 content_hash TEXT NOT NULL
) STRICT;
CREATE INDEX text_file_versions_scope ON text_file_versions(owner_uid,connection_id,identity_hash,created_at,id);
`;
export const adbSchema = `
CREATE TABLE adb_connections (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 host TEXT NOT NULL, port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
 folder_id TEXT, device_type TEXT NOT NULL DEFAULT 'network' CHECK(device_type IN ('network','usb')),
 serial TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 folder_scope TEXT NOT NULL DEFAULT 'assets' CHECK(folder_scope='assets'),
 FOREIGN KEY(owner_uid,folder_scope,folder_id) REFERENCES ssh_folders(owner_uid,scope,id)
) STRICT;
CREATE INDEX adb_connections_owner ON adb_connections(owner_uid,folder_id);
`;
export const vncSchema = `
CREATE TABLE vnc_connections (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 host TEXT NOT NULL, port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
 username TEXT NOT NULL, password TEXT NOT NULL,
 folder_id TEXT, folder_scope TEXT NOT NULL DEFAULT 'assets' CHECK(folder_scope='assets'),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(owner_uid,folder_scope,folder_id) REFERENCES ssh_folders(owner_uid,scope,id)
) STRICT;
CREATE INDEX vnc_connections_owner ON vnc_connections(owner_uid,folder_id);
`;

export const vncPreferencesSchema = `
CREATE TABLE vnc_preferences (
 owner_uid TEXT PRIMARY KEY NOT NULL CHECK(length(owner_uid)>0),
 shared INTEGER NOT NULL CHECK(shared IN (0,1)),
 view_only INTEGER NOT NULL CHECK(view_only IN (0,1)),
 clip_viewport INTEGER NOT NULL CHECK(clip_viewport IN (0,1)),
 scale_mode TEXT NOT NULL CHECK(scale_mode IN ('off','scale','remote')),
 quality_level INTEGER NOT NULL CHECK(quality_level BETWEEN 0 AND 9),
 compression_level INTEGER NOT NULL CHECK(compression_level BETWEEN 0 AND 9),
 show_dot_cursor INTEGER NOT NULL CHECK(show_dot_cursor IN (0,1)),
 auto_reconnect INTEGER NOT NULL CHECK(auto_reconnect IN (0,1)),
 reconnect_delay INTEGER NOT NULL CHECK(reconnect_delay BETWEEN 1000 AND 60000),
 repeater_id TEXT NOT NULL CHECK(length(repeater_id)<=250 AND instr(repeater_id,char(0))=0 AND repeater_id NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || '-' || char(159) || ']*')),
 logging TEXT NOT NULL CHECK(logging IN ('error','warn','info','debug')),
 updated_at INTEGER NOT NULL
) STRICT;
`;

export const retentionSchema = `
CREATE TABLE history_limits (
 id INTEGER PRIMARY KEY CHECK(id=1),
 scans INTEGER NOT NULL CHECK(scans BETWEEN 1 AND 10000),
 renames INTEGER NOT NULL CHECK(renames BETWEEN 1 AND 10000),
 task_runs INTEGER NOT NULL CHECK(task_runs BETWEEN 1 AND 10000),
 operations INTEGER NOT NULL CHECK(operations BETWEEN 1 AND 10000),
 deliveries INTEGER NOT NULL CHECK(deliveries BETWEEN 1 AND 10000),
 restore_receipts INTEGER NOT NULL CHECK(restore_receipts BETWEEN 1 AND 10000),
 service_log_mib INTEGER NOT NULL CHECK(service_log_mib BETWEEN 1 AND 100)
) STRICT;
`;

export const vncCursorSchema = `
ALTER TABLE vnc_preferences ADD COLUMN cursor_mode TEXT NOT NULL DEFAULT 'remote' CHECK(cursor_mode IN ('local','remote'));
`;

export const rdpBaseSchema = `
CREATE TABLE rdp_connections (
 id TEXT PRIMARY KEY NOT NULL,
 owner_uid TEXT NOT NULL CHECK(length(owner_uid)>0),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 host TEXT NOT NULL, port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
 username TEXT NOT NULL, password TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '',
 folder_id TEXT, folder_scope TEXT NOT NULL DEFAULT 'assets' CHECK(folder_scope='assets'),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(owner_uid,folder_scope,folder_id) REFERENCES ssh_folders(owner_uid,scope,id)
) STRICT;
CREATE INDEX rdp_connections_owner ON rdp_connections(owner_uid,folder_id);
`;

export const rdpSecuritySchema = `
ALTER TABLE rdp_connections ADD COLUMN security TEXT NOT NULL DEFAULT 'nla' CHECK(security IN ('any','nla','tls','rdp'));
ALTER TABLE rdp_connections ADD COLUMN certificate_policy TEXT NOT NULL DEFAULT 'strict' CHECK(certificate_policy IN ('strict','tofu','ignore'));
`;

export const rdpSchema = rdpBaseSchema + rdpSecuritySchema;

export const appearanceSchema = `
ALTER TABLE user_preferences ADD COLUMN palette TEXT NOT NULL DEFAULT 'classic' CHECK(palette IN ('classic','mist','teal','default'));
ALTER TABLE user_preferences ADD COLUMN terminal_background TEXT NOT NULL DEFAULT 'striped' CHECK(terminal_background IN ('striped','solid'));
`;

export const updatePolicySchema = `
CREATE TABLE update_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 download_route TEXT NOT NULL DEFAULT 'direct' CHECK(download_route IN ('direct','mirror')),
 mode TEXT NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','auto')),
 last_version TEXT NOT NULL DEFAULT '',
 last_attempt INTEGER NOT NULL DEFAULT 0 CHECK(last_attempt>=0)
) STRICT;
`;

export const schema =
  updatePolicySchema +
  baseSchema +
  aiProfilesSchema +
  aiReasoningSchema +
  catalogSchema +
  settingsSchema +
  menuEntrySchema +
  aiAttachmentsSchema +
  aiAttachmentCleanupSchema +
  aiSkillsSchema +
  aiSkillPackagesSchema +
  aiArchiveAttachmentsSchema +
  backupSchema +
  notificationSchema +
  notificationOptionsSchema +
  notificationTemplatesSchema +
  reminderSchema +
  notificationInboxSchema +
  operationSchema +
  reachabilitySchema +
  textVersionsSchema +
  vncSchema +
  adbSchema +
  vncPreferencesSchema +
  retentionSchema +
  vncCursorSchema +
  rdpSchema +
  appearanceSchema +
  `
INSERT INTO schema_migrations VALUES(6,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(7,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(8,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(9,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(10,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(11,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(12,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(13,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(14,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(15,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(16,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(17,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(18,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(19,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(20,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(21,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(22,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(23,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(24,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(25,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(26,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(27,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(28,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(29,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(30,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(31,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(32,CAST(unixepoch('subsec')*1000 AS INTEGER));
INSERT INTO schema_migrations VALUES(33,CAST(unixepoch('subsec')*1000 AS INTEGER));
PRAGMA user_version=33;
`;
