# 🚀 Walrus Sites Provenance

> **Your trusted source of truth.**  
> Sign, attest, and verify your deployments with cryptographic confidence.

Deploy [Walrus Sites](https://docs.wal.app/walrus-sites/intro.html) using this GitHub Action.  
Every deployment is cryptographically verifiable, tamper-proof, and easy to manage — all on the [Sui blockchain](https://sui.io).

## 🌐 What is Walrus?

[Walrus](https://github.com/MystenLabs/walrus) is a decentralized storage protocol built on the [Sui blockchain](https://sui.io).  
It allows developers to publish static websites as verifiable, on-chain assets using certified blob storage.

**Walrus Sites** are:

- ⚡ Fully on-chain static websites
- 📦 Owned like NFTs or domains
- 🧱 Immutable and censorship-resistant
- 🔗 Linked to smart contracts or SuiNS names

## ⚙️ Quick Start

### 1. Add the Deployment Action

```yaml
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Walrus Sites
        uses: zktx-io/walrus-sites-provenance@v0.5.8
        env:
          ED25519_PRIVATE_KEY: ${{ secrets.ED25519_PRIVATE_KEY }}
```

> ⚠️ Important:
> When using the GitHub Action directly (without full workflow),
> make sure your site.config.json is located at the repository root (./site.config.json).

> 👉 For monorepo or working directory support,
> use the [Full Workflow](./SLSA.md) instead.

## 🔐 Environment Variables

| Variable              | Required | Description                                           |
| --------------------- | -------- | ----------------------------------------------------- |
| `ED25519_PRIVATE_KEY` | ✅       | Default signing key in Sui format (suiprivkey...)     |
| `GIT_SIGNER_PIN`      | optional | Enables secure remote signing via notary.wal.app/sign |

### 2. Configure site.config.json

Your `site.config.json` defines how the Walrus Site will be deployed or updated.

```json
{
  "network": "testnet",
  "owner": "0x1234567890abcdef1234567890abcdef12345678",
  "site_name": "my-walrus-site",
  "metadata": {
    "link": "https://myproject.xyz",
    "image_url": "https://myproject.xyz/preview.png",
    "name": "My Project",
    "description": "A decentralized web app deployed on Walrus.",
    "project_url": "https://github.com/my-org/my-walrus-site",
    "creator": "my-org"
  },
  "epochs": 30,
  "path": "./dist",
  "write_retry_limit": 3,
  "site_obj_id": "0xexisting_site_object_id"
}
```

#### 🧹 Top-level fields

| Field               | Type                       | Required | Description                                                       |
| ------------------- | -------------------------- | -------- | ----------------------------------------------------------------- |
| `network`           | `"mainnet"` \| `"testnet"` | ✅       | Network to deploy to                                              |
| `owner`             | `string`                   | ✅       | Sui address that will own the deployed site                       |
| `site_name`         | `string`                   | ✅       | Human-readable name of your site                                  |
| `metadata`          | `object`                   | ❌       | Descriptive site metadata (see below)                             |
| `epochs`            | `number`                   | ✅       | How long the site should be stored (in epochs)                    |
| `path`              | `string`                   | ✅       | Directory containing your built static site                       |
| `write_retry_limit` | `number`                   | ❌       | Number of times to retry failed blob writes                       |
| `site_obj_id`       | `string`                   | ❌       | Existing site object ID to update (set this when updating a site) |

> ✅ Leave `site_obj_id` empty when deploying a new site.  
> ↻ Set `site_obj_id` only when **updating** an existing site deployment.

#### 🖼 `metadata` (Optional)

Metadata fields describe your site and help users understand and discover it. These values are stored on-chain and displayed in UIs.

| Field         | Type      | Description                                                        |
| ------------- | --------- | ------------------------------------------------------------------ |
| `link`        | `string?` | Canonical URL for your app or homepage                             |
| `image_url`   | `string?` | URL to a preview image or thumbnail for your site                  |
| `name`        | `string`  | Display name of your site (also provided as `site_name` top-level) |
| `description` | `string?` | Short summary of what your site does                               |
| `project_url` | `string?` | Link to your source code repository                                |
| `creator`     | `string?` | Name, alias, or address of the creator or organization             |

## 🔐 Signing Options

This action supports two signing methods:

- **ED25519_PRIVATE_KEY**: Use a secret key in Sui format to sign transactions (default).
- **GIT_SIGNER_PIN** _(Optional)_: Enables secure remote signing via [notary.wal.app/sign](https://notary.wal.app/sign)

If `GIT_SIGNER_PIN` is set, the workflow uses an ephemeral on-chain transaction to request a signature.  
This keeps your signing key **outside of CI**, improving overall security.

## 📎 Advanced Usage: Provenance & GitSigner

For SLSA provenance workflows, signed metadata, and full GitSigner integration,
see: [SLSA.md](./SLSA.md)
