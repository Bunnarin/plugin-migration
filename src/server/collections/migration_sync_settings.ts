import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'migration_sync_settings',
  fields: [
    { type: 'uid', name: 'collectionName', primaryKey: true },
    { type: 'boolean', name: 'enabled' },
  ],
});
