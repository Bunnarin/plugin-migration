import { generateMockData } from './mock-data';

export async function runSyncPull(app: any, prodUrl: string, pullKey: string) {
  console.log(`[Sync] Fetching data from ${prodUrl}...`);
  const baseUrl = prodUrl.replace(/\/$/, '');
  
  const response = await fetch(`${baseUrl}/api/sync:pull`, {
    headers: {
      'X-Sync-Key': pullKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const receivedCollections = Object.keys(data);
  console.log(`[Sync] Received ${receivedCollections.length} collections. Beginning selective overwrite...`);

  const userCollections = await app.db.getRepository('collections').find();
  const businessNames = userCollections.map((c: any) => c.name);

  for (const collectionName of receivedCollections) {
    const rows = data[collectionName];
    const collection = app.db.getCollection(collectionName);
    
    if (!collection) {
      console.warn(`[Sync] Collection ${collectionName} not found locally, skipping...`);
      continue;
    }

    console.log(`[Sync] Syncing collection ${collectionName}...`);
    await collection.repository.destroy({ truncate: true });

    if (collectionName === 'applicationPlugins') {
      for (const pluginRow of rows) {
        await collection.repository.create({ values: pluginRow });
        if (pluginRow.enabled) {
          await collection.repository.update({ 
            filter: { name: pluginRow.name }, 
            values: { enabled: false } 
          });

          if (!app.pm.has(pluginRow.name)) {
            console.error(`[Sync] FATAL: Pulled plugin ${pluginRow.name} is enabled on prod but not installed locally.`);
            throw new Error(`Plugin ${pluginRow.name} missing locally.`);
          }
          
          console.log(`[Sync] Running enable hooks for plugin: ${pluginRow.name}...`);
          await app.pm.enable(pluginRow.name);
        }
      }
      continue;
    }

    if (businessNames.includes(collectionName)) {
       console.log(`[Sync] Business collection ${collectionName} detected. Generating mock data...`);
       const mockRows = await generateMockData(collection, 10);
       if (mockRows.length > 0) {
         await collection.repository.create({ values: mockRows });
       }
    } else if (rows.length > 0) {
       await collection.repository.create({ values: rows });
    }
  }
  console.log('[Sync] Sync completed successfully.');
  return true;
}
