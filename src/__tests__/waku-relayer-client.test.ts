/// <reference types="../types/index.js" />
import {
  Chain,
  poll,
  RelayerConnectionStatus,
  SelectedRelayer,
} from '@railgun-community/shared-models';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { WakuRelayerClient } from '../waku-relayer-client.js';
import { MOCK_CHAIN_ETHEREUM, MOCK_CHAIN_GOERLI } from '../tests/mocks.test.js';
import { WakuRelayerWakuCore } from '../waku/waku-relayer-waku-core.js';
import { RelayerOptions } from '../models/index.js';

chai.use(chaiAsPromised);
const { expect } = chai;

const chain = MOCK_CHAIN_ETHEREUM;

const relayerOptions: RelayerOptions = {};

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

const WETH_ADDRESS_GOERLI = '0xb4fbf271143f4fbf7b91a5ded31805e42b2208d6';

const CURRENT_TEST_TOKEN = WETH_ADDRESS;

let currentChain: Chain;
let currentStatus: RelayerConnectionStatus;
const statusCallback = (chain: Chain, status: RelayerConnectionStatus) => {
  currentChain = chain;
  currentStatus = status;
};

describe('waku-relayer-client', () => {
  after(async () => {
    await WakuRelayerClient.stop();
  });

  it('Should start up the client, pull live fees and find best Relayer, then error and reconnect', async () => {
    WakuRelayerClient.pollDelay = 500;

    await WakuRelayerClient.start(chain, relayerOptions, statusCallback);

    expect(currentChain).to.deep.equal(chain);
    expect(currentStatus).to.equal(RelayerConnectionStatus.Searching);

    // Poll until currentStatus is Connected.
    const statusInitialConnection = await poll(
      async () => currentStatus,
      status => status === RelayerConnectionStatus.Connected,
      20,
      60000 / 60, // 20 sec.
    );
    if (statusInitialConnection !== RelayerConnectionStatus.Connected) {
      throw new Error('Could not establish initial connection with fees.');
    }

    const useRelayAdapt = true;
    const selectedRelayer: Optional<SelectedRelayer> =
      WakuRelayerClient.findBestRelayer(chain, CURRENT_TEST_TOKEN, useRelayAdapt);

    expect(selectedRelayer).to.be.an('object');
    expect(selectedRelayer?.railgunAddress).to.be.a('string');
    expect(selectedRelayer?.tokenAddress).to.equal(CURRENT_TEST_TOKEN);
    expect(selectedRelayer?.tokenFee.availableWallets).to.be.greaterThanOrEqual(
      1,
    );
    expect(selectedRelayer?.tokenFee.expiration).to.be.a('number');
    expect(selectedRelayer?.tokenFee.feePerUnitGas).to.be.a('string');
    expect(selectedRelayer?.tokenFee.feesID).to.be.a('string');
    expect(selectedRelayer?.tokenFee.relayAdapt).to.be.a('string');

    // Set error state in order to test status and reconnect.
    WakuRelayerWakuCore.hasError = true;

    // Poll until currentStatus is Error.
    const statusError = await poll(
      async () => currentStatus,
      status => status === RelayerConnectionStatus.Error,
      20,
      1000 / 20, // 1 sec.
    );
    if (statusError !== RelayerConnectionStatus.Error) {
      throw new Error(`Should be error, got ${currentStatus}`);
    }

    // Poll until currentStatus is Disconnected.
    const statusDisconnected = await poll(
      async () => currentStatus,
      status => status === RelayerConnectionStatus.Disconnected,
      20,
      2000 / 20, // 2 sec.
    );
    if (statusDisconnected !== RelayerConnectionStatus.Disconnected) {
      throw new Error(`Should be disconnected, got ${currentStatus}`);
    }

    // Poll until currentStatus is Connected.
    const statusConnected = await poll(
      async () => currentStatus,
      status => status === RelayerConnectionStatus.Connected,
      20,
      20000 / 20, // 20 sec.
    );
    if (statusConnected !== RelayerConnectionStatus.Connected) {
      throw new Error(
        `Should be re-connected after disconnection, got ${currentStatus}`,
      );
    }

    // expect(
    //   WakuRelayerClient.getMeshPeerCount(),
    // ).to.be.greaterThanOrEqual(1);

    await WakuRelayerClient.setChain(MOCK_CHAIN_GOERLI);
    expect(WakuRelayerClient.getContentTopics()).to.deep.equal([
      '/railgun/v2/0/5/fees/json',
      '/railgun/v2/0/5/transact-response/json',
    ]);
  }).timeout(90000);
});
