import fs from 'fs';
import os from 'os';
import path from 'path';

import { jest } from '@jest/globals';

const mockCore = {
  info: jest.fn<(message: string) => void>(),
  setFailed: jest.fn<(message: string) => void>(),
};

jest.unstable_mockModule('@actions/core', () => mockCore);

let groupFilesBySize: typeof import('./groupFilesBySize').groupFilesBySize;

describe('groupFilesBySize', () => {
  let siteRoot: string;

  beforeAll(async () => {
    ({ groupFilesBySize } = await import('./groupFilesBySize'));
  });

  beforeEach(() => {
    mockCore.info.mockReset();
    mockCore.setFailed.mockReset();
    siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'walrus-site-'));
  });

  afterEach(() => {
    fs.rmSync(siteRoot, { recursive: true, force: true });
  });

  it('includes extensionless files, dotfiles, and well-known files', () => {
    fs.mkdirSync(path.join(siteRoot, '.well-known'), { recursive: true });
    fs.writeFileSync(path.join(siteRoot, 'index.html'), '<main>ok</main>');
    fs.writeFileSync(path.join(siteRoot, 'CNAME'), 'example.test');
    fs.writeFileSync(path.join(siteRoot, '.nojekyll'), '');
    fs.mkdirSync(path.join(siteRoot, '.git'), { recursive: true });
    fs.mkdirSync(path.join(siteRoot, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(siteRoot, '.git', 'config'), '[core]\n');
    fs.writeFileSync(path.join(siteRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}');
    fs.writeFileSync(path.join(siteRoot, '.DS_Store'), 'metadata');
    fs.writeFileSync(path.join(siteRoot, 'Thumbs.db'), 'metadata');
    fs.writeFileSync(
      path.join(siteRoot, '.well-known', 'walrus-sites.intoto.jsonl'),
      '{"predicateType":"test"}\n',
    );

    const groups = groupFilesBySize(siteRoot);
    const names = groups.flatMap(group => group.files.map(file => file.name));

    expect(names).toEqual(
      expect.arrayContaining([
        '/index.html',
        '/CNAME',
        '/.nojekyll',
        '/.well-known/walrus-sites.intoto.jsonl',
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        '/.git/config',
        '/node_modules/pkg/index.js',
        '/.DS_Store',
        '/Thumbs.db',
      ]),
    );
    expect(groups[0].files.map(file => file.name)).toEqual([
      '/.well-known/walrus-sites.intoto.jsonl',
    ]);
  });
});
