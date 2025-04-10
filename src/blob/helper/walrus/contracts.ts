import { bcs, BcsType } from '@mysten/sui/bcs';

const Authorized = () => {
  return bcs.enum('Authorized', {
    Address: bcs.Address,
    ObjectID: bcs.Address,
  });
};

const Bag = () => {
  return bcs.struct('Bag', {
    id: UID(),
    size: bcs.u64(),
  });
};

const Balance = () => {
  return bcs.struct('Balance', {
    value: bcs.u64(),
  });
};

const Element = () => {
  return bcs.struct('Element', {
    bytes: bcs.vector(bcs.u8()),
  });
};

const PendingValues = () => {
  return bcs.struct('PendingValues', {
    pos0: VecMap(bcs.u32(), bcs.u64()),
  });
};

const UID = () => {
  return bcs.struct('UID', {
    id: bcs.Address,
  });
};

const ExtendedField = () => {
  return bcs.struct('ExtendedField', {
    id: UID(),
  });
};

const StorageNodeInfo = () => {
  return bcs.struct('StorageNodeInfo', {
    name: bcs.string(),
    node_id: bcs.Address,
    network_address: bcs.string(),
    public_key: Element(),
    next_epoch_public_key: bcs.option(Element()),
    network_public_key: bcs.vector(bcs.u8()),
    metadata: ExtendedField(),
  });
};

const PoolState = () => {
  return bcs.enum('PoolState', {
    Active: null,
    Withdrawing: bcs.u32(),
    Withdrawn: null,
  });
};

const Table = () => {
  return bcs.struct('Table', {
    id: UID(),
    size: bcs.u64(),
  });
};

const VotingParams = () => {
  return bcs.struct('VotingParams', {
    storage_price: bcs.u64(),
    write_price: bcs.u64(),
    node_capacity: bcs.u64(),
  });
};

const VecMap = <T0 extends BcsType<any>, T1 extends BcsType<any>>(...typeParameters: [T0, T1]) => {
  return bcs.struct('VecMap', {
    contents: bcs.vector(Entry(typeParameters[0], typeParameters[1])),
  });
};
const Entry = <T0 extends BcsType<any>, T1 extends BcsType<any>>(...typeParameters: [T0, T1]) => {
  return bcs.struct('Entry', {
    key: typeParameters[0],
    value: typeParameters[1],
  });
};

export const Field = <T0 extends BcsType<any>, T1 extends BcsType<any>>(
  ...typeParameters: [T0, T1]
) => {
  return bcs.struct('Field', {
    id: UID(),
    name: typeParameters[0],
    value: typeParameters[1],
  });
};

export const StakingPool = () => {
  return bcs.struct('StakingPool', {
    id: UID(),
    state: PoolState(),
    voting_params: VotingParams(),
    node_info: StorageNodeInfo(),
    activation_epoch: bcs.u32(),
    latest_epoch: bcs.u32(),
    wal_balance: bcs.u64(),
    num_shares: bcs.u64(),
    pending_shares_withdraw: PendingValues(),
    pre_active_withdrawals: PendingValues(),
    pending_commission_rate: PendingValues(),
    commission_rate: bcs.u16(),
    exchange_rates: Table(),
    pending_stake: PendingValues(),
    rewards_pool: Balance(),
    commission: Balance(),
    commission_receiver: Authorized(),
    governance_authorized: Authorized(),
    extra_fields: Bag(),
  });
};

export const Committee = () => {
  return bcs.struct('Committee', {
    pos0: VecMap(bcs.Address, bcs.vector(bcs.u16())),
  });
};
