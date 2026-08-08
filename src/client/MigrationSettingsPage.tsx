import React, { useEffect, useState } from 'react';
import { useAPIClient, useCollections } from '@nocobase/client';
import { Spin, Table, Switch, message, Typography, Input, Button, Card, Space, Form } from 'antd';

export const MigrationSettingsPage = () => {
  const api = useAPIClient();
  const collections = useCollections();
  
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [businessNames, setBusinessNames] = useState<string[]>([]);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [pulling, setPulling] = useState(false);

  const [form] = Form.useForm();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [settingsRes, collectionsRes, configRes] = await Promise.all([
          api.request({
            url: 'migration_sync_settings:list',
            params: { paginate: false },
          }),
          api.request({
            url: 'collections:list',
            params: { paginate: false },
          }),
          api.request({
            url: 'migration_sync_config:list',
            params: { paginate: false },
          })
        ]);
        
        const bNames = collectionsRes.data.data.map((c: any) => c.name);
        setBusinessNames(bNames);

        const settingsMap: Record<string, boolean> = {};
        settingsRes.data.data.forEach((s: any) => {
          settingsMap[s.collectionName] = s.enabled;
        });
        setSettings(settingsMap);

        const configMap: Record<string, string> = {};
        configRes.data.data.forEach((c: any) => {
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
          url: `migration_sync_settings:update/${collectionName}`,
          method: 'put',
          data: { enabled },
        });
      } else {
        await api.request({
          url: `migration_sync_settings:create`,
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
      try {
        await api.request({
          url: `migration_sync_config:update/${key}`,
          method: 'put',
          data: { value },
        });
      } catch (e: any) {
        if (e?.response?.status === 404 || e?.response?.status === 400) {
          await api.request({
            url: `migration_sync_config:create`,
            method: 'post',
            data: { key, value },
          });
        } else {
          throw e;
        }
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

  const tableData = collections.map(c => {
    const name = c.name;
    const isBusiness = businessNames.includes(name);
    
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
      title: 'Type',
      key: 'type',
      render: (_, record) => record.isBusiness ? 'User Created (Business)' : 'System',
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
        <Card title="Database Pull Operation" bordered={false}>
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

        <Card title="Production Export Settings" bordered={false}>
          <Typography.Paragraph>
            Configure which tables are exported when this server acts as Production and the `/api/sync:pull` endpoint is called.
            Business collections are not exported with real rows; they trigger mock data generation on the dev side.
          </Typography.Paragraph>
          <Table 
            dataSource={tableData} 
            columns={columns} 
            pagination={{ pageSize: 100 }} 
            size="small"
          />
        </Card>
      </Space>
    </div>
  );
};

