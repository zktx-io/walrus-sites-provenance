# AGENTS.md

## Project Goal

This project provides a GitHub Action for deploying static sites to Walrus Sites on Sui, with SLSA/Sigstore provenance support and a signing path that can keep the site owner's key outside the GitHub runner.

## Maintenance Rules

Before changing deployment behavior, inspect the full connected flow: `config -> signing context -> blob registration -> storage-node upload -> site planner -> cleanup -> outputs`. Include related tests, workflow files, README/SLSA docs, and `dist/` when the action runtime changes.

Do not implement from assumptions or memory. Check the recorded Walrus Sites CLI, `@mysten/walrus`, and `@mysten/sui` sources before changing site semantics, storage behavior, transaction construction, signing, or SDK usage.

When a change affects a failure path, inspect both success and failure boundaries. Confirm which transaction has been submitted, which objects may already exist on-chain, which Blob IDs are referenced by the current site, and which cleanup action is safe.

After each implementation slice, check its callers, tests, generated bundle impact, documentation, and nearby failure paths before moving on.

Runtime changes must leave tests, lint, typecheck, build, release-tag checks, upstream-lock checks, and `dist/` verification passing.

Documentation changes should record implemented behavior, operational constraints, and purpose. Do not add incident timelines, debugging logs, or upstream-service critique to README/SLSA/AGENTS.

## Current Deployment Architecture

The deployment flow is:

1. Load and validate `site.config.json`.
2. Create a GitSigner signing context using `GIT_SIGNER_PIN`.
3. Register encoded Walrus Blob objects on-chain.
4. Upload encoded raw blob or quilt data to Walrus storage nodes.
5. Plan certification, site create/update, route changes, and safe cleanup into site PTBs.
6. Emit site outputs and send the GitSigner finalization notification when applicable.

Blob registration is separate from upload because storage-node upload needs registered Blob object IDs. After upload, certification, site resource changes, route updates, and safe old-blob cleanup are planned together where PTB budgets allow.

The site deployment planner is the only site mutation path. Do not reintroduce standalone `certifyBlobs`, `createSite`, or `updateSite` flows that bypass planner budgets, cleanup rules, or the signing context.

New resources use a hybrid Walrus storage layout for browser-facing delivery:

- `.wasm` files are stored as individual raw blobs.
- `.js`, `.mjs`, `.css`, and font files at or above 256 KiB are stored as individual raw blobs.
- Other files at or above 1 MiB are stored as individual raw blobs.
- Remaining smaller files are packed into quilts capped at 2 MiB per quilt.

New resources do not use byte ranges. Quilt resources receive an `x-wal-quilt-patch-internal-id` header that points to the patch inside the quilt blob. Raw resources do not receive that header and are served through the raw blob resource path.

`FileInfo` represents raw local files. `RawResourceFile` and `QuiltResourceFile` represent deployable site resources, and `ResourceFile` is their union. Only `QuiltResourceFile` includes `quiltPatchInternalId`. Resource registration must accept `ResourceFile`, not raw `FileInfo`.

Deployment file discovery includes dotfiles and extensionless files so `.well-known/walrus-sites.intoto.jsonl`, `.nojekyll`, `CNAME`, and similar static-site files are preserved. It must continue to ignore VCS, dependency, and OS metadata such as `.git/`, `.hg/`, `.svn/`, `node_modules/`, `.DS_Store`, and `Thumbs.db`.

## Cleanup Rules

Successful update cleanup is keyed by old Blob IDs, not individual resource patch IDs. Never delete a Blob object that is still referenced by current resources. Deduplicate repeated old resources that share the same Blob, and only include owned Blob objects marked `deletable === true`.

Failure cleanup uses transaction-boundary rules:

- If blob registration fails after a transaction commits, cleanup created Blob object IDs. If Blob ID mapping is already known, skip entries whose Blob ID is protected by the existing site.
- If storage-node upload fails, cleanup only newly registered Blob objects whose Blob ID is not already referenced by the existing site.
- If site deployment fails before a site PTB is submitted, apply the same protected Blob ID rule.
- If site deployment fails after a site PTB is submitted, do not cleanup newly registered blobs because the site transaction may still commit and reference them.

`cleanupBlobs` is best-effort across cleanup chunks. It should try all chunks, warn on failed chunks, and preserve the original caller error where cleanup is a recovery action.

## Upstream Reference

Use `.walrus/` as a local reference workspace only. Do not edit it as part of project changes, and do not commit its contents.

Walrus Sites:

- Repository: `https://github.com/MystenLabs/walrus-sites`
- Recorded release: `mainnet-v2.9.1`
- Recorded commit: `6669cec5f06ce2037b9b81b688e5b07addfd95cb`
- Release URL: `https://github.com/MystenLabs/walrus-sites/releases/tag/mainnet-v2.9.1`
- Local path: `.walrus/walrus-sites-mainnet-v2.9.1`

Walrus TypeScript SDK:

- Repository: `https://github.com/MystenLabs/ts-sdks`
- Package: `@mysten/walrus`
- Recorded release: `@mysten/walrus@1.1.4`
- Recorded commit: `a8f3df80e934ff8ad3951c544662aca67ff055c8`
- Release URL: `https://github.com/MystenLabs/ts-sdks/releases/tag/%40mysten%2Fwalrus%401.1.4`
- Local path: `.walrus/ts-sdks-mysten-walrus-1.1.4`
- Package path: `.walrus/ts-sdks-mysten-walrus-1.1.4/packages/walrus`

Sui TypeScript SDK:

- Repository: `https://github.com/MystenLabs/ts-sdks`
- Package: `@mysten/sui`
- Recorded release: `@mysten/sui@2.16.0`
- Recorded commit: `e45d2771414317e05ba7d70f7f314d0fbdceb461`
- Release URL: `https://github.com/MystenLabs/ts-sdks/releases/tag/%40mysten%2Fsui%402.16.0`
- Local path: `.walrus/ts-sdks-mysten-sui-2.16.0`
- Package path: `.walrus/ts-sdks-mysten-sui-2.16.0/packages/sui`

`upstream-lock.json` is the reproducible contract for `.walrus/`. Run `npm run sync:upstream` in a fresh clone, then run `npm run check:upstream` before upstream-sensitive work.

`package.json` and `upstream-lock.json` must agree for the in-use `@mysten/walrus` and `@mysten/sui` package versions.

## Responsibility Boundaries

Walrus Sites CLI is the source of truth for site semantics: site package IDs, resources, routes, redirects, metadata, update behavior, PTB limits, portal-compatible headers, and `ws-resources.json` behavior.

`@mysten/walrus` is the source of truth for storage behavior: blob/quilt encoding, storage cost, registration/certification primitives, storage-node upload/read/delete/extend behavior, package config, and Sui SDK interoperability.

`@mysten/sui` is the source of truth for Sui client, transaction, signer, BCS, object query, package format, Node runtime, and gRPC/Core behavior.

This repository is an orchestrator. Keep it focused on GitHub Action execution, provenance integration, config validation, signing policy, workflow integration, cleanup boundaries, and compatibility glue. Do not reimplement upstream blob encoding, quilt packing, or Walrus contract mirrors when the SDK provides the behavior.

## Signing Rules

All deployment transactions must go through the project signing context and the single `runTx` execution path. Call sites build `Transaction` values and hand them to `runTx`; they must not directly simulate, set gas budgets, sign, execute, or wait for deployment transactions.

Set `GIT_SIGNER_PIN` for deployment signing. `ED25519_PRIVATE_KEY` signing has been removed. Do not reintroduce `ED25519_PRIVATE_KEY`, `ed25519-private-key`, `WALRUS_DEPRECATION_ACK`, or `walrus-deprecation-ack` as compatibility paths.

GitSigner uses a devnet faucet plus Sui gRPC transport channel and requires a human to approve notary UI requests. It is not unattended CI. Its finalization call is a fire-and-forget notification; deployment success must not depend on a verified finalization response.

Use only the narrow deployment signer surface in shared code: `toSuiAddress`, `signTransaction`, and `signPersonalMessage`. Do not rely on `Keypair` methods such as `getPublicKey`, `getSecretKey`, `getKeyScheme`, or `signWithIntent` for GitSigner-compatible deployment paths.

## Sui And SDK Rules

Deployment code uses the official Sui gRPC/Core API through the local Sui client wrapper. Do not import or reintroduce `@mysten/sui/jsonRpc`, JSON-RPC request shapes, `dryRunTransactionBlock`, `executeTransactionBlock`, or legacy `show*` option names.

Do not use SDK convenience APIs that sign, execute, or hide transaction construction. Compose explicit `Transaction` values and run them through `runTx`.

When `@mysten/walrus` or `@mysten/sui` changes, update `upstream-lock.json`, sync `.walrus/`, compare the affected upstream APIs, then verify tests, lint, typecheck, build, and the generated bundle.

## Release Rules

When a release changes action behavior, update public examples in `README.md`, `SLSA.md`, and the self-reference inside `.github/workflows/deploy_with_slsa3.yml` in the same release operation.

Run the full local gate before publishing a tag:

- `npm run check:upstream`
- `npm run check:release-tags`
- `npm test -- --runInBand`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

Run the manual release smoke workflow before publishing a release tag. The smoke site must include multiple resources, including `.well-known/walrus-sites.intoto.jsonl`, a raw asset such as `.wasm` or a large JS bundle, and enough small files to exercise multi-patch quilt resolution.
