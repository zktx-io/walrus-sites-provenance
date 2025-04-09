# 🚀 Walrus SLSA Action

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
        uses: zktx-io/walrus-slsa-action@v1
        with:
          config-path: './site.config.json'
        env:
          WALRUS_KEYPAIR: ${{ secrets.WALRUS_KEYPAIR }}
```

## 📁 Inputs

| Name          | Required | Default              | Description                               |
| ------------- | -------- | -------------------- | ----------------------------------------- |
| `config-path` | ❌       | `./site.config.json` | Path to your Walrus Site config JSON file |

## 🔐 Environment Variables

| Name             | Required | Description                    |
| ---------------- | -------- | ------------------------------ |
| `WALRUS_KEYPAIR` | ✅       | Base64-encoded signing keypair |
