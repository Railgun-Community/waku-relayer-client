import { Chain, promiseTimeout } from '@railgun-community/shared-models';
import { waitForRemotePeer, createEncoder } from '@waku/core';
import { Protocols, IMessage, RelayNode } from '@waku/interfaces';
import { WakuObservers } from './waku-observers.js';
import { RelayerDebug } from '../utils/relayer-debug.js';
import { RelayerFeeCache } from '../fees/relayer-fee-cache.js';
import { utf8ToBytes } from '../utils/conversion.js';
import { isDefined } from '../utils/is-defined.js';
import { bootstrap } from '@libp2p/bootstrap';
import { tcp } from '@libp2p/tcp';
import { createRelayNode } from '@waku/sdk';
import { RelayerOptions } from '../models/index.js';
import {
  WAKU_RAILGUN_DEFAULT_PEERS,
  WAKU_RAILGUN_PUB_SUB_TOPIC,
} from '../models/constants.js';

export class WakuRelayerWakuCore {
  static hasError = false;

  static waku: Optional<RelayNode>;

  private static pubSubTopic = WAKU_RAILGUN_PUB_SUB_TOPIC;
  private static additionalDirectPeers: string[] = [];
  private static peerDiscoveryTimeout = 60000;
  private static useTcp = false;

  static initWaku = async (chain: Chain): Promise<void> => {
    try {
      await WakuRelayerWakuCore.connect();
      if (!WakuRelayerWakuCore.waku) {
        RelayerDebug.log('No waku instance found');
        return;
      }
      WakuObservers.resetCurrentChain();
      await WakuObservers.setObserversForChain(WakuRelayerWakuCore.waku, chain);
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Unexpected non-error thrown', { cause });
      }
      const err = new Error('Failed to initialize Waku Core.', { cause });
      RelayerDebug.error(err);
      throw err;
    }
  };

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
    if (isDefined(relayerOptions.useTcp)) {
      WakuRelayerWakuCore.useTcp = relayerOptions.useTcp;
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
        ...WAKU_RAILGUN_DEFAULT_PEERS,
        ...this.additionalDirectPeers,
      ];
      const waitTimeoutBeforeBootstrap = 250; // 250 ms - default is 1000ms
      const waku: RelayNode = await createRelayNode({
        pubsubTopics: [WakuRelayerWakuCore.pubSubTopic],
        libp2p: {
          ...(WakuRelayerWakuCore.useTcp ? { transports: [tcp()] } : null),
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
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Unexpected non-error thrown', { cause });
      }
      WakuRelayerWakuCore.hasError = true;
      throw new Error('Failed to connect to Waku network.', { cause });
    }
  };

  static getMeshPeerCount(): number {
    return this.waku?.relay.getMeshPeers().length ?? 0;
  }

  private static async waitForRemotePeer(waku: RelayNode) {
    try {
      const protocols = [Protocols.Relay];
      await promiseTimeout(
        waitForRemotePeer(waku, protocols),
        WakuRelayerWakuCore.peerDiscoveryTimeout,
      );
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Unexpected non-error thrown', { cause });
      }
      const err = new Error('Failed to wait for remote peer.', { cause });
      RelayerDebug.error(err);
      throw err;
    }
  }

  static async relayMessage(data: object, contentTopic: string): Promise<void> {
    if (!WakuRelayerWakuCore.waku?.relay) {
      throw new Error('No Waku Relay found.');
    }

    const dataString = JSON.stringify(data);
    const payload = utf8ToBytes(dataString);
    const message: IMessage = { payload };

    try {
      await WakuRelayerWakuCore.waku.relay.send(
        createEncoder({ contentTopic }),
        message,
      );
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Unexpected non-error thrown', { cause });
      }
      RelayerDebug.error(new Error('Failed to relay message.', { cause }));
    }
  }
}
