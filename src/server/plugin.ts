import { Plugin } from '@nocobase/server';
import { runSyncPull } from './run-pull';

export class PluginMigrationServer extends Plugin {
  async load() {
    // Action handler for the /sync/pull endpoint
    // Returns a JSON dump using raw physical columns, allowing the dev side to bypass ORM bloat
    // and seamlessly trigger NocoBase's native schema synchronizer.
    const syncPullAction = async (ctx, next) => {
      const configRepo = this.db.getRepository('__migration_sync_config');
      const pullKeyObj = await configRepo.findOne({ filter: { key: 'pullKey' } });
      const pushKeyObj = await configRepo.findOne({ filter: { key: 'pushKey' } });

      const pullKey = pullKeyObj?.get('value');
      const pushKey = pushKeyObj?.get('value');
      const reqKey = ctx.request.headers['x-sync-key'];

      if (!reqKey || (!pullKey && !pushKey) || (reqKey !== pullKey && reqKey !== pushKey)) {
        ctx.throw(401, 'Unauthorized');
      }

      const userCollections = await this.app.db.getRepository('collections').find();
      const businessNames = userCollections.map((c: any) => c.name);

      const dump = {
        system: {} as Record<string, any[]>,
        business: {} as Record<string, any[]>
      };

      for (const [name, collection] of this.app.db.collections) {
        const setting = await this.app.db.getRepository('__migration_sync_settings').findOne({
          filter: { collectionName: name }
        });

        let isEnabled = true;
        if (setting) {
          isEnabled = setting.enabled;
        } else if (!businessNames.includes(name) && !['environmentVariables', 'authenticators', 'jobs'].includes(name)) {
          // system = true by default
          isEnabled = true;
        } else if (businessNames.includes(name)) {
          // business = false by default
          isEnabled = false;
        }

        if (!isEnabled) continue;

        const tableName = collection.model.tableName;

        // Skip real rows for business collections if not enabled, but here we only query if enabled
        if (isEnabled) {
          // Use raw SQL — returns plain JS objects with physical column names, no Sequelize overhead
          // sequelize.query returns [rows, metadata] tuple; QueryTypes.SELECT makes rows be plain objects
          const [rows] = (await this.app.db.sequelize.query(
            `SELECT * FROM "${tableName}"`,
            { raw: true },
          )) as [Record<string, any>[], unknown];

          const isSystem = !businessNames.includes(name);
          if (isSystem) {
            dump.system[tableName] = rows;
          } else {
            dump.business[tableName] = rows;
          }
        }
      }

      ctx.withoutDataWrapping = true;
      ctx.set('Content-Type', 'application/json');
      ctx.body = JSON.stringify(dump);
      await next();
    };
    // Action handler for triggering a pull from the UI
    const runPullAction = async (ctx, next) => {
      const { prodUrl, pullKey } = ctx.request.body;
      if (!prodUrl || !pullKey) {
        ctx.throw(400, 'prodUrl and pullKey are required');
      }
      try {
        await runSyncPull(this.app, prodUrl, pullKey);
        ctx.body = { success: true };
      } catch (e) {
        ctx.throw(500, e.message);
      }
      await next();
    };

    const listCollectionsAction = async (ctx, next) => {
      const userCollections = await this.app.db.getRepository('collections').find();
      const businessNames = userCollections.map((c: any) => c.name);

      const allCollections = [];
      for (const [name, collection] of this.app.db.collections) {
        const isBusiness = businessNames.includes(name);
        allCollections.push({
          name,
          title: collection.options?.title || name,
          isBusiness,
        });
      }

      ctx.body = allCollections;
      await next();
    };

    this.app.resourceManager.define({
      name: 'sync',
      actions: {
        pull: syncPullAction,
        runPull: runPullAction,
        listCollections: listCollectionsAction,
      },
    });

    this.app.acl.allow('sync', 'pull', 'public');
    this.app.acl.allow('sync', 'runPull', 'loggedIn');
    this.app.acl.allow('sync', 'listCollections', 'loggedIn');

    this.app.command('sync:from-prod')
      .description('Pull data from production and insert into local DB')
      .argument('[prod-url]', 'Production URL (e.g., https://prod.example.com)')
      .argument('[pull-key]', 'X-Sync-Key used for authentication')
      .action(async (prodUrlArg, pullKeyArg) => {
        try {
          const configRepo = this.app.db.getRepository('__migration_sync_config');
          const savedUrl = await configRepo.findOne({ filter: { key: 'prodUrl' } });
          const savedKey = await configRepo.findOne({ filter: { key: 'pullKey' } });

          const prodUrl = prodUrlArg || savedUrl?.value;
          const pullKey = pullKeyArg || savedKey?.value;

          if (!prodUrl || !pullKey) {
            throw new Error('prod-url and pull-key must be provided as arguments or saved in the database config.');
          }

          await runSyncPull(this.app, prodUrl, pullKey);
          process.exit(0);
        } catch (error) {
          console.error('Error during sync:', error.message);
          process.exit(1);
        }
      });
  }
}

export default PluginMigrationServer;
