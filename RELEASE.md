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
- `ED25519_PRIVATE_KEY` remains supported as a deprecated compatibility path.
- `GIT_SIGNER_PIN` is interactive and depends on the devnet faucet plus Sui gRPC transport channel.
- `WALRUS_DEPRECATION_ACK=1` or the `walrus-deprecation-ack` input silences repeated ED25519 warnings.
- New site resources are stored as Walrus quilt patches and use `x-wal-quilt-patch-internal-id`.
- Small deployments normally use one registration PTB and one certification/site/cleanup PTB.
- Prettier formatting is enforced as a lint error in PR CI.

## Smoke Deploy

Run the manual `Release Smoke Deploy` workflow before publishing the tag.

Select exactly one signer mode. The default smoke mode is GitSigner because it exercises the external-signing path; choose ED25519 only for unattended compatibility checks.

Mainnet smoke deploys spend real gas and WAL. For testnet URL verification, provide a public testnet portal host; `wal.app` only supports mainnet.

The smoke fixture must include multiple resources:

- `index.html`
- `style.css`
- a small asset
- `.well-known/walrus-sites.intoto.jsonl`

This verifies provenance-file deployment and single-quilt multi-patch resolution.

## SDK And Upstream Changes

Before changing `@mysten/walrus`, `@mysten/sui`, Walrus Sites package behavior, or Sui gRPC/Core access:

- Sync `.walrus/` with `npm run sync:upstream`.
- Verify `upstream-lock.json` with `npm run check:upstream`.
- Compare the affected upstream CLI or SDK APIs.
- Confirm no selected SDK path signs, executes, or hides transaction construction internally.
- Confirm the selected signer path does not require `getPublicKey`, `getSecretKey`, `getKeyScheme`, or `signWithIntent`.
- Run the required local checks and release smoke workflow.
