import { Chain, delay, promiseTimeout } from '@railgun-community/shared-models';
import { waitForRemotePeer, createEncoder } from '@waku/core';
import { Protocols, IMessage, FullNode } from '@waku/interfaces';
import { WakuObservers } from './waku-observers.js';
import { RelayerDebug } from '../utils/relayer-debug.js';
import { RelayerFeeCache } from '../fees/relayer-fee-cache.js';
import { utf8ToBytes } from '../utils/conversion.js';
import { isDefined } from '../utils/is-defined.js';
import { bootstrap } from '@libp2p/bootstrap';
import { tcp } from '@libp2p/tcp';
import { createFullNode } from '@waku/sdk';
import { RelayerOptions } from '../models/index.js';
import {
  WAKU_RAILGUN_DEFAULT_PEERS_NODE,
  WAKU_RAILGUN_PUB_SUB_TOPIC,
} from '../models/constants.js';

export class WakuRelayerWakuCore {
  static hasError = false;

  static waku: Optional<FullNode>;

  private static pubSubTopic = WAKU_RAILGUN_PUB_SUB_TOPIC;
  private static additionalDirectPeers: string[] = [];
  private static peerDiscoveryTimeout = 60000;

  static initWaku = async (chain: Chain): Promise<void> => {
    try {
      await WakuRelayerWakuCore.connect();
      if (!WakuRelayerWakuCore.waku) {
        RelayerDebug.log('No waku instance found');
        return;
      }
      WakuObservers.resetCurrentChain();
      await WakuObservers.setObserversForChain(WakuRelayerWakuCore.waku, chain);
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      RelayerDebug.error(err);
      throw err;
    }
  };

  private static alreadyPolling = false;
  static checkConnectionPoller = async () => {
    if (WakuRelayerWakuCore.alreadyPolling) {
      return;
    }
    WakuRelayerWakuCore.alreadyPolling = true;
    const peerCount = WakuRelayerWakuCore.getMeshPeerCount();
    if (peerCount < 1) {
      const currentChain = WakuObservers.getCurrentChain();
      if (isDefined(currentChain)) {
        await WakuRelayerWakuCore.reinitWaku(currentChain);
      }
    }
    await delay(30 * 1000);
    WakuRelayerWakuCore.alreadyPolling = false;
    WakuRelayerWakuCore.checkConnectionPoller();
  }

  static reinitWaku = async (chain: Chain) => {
    if (
      isDefined(WakuRelayerWakuCore.waku) &&
      WakuRelayerWakuCore.waku.isStarted()
    ) {
      await WakuRelayerWakuCore.disconnect();
    }

    // Resets connection status to "Connecting" for this network.
    RelayerFeeCache.resetCache(chain);

    await WakuRelayerWakuCore.initWaku(chain);
  };

  static setRelayerOptions(relayerOptions: RelayerOptions) {
    if (isDefined(relayerOptions.pubSubTopic)) {
      WakuRelayerWakuCore.pubSubTopic = relayerOptions.pubSubTopic;
    }
    if (relayerOptions.additionalDirectPeers) {
      WakuRelayerWakuCore.additionalDirectPeers =
        relayerOptions.additionalDirectPeers;
    }
    if (isDefined(relayerOptions.peerDiscoveryTimeout)) {
      WakuRelayerWakuCore.peerDiscoveryTimeout =
        relayerOptions.peerDiscoveryTimeout;
    }
  }

  static disconnect = async () => {
    await WakuRelayerWakuCore.waku?.stop();
    WakuRelayerWakuCore.waku = undefined;
  };

  private static connect = async (): Promise<void> => {
    try {
      WakuRelayerWakuCore.hasError = false;

      RelayerDebug.log(`Creating waku relay client`);

      const peers: string[] = [
        ...WAKU_RAILGUN_DEFAULT_PEERS_NODE,
        ...this.additionalDirectPeers,
      ];
      const waitTimeoutBeforeBootstrap = 250; // 250 ms - default is 1000ms
      const waku: FullNode = await createFullNode({
        pubsubTopics: [WakuRelayerWakuCore.pubSubTopic],
        libp2p: {
          transports: [tcp()],
          peerDiscovery: [
            bootstrap({
              list: peers,
              timeout: waitTimeoutBeforeBootstrap,
            }),
          ],
        },
      });

      RelayerDebug.log('Start Waku.');
      await waku.start();

      RelayerDebug.log('Waiting for remote peer.');
      await this.waitForRemotePeer(waku);

      if (!isDefined(waku.relay)) {
        throw new Error('No Waku Relay instantiated.');
      }

      RelayerDebug.log('Waku peers:');
      for (const peer of waku.libp2p.getPeers()) {
        RelayerDebug.log(JSON.stringify(peer));
      }

      RelayerDebug.log('Connected to Waku');
      WakuRelayerWakuCore.waku = waku;
      WakuRelayerWakuCore.hasError = false;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      WakuRelayerWakuCore.hasError = true;
      throw err;
    }
  };

  static getMeshPeerCount(): number {
    return this.waku?.relay.getMeshPeers(WAKU_RAILGUN_PUB_SUB_TOPIC).length ?? 0;
  }

  static getPubSubPeerCount(): number {
    const peers = this.waku?.libp2p.getPeers() ?? []
    return peers.length;
  }

  static async getLightPushPeerCount(): Promise<number> {
    const peers = (await this.waku?.lightPush.peers()) ?? [];
    return peers.length;
  }

  static async getFilterPeerCount(): Promise<number> {
    const peers = (await this.waku?.filter.peers()) ?? [];
    return peers.length;
  }

  private static async waitForRemotePeer(waku: FullNode) {
    try {
      const protocols = [Protocols.LightPush, Protocols.Relay];
      await promiseTimeout(
        waitForRemotePeer(waku, protocols),
        WakuRelayerWakuCore.peerDiscoveryTimeout,
      );
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      RelayerDebug.error(err);
      throw new Error(err.message);
    }
  }

  static async relayMessage(data: object, contentTopic: string): Promise<void> {
    if (!WakuRelayerWakuCore.waku?.lightPush) {
      throw new Error('No Waku LightPush found.');
    }

    const dataString = JSON.stringify(data);
    const payload = utf8ToBytes(dataString);
    const message: IMessage = { payload };

    try {
      const results = await WakuRelayerWakuCore.waku.lightPush.send(
        createEncoder({ contentTopic, pubsubTopic: WakuRelayerWakuCore.pubSubTopic }),
        message,
      );
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      RelayerDebug.error(err);
    }
  }
}
