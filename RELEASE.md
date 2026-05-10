# Release Checklist

## Required Local Checks

Run these checks before publishing a release tag:

- `npm run sync:upstream` if `.walrus/` is missing or stale.
- `npm run check:upstream`
- `npm run check:release-tags`
- `npm test -- --runInBand`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

Confirm `dist/` is committed after the build.

## Public Tag References

Update action tag references atomically in:

- `README.md`
- `SLSA.md`
- `.github/workflows/deploy_with_slsa3.yml`

Do not update public examples to a tag before that tag exists. Treat documentation, workflow self-reference, build artifact, and tag creation as one release operation.

## Release Notes

If the release includes these current behaviors, mention them in user-facing release notes:

- `site.config.json` is required and validates `network`, `owner`, `site_name`, `epochs`, and `path`.
- The action runtime is Node 24.
- Sui client access uses the official gRPC/Core API. `sui_grpc_url` and `sui_grpc_timeout_ms` are the preferred endpoint settings; `sui_rpc_*` names are deprecated aliases.
- `GIT_SIGNER_PIN` is required, interactive, and depends on the devnet faucet plus Sui gRPC transport channel.
- `ED25519_PRIVATE_KEY` signing and the ED25519 deprecation acknowledgement input are removed.
- New site resources use the raw/quilt hybrid storage layout.
- Small deployments normally use one registration PTB and one certification/site/cleanup PTB.
- Prettier formatting is enforced as a lint error in PR CI.

## Smoke Deploy

Run the manual `Release Smoke Deploy` workflow before publishing the tag.

The smoke workflow uses GitSigner.

Mainnet smoke deploys spend real gas and WAL. For testnet URL verification, provide a public testnet portal host; `wal.app` only supports mainnet.

The smoke fixture must include multiple resources:

- `index.html`
- `style.css`
- a small asset
- a raw asset such as `.wasm` or a large JS bundle
- `.well-known/walrus-sites.intoto.jsonl`

This verifies provenance-file deployment, raw resource registration, and single-quilt multi-patch resolution.

## SDK And Upstream Changes

Before changing `@mysten/walrus`, `@mysten/sui`, Walrus Sites package behavior, or Sui gRPC/Core access:

- Sync `.walrus/` with `npm run sync:upstream`.
- Verify `upstream-lock.json` with `npm run check:upstream`.
- Compare the affected upstream CLI or SDK APIs.
- Confirm no selected SDK path signs, executes, or hides transaction construction internally.
- Confirm the selected signer path does not require `getPublicKey`, `getSecretKey`, `getKeyScheme`, or `signWithIntent`.
- Run the required local checks and release smoke workflow.
