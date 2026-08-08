import { Plugin } from '@nocobase/client';
import models from './models';

import { MigrationSettingsPage } from './MigrationSettingsPage';

export class PluginMigrationClient extends Plugin {
  async load() {
    this.flowEngine.registerModels(models);

    this.app.pluginSettingsManager.add('plugin-migration', {
      title: 'Sync Settings',
      icon: 'SyncOutlined',
      Component: MigrationSettingsPage,
    });
  }
}

export default PluginMigrationClient;
