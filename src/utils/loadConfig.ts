import fs from 'fs';
import path from 'path';

import * as core from '@actions/core';

import { SiteConfig } from '../types';

export const getDefaultConfig = (): SiteConfig => ({
  network: 'testnet',
  owner: '',
  site_name: 'default-site',
  metadata: {
    link: '',
    image_url: '',
    name: 'Walrus Site',
    description: '',
    project_url: '',
    creator: '',
  },
  epochs: 30,
  path: './dist',
  gas_budget: 100000000,
});

export const loadConfig = (): SiteConfig => {
  const resolvedPath = path.resolve('./site.config.json');

  if (!fs.existsSync(resolvedPath)) {
    core.warning(`[walrus] Config file not found. Using default config.`);
    return getDefaultConfig();
  }

  try {
    const data = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(data);
    return {
      ...getDefaultConfig(),
      ...parsed,
      metadata: {
        ...getDefaultConfig().metadata,
        ...(parsed.metadata || {}),
      },
    };
  } catch (err) {
    core.warning(`[walrus] Failed to load config: ${(err as Error).message}`);
    core.warning('Using default config instead. Make sure your config is valid JSON.');
    return getDefaultConfig();
  }
};
