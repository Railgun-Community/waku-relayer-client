[![Unit Tests](https://github.com/Railgun-Community/waku-relayer-client/actions/workflows/unit-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/waku-relayer-client/actions)

# RAILGUN Relayer Client with Waku networking layer

- [Node.js-specific package](./packages/node/README.md)
- [Browser-specific package](./packages/web/README.md)

`yarn add @railgun-community/waku-relayer-client-node`

OR

`yarn add @railgun-community/waku-relayer-client-web`

## The Basics

```js
// Initialize the Relayer Client
await WakuRelayerClient.start(...)

// Wait for Relayers to connect (5-10 sec) and client to collect fees.
// Relayers broadcast fees through the privacy-safe Waku network.

// Get relayer with lowest fee for a given ERC20 token.
const selectedRelayer = await WakuRelayerClient.findBestRelayer(...)

// Create Relayed transaction and send through selected Relayer.
const relayerTransaction = await RelayerTransaction.create(...)
await RelayerTransaction.send(...)
```
