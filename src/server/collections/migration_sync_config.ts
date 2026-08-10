import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: '__migration_sync_config',
  fields: [
    { type: 'uid', name: 'key', primaryKey: true, unique: true },
    { type: 'string', name: 'value' },
  ],
});
