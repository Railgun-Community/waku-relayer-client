import {
  Chain,
  RelayerConnectionStatus,
} from '@railgun-community/shared-models';

export type RelayerConnectionStatusCallback = (
  chain: Chain,
  status: RelayerConnectionStatus,
) => void;

export type RelayerDebugger = {
  log: (msg: string) => void;
  error: (error: Error) => void;
};
