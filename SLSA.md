# 🧱 Advanced: SLSA Provenance & GitSigner

Enhance your Walrus Site deployments with full provenance, tamper-proof signatures, and optional secure remote signing.

This guide introduces the advanced features of the Walrus Sites GitHub Action, including:

- 🛡 SLSA-compliant provenance generation
- 🔐 GitSigner integration (no private key in CI)
- 📄 `.intoto.jsonl` structure
- ✅ End-to-end verification via [notary.wal.app](https://notary.wal.app)

## 🔍 Why Provenance?

Provenance ensures:

- What was built?
- Where did it come from?
- Who built it?
- Has it been tampered with?

This is critical for:

- Trusting frontends and static sites
- Open-source supply chain security
- Third-party audits and community verification

## ⚙️ What `deploy_with_slsa3.yml` Does

This reusable workflow:

1. Builds your static site (`npm run build`)
2. Hashes all files (SHA-256)
3. Generates SLSA-compliant provenance via [Sigstore](https://www.sigstore.dev/)
4. Produces a signed `.well-known/walrus-sites.intoto.jsonl`
5. Uploads your site to Walrus with attached metadata

> This gives you end-to-end verifiability, from GitHub commit to on-chain content.

## 🔐 Signing: Private Key vs GitSigner

| Option                | Description                                                                   | Best For                        |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| `ED25519_PRIVATE_KEY` | Default. Stored as GitHub secret.                                             | Simpler setups                  |
| `GIT_SIGNER_PIN`      | Secure external signer via [notary.wal.app/sign](https://notary.wal.app/sign) | Enhanced key hygiene & security |

If `GIT_SIGNER_PIN` is set, your workflow:

- Generates a temporary transaction on devnet
- Encrypts the signing payload with your PIN
- Waits for the signer UI to decrypt and respond

This ensures:

- 🔒 No key in CI
- 📎 Audit trail via Sui
- 🧾 Signature tied to GitHub OIDC + Sui address

## 🚀 Sample Workflow

```yaml
name: Deploy My Static Site with Provenance

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: write
  actions: read

jobs:
  deploy-with-provenance:
    uses: zktx-io/walrus-sites-provenance/.github/workflows/deploy_with_slsa3.yml@v0.2.2
    secrets:
      ED25519_PRIVATE_KEY: ${{ secrets.ED25519_PRIVATE_KEY }}
      # or
      GIT_SIGNER_PIN: ${{ secrets.GIT_SIGNER_PIN }}
```

**This will:**

- 🔨 Build your static site
- 📦 Recursively hash and encode all output files
- 🧾 Generate and sign a `.intoto.jsonl` bundle using Sigstore
- 🌐 Deploy your Walrus Site with attached provenance
- ✅ Enable post-deployment verification via [notary.wal.app](https://notary.wal.app)

## 📄 What is `.intoto.jsonl`?

This file is added to: `.well-known/walrus-sites.intoto.jsonl`

It contains:

- List of resources (name + SHA-256 hash)
- The GitHub repo + workflow used
- Signing identity via Sigstore

Example (shortened):

```json
{
  "_type": "https://in-toto.io/Statement/v0.1",
  "subject": [
    {
      "name": "index.html",
      "digest": {
        "sha256": "..."
      }
    }
  ],
  "predicate": {
    "builder": {
      "id": "github.com/your-org/your-repo/.github/workflows/deploy_with_slsa3.yml"
    },
    "buildType": "https://slsa.dev/provenance/v1"
  }
}
```

## ✅ Verifying at notary.wal.app

You (or your users) can visit: `https://notary.wal.app/?q=your-site-prefix`

And:

- Retrieve the site object from Sui
- Load and parse `.intoto.jsonl`
- Verify file hashes match the deployed blobs
- Confirm signature, commit, workflow, and GitHub link

If no `.intoto.jsonl` is found, it will display the files but mark the site as **unverified**.

## 🎯 Summary

| Feature               | Enabled via                              |
| --------------------- | ---------------------------------------- |
| Provenance hashes     | `deploy_with_slsa3.yml`                  |
| Signature attestation | Sigstore + GitHub OIDC                   |
| Remote signing        | `GIT_SIGNER_PIN`                         |
| On-chain verification | [notary.wal.app](https://notary.wal.app) |

Start simple with `README.md`, and upgrade here when you're ready to prove everything.
