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
  });

  it('stores wasm files as single raw blobs with the browser streaming MIME type', () => {
    fs.mkdirSync(path.join(siteRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(siteRoot, 'assets', 'sui_move_wasm_bg.wasm'), '\0asm');

    const groups = groupFilesBySize(siteRoot);
    const wasmGroup = groups.find(group =>
      group.files.some(file => file.name === '/assets/sui_move_wasm_bg.wasm'),
    );
    const wasmFile = wasmGroup?.files[0];

    expect(wasmGroup?.storageKind).toBe('raw');
    expect(wasmGroup?.files).toHaveLength(1);
    expect(wasmFile?.headers['Content-Type']).toBe('application/wasm');
  });

  it('stores large JS, CSS, and font assets as raw blobs', () => {
    fs.mkdirSync(path.join(siteRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(siteRoot, 'assets', 'app.js'), Buffer.alloc(256 * 1024));
    fs.writeFileSync(path.join(siteRoot, 'assets', 'style.css'), Buffer.alloc(256 * 1024));
    fs.writeFileSync(path.join(siteRoot, 'assets', 'font.woff2'), Buffer.alloc(256 * 1024));
    fs.writeFileSync(path.join(siteRoot, 'assets', 'small.js'), Buffer.alloc(256 * 1024 - 1));

    const groups = groupFilesBySize(siteRoot);
    const rawNames = groups
      .filter(group => group.storageKind === 'raw')
      .flatMap(group => group.files.map(file => file.name));
    const quiltNames = groups
      .filter(group => group.storageKind === 'quilt')
      .flatMap(group => group.files.map(file => file.name));

    expect(rawNames).toEqual(
      expect.arrayContaining(['/assets/app.js', '/assets/style.css', '/assets/font.woff2']),
    );
    expect(quiltNames).toContain('/assets/small.js');
  });

  it('stores other 1 MiB or larger assets as raw blobs', () => {
    fs.mkdirSync(path.join(siteRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(siteRoot, 'assets', 'large.png'), Buffer.alloc(1024 * 1024));
    fs.writeFileSync(path.join(siteRoot, 'assets', 'small.png'), Buffer.alloc(1024 * 1024 - 1));

    const groups = groupFilesBySize(siteRoot);
    const rawNames = groups
      .filter(group => group.storageKind === 'raw')
      .flatMap(group => group.files.map(file => file.name));
    const quiltNames = groups
      .filter(group => group.storageKind === 'quilt')
      .flatMap(group => group.files.map(file => file.name));

    expect(rawNames).toContain('/assets/large.png');
    expect(quiltNames).toContain('/assets/small.png');
  });

  it('keeps remaining quilt groups under the 2 MiB cap', () => {
    fs.mkdirSync(path.join(siteRoot, 'assets'), { recursive: true });
    for (let index = 0; index < 4; index += 1) {
      fs.writeFileSync(
        path.join(siteRoot, 'assets', `chunk-${index}.txt`),
        Buffer.alloc(600 * 1024),
      );
    }

    const groups = groupFilesBySize(siteRoot);
    const quiltGroups = groups.filter(group => group.storageKind === 'quilt');

    expect(quiltGroups).toHaveLength(2);
    expect(quiltGroups.every(group => group.size <= 2 * 1024 * 1024)).toBe(true);
  });
});
