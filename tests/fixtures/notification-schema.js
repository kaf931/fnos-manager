import {
  notificationSchema,
  notificationOptionsSchema,
  notificationTemplatesSchema,
  reminderSchema,
  notificationInboxSchema,
  notificationTemplateOrderSchema,
} from '../../server/persistence/schema.js';
export function beforeInboxSchema(schema) {
  return schema
    .replace(notificationTemplateOrderSchema, '')
    .replace(/INSERT INTO schema_migrations VALUES\(34[^;]*;/, '')
    .replace('PRAGMA user_version=34', 'PRAGMA user_version=33')
    .replace(notificationInboxSchema, '')
    .replace(/INSERT INTO schema_migrations VALUES\(33[^;]*;/, '')
    .replace('PRAGMA user_version=33', 'PRAGMA user_version=32');
}
export function beforeRemindersSchema(schema) {
  return beforeInboxSchema(schema)
    .replace(reminderSchema, '')
    .replace(/INSERT INTO schema_migrations VALUES\(32[^;]*;/, '')
    .replace('PRAGMA user_version=32', 'PRAGMA user_version=31');
}
export function legacyNotificationSchema(schema) {
  return beforeRemindersSchema(schema)
    .replace(notificationTemplatesSchema, '')
    .replace(/INSERT INTO schema_migrations VALUES\(31[^;]*;/, '')
    .replace('PRAGMA user_version=31', 'PRAGMA user_version=30');
}
// Reconstruct the old notification tables when another subsystem's migration fixture rolls a current database back.
export const legacyNotificationReset = `DROP TABLE IF EXISTS notification_template_order; DELETE FROM schema_migrations WHERE version=34;

DELETE FROM schema_migrations WHERE version=33;
DROP TABLE IF EXISTS reminders; DELETE FROM schema_migrations WHERE version=32;
ALTER TABLE notification_deliveries RENAME TO template_deliveries_fixture;
DROP INDEX notification_due;DROP INDEX notification_owner;
${notificationSchema}${notificationOptionsSchema}
INSERT INTO notification_settings SELECT owner_uid,COALESCE(json_extract(config,'$.enabled'),0),COALESCE(json_extract(config,'$.url'),''),COALESCE(json_extract(config,'$.token'),''),COALESCE(json_extract(config,'$.condition'),'errors'),COALESCE(json_extract(config,'$.scanFailures'),1),revision FROM notification_templates WHERE id='default';
INSERT INTO notification_options SELECT owner_uid,config FROM notification_templates WHERE id='default';
INSERT INTO notification_deliveries SELECT id,owner_uid,event_id,event_type,name,payload,revision,status,attempts,created_at,finished_at,next_attempt_at,http_status,error FROM template_deliveries_fixture WHERE template_id='default' AND owner_uid IN(SELECT owner_uid FROM notification_settings);
DROP TABLE template_deliveries_fixture;DROP TABLE notification_templates;
DELETE FROM schema_migrations WHERE version=31;
`;
