import { Plugin } from '@nocobase/server';
import { runSyncPull } from './run-pull';

export class PluginMigrationServer extends Plugin {
  async afterAdd() {}
  async beforeLoad() {}

  async load() {
    this.app.acl.allow('migration_sync_settings', '*', 'loggedIn');
    this.app.acl.allow('migration_sync_config', '*', 'loggedIn');

    // Action handler for the /sync/pull endpoint
    const syncPullAction = async (ctx, next) => {
      const configRepo = this.app.db.getRepository('migration_sync_config');
      const pullKeyObj = await configRepo.findOne({ filter: { key: 'pullKey' } });
      const pushKeyObj = await configRepo.findOne({ filter: { key: 'pushKey' } });
      
      const pullKey = pullKeyObj?.value;
      const pushKey = pushKeyObj?.value;
      const reqKey = ctx.get('X-Sync-Key');

      if (!reqKey || (!pullKey && !pushKey) || (reqKey !== pullKey && reqKey !== pushKey)) {
        ctx.throw(401, 'Unauthorized');
      }

      const userCollections = await this.app.db.getRepository('collections').find();
      const businessNames = userCollections.map((c: any) => c.name);

      const result: Record<string, any[]> = {};
      
      for (const [name, collection] of this.app.db.collections) {
        const setting = await this.app.db.getRepository('migration_sync_settings').findOne({
          filter: { collectionName: name }
        });
        
        let isEnabled = true;
        if (setting) {
          isEnabled = setting.enabled;
        } else if (businessNames.includes(name) || name === 'environmentVariables' || name === 'authenticators') {
          isEnabled = false;
        }

        if (isEnabled) {
          if (businessNames.includes(name)) {
            result[name] = [];
          } else {
            result[name] = await collection.repository.find();
          }
        }
      }

      ctx.body = result;
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

    this.app.resourceManager.define({
      name: 'sync',
      actions: {
        pull: syncPullAction,
        runPull: runPullAction,
      },
    });

    this.app.acl.allow('sync', 'pull', 'public');
    this.app.acl.allow('sync', 'runPull', 'loggedIn');

    this.app.command('sync:from-prod')
      .description('Pull data from production and insert into local DB')
      .argument('[prod-url]', 'Production URL (e.g., https://prod.example.com)')
      .argument('[pull-key]', 'X-Sync-Key used for authentication')
      .action(async (prodUrlArg, pullKeyArg) => {
        try {
          const configRepo = this.app.db.getRepository('migration_sync_config');
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

  async install() {}
  async afterEnable() {}
  async afterDisable() {}
  async remove() {}
}

export default PluginMigrationServer;
