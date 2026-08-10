import React, { useEffect, useState } from 'react';
import { useAPIClient } from '@nocobase/client';
import { Spin, Table, Switch, message, Typography, Input, Button, Card, Space, Form } from 'antd';

export const MigrationSettingsPage = () => {
  const api = useAPIClient();

  let migrationConfigs = []

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [allCollections, setAllCollections] = useState<any[]>([]);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [pulling, setPulling] = useState(false);
  const [isBusiness, setIsBusiness] = useState(false);

  const [form] = Form.useForm();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [settingsRes, collectionsRes, configRes] = await Promise.all([
          api.request({
            url: '__migration_sync_settings:list',
            params: { paginate: false },
          }),
          api.request({
            url: 'sync:listCollections',
          }),
          api.request({
            url: '__migration_sync_config:list',
            params: { paginate: false },
          })
        ]);

        setAllCollections(collectionsRes.data.data || []);

        const settingsMap: Record<string, boolean> = {};
        settingsRes.data.data.forEach((s: any) => {
          settingsMap[s.collectionName] = s.enabled;
        });
        setSettings(settingsMap);

        migrationConfigs = configRes.data.data;
        const configMap: Record<string, string> = {};
        migrationConfigs.forEach((c: any) => {
          configMap[c.key] = c.value;
        });
        form.setFieldsValue(configMap);

      } catch (err) {
        console.error(err);
        message.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [api, form]);

  const handleToggle = async (collectionName: string, enabled: boolean) => {
    setUpdating(prev => ({ ...prev, [collectionName]: true }));
    try {
      if (settings.hasOwnProperty(collectionName)) {
        await api.request({
          url: `__migration_sync_settings:update`,
          method: 'post',
          params: {
            filter: {
              collectionName
            }
          },
          data: { enabled },
        });
      } else {
        await api.request({
          url: `__migration_sync_settings:create`,
          method: 'post',
          data: { collectionName, enabled },
        });
      }
      setSettings(prev => ({ ...prev, [collectionName]: enabled }));
      message.success('Setting updated');
    } catch (err) {
      console.error(err);
      message.error('Failed to update setting');
    } finally {
      setUpdating(prev => ({ ...prev, [collectionName]: false }));
    }
  };

  const handleSaveConfig = async (key: string, value: string) => {
    try {
      // Create or update the config key
      // NocoBase collection with primaryKey 'key'
      if (migrationConfigs.find((c: any) => c.key === key)) {
        await api.request({
          url: `__migration_sync_config:update`,
          method: 'post',
          params: {
            filter: {
              key
            }
          },
          data: { value },
        });
        migrationConfigs = migrationConfigs.map((c: any) => {
          if (c.key === key) {
            c.value = value;
          }
          return c;
        });
      } else {
        await api.request({
          url: `__migration_sync_config:create`,
          method: 'post',
          data: { key, value },
        });
      }
      message.success(`Saved ${key}`);
    } catch (err) {
      console.error(err);
      message.error(`Failed to save ${key}`);
    }
  };

  const handlePull = async () => {
    const values = form.getFieldsValue();
    if (!values.prodUrl || !values.pullKey) {
      message.warning('Production URL and Pull Key are required to pull data.');
      return;
    }

    setPulling(true);
    try {
      await api.request({
        url: 'sync:runPull',
        method: 'post',
        data: {
          prodUrl: values.prodUrl,
          pullKey: values.pullKey,
        },
      });
      message.success('Successfully pulled and synced data from production!');
    } catch (err: any) {
      console.error(err);
      message.error(err?.response?.data?.errors?.[0]?.message || err?.message || 'Failed to pull data');
    } finally {
      setPulling(false);
    }
  };

  if (loading) {
    return <Spin style={{ margin: 24 }} />;
  }

  const tableData = allCollections.map(c => {
    const name = c.name;
    const isBusiness = c.isBusiness;

    let defaultOn = true;
    if (isBusiness || name === 'environmentVariables' || name === 'authenticators') {
      defaultOn = false;
    }

    const enabled = settings.hasOwnProperty(name) ? settings[name] : defaultOn;

    return {
      key: name,
      name,
      title: c.title || c.name,
      isBusiness,
      enabled,
    };
  });

  const columns = [
    {
      title: 'Collection Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
    },
    {
      title: 'Sync Export Enabled',
      key: 'action',
      render: (_, record) => (
        <Switch
          checked={record.enabled}
          loading={updating[record.name]}
          onChange={(checked) => handleToggle(record.name, checked)}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100vh' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card title="Database Pull Operation">
          <Form form={form} layout="vertical">
            <Form.Item label="Production URL (Dev Side)" name="prodUrl">
              <Input
                placeholder="https://prod.example.com"
                onBlur={(e) => handleSaveConfig('prodUrl', e.target.value)}
              />
            </Form.Item>
            <Form.Item label="Pull Key (Used by both Dev and Prod)" name="pullKey">
              <Input.Password
                placeholder="Secret pull key"
                onBlur={(e) => handleSaveConfig('pullKey', e.target.value)}
              />
            </Form.Item>
            <Form.Item label="Push Key (Prod Side Only)" name="pushKey">
              <Input.Password
                placeholder="Secret push key (Reserved for future)"
                onBlur={(e) => handleSaveConfig('pushKey', e.target.value)}
              />
            </Form.Item>
            <Button type="primary" onClick={handlePull} loading={pulling}>
              Pull from Prod
            </Button>
          </Form>
        </Card>

        <Card title="Production Export Settings">
          <Typography.Paragraph>
            Configure which tables are exported when this server acts as Production and the `/api/sync:pull` endpoint is called.
            Business collections are not exported with real rows; they trigger mock data generation on the dev side.
          </Typography.Paragraph>
          <Switch
            checked={isBusiness}
            onChange={(checked) => setIsBusiness(checked)}
            checkedChildren="Business Collections"
            unCheckedChildren="System Collections"
          />
          <Table
            dataSource={tableData.filter(i => i.isBusiness == isBusiness)}
            columns={columns}
            size="small"
            pagination={false}
          />
        </Card>
      </Space>
    </div>
  );
};

