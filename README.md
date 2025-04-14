# 🚀 Walrus Sites Provenance

> **Your trusted source of truth.**  
> Sign, attest, and verify with absolute confidence.

Deploy Walrus Sites with cryptographic provenance using [SLSA](https://slsa.dev) and [Sigstore](https://www.sigstore.dev/).

This GitHub Action automates the process of deploying Walrus Sites while generating and embedding verifiable provenance metadata for enhanced supply chain security.

## 🌐 What is Walrus?

[Walrus](https://github.com/MystenLabs/walrus) is a **decentralized storage protocol** built on the [Sui blockchain](https://sui.io). It allows developers to publish, verify, and update data in a tamper-proof and censorship-resistant way using on-chain ownership and certified storage.

**Walrus Sites** are static websites hosted on Walrus. Think of them as decentralized web pages: simple to publish, update, and verify — with no centralized server needed. Walrus Sites demonstrate how Web3-native websites can operate securely and transparently.

### 🧩 Key features of Walrus Sites:

- ✅ No server or backend required — just build your static site and deploy
- 🔗 Linkable to on-chain Sui objects (like NFTs, assets, etc.)
- 🧾 Owned and transferrable like any Sui object (and SuiNS compatible)
- 🧱 Immutable and censorship-resistant by design
- ⚡ Can interact with Sui wallets and smart contracts for backend-like features

This action simplifies deploying such sites while attaching [SLSA](https://slsa.dev) provenance metadata, ensuring transparency and auditability in how the site was built and signed.

## 📦 Features

- ✅ Generate SLSA provenance for your Walrus site assets
- 🔐 Sign deployments with a provided keypair
- 📤 Upload to [Walrus Sites](https://docs.wal.app/walrus-sites/intro.html)
- 🔎 Enable post-deployment verification

## 🔧 Usage

### 1. Configure Your Workflow

```yaml
name: Deploy to Walrus Sites

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Walrus Sites with SLSA
        uses: zktx-io/walrus-sites-provenance@v0.1.7
        with:
          config-path: './site.config.json'
        env:
          ED25519_PRIVATE_KEY: ${{ secrets.ED25519_PRIVATE_KEY }}
```

## 📁 Inputs

| Name          | Required | Default              | Description                               |
| ------------- | -------- | -------------------- | ----------------------------------------- |
| `config-path` | ❌       | `./site.config.json` | Path to your Walrus Site config JSON file |

## 🔐 Environment Variables

| Name                  | Required | Description                                          |
| --------------------- | -------- | ---------------------------------------------------- |
| `ED25519_PRIVATE_KEY` | ✅       | Private key in Sui format (starts with "suiprivkey") |

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
  "gas_budget": 100000000,
  "write_retry_limit": 3,
  "object_id": "0xexisting_site_object_id"
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
| `gas_budget`        | `number`                   | ✅       | Max gas to use for on-chain transactions                          |
| `write_retry_limit` | `number`                   | ❌       | Number of times to retry failed blob writes                       |
| `object_id`         | `string`                   | ❌       | Existing site object ID to update (set this when updating a site) |

> ✅ Leave `object_id` empty when deploying a new site.  
> ↻ Set `object_id` only when **updating** an existing site deployment.

---

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

## 🛡️ Deploy with Provenance (SLSA)

To **secure your Walrus Site with verifiable provenance**, use the full reusable GitHub Actions workflow provided in this repository.

This workflow:

1. Builds your static site
2. Recursively hashes all site files
3. Attests the hash list using [SLSA](https://slsa.dev) provenance via [Sigstore](https://www.sigstore.dev/)
4. Produces a signed `walrus-sites.intoto.jsonl` file
5. Deploys the site to Walrus using the Walrus CLI

### ✅ Usage

Create a GitHub Actions workflow in your project:

```yaml
name: Deploy My Static Site to Walrus with Provenance

on:
  push:
    branches:
      - main

permissions:
  id-token: write
  contents: write
  actions: read

jobs:
  deploy-with-provenance:
    uses: zktx-io/walrus-sites-provenance/.github/workflows/deploy_with_slsa3.yml@v0.1.7
    secrets:
      ED25519_PRIVATE_KEY: ${{ secrets.ED25519_PRIVATE_KEY }}
```

### 📁 `site.config.json` Requirements

The full provenance workflow uses your existing `site.config.json` file — the same as in standard Walrus deployments.

Only one field is **strictly required for provenance**:

| Field  | Required | Purpose                                                                                               |
| ------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `path` | ✅       | Must specify the output directory (e.g. `"./dist"` or `"./build"`), which will be hashed recursively. |

> 💡 All other fields (`network`, `owner`, etc.) are used as-is by the Walrus Sites deploy step.  
> The file must be located at the project root (`./site.config.json`).

Example:

```json
{
  "path": "./build"
}
```

### 🧪 What Happens Under the Hood

- All site files are recursively hashed (SHA256)
- A newline-separated list of `sha256sum` lines is base64-encoded
- This list is passed to [SLSA GitHub Generator](https://github.com/slsa-framework/slsa-github-generator)
- A signed `walrus-sites.intoto.jsonl` file is generated
- The site is deployed with cryptographic provenance

### 🎯 Why Use Provenance?

Embedding provenance data ensures:

- 🔍 Transparency: Know what was built and how
- 🔏 Integrity: Trace back to specific commits and configurations
- ✅ Auditability: Verifiable chain-of-trust for secure deployments
