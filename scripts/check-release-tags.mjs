import fs from 'node:fs';

const references = [
  {
    name: 'README direct action example',
    file: 'README.md',
    pattern: /uses:\s*zktx-io\/walrus-sites-provenance@(?<tag>v[^\s]+)/,
  },
  {
    name: 'SLSA reusable workflow example',
    file: 'SLSA.md',
    pattern:
      /uses:\s*zktx-io\/walrus-sites-provenance\/\.github\/workflows\/deploy_with_slsa3\.yml@(?<tag>v[^\s]+)/,
  },
  {
    name: 'reusable workflow self-reference',
    file: '.github/workflows/deploy_with_slsa3.yml',
    pattern: /uses:\s*zktx-io\/walrus-sites-provenance@(?<tag>v[^\s]+)/,
  },
];

const discovered = references.map(reference => {
  const content = fs.readFileSync(reference.file, 'utf8');
  const match = content.match(reference.pattern);
  if (!match?.groups?.tag) {
    throw new Error(`[release-tags] Missing tag reference: ${reference.name} (${reference.file})`);
  }
  return {
    ...reference,
    tag: match.groups.tag,
  };
});

const tags = new Set(discovered.map(reference => reference.tag));
const expectedTag = process.env.RELEASE_TAG;

if (tags.size !== 1) {
  for (const reference of discovered) {
    console.error(`[release-tags] ${reference.name}: ${reference.tag}`);
  }
  throw new Error('[release-tags] Release tag references are not identical.');
}

const [actualTag] = tags;
if (expectedTag && actualTag !== expectedTag) {
  throw new Error(`[release-tags] References use ${actualTag}, expected RELEASE_TAG=${expectedTag}.`);
}

console.log(`[release-tags] all release references use ${actualTag}`);
