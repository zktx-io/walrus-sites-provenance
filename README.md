# 🚀 Walrus Sites Provenance

Deploy Walrus Sites from GitHub Actions with optional SLSA provenance and remote signing support.

This project wraps the official Walrus and Sui TypeScript SDKs in a GitHub Action. It focuses on reproducible CI deployment, provenance workflow integration, and a signing path that can keep the site owner's key outside the GitHub runner.

## 🌐 What is Walrus?

[Walrus](https://github.com/MystenLabs/walrus) is a decentralized storage protocol built on the [Sui blockchain](https://sui.io).  
It allows developers to publish static websites as verifiable, on-chain assets using certified blob storage.

**Walrus Sites** are:

- Static websites backed by certified Walrus blob storage
- Represented by owned Sui objects
- Compatible with Walrus Sites portals
- Usable with SuiNS and other Sui object workflows

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
          GIT_SIGNER_PIN: ${{ secrets.GIT_SIGNER_PIN }}
```

> ⚠️ Important:
> When using the GitHub Action directly (without full workflow),
> make sure your site.config.json is located at the repository root (./site.config.json).

> 👉 For monorepo or working directory support,
> use the [Full Workflow](./SLSA.md) instead.

## 🔐 Environment Variables

| Variable              | Required | Description                                           |
| --------------------- | -------- | ----------------------------------------------------- |
| `GIT_SIGNER_PIN`      | optional | Enables secure remote signing via notary.wal.app/sign |
| `ED25519_PRIVATE_KEY` | optional | Deprecated fallback key for unattended CI. Planned for removal in v1.0.0. |
| `WALRUS_DEPRECATION_ACK` | optional | Set to `1` to silence repeated ED25519 deprecation warnings in unattended CI. |

Set exactly one signing credential: either `GIT_SIGNER_PIN` or `ED25519_PRIVATE_KEY`. Supplying both fails the deployment.

## 📤 Action Outputs

| Output           | Description                                         |
| ---------------- | --------------------------------------------------- |
| `site-object-id` | Sui object ID of the created or updated Walrus Site |
| `site-base36`    | Base36 site identifier derived from the object ID   |
| `site-url`       | Portal URL emitted for the target network           |

### 2. Configure site.config.json

Your `site.config.json` defines how the Walrus Site will be deployed or updated.
It must be present at the repository root for the direct action path, or at the configured working directory for the reusable workflow.

This file is validated before deployment. Missing `network`, `owner`, `site_name`, `epochs`, or `path` fails immediately instead of falling back to defaults.

```json
{
  "network": "testnet",
  "owner": "0x1234567890abcdef1234567890abcdef12345678",
  "site_name": "my-walrus-site",
  "metadata": {
    "link": "https://myproject.xyz",
    "image_url": "https://myproject.xyz/preview.png",
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
| `sui_grpc_url`      | `string`                   | ❌       | Custom Sui gRPC base URL                                          |
| `sui_grpc_timeout_ms` | `number`                 | ❌       | Custom Sui gRPC timeout in milliseconds                           |

> ✅ Leave `site_obj_id` empty when deploying a new site.  
> ↻ Set `site_obj_id` only when **updating** an existing site deployment.
> `sui_rpc_url` and `sui_rpc_timeout_ms` are deprecated v0.6.x aliases and are treated as gRPC endpoint settings because Sui JSON-RPC is being retired.
> `path` should point to a clean build output directory. Dotfiles and extensionless files inside that directory are included in the deployment, while common VCS/system metadata such as `.git/`, `.hg/`, `.svn/`, `node_modules/`, `.DS_Store`, and `Thumbs.db` is ignored. Keep `.well-known/walrus-sites.intoto.jsonl` in this directory when deploying SLSA provenance.

#### 🖼 `metadata` (Optional)

Metadata fields describe your site and help users understand and discover it. These values are stored on-chain and displayed in UIs.

| Field         | Type      | Description                                                        |
| ------------- | --------- | ------------------------------------------------------------------ |
| `link`        | `string?` | Canonical URL for your app or homepage                             |
| `image_url`   | `string?` | URL to a preview image or thumbnail for your site                  |
| `description` | `string?` | Short summary of what your site does                               |
| `project_url` | `string?` | Link to your source code repository                                |
| `creator`     | `string?` | Name, alias, or address of the creator or organization             |

## 🔐 Signing Options

This action supports two signing methods:

- **GIT_SIGNER_PIN** _(Optional)_: Enables secure remote signing via [notary.wal.app/sign](https://notary.wal.app/sign)
- **ED25519_PRIVATE_KEY** _(Deprecated)_: Uses a Sui private key for unattended CI. This path is retained for v0.6.x compatibility and is planned for removal in v1.0.0.

If `GIT_SIGNER_PIN` is set, the workflow uses an ephemeral on-chain transaction to request a signature.  
This keeps your signing key outside of CI.

GitSigner requires a person to approve signing in the notary UI and uses a devnet faucet plus Sui gRPC transport channel. If devnet or the faucet is unavailable, deployments that use GitSigner can be blocked even for mainnet/testnet site targets. For fully unattended CI, pin a version that still supports `ED25519_PRIVATE_KEY` until an external KMS/HSM signer is available.

For unattended ED25519 deployments, set `WALRUS_DEPRECATION_ACK=1` after accepting that this compatibility path is deprecated. This only hides the repeated warning; it does not change signing behavior.
When using the action directly, the equivalent action input is `walrus-deprecation-ack: '1'`.

## Deployment Flow

The action uses the official Walrus and Sui TypeScript SDKs to build deployment PTBs directly.

The Walrus Sites CLI remains the reference for site semantics such as resources, routes, metadata, and PTB limits. This action does not shell out to the CLI because it has two CI-specific requirements:

- It needs a single signing boundary that can route every deployment transaction through GitSigner or the deprecated ED25519 fallback.
- It needs to attach provenance workflow behavior and action outputs without depending on a local CLI installation or CLI-managed signing.

For that reason, the action follows the CLI and SDK behavior as reference material, but constructs the transactions in TypeScript.

The deployment order is:

1. Register Walrus quilt Blob objects on-chain.
2. Upload encoded quilt data to Walrus storage nodes.
3. Certify uploaded blobs and apply the Walrus Site create/update in a planned site PTB.
4. Use continuation PTBs only when the site plan would exceed conservative PTB limits.

Blob registration is intentionally separate from upload because storage-node upload needs the registered Blob object IDs. After upload, the action minimizes additional signatures by combining certification, resource registration, route updates, and safe old-blob cleanup into the fewest site PTBs possible. For small sites, the normal target is two signatures: one registration PTB and one certification/site/cleanup PTB.

New resources are stored as Walrus quilt patches. They do not use byte ranges; each site resource receives an `x-wal-quilt-patch-internal-id` header that points to the patch inside the quilt blob.

When updating an existing site, cleanup is still supported. The action compares old site resources against the current quilt Blob IDs, deduplicates shared old blobs, skips blobs still referenced by the new site, and only deletes owned Blob objects that Walrus marks as `deletable`.

## Compatibility Notes

- `site.config.json` is now required and validated at startup. Workflows that depended on implicit defaults must add the required fields explicitly.
- `owner` must be a valid `0x`-prefixed Sui hex address. Short hex addresses are normalized before signing and transaction execution.
- `metadata.name` is deprecated and ignored. Use top-level `site_name`.
- Sui access uses the official `@mysten/sui` gRPC/Core API. Use `sui_grpc_url` and `sui_grpc_timeout_ms` for custom endpoints; the old `sui_rpc_*` fields are deprecated aliases.
- The action runtime is Node 24 to match the current `@mysten/sui`/`@mysten/walrus` SDK requirements.
- The ED25519 path remains available for v0.6.x compatibility, but is deprecated and planned for removal in v1.0.0.
- GitSigner is interactive and should not be treated as a replacement for unattended CI.
- Deployments use quilt patch headers instead of byte-range resource entries. Existing range-based resources can still be read during update cleanup, but new resources are written through the quilt path.

## 📎 Advanced Usage: Provenance & GitSigner

For SLSA provenance workflows, signed metadata, and full GitSigner integration,
see: [SLSA.md](./SLSA.md)
