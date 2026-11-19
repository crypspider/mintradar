# MintRadar 📡

**A live radar of what the top AI agent wallets on BNB Chain are minting — where you follow agents by their Agent ID (`name.ai`), not raw addresses.**

Built for the Binance Wallet × BNB Chain **Agent ID Hackathon** (Nov–Dec 2026).

## The problem

AI agent wallets mint early. By the time a mint trends on the timeline, the agents were already in hours earlier — a free agent NFT on 18 Nov 2026 opened and closed at 10,019 mints before most people heard its name. Watching 100 agent wallets by hand, in a block explorer, is not a product. MintRadar is.

## What it does

- **Radar** — a live feed of mints detected across 100 tracked agent wallets, newest first.
- **Agents** — a directory of tracked agents with profiles built from public on-chain data.
- **Follow on-chain** — registered Agent ID holders follow each other through the `MintRadarRegistry` contract on BNB Chain. No token, no funds held, just an identity + follow graph.
- **Verified Agent badge** — Agent ID names resolve through Binance's resolution service. A registration only earns the Verified badge when the name resolves to the same address that registered it, so nobody can impersonate another agent.
- **Leaderboard** — the most-followed agents, read from the contract. The growth engine: every agent on it has a reason to bring their audience.

## The contract

`contracts/MintRadarRegistry.sol` (Solidity ^0.8.20, MIT):

- `register(string agentId)` — bind the caller's address to a `.ai` Agent ID name (one name per address; names are unique, compared case-insensitively; re-registering frees the old name).
- `follow(address)` / `unfollow(address)` — the follow graph. Both parties must be registered.
- `followerCount` / `followingCount` / `getRegisteredAgents(offset, limit)` — reads for profiles and the leaderboard.

The contract holds no funds, issues no token, and has no owner or admin functions.

Local tests: `npm install && node scripts/compile.js && node scripts/test_local.js` (28 checks: registration, name uniqueness, follow/unfollow, renames, pagination, and every custom error).

## Agent ID integration

MintRadar's identity layer *is* Agent ID:

1. Registration keys identity to a `name.ai`, verified against Binance's domain resolution (`crypspider.ai` → the builder's BSC wallet).
2. Profiles, following, and the leaderboard are all addressed by Agent ID, not `0x…` strings.
3. The tracked-agent directory is seeded with real Agent ID holders from the live watch data.

## Data

The radar feed is produced by an on-chain watch over the 100 tracked agent wallets, refreshed on a 3-hour cycle and published as a static data file the site reads. No servers, no custodial anything.

## Status

- [x] Contract written, compiled (solc 0.8.26, Shanghai), and fully tested locally
- [ ] Deployed to BNB Chain mainnet + verified on BscScan
- [ ] Site live on GitHub Pages
- [ ] Submitted to the Agent ID Hackathon

## Builder

Emmanuel Chiekezie — Agent ID **crypspider.ai** — X [@Spiderweb_01](https://x.com/Spiderweb_01)
