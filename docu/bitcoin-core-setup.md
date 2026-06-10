# Connecting rawBit to a local Bitcoin Core node (regtest)

Step 1 of the hex-to-flow feature. rawBit's backend talks to a locally installed
Bitcoin Core node over JSON-RPC; the **Bitcoin Core** button in the topbar opens
a console panel where you can send commands (e.g. `getblockchaininfo`).

This is **local-install only**: the rawBit backend and bitcoind must run on the
same machine. The hosted rawbit.io site cannot reach your node.

## 1. Configure bitcoin.conf

Create (or edit) your Bitcoin Core config file:

- macOS: `~/Library/Application Support/Bitcoin/bitcoin.conf`
- Linux: `~/.bitcoin/bitcoin.conf`
- Windows: `%APPDATA%\Bitcoin\bitcoin.conf`

Minimal regtest setup:

```ini
regtest=1
txindex=1
server=1

[regtest]
# rawBit reads the auto-generated cookie file, so no rpcuser/rpcpassword needed.
rpcbind=127.0.0.1
rpcport=18443
```

Notes:
- `txindex=1` lets `getrawtransaction <txid>` work for any transaction (needed
  for rebuilding txs later). Adding it to an existing chain triggers a one-time
  reindex; on a fresh regtest chain it's instant.
- Cookie auth is the default. rawBit reads `~/.bitcoin/regtest/.cookie`
  automatically — you do **not** need to set a username or password.
- Leave the RPC server bound to `127.0.0.1` (the default). Never expose it.

## 2. Start the node

```sh
bitcoind -regtest
# or, if it's installed as a service / you prefer the daemon flag:
bitcoind -regtest -daemon
```

Make a wallet and some blocks so there's something to inspect:

```sh
bitcoin-cli -regtest createwallet "dev"
bitcoin-cli -regtest -generate 101        # 101 blocks → spendable coins
```

> Use a **legacy** address type if you want classic P2PKH transactions for the
> rebuild step: `bitcoin-cli -regtest getnewaddress "" legacy`.

## 3. Start rawBit locally

The Bitcoin Core endpoints are only served by a **local** rawBit backend. The
default dev command enables them automatically:

```sh
python backend/routes.py        # Flask on :5007, debug mode → /bitcoin/* enabled
npm run dev                     # Vite on :3041
```

If you run the backend under gunicorn (production-style) instead of debug mode,
enable the endpoints explicitly:

```sh
RAWBIT_BITCOIN_RPC_ENABLED=1 gunicorn -c backend/gunicorn_config.py routes:app
```

## 4. Use the console

Open rawBit, click the **Bitcoin Core** (₿) button in the topbar. The panel shows
the node's network and block height. Type commands like:

```
getblockchaininfo
getblockcount
getnewaddress
listunspent
decoderawtransaction <hex>
```

Commands are parsed bitcoin-cli style — you can paste lines verbatim, including a
leading `bitcoin-cli -regtest`. Use ↑/↓ to recall previous commands.

## Configuration overrides (optional)

Environment variables read by the backend:

| Variable | Default | Purpose |
|---|---|---|
| `RAWBIT_BITCOIN_NETWORK` | `regtest` | `regtest` / `signet` / `testnet` / `mainnet` |
| `RAWBIT_BITCOIN_RPC_URL` | `http://127.0.0.1:18443` | full RPC URL override |
| `RAWBIT_BITCOIN_DATADIR` | `~/.bitcoin` | data dir holding the `.cookie` |
| `RAWBIT_BITCOIN_COOKIE_FILE` | — | explicit cookie path |
| `RAWBIT_BITCOIN_RPC_USER` / `_PASSWORD` | — | static rpcauth instead of cookie |
| `RAWBIT_BITCOIN_RPC_ENABLED` | off | force-enable endpoints under gunicorn |

## Safety model

- The `/bitcoin/*` endpoints accept **loopback clients only** and reject foreign
  `Host` headers, so another machine on your network — or a malicious website
  using DNS rebinding — cannot drive your node through rawBit.
- On a **regtest** node, all commands are forwarded (the coins are worthless).
- On any **other** network, only read-only commands are forwarded; the console
  shows a warning banner. `stop` is always blocked.
- If you point rawBit at a **mainnet** node, the panel turns the network badge
  red. Don't do this with a funded wallet.
