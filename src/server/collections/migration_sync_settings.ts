import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: '__migration_sync_settings',
  fields: [
    { type: 'uid', name: 'collectionName', primaryKey: true, unique: true },
    { type: 'boolean', name: 'enabled' },
  ],
});
