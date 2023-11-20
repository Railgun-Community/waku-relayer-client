import { Chain, compareChains } from '@railgun-community/shared-models';
import { createDecoder } from '@waku/core';
import { contentTopics } from './waku-topics.js';
import { RelayNode, IMessage } from '@waku/interfaces';
import { handleRelayerFeesMessage } from '../fees/handle-fees-message.js';
import { RelayerTransactResponse } from '../transact/relayer-transact-response.js';
import { RelayerDebug } from '../utils/relayer-debug.js';
import { ContentTopic } from '@waku/relay';
import { isDefined } from '../utils/is-defined.js';
import { WAKU_RAILGUN_PUB_SUB_TOPIC } from '../models/constants.js';

export class WakuObservers {
  private static currentChain: Optional<Chain>;

  static setObserversForChain = async (
    waku: Optional<RelayNode>,
    chain: Chain,
  ) => {
    if (!waku) {
      return;
    }
    if (
      WakuObservers.currentChain &&
      compareChains(WakuObservers.currentChain, chain)
    ) {
      return;
    }
    RelayerDebug.log(`Add Waku observers for chain: ${chain.type}:${chain.id}`);
    WakuObservers.currentChain = chain;
    WakuObservers.removeAllObservers(waku);
    await WakuObservers.addChainObservers(waku, chain);
    RelayerDebug.log(
      `Waku listening for events on chain: ${chain.type}:${chain.id}`,
    );
  };

  static resetCurrentChain = () => {
    this.currentChain = undefined;
  };

  private static removeAllObservers = (waku: RelayNode) => {
    if (!isDefined(waku.relay)) {
      return;
    }
    // @ts-ignore
    waku.relay.observers = new Map();
  };

  private static addChainObservers = async (waku: RelayNode, chain: Chain) => {
    if (!isDefined(waku.relay)) {
      return;
    }

    const contentTopicFees = contentTopics.fees(chain);
    await waku.relay.subscribe(
      createDecoder(contentTopicFees, WAKU_RAILGUN_PUB_SUB_TOPIC),
      (message: IMessage) =>
        handleRelayerFeesMessage(chain, message, contentTopicFees),
    );

    await waku.relay.subscribe(
      createDecoder(
        contentTopics.transactResponse(chain),
        WAKU_RAILGUN_PUB_SUB_TOPIC,
      ),
      RelayerTransactResponse.handleRelayerTransactionResponseMessage,
    );

    // Log current list of observers
    const currentContentTopics = WakuObservers.getCurrentContentTopics(waku);
    RelayerDebug.log('Waku content topics:');
    for (const observer of currentContentTopics) {
      RelayerDebug.log(observer);
    }
  };

  static getCurrentContentTopics(waku?: RelayNode): string[] {
    // @ts-expect-error - 'observers' is private.
    const observers = waku?.relay?.observers as Map<ContentTopic, Set<unknown>>;
    const contentTopics: string[] = [];
    for (const observer of observers.keys()) {
      const pubsubTopic = observers.get(observer);
      if (isDefined(pubsubTopic)) {
        const pubSubContent = pubsubTopic.keys() ?? [];
        for (const contentTopic of pubSubContent) {
          contentTopics.push(String(contentTopic));
        }
      }
    }
    return contentTopics;
  }
}
