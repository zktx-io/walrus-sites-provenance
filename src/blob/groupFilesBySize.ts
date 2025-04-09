import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import * as core from '@actions/core';

import { FileGroup, SiteConfig } from '../types';
import { MAX_BLOB_SIZE } from '../utils/constants';

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

const getContentTypeFromExtension = (ext: string): string | undefined => {
  return contentTypeMap[ext.toLowerCase()];
};

export const groupFilesBySize = (config: SiteConfig): FileGroup[] => {
  const siteRoot = path.resolve(process.cwd(), config.path);

  if (!fs.existsSync(siteRoot)) {
    core.setFailed(`❌ Provided path "${siteRoot}" does not exist.`);
    return [];
  }

  const files = glob.sync('**/*.*', { cwd: siteRoot }).map(relativePath => {
    const fullPath = path.join(siteRoot, relativePath);
    const { size } = fs.statSync(fullPath);
    const ext = path.extname(relativePath).slice(1);
    const contentType = getContentTypeFromExtension(ext) ?? 'application/octet-stream';
    return {
      path: fullPath,
      name: `/${relativePath}`,
      size,
      headers: {
        'Content-Type': contentType,
        'Content-Encoding': 'identity',
      },
    };
  });

  const groups: FileGroup[] = [];
  let currentGroup: FileGroup = { groupId: 0, files: [], size: 0 };

  for (const file of files) {
    if (currentGroup.size + file.size > MAX_BLOB_SIZE && currentGroup.files.length > 0) {
      groups.push(currentGroup);
      currentGroup = { groupId: currentGroup.groupId + 1, files: [], size: 0 };
    }
    currentGroup.files.push(file);
    currentGroup.size += file.size;
  }

  if (currentGroup.files.length > 0) {
    groups.push(currentGroup);
  }

  let totalSize = 0;
  let totalFiles = 0;

  for (const group of groups) {
    core.info(`✅ Group ${group.groupId} (${group.size} bytes)`);
    for (const file of group.files) {
      core.info(` + ${file.name} (${file.size} bytes)`);
    }
    totalSize += group.size;
    totalFiles += group.files.length;
  }

  return groups;
};
