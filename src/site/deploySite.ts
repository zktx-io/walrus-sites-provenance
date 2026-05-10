import * as core from '@actions/core';
import { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { WalrusClient } from '@mysten/walrus';

import { cleanupBlobs } from '../blob/helper/cleanupBlobs';
import { BlobDictionary, ResourceFile, SiteConfig } from '../types';
import { SITE_PTB_BYTE_BUDGET, SITE_PTB_COMMAND_BUDGET } from '../utils/constants';
import { failWithMessage } from '../utils/failWithMessage';
import { getAllObjects } from '../utils/getAllObjects';
import { hexToBase36 } from '../utils/hexToBase36';
import { WalrusSystem } from '../utils/loadWalrusSystem';
import { SigningContext } from '../utils/signingContext';
import { SuiClient, TransactionEffects } from '../utils/suiClient';
import { getCreatedObjectIds, runTx } from '../utils/suiRetry';

import {
  getOldBlobObjectCandidates,
  OldBlobObjectCandidate,
} from './helper/getOldBlobObjectCandidates';
import { getResourceObjects } from './helper/getResourceObjects';
import { registerResources } from './helper/registerResources';

type ResourceEntry = { blobId: string; file: ResourceFile };
type CleanupCandidate = { blobId: string; objectId: string; deletable: boolean; endEpoch: number };
type SiteRef = TransactionResult | string;
type PlannedSiteTx = {
  certBlobIds: string[];
  removalPaths: string[];
  resources: ResourceEntry[];
  routeReset: boolean;
  routeInserts: ResourceFile[];
  cleanupObjectIds: string[];
  commandCost: number;
  byteCost: number;
};
type Cost = { commands: number; bytes: number };

const BASE_TX_OVERHEAD: Cost = { commands: 0, bytes: 256 };
const CREATE_SITE_COST: Cost = { commands: 3, bytes: 1_024 };
const CERTIFY_BLOB_COST: Cost = { commands: 1, bytes: 2_048 };
const REMOVE_RESOURCE_COST = (path: string): Cost => ({ commands: 1, bytes: path.length + 96 });
const CLEANUP_BLOB_COST: Cost = { commands: 2, bytes: 128 };

const resourceCost = (file: ResourceFile): Cost => ({
  commands: file.storageKind === 'quilt' ? 6 : 5,
  bytes:
    file.name.length +
    file.hash.length +
    (file.storageKind === 'quilt' ? file.quiltPatchInternalId.length : 0) +
    Object.entries(file.headers).reduce(
      (size, [name, value]) => size + name.length + value.length,
      0,
    ) +
    256,
});

const routeResetCost = (isUpdate: boolean): Cost => ({ commands: isUpdate ? 2 : 1, bytes: 96 });

const routeInsertCost = ({ name }: ResourceFile): Cost => ({
  commands: 1,
  bytes: name.length * 2 + 96,
});

const addCost = (a: Cost, b: Cost): Cost => ({
  commands: a.commands + b.commands,
  bytes: a.bytes + b.bytes,
});

class TxBudget {
  #cost: Cost = { ...BASE_TX_OVERHEAD };

  constructor(base?: Cost) {
    if (base) this.#cost = addCost(this.#cost, base);
  }

  get commandCost() {
    return this.#cost.commands;
  }

  get byteCost() {
    return this.#cost.bytes;
  }

  canFit(cost: Cost): boolean {
    const next = addCost(this.#cost, cost);
    return next.commands <= SITE_PTB_COMMAND_BUDGET && next.bytes <= SITE_PTB_BYTE_BUDGET;
  }

  add(cost: Cost) {
    if (!this.canFit(cost)) {
      throw new Error(
        `PTB budget exceeded: ${this.#cost.commands + cost.commands} commands / ${this.#cost.bytes + cost.bytes} bytes`,
      );
    }
    this.#cost = addCost(this.#cost, cost);
  }
}

const emptyPlan = (): PlannedSiteTx => ({
  certBlobIds: [],
  removalPaths: [],
  resources: [],
  routeReset: false,
  routeInserts: [],
  cleanupObjectIds: [],
  commandCost: 0,
  byteCost: 0,
});

const hasPlannedWork = (tx: PlannedSiteTx): boolean =>
  tx.certBlobIds.length > 0 ||
  tx.removalPaths.length > 0 ||
  tx.resources.length > 0 ||
  tx.routeReset ||
  tx.routeInserts.length > 0 ||
  tx.cleanupObjectIds.length > 0;

export const collectResourceEntries = (blobs: BlobDictionary): ResourceEntry[] =>
  Object.entries(blobs).flatMap(([blobId, blob]) =>
    blob.files.map(file => ({
      blobId,
      file,
    })),
  );

const htmlRouteFiles = (blobs: BlobDictionary): ResourceFile[] =>
  Object.values(blobs)
    .flatMap(blob => blob.files)
    .filter(file => file.name.endsWith('.html'));

export const selectCleanupCandidates = (
  oldCandidates: OldBlobObjectCandidate[],
  currentBlobIds: Set<string>,
): { deletable: CleanupCandidate[]; skipped: CleanupCandidate[] } => {
  const bestByBlobId = new Map<string, CleanupCandidate>();
  const skippedByObjectId = new Map<string, CleanupCandidate>();

  for (const candidate of oldCandidates) {
    if (currentBlobIds.has(candidate.blobId)) {
      continue;
    }
    const next = {
      blobId: candidate.blobId,
      objectId: candidate.objectId,
      deletable: candidate.deletable,
      endEpoch: candidate.endEpoch,
    };
    if (!next.deletable) {
      skippedByObjectId.set(next.objectId, next);
      continue;
    }
    const existing = bestByBlobId.get(candidate.blobId);
    if (!existing || next.endEpoch > existing.endEpoch) {
      bestByBlobId.set(candidate.blobId, next);
    }
  }

  const candidates = Array.from(bestByBlobId.values());
  return {
    deletable: candidates,
    skipped: Array.from(skippedByObjectId.values()),
  };
};

export const planSiteTransactions = ({
  isCreate,
  certBlobIds,
  removalPaths,
  resources,
  routeFiles,
  cleanupObjectIds,
}: {
  isCreate: boolean;
  certBlobIds: string[];
  removalPaths: string[];
  resources: ResourceEntry[];
  routeFiles: ResourceFile[];
  cleanupObjectIds: string[];
}): PlannedSiteTx[] => {
  const plans: PlannedSiteTx[] = [];
  let isFirstPlan = true;
  let current = emptyPlan();
  let budget = new TxBudget(isCreate ? CREATE_SITE_COST : undefined);

  const finalizeCurrent = () => {
    current.commandCost = budget.commandCost;
    current.byteCost = budget.byteCost;
    plans.push(current);
    isFirstPlan = false;
    current = emptyPlan();
    budget = new TxBudget();
  };

  const addOperation = (cost: Cost, apply: () => void) => {
    if (!budget.canFit(cost)) {
      if (isFirstPlan && isCreate && !hasPlannedWork(current)) {
        finalizeCurrent();
      } else if (hasPlannedWork(current)) {
        finalizeCurrent();
      }
    }

    if (!budget.canFit(cost)) {
      throw new Error(
        `Single site deployment operation exceeds PTB budget: ${cost.commands} commands / ${cost.bytes} bytes`,
      );
    }

    budget.add(cost);
    apply();
  };

  for (const blobId of certBlobIds) {
    addOperation(CERTIFY_BLOB_COST, () => current.certBlobIds.push(blobId));
  }

  for (const path of removalPaths) {
    addOperation(REMOVE_RESOURCE_COST(path), () => current.removalPaths.push(path));
  }

  for (const resource of resources) {
    addOperation(resourceCost(resource.file), () => current.resources.push(resource));
  }

  addOperation(routeResetCost(!isCreate), () => {
    current.routeReset = true;
  });
  for (const file of routeFiles) {
    addOperation(routeInsertCost(file), () => current.routeInserts.push(file));
  }

  for (const objectId of cleanupObjectIds) {
    addOperation(CLEANUP_BLOB_COST, () => current.cleanupObjectIds.push(objectId));
  }

  if (hasPlannedWork(current) || (isCreate && plans.length === 0)) {
    finalizeCurrent();
  }

  return plans;
};

const createSiteObject = (
  transaction: Transaction,
  config: SiteConfig,
  walrusSystem: WalrusSystem,
): TransactionResult => {
  const metadata = transaction.moveCall({
    target: `${walrusSystem.sitePackageId}::metadata::new_metadata`,
    arguments: [
      transaction.pure.option('string', config.metadata.link || null),
      transaction.pure.option('string', config.metadata.image_url || null),
      transaction.pure.option('string', config.metadata.description || null),
      transaction.pure.option('string', config.metadata.project_url || null),
      transaction.pure.option('string', config.metadata.creator || null),
    ],
  });

  return transaction.moveCall({
    target: `${walrusSystem.sitePackageId}::site::new_site`,
    arguments: [transaction.pure.string(config.site_name), metadata],
  });
};

const addRouteReset = (
  transaction: Transaction,
  packageId: string,
  site: SiteRef,
  isUpdate: boolean,
) => {
  const siteRef = typeof site === 'string' ? transaction.object(site) : site;
  if (isUpdate) {
    transaction.moveCall({
      target: `${packageId}::site::remove_all_routes_if_exist`,
      arguments: [siteRef],
    });
  }
  transaction.moveCall({
    target: `${packageId}::site::create_routes`,
    arguments: [siteRef],
  });
};

const siteArgument = (transaction: Transaction, site: SiteRef) =>
  typeof site === 'string' ? transaction.object(site) : site;

const addRouteInsert = (
  transaction: Transaction,
  packageId: string,
  site: SiteRef,
  file: ResourceFile,
) => {
  const siteRef = typeof site === 'string' ? transaction.object(site) : site;
  const route = file.name === '/index.html' ? '/*' : file.name;
  transaction.moveCall({
    target: `${packageId}::site::insert_route`,
    arguments: [siteRef, transaction.pure.string(route), transaction.pure.string(file.name)],
  });
};

const extractCreatedSiteObjectId = async (
  suiClient: SuiClient,
  walrusSystem: WalrusSystem,
  effects: TransactionEffects,
  digest: string,
): Promise<string> => {
  const txCreatedIds = getCreatedObjectIds(effects);
  const createdObjects = await getAllObjects(suiClient, {
    ids: txCreatedIds,
  });
  const siteObject = createdObjects.find(
    obj => obj.type === `${walrusSystem.sitePackageId}::site::Site`,
  );

  if (siteObject) {
    return siteObject.objectId;
  }

  throw new Error(`Transaction ${digest} did not create a Site object`);
};

const setSiteOutputs = (config: SiteConfig, siteObjectId: string): string => {
  const b36 = hexToBase36(siteObjectId);
  const url =
    config.network === 'mainnet' ? `https://${b36}.wal.app` : `http://${b36}.localhost:3000`;
  core.setOutput('site-object-id', siteObjectId);
  core.setOutput('site-base36', b36);
  core.setOutput('site-url', url);
  return url;
};

export const deploySite = async ({
  config,
  suiClient,
  walrusClient,
  walrusSystem,
  blobs,
  signingContext,
  protectedBlobIds = new Set<string>(),
}: {
  config: SiteConfig;
  suiClient: SuiClient;
  walrusClient: WalrusClient;
  walrusSystem: WalrusSystem;
  blobs: BlobDictionary;
  signingContext: SigningContext;
  protectedBlobIds?: Set<string>;
}) => {
  let sitePlanSubmitted = false;
  try {
    const isCreate = !config.site_obj_id;
    const currentBlobIds = new Set(Object.keys(blobs));
    const resourceEntries = collectResourceEntries(blobs);
    const removalPaths = isCreate
      ? []
      : (await getResourceObjects({ suiClient, siteObjectId: config.site_obj_id! })).map(
          resource => resource.path,
        );

    const cleanupSelection = isCreate
      ? { deletable: [] as CleanupCandidate[], skipped: [] as CleanupCandidate[] }
      : selectCleanupCandidates(
          await getOldBlobObjectCandidates({
            packageId: walrusSystem.blobPackageId,
            config,
            suiClient,
            walrusClient,
          }),
          currentBlobIds,
        );

    for (const candidate of cleanupSelection.skipped) {
      core.warning(
        `Skipping cleanup for non-deletable old Walrus Blob object ${candidate.objectId} (${candidate.blobId}).`,
      );
    }

    const plans = planSiteTransactions({
      isCreate,
      certBlobIds: Object.keys(blobs),
      removalPaths,
      resources: resourceEntries,
      routeFiles: htmlRouteFiles(blobs),
      cleanupObjectIds: cleanupSelection.deletable.map(candidate => candidate.objectId),
    });

    let siteObjectId = config.site_obj_id;
    let url = '';

    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const transaction = new Transaction();
      let site: SiteRef;

      for (const blobId of plan.certBlobIds) {
        const blob = blobs[blobId];
        if (
          !blob.confirmations ||
          blob.confirmations.length === 0 ||
          !blob.confirmations.some(Boolean)
        ) {
          throw new Error(`Blob ${blobId} is missing storage confirmations for certification.`);
        }
        transaction.add(
          walrusClient.certifyBlob({
            blobId,
            blobObjectId: blob.objectId,
            confirmations: blob.confirmations,
            deletable: true,
          }),
        );
      }

      if (isCreate && index === 0) {
        site = createSiteObject(transaction, config, walrusSystem);
      } else {
        if (!siteObjectId) {
          throw new Error('Site object ID is required for continuation PTB.');
        }
        site = siteObjectId;
      }

      for (const path of plan.removalPaths) {
        transaction.moveCall({
          target: `${walrusSystem.sitePackageId}::site::remove_resource_if_exists`,
          arguments: [siteArgument(transaction, site), transaction.pure.string(path)],
        });
      }

      for (const resource of plan.resources) {
        transaction.add(
          registerResources({
            packageId: walrusSystem.sitePackageId,
            site,
            file: resource.file,
            blobId: resource.blobId,
          }),
        );
      }

      if (plan.routeReset) {
        addRouteReset(transaction, walrusSystem.sitePackageId, site, !isCreate);
      }
      for (const file of plan.routeInserts) {
        addRouteInsert(transaction, walrusSystem.sitePackageId, site, file);
      }

      const cleanupStorageObjects = plan.cleanupObjectIds.map(blobObjectId =>
        transaction.add(walrusClient.deleteBlob({ blobObjectId })),
      );
      if (cleanupStorageObjects.length > 0) {
        transaction.transferObjects(cleanupStorageObjects, config.owner);
      }

      if (isCreate && index === 0) {
        transaction.transferObjects([site as TransactionResult], config.owner);
      }

      const operation = `${isCreate ? 'createSite' : 'updateSite'}:plannedTx${index + 1}`;
      const { digest, effects } = await runTx({
        suiClient,
        signer: signingContext.signer,
        transaction,
        operation,
        logger: core,
        onTransactionSubmitted: () => {
          sitePlanSubmitted = true;
        },
      });

      if (isCreate && index === 0) {
        siteObjectId = await extractCreatedSiteObjectId(suiClient, walrusSystem, effects, digest);
        // Expose the created site ID even if a continuation PTB fails later.
        url = setSiteOutputs(config, siteObjectId);
      }

      core.info(
        `🚀 ${operation} succeeded, tx digest: ${digest} (${plan.commandCost} estimated commands, ${plan.byteCost} estimated bytes)`,
      );
    }

    if (!siteObjectId) {
      throw new Error('Site object ID was not resolved after deployment.');
    }

    url = setSiteOutputs(config, siteObjectId);
    core.info(`\n📦 Site object ID: ${siteObjectId}`);
    core.info(`🌐 ${url}`);
    if (config.network === 'mainnet' && isCreate) {
      core.info(`⚠️ To perform upgrades later, add this to your site.config.json:`);
      core.info(`  "site_obj_id": "${siteObjectId}"`);
    } else if (config.network === 'mainnet') {
      core.info(`👉 You can now register this site on SuiNS using the object ID above.`);
    } else {
      core.info(`👉 You can test this Walrus Site locally.`);
    }

    const message = new TextEncoder().encode(JSON.stringify({ url }));
    await signingContext.finalize(message);
  } catch (error) {
    const deploymentError = error as Error;
    if (!sitePlanSubmitted) {
      try {
        await cleanupBlobs({
          signer: signingContext.signer,
          suiClient,
          config,
          walrusClient,
          blobObjectsIds: Object.entries(blobs).flatMap(([blobId, blob]) => {
            if (!blob.objectId) return [];
            if (protectedBlobIds.has(blobId)) {
              core.warning(
                `Skipping cleanup for newly registered Blob object ${blob.objectId} because blob ${blobId} is still referenced by the existing site.`,
              );
              return [];
            }
            return [blob.objectId];
          }),
        });
      } catch (cleanupError) {
        core.warning(
          `Cleanup after failed site deployment also failed: ${(cleanupError as Error).message}`,
        );
      }
    } else {
      core.warning(
        'Skipping cleanup of newly registered blobs because a site PTB was submitted and may still commit.',
      );
    }
    failWithMessage(`🚫 Failed to deploy site: ${deploymentError.message}`);
  }
};
