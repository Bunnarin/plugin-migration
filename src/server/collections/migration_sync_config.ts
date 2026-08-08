import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'migration_sync_config',
  fields: [
    { type: 'uid', name: 'key', primaryKey: true },
    { type: 'string', name: 'value' },
  ],
});
