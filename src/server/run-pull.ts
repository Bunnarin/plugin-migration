// import { chunk } from 'lodash';

export async function runSyncPull(app: any, prodUrl: string, pullKey: string) {
  if (process.env.APP_ENV !== 'development')
    throw new Error('APP_ENV must be development to run this action');

  console.log(`[Sync] Fetching dump from ${prodUrl}...`);
  const baseUrl = prodUrl.replace(/\/$/, '');

  const response = await fetch(`${baseUrl}/api/sync:pull`, {
    headers: {
      'X-Sync-Key': pullKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
  }

  const dump = await response.json();
  console.log(`[Sync] Received dump. Applying to local DB...`);

  // 0.  user must enable manually
  const plugins = dump.system?.applicationPlugins || [];
  const pluginsToBePulled = plugins.filter(plugin => plugin.enabled && !app.pm.has(plugin.packageName)).map(plugin => plugin.packageName);
  if (pluginsToBePulled.length > 0) {
    for (const packageName of pluginsToBePulled) {
      try {
        console.log('pulling: ', packageName)
        await app.pm.pull(packageName, { registry: 'https://registry.npmjs.org/', packageName })
      } catch {
        console.log("couldn't pull ", packageName)
      }
    }
    console.log('enabling everything')
    await app.pm.enable('*')
  }

  // Helper to process bulk inserts
  // do applicationPlugins first and exlude it from the loop
  const insertCollection = async (tableName: string, rows: any[]) => {
    if (!rows || rows.length === 0) return;
    console.log(`[Sync] Restoring table: ${tableName} (${rows.length} rows)`);

    // app.reload() creates a new database connection pool. 
    // We must grab the fresh query interface dynamically every time.
    const qi = app.db.sequelize.getQueryInterface();

    // Truncate existing data safely
    await qi.bulkDelete(tableName, {}, { truncate: true, cascade: true });

    // Fix null sort values and stringify JSON objects for low-level bulkInsert
    rows.forEach((r, idx) => {
      if (Object.prototype.hasOwnProperty.call(r, 'sort') && r.sort === null) {
        r.sort = idx + 1;
      }
      for (const key of Object.keys(r)) {
        const val = r[key];
        // Sequelize's queryInterface.bulkInsert doesn't know column types.
        // It throws 'Invalid value' if it encounters a plain JS object/array.
        // We must stringify them so the pg driver accepts them for JSONB columns.
        if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
          r[key] = JSON.stringify(val);
        }
      }
    });

    // Chunk the inserts to avoid memory spikes / query size limits
    await qi.bulkInsert(tableName, rows);
    // const batches = chunk(rows, 1000);
    // for (const batch of batches) {
    //   await qi.bulkInsert(tableName, batch);
    // }
  };

  // 1. Process System Collections
  // We must process these first so NocoBase learns about schema changes (new tables/columns)
  for (const [tableName, rows] of Object.entries(dump.system || {})) {
    if (tableName == 'applicationPlugins')
      continue
    await insertCollection(tableName, rows as any[]);
  }

  // 2. Trigger NocoBase Schema Evolution
  console.log(`[Sync] Reloading app to ingest new schema metadata...`);
  await app.reload();
  await (app.db.getRepository('collections') as any).load();

  console.log(`[Sync] Synchronizing physical database schema...`);
  await app.db.sync(); // Creates any missing tables or columns on the dev side

  // 3. Process Business Collections
  for (const [tableName, rows] of Object.entries(dump.business || {})) {
    await insertCollection(tableName, rows as any[]);
  }

  console.log('[Sync] Import completed successfully. Restarting server...');
  setTimeout(() => process.exit(0), 500);
  return true;
}
