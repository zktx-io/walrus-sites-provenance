// https://github.com/MystenLabs/ts-sdks/blob/main/packages/walrus/src/contracts/blob.ts
// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { bcs } from '@mysten/sui/bcs';

function UID() {
  return bcs.struct('UID', {
    id: bcs.Address,
  });
}

function Storage() {
  return bcs.struct('Storage', {
    id: UID(),
    start_epoch: bcs.u32(),
    end_epoch: bcs.u32(),
    storage_size: bcs.u64(),
  });
}

export function Blob() {
  return bcs.struct('Blob', {
    id: UID(),
    registered_epoch: bcs.u32(),
    blob_id: bcs.u256(),
    size: bcs.u64(),
    encoding_type: bcs.u8(),
    certified_epoch: bcs.option(bcs.u32()),
    storage: Storage(),
    deletable: bcs.bool(),
  });
}
