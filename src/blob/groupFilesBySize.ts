import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import * as core from '@actions/core';
import { glob } from 'glob';

import { FileGroup, FileInfo } from '../types';
import {
  MAX_QUILT_GROUP_SIZE,
  RAW_DEFAULT_ASSET_THRESHOLD,
  RAW_PRIORITY_ASSET_THRESHOLD,
} from '../utils/constants';

const contentTypeMap: Record<string, string> = {
  aac: 'audio/aac',
  abw: 'application/x-abiword',
  apng: 'image/apng',
  arc: 'application/x-freearc',
  avif: 'image/avif',
  avi: 'video/x-msvideo',
  azw: 'application/vnd.amazon.ebook',
  bin: 'application/octet-stream',
  bmp: 'image/bmp',
  bz: 'application/x-bzip',
  bz2: 'application/x-bzip2',
  cda: 'application/x-cdf',
  csh: 'application/x-csh',
  css: 'text/css',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  eot: 'application/vnd.ms-fontobject',
  epub: 'application/epub+zip',
  gz: 'application/gzip',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/vnd.microsoft.icon',
  ics: 'text/calendar',
  jar: 'application/java-archive',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  jsonld: 'application/ld+json',
  mid: 'audio/midi',
  midi: 'audio/midi',
  mjs: 'text/javascript',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mpeg: 'video/mpeg',
  mpkg: 'application/vnd.apple.installer+xml',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odt: 'application/vnd.oasis.opendocument.text',
  oga: 'audio/ogg',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  ogx: 'application/ogg',
  opus: 'audio/opus',
  otf: 'font/otf',
  png: 'image/png',
  pdf: 'application/pdf',
  php: 'application/x-httpd-php',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rar: 'application/vnd.rar',
  rtf: 'application/rtf',
  sh: 'application/x-sh',
  svg: 'image/svg+xml',
  tar: 'application/x-tar',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ts: 'video/mp2t',
  ttf: 'font/ttf',
  txt: 'text/plain',
  vsd: 'application/vnd.visio',
  wav: 'audio/wav',
  wasm: 'application/wasm',
  weba: 'audio/webm',
  webm: 'video/webm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xhtml: 'application/xhtml+xml',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  xul: 'application/vnd.mozilla.xul+xml',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
};

const deployIgnorePatterns = [
  '**/.{git,hg,svn}{,/**}',
  '**/node_modules{,/**}',
  '**/.DS_Store',
  '**/Thumbs.db',
];

const priorityRawAssetExtensions = new Set([
  'js',
  'mjs',
  'css',
  'eot',
  'otf',
  'ttf',
  'woff',
  'woff2',
]);

const sha256ToU256LE = (buffer: Buffer): string => {
  const hash = createHash('sha256').update(buffer).digest();
  const reversed = Buffer.from(hash).reverse();
  return BigInt('0x' + reversed.toString('hex')).toString();
};

const shouldStoreAsRawBlob = (extension: string, size: number): boolean => {
  if (extension === 'wasm') {
    return true;
  }
  if (priorityRawAssetExtensions.has(extension)) {
    return size >= RAW_PRIORITY_ASSET_THRESHOLD;
  }
  return size >= RAW_DEFAULT_ASSET_THRESHOLD;
};

const appendQuiltGroups = (groups: FileGroup[], files: FileInfo[]) => {
  let currentGroup: FileGroup = {
    groupId: groups.length,
    storageKind: 'quilt',
    files: [],
    size: 0,
  };
  const sortedFiles = [...files].sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));

  for (const file of sortedFiles) {
    if (currentGroup.size + file.size > MAX_QUILT_GROUP_SIZE && currentGroup.files.length > 0) {
      groups.push(currentGroup);
      currentGroup = {
        groupId: groups.length,
        storageKind: 'quilt',
        files: [],
        size: 0,
      };
    }
    currentGroup.files.push(file);
    currentGroup.size += file.size;
  }

  if (currentGroup.files.length > 0) {
    groups.push(currentGroup);
  }
};

export const groupFilesBySize = (outputDir: string): FileGroup[] => {
  const siteRoot = path.resolve(process.cwd(), outputDir);

  if (!fs.existsSync(siteRoot)) {
    core.setFailed(`❌ Provided path "${siteRoot}" does not exist.`);
    return [];
  }

  const allFiles = glob
    .sync('**/*', { cwd: siteRoot, dot: true, ignore: deployIgnorePatterns, nodir: true })
    .sort();

  const rawFiles: FileInfo[] = [];
  const quiltFiles: FileInfo[] = [];

  for (const relativePath of allFiles) {
    const fullPath = path.join(siteRoot, relativePath);
    const fileBuffer = fs.readFileSync(fullPath);
    const ext = path.extname(relativePath).slice(1).toLowerCase();
    const contentType = contentTypeMap[ext] ?? 'application/octet-stream';

    const fileInfo: FileInfo = {
      path: fullPath,
      name: `/${relativePath}`,
      size: fileBuffer.length,
      hash: sha256ToU256LE(fileBuffer),
      buffer: fileBuffer,
      headers: {
        'Content-Type': contentType,
        'Content-Encoding': 'identity',
      },
    };

    if (shouldStoreAsRawBlob(ext, fileInfo.size)) {
      rawFiles.push(fileInfo);
    } else {
      quiltFiles.push(fileInfo);
    }
  }

  const groups: FileGroup[] = rawFiles
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file, groupId) => ({
      groupId,
      storageKind: 'raw',
      files: [file],
      size: file.size,
    }));
  appendQuiltGroups(groups, quiltFiles);

  for (const group of groups) {
    core.info(`✅ Group ${group.groupId} ${group.storageKind} (${group.size} bytes)`);
    for (const file of group.files) {
      core.info(` + ${file.name} (${file.size} bytes)`);
    }
  }

  return groups;
};
