import type { Application } from '@nocobase/server';

export async function runSyncPull(app: Application, prodUrl: string, pullKey: string) {
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
        await app.pm.enable(packageName)
      } catch {
        console.log("couldn't pull/enable ", packageName)
      }
    }
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
    await qi.bulkDelete(tableName, {});

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

  // set the highest ID as the nextval
  await app.db.sequelize.query(`
    DO $$
      DECLARE
          r RECORD;
      BEGIN
          FOR r IN
              SELECT table_schema, table_name, column_name
              FROM information_schema.columns
              WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                AND (
                    column_default LIKE 'nextval%'
                    OR is_identity = 'YES'
                )
          LOOP
              EXECUTE format(
                  'SELECT setval(pg_get_serial_sequence(%L, %L), COALESCE(MAX(%s), 1), MAX(%s) IS NOT NULL) FROM %s.%s',
                  r.table_schema || '.' || quote_ident(r.table_name),
                  quote_ident(r.column_name),
                  quote_ident(r.column_name),
                  quote_ident(r.column_name),
                  quote_ident(r.table_schema),
                  quote_ident(r.table_name)
              );
          END LOOP;
      END $$;
  `)

  // change the root password to be the pullkey
  const userRepo = app.db.getRepository('users');
  const user = await userRepo.findOne({ filterByTk: 1 });
  if (user) {
    console.log('[Sync] changing root password to ', pullKey)
    user.set('password', pullKey)
    await user.save()
  }

  console.log('[Sync] Import completed successfully. Restarting server...');
  setTimeout(() => process.exit(0), 500);
  return true;
}
