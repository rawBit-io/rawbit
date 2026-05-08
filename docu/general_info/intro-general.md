# Lecture Notes — Raw Bitcoin Transactions

**Lecture 1: Building and understanding a legacy P2PKH transaction**

> These are general reference notes for explaining raw Bitcoin transactions without relying on any specific teaching tool. They are organized so you can flip to any section if a student asks something off-script.

---

## Table of contents

1. [Suggested lecture flow (90-120 min)](#1-suggested-lecture-flow)
2. [Bits, bytes, hex](#2-bits-bytes-hex)
3. [Endianness (LE vs BE)](#3-endianness)
4. [Hashing](#4-hashing)
5. [Public-key cryptography](#5-public-key-cryptography)
6. [For math-curious students: simpler signature schemes (reference only)](#6-for-math-curious-students)
7. [Base58Check & Bitcoin addresses](#7-base58check--bitcoin-addresses)
8. [Bitcoin Script basics](#8-bitcoin-script-basics)
9. [Raw transaction anatomy](#9-raw-transaction-anatomy)
10. [Sequence, locktime, RBF](#10-sequence-locktime-rbf)
11. [The legacy signing preimage](#11-the-legacy-signing-preimage)
12. [ECDSA, low-R, low-S](#12-ecdsa-low-r-low-s)
13. [TXID byte order](#13-txid-byte-order)
14. [Fees and vsize](#14-fees-and-vsize)
15. [Anticipated student questions](#15-anticipated-student-questions)
16. [Resources & further reading](#16-resources--further-reading)

---

## 1. Suggested lecture flow

A realistic 2-hour schedule for building the concepts needed to understand a legacy P2PKH transaction:

| Time     | Topic                                                        |
| -------- | ------------------------------------------------------------ |
| 0–10 min | What we are building + P2PKH transaction goal                |
| 10–25    | Bits, bytes, hex                                             |
| 25–40    | Endianness + VarInt                                          |
| 40–55    | Hashing + HASH160                                            |
| 55–70    | Private/public keys + addresses (Base58Check worked example) |
| 70–85    | P2PKH Script                                                 |
| 85–115   | Assemble and trace the P2PKH transaction                     |
| 115–120  | Fee, TXID display order, wrap-up                             |

For a **90-minute** slot, drop section 6 (math-curious) entirely and trim section 12 (DER details) to one sentence. For a **120-minute** slot you can spend a few minutes on section 6 if a student asks; otherwise treat it as office-hours material.

---

## 2. Bits, bytes, hex

### Concept

- A **bit** is the smallest unit: 0 or 1.
- A **byte** is 8 bits: 256 possible values (0–255, or `0x00`–`0xff`).
- **Hex** (base 16) uses digits `0–9` and `a–f`. Each hex digit encodes 4 bits ("a nibble"), so **two hex characters = one byte**. This is the only conversion students absolutely must internalize.

The actual transaction is bytes. In this course we display and edit those bytes as hex, because hex is the standard human-readable notation for raw transaction bytes. Decoded RPC output, block explorer pages, and `bitcoin-cli decoderawtransaction` show the same fields in decimal too — but on the wire, peers send bytes, and when humans inspect those bytes in tools, packet captures, or block explorers, they are usually displayed as hex.

### Worked examples

```
hex     binary               bytes  decimal
0x00    0000 0000            1      0
0x01    0000 0001            1      1
0xff    1111 1111            1      255
0x0100  0000 0001 0000 0000  2      256
```

Note for the last row: the integer 256 takes two bytes. _Which_ two bytes depends on byte order — that's the next section. As big-endian bytes, 256 is `01 00`; as little-endian bytes, it is `00 01`.

Reading a longer hex string:

```
67d60153 → 4 bytes:  67  d6  01  53
```

Always read hex in **pairs** from left to right. An odd number of hex chars usually means a typo.

### Useful conversions on a calculator / Python

```python
# Python is a convenient way to check conversions:
>>> 0x10                  # hex literal
16
>>> 391000                # decimal
391000
>>> hex(391000)           # decimal → hex
'0x5f758'
>>> (391000).to_bytes(8, 'little').hex()
'58f7050000000000'        # example 8-byte little-endian amount
>>> bytes.fromhex('58f7050000000000')
b'X\xf7\x05\x00\x00\x00\x00\x00'
>>> int.from_bytes(bytes.fromhex('58f7050000000000'), 'little')
391000
```

### Common student traps

- "0x" is not part of the byte; it's a prefix telling the reader the number is hex.
- A 32-byte value is **64 hex characters**, not 32.
- Leading zeros matter. In byte notation, always write two hex characters per byte. `01` is one complete byte; a lone `1` is not a complete byte representation and usually indicates a typo or a missing leading zero.

## 3. Endianness

### Concept

When we write a multi-byte number, we have to decide which byte to put first.

- **Big-endian (BE):** most-significant byte first — the way humans read numbers.
- **Little-endian (LE):** least-significant byte first.

The integer **1** as two bytes:

```
big-endian:    00 01
little-endian: 01 00
```

The integer **256** as two bytes:

```
big-endian:    01 00
little-endian: 00 01
```

The bytes are the same; the order changes.

Bitcoin serializes many **numeric transaction fields** little-endian: version, vout, sequence, amount, locktime, and the 4-byte sighash flag appended to legacy signing preimages. Public keys, signatures, scripts, hashes, and `pubKeyHash` values are byte strings or format-specific encodings; they are not generally "converted to little-endian."

### Why LE?

Mostly historical convention. Many numeric fields in Bitcoin's raw transaction format are serialized little-endian, and that convention is now part of the protocol. Students don't need a deep "why," they need to learn which fields are numbers and how those numbers are serialized.

### The TXID quirk

The transaction ID is a `double-SHA256` of the serialized transaction, which produces a 32-byte digest. Block explorers and CLI tools display this digest with the **byte order reversed** compared to how it appears inside a raw transaction's `prev_txid` field.

This trips up _every_ learner. Drill it once:

```
Internal byte order (inside the raw transaction):
  67d60153be449d7ff8685193eb00bf518969f4a71849e07c53ba8d73eec22f22

Display order (what mempool.space shows):
  222fc2ee738dba537ce04918a7f4698951bf00eb935168f87f9d44be5301d667
```

These are the **same 32 bytes**, just byte-reversed.

### Worked examples

```python
>>> (2).to_bytes(4, 'little').hex()    # transaction version
'02000000'
>>> (1).to_bytes(4, 'little').hex()    # vout = 1
'01000000'
>>> (0).to_bytes(4, 'little').hex()    # locktime = 0
'00000000'
>>> (391000).to_bytes(8, 'little').hex()  # output amount
'58f7050000000000'
```

And for the sequence:

```python
>>> (0xfffffffd).to_bytes(4, 'little').hex()
'fdffffff'
```

### Common student questions

- _"Is hex little-endian or big-endian?"_ Hex is just a representation. Endianness is about how a multi-byte **number** is laid out in memory or on the wire.
- _"How do I know if I should reverse?"_ If the field is a number (version, amount, vout), it's LE in the wire format. If it's a hash you got from an explorer and want to put in a raw tx, you reverse it.

---

## 4. Hashing

### Concept

A **cryptographic hash function** takes any input and produces a fixed-size output (the digest). Properties we care about:

| Property                       | Meaning                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| **Deterministic**              | Same input → same output, every time.                                |
| **Fixed output size**          | Regardless of input length.                                          |
| **Preimage resistance**        | Given a digest, you can't find an input that produces it.            |
| **Second-preimage resistance** | Given input `x`, you can't find a different `x'` with the same hash. |
| **Collision resistance**       | You can't find any two inputs with the same hash.                    |
| **Avalanche**                  | Changing 1 bit of input changes ~half the output bits.               |

The avalanche property is what makes signatures and TXIDs useful: any tampering, however small, produces a totally different hash.

### Hashes used in Bitcoin

- **SHA-256:** the workhorse. 256-bit (32-byte) output. Used inside almost everything.
- **RIPEMD-160:** older 160-bit hash. In Bitcoin it appears mainly inside `HASH160`, which produces 20-byte fingerprints such as P2PKH public-key hashes and P2SH script hashes.
- **`HASH160(x) = RIPEMD-160(SHA-256(x))`**: produces a 20-byte hash. Used to derive P2PKH addresses from public keys. The 20-byte result is called the **public-key hash** (`pubKeyHash`).
- **`HASH256(x) = SHA-256(SHA-256(x))`** (also called "double-SHA256"): produces a 32-byte hash. Used for the **TXID** and for the **legacy P2PKH signing hash in this example**.

### Why combine SHA-256 and RIPEMD-160 for HASH160?

For P2PKH, the practical result is a compact 20-byte public-key hash. The combination also means an attacker would need to deal with a composed hash construction rather than just a raw public key or a single 32-byte SHA-256 value — historically this was sometimes framed as "defense in depth," though Satoshi never documented the exact motivation. Today we use this construction because it is part of the protocol, and the 20-byte output keeps addresses compact while still giving 160 bits of security against second-preimage attacks (and roughly 80 bits of collision security via the birthday bound — fine for address uniqueness).

### Why double-SHA256 instead of single?

Honestly, partly historical. Satoshi used it everywhere. One commonly given explanation is protection against length-extension-style issues, although that is not usually a practical attack on Bitcoin's specific transaction-hash use. Today, double-SHA256 is mainly historical convention. Taproot/Schnorr uses BIP340-style tagged hashing instead.

### What hashing achieves in Bitcoin

| Use                       | What hashing buys us                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| TXID                      | Unique, tamper-evident identifier for a transaction                                  |
| `pubKeyHash` in addresses | Lets us commit to a public key without revealing it until spend time                 |
| Merkle root in blocks     | Compact commitment to all transactions in a block                                    |
| Signing hash (sighash)    | A fixed 32-byte target for ECDSA to sign — can't sign arbitrary-length data directly |
| Mining (proof-of-work)    | Hashing is the puzzle                                                                |

### Common student questions

- _"Can two different pubkeys produce the same HASH160?"_ In theory yes. A generic collision against a 160-bit hash has about 80-bit birthday security. But finding a private key whose public key matches someone else's already-existing `pubKeyHash` is a targeted second-preimage attack and is about 160-bit work, which is computationally infeasible with current technology.
- _"If I lose my private key but have my public key, am I safe?"_ The question has two readings:
  - **Can you still spend?** No. The public key can verify signatures but cannot create them, so without the private key the UTXO is effectively unspendable forever.
  - **Are your funds safe from someone _else_ taking them?** Yes — assuming ECDSA holds. But once you've spent once, the public key is revealed on-chain, so the remaining security relies entirely on ECDSA's hardness rather than on the hash hiding the pubkey. This is why the "don't reuse addresses" advice exists.

---

## 5. Public-key cryptography

### Concept (no math yet)

A **public-key (asymmetric) cryptosystem** has two related keys. Some asymmetric systems are used for encryption, some for signatures. Bitcoin transactions use the signature side:

- **Private key:** kept secret; creates signatures.
- **Public key:** can be shared; verifies signatures.

For Bitcoin transactions, think **sign/verify**, not encrypt/decrypt. The defining property: knowing the public key tells you _nothing useful_ about the private key, even though the private key uniquely determines the public key.

### Main characteristics

- **One-way derivation:** `pub = derive(priv)` is fast; `priv = derive⁻¹(pub)` is computationally infeasible.
- **Deterministic:** the same private key always produces the same public key.
- **Signing produces unforgeable proofs:** without the private key, you cannot produce a signature that verifies under the public key.
- **Public verification:** anyone with the public key and the signed message can check the signature.
- **NOT quantum-safe in the long term:** Shor's algorithm can break both RSA-style factoring assumptions and ECDSA/Schnorr-style discrete-log assumptions. In P2PKH, the public key is not revealed on-chain until the output is spent; before spending, only the public-key hash is visible. This gives some extra protection before first spend, but it should not be described as full quantum safety.

### Bitcoin specifics

- Curve: **secp256k1** (a specific elliptic curve over a 256-bit prime field).
- **Private key:** a 32-byte (256-bit) number `d`, with `1 ≤ d < n`, where `n` is the curve's order (just below 2²⁵⁶).
- **Public key:** the curve point `P = d·G`, where `G` is a fixed generator point.
- **Compressed encoding (33 bytes):** 1 prefix byte (`02` if y is even, `03` if y is odd) + 32 bytes of x. The y-coordinate is recoverable from x and the prefix because the curve equation pins it down up to sign.
- **Uncompressed (65 bytes):** prefix `04` + 32 bytes x + 32 bytes y. Modern wallets almost always use compressed public keys; older Bitcoin transactions sometimes used uncompressed.

### Worked example

```
Private key: 0ce7ae59784562c3e19d17d90c7553902a0a50174f03a770d35717918bcf891a
             └────────── 32 bytes = 64 hex chars ──────────┘

Public key:  03b3986f19324a8552501163fbb26fbb4635710423e1423672af890b025c655e7b
             ││└──── x-coordinate, 32 bytes ────────────────────────────────┘
             │└── prefix byte (03 = y is odd)
             └── always part of the compressed format
```

## 6. For math-curious students

> **Reference only — do not cover in the main lecture unless a student asks.** This section runs ~25 minutes if covered fully and is not part of the lecture path. Use it as office-hours material or as a follow-up reading list.

If a student asks about the actual math, here's a recommended progression — easiest to hardest:

### Step 1: modular arithmetic

If they're shaky on `a mod n`, send them to Khan Academy's "Modular arithmetic" module first. Everything else depends on it.

### Step 2: RSA (gentlest entry to PK crypto)

RSA is the easiest signature scheme to _fully_ understand. The math fits on a postcard:

```
Setup
  pick two large primes p, q
  N = p·q
  φ(N) = (p−1)(q−1)
  pick e (public exponent), usually 65537
  compute d such that e·d ≡ 1 (mod φ(N))   ← extended Euclidean alg.

Public key  = (N, e)
Private key = d

Sign(m)    = m^d mod N
Verify(m,s): check that s^e ≡ m (mod N)
```

In real RSA you sign `H(m)`, not `m`, and there's padding (PSS, PKCS#1) that students should _not_ try to reinvent. But the core is just modular exponentiation.

**Hard problem:** factoring `N` back into `p` and `q`.

### Step 3: discrete-log groups

Move from "factoring is hard" to "discrete log is hard." In a group `(Z/p)*` with generator `g`:

```
Easy:  given g, x, p   →  compute y = g^x mod p
Hard:  given g, y, p   →  recover x
```

This is the math that ElGamal and DSA are built on. Diffie-Hellman key exchange lives here too.

### Step 4: elliptic curves (same idea, different group)

An elliptic curve over a prime field gives you a _group_ where the group operation is point addition, and "scalar multiplication" `k·G` is computed by repeated point doubling and addition. The discrete-log problem becomes:

```
Easy:  given G, k   →  compute P = k·G
Hard:  given G, P   →  recover k
```

For students with calculus background: secp256k1 is `y² = x³ + 7` over a 256-bit prime field. The geometry of "point addition" is a chord-and-tangent construction. Andrea Corbellini's blog post (linked at the bottom) is the cleanest visual introduction I know.

### Step 5: ECDSA (Bitcoin's signature scheme)

```
To sign hash z with private key d:
  pick random nonce k  (in practice: deterministic via RFC 6979)
  R = k·G
  r = R.x mod n
  s = k⁻¹ (z + r·d) mod n
  signature = (r, s), DER-encoded

To verify (r, s) against z and pubkey P:
  u₁ = z·s⁻¹ mod n
  u₂ = r·s⁻¹ mod n
  R' = u₁·G + u₂·P
  signature is valid iff r ≡ R'.x (mod n)
```

ECDSA has known awkwardness:

- The signature is **malleable** by replacing `s` with `n − s`; this is why modern wallets and standard relay policy use low-S signatures. (Section 12 covers this in detail.)
- A reused or biased `k` leaks the private key (Sony PS3 disaster, 2010).

### Step 6: Schnorr (used in Bitcoin Taproot)

Schnorr is _much_ cleaner than ECDSA. If a student finds ECDSA confusing, jumping to Schnorr is often the unlock:

```
Sign hash z with private key d:
  pick nonce k
  R = k·G
  e = H(R || P || z)            ← challenge
  s = k + e·d  mod n
  signature = (R, s)

Verify (R, s) against z and P:
  e = H(R || P || z)
  check that s·G == R + e·P
```

That's it. Linear in `d`, easy to prove secure, supports clean key/signature aggregation patterns such as MuSig2, and avoids the classic ECDSA high-S malleability issue. Bitcoin moved to Schnorr in BIP340 for Taproot.

### Recommended resource path

1. Khan Academy — modular arithmetic
2. Boneh & Shoup, _A Graduate Course in Applied Cryptography_ (free PDF) — chapters 13 & 19
3. Jimmy Song, _Programming Bitcoin_ — gentlest practical intro to secp256k1 in Python
4. Andrea Corbellini, "Elliptic Curve Cryptography: a gentle introduction" (blog series)
5. BIP 340 (Schnorr) and BIP 341 (Taproot) — surprisingly readable

---

## 7. Base58Check & Bitcoin addresses

### Why not just hex?

A 20-byte `pubKeyHash` in hex is 40 characters, looks like `918976552e1164768fba9ee3ef11d867cfcdfd31`, and is impossible to copy down by hand without errors. Bitcoin needs an encoding that is:

- shorter than hex,
- visually unambiguous (no `0/O`, no `l/I`),
- copy-paste safe,
- has built-in error detection.

### Base58

**Base58** is base-64 minus the four ambiguous characters: `0`, `O`, `I`, `l`, plus `+` and `/`. The alphabet is:

```
123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
```

Note: no `0`, no `I`, no `O`, no `l`.

### Base58Check structure

A Base58Check-encoded address is built like this:

```
[ version byte ] [ payload ] [ 4-byte checksum ]
└── 1 byte ─┘    └─ 20 bytes for P2PKH ─┘
                                          └── first 4 bytes of HASH256(version || payload)
```

Then Base58-encode the whole 25-byte blob.

| Network           | P2PKH version byte | Result starts with |
| ----------------- | ------------------ | ------------------ |
| Mainnet           | `0x00`             | `1...`             |
| Testnet (3 and 4) | `0x6f`             | `m...` or `n...`   |
| Regtest           | `0x6f`             | `m...` or `n...`   |

### Worked example

This is the address from the example. Break it down step by step:

```python
import hashlib
import base58  # pip install base58

# 1. The HASH160 of the public key
h160 = bytes.fromhex('918976552e1164768fba9ee3ef11d867cfcdfd31')
print('HASH160 :', h160.hex(), '  (20 bytes)')

# 2. Prepend the testnet P2PKH version byte
versioned = b'\x6f' + h160
print('Versioned:', versioned.hex(), '  (21 bytes)')

# 3. Compute checksum: first 4 bytes of double-SHA256
def hash256(data):
    return hashlib.sha256(hashlib.sha256(data).digest()).digest()
checksum = hash256(versioned)[:4]
print('Checksum :', checksum.hex(), '  (4 bytes)')

# 4. Concatenate
payload = versioned + checksum
print('Payload  :', payload.hex(), '  (25 bytes)')

# 5. Base58-encode the 25 bytes
address = base58.b58encode(payload).decode()
print('Address  :', address)
# → mtnUwuuyf9gLnsG1cDmEghSwB3uvqX5KZK
```

### Reverse direction (decoding an address)

```python
decoded = base58.b58decode('mtnUwuuyf9gLnsG1cDmEghSwB3uvqX5KZK')
print(decoded.hex())
# 6f 918976552e1164768fba9ee3ef11d867cfcdfd31 [4-byte checksum]
#  ^  ^---- HASH160 ----^                       ^
#  |                                           checksum bytes
#  └ testnet version byte

assert hash256(decoded[:-4])[:4] == decoded[-4:]   # checksum verifies
```

### Common student questions

- _"What if I send to a mainnet address by mistake?"_ The version byte differs (`0x00` mainnet vs `0x6f` testnet), so wallets will reject the wrong network. But across networks of the _same_ version byte, the bytes are valid in both — that's why there are dedicated testnets.
- _"Why not just use hex with a checksum?"_ Same idea would work; Base58 was the design choice for compactness and human-friendliness.

---

## 8. Bitcoin Script basics

### The model

Bitcoin Script is a tiny **stack-based, postfix** language. Execution starts with an empty stack. For a standard P2PKH spend, the spender's `scriptSig` first pushes two data items onto the stack — the signature and the public key — and then the previous output's `scriptPubKey` runs and checks those items. Opcodes pop operands off the stack, do something, and (sometimes) push results.

Important: Script is **not Turing-complete** — no loops, no arbitrary jumps. Bounded by transaction size.

### Encoding

- Every opcode is **1 byte**.
- Bytes `0x01`–`0x4b` are **push-data opcodes** — the opcode value itself is the length to push. So `0x14` is the opcode "push the next 20 bytes onto the stack." (In Bitcoin Core these are often described as `OP_PUSHBYTES_1` through `OP_PUSHBYTES_75`. Some tools display them by that name; others simply show the raw byte value.)
- For pushes longer than 75 bytes you use `OP_PUSHDATA1` / `OP_PUSHDATA2` / `OP_PUSHDATA4`.
- Small integer opcodes are special: `0x00 = OP_0`, and `0x51 = OP_1` through `0x60 = OP_16`. Other named opcodes, such as `OP_DUP`, `OP_HASH160`, and `OP_CHECKSIG`, live at their own assigned byte values.

### The opcodes used in P2PKH

| Hex    | Opcode            | What it does                                       |
| ------ | ----------------- | -------------------------------------------------- |
| `0x76` | `OP_DUP`          | Duplicate the top stack item                       |
| `0xa9` | `OP_HASH160`      | Replace top item with `RIPEMD160(SHA256(top))`     |
| `0x14` | `OP_PUSHBYTES_20` | Push the next 20 bytes onto the stack              |
| `0x88` | `OP_EQUALVERIFY`  | Pop top two; fail if not equal, else continue      |
| `0xac` | `OP_CHECKSIG`     | Pop pubkey then signature; verify; push true/false |

A P2PKH `scriptPubKey` is therefore exactly **25 bytes**:

```
76 a9 14 <20-byte-pubKeyHash> 88 ac
```

This is why the VarInt for a standard P2PKH `scriptPubKey` length is `19` (= 25 in hex).

### Execution: how scriptSig and scriptPubKey combine

For legacy outputs (pre-SegWit), the rule is:

1. Run the spender's `scriptSig` first. For standard P2PKH spends, the `scriptSig` is **push-only** — it just pushes the signature and the public key.
2. The resulting stack becomes the input stack for the previous output's `scriptPubKey`.
3. Run the `scriptPubKey`. If it finishes with a non-empty stack whose top is "true" (any non-zero value), the spend is valid. (Under common standardness/verification flags such as `CLEANSTACK` — when CLEANSTACK-style verification is applied — the final stack must contain _exactly one_ true item, no leftover entries.)

For our P2PKH transaction:

```
Initial:                  []
Run scriptSig:
  push <sig||sighash>     [sig]
  push <pubkey>           [sig, pubkey]
Hand-off to scriptPubKey:  [sig, pubkey]
  OP_DUP                  [sig, pubkey, pubkey]
  OP_HASH160              [sig, pubkey, hash160(pubkey)]
  push <expected hash>    [sig, pubkey, hash160(pubkey), expected]
  OP_EQUALVERIFY          [sig, pubkey]            ← fails if hashes differ
  OP_CHECKSIG             [01]                     ← fails if sig invalid
Final stack: [01] → valid
```

### Whiteboard summary: address vs scriptPubKey vs scriptSig

Students confuse these three constantly. Worth putting on the board explicitly:

| Term             | What it is                                      | Where it lives                                 |
| ---------------- | ----------------------------------------------- | ---------------------------------------------- |
| **Address**      | Human-readable encoding used **before** payment | Wallet UI, payment URL, copy-paste destination |
| **scriptPubKey** | Locking script **inside an output**             | Transaction's vout field, on-chain forever     |
| **scriptSig**    | Unlocking data **inside an input**              | Spending transaction's vin field               |

Concrete example from the example:

```
Address:      mtnUwuuyf9gLnsG1cDmEghSwB3uvqX5KZK
scriptPubKey: 76 a9 14 9189...fd31 88 ac          ← inside the funding tx output
scriptSig:    47 3044...01 21 03b3...e7b           ← inside our spending tx input
```

The address encodes the same `pubKeyHash` (`9189...fd31`) that ends up _inside_ the scriptPubKey. The scriptSig is built later, when we want to spend.

## 9. Raw transaction anatomy

### Field layout (legacy / non-SegWit)

```
[ version       ]   4 bytes, LE
[ input count   ]   VarInt
[ inputs[]      ]   each input:
                      [ prev_txid    ]  32 bytes, raw byte order
                      [ vout         ]  4 bytes, LE
                      [ scriptSig    ]  VarInt length + bytes
                      [ sequence     ]  4 bytes, LE
[ output count  ]   VarInt
[ outputs[]     ]   each output:
                      [ amount (sats)]  8 bytes, LE
                      [ scriptPubKey ]  VarInt length + bytes
[ locktime      ]   4 bytes, LE
```

The serialized final transaction assembles exactly this, in this order.

### VarInt (compact size integer)

A space-saving encoding for non-negative integers used throughout the Bitcoin protocol. Bitcoin Core's source code calls this `compactSize uint`; many tutorials casually call it `VarInt`. Both names are common.

| Value range                  | Bytes used | Encoding                 |
| ---------------------------- | ---------- | ------------------------ |
| `0` ≤ n ≤ `0xfc`             | 1          | `n` (single byte)        |
| `0xfd` ≤ n ≤ `0xffff`        | 3          | `0xfd` + n as LE 2 bytes |
| `0x10000` ≤ n ≤ `0xffffffff` | 5          | `0xfe` + n as LE 4 bytes |
| larger                       | 9          | `0xff` + n as LE 8 bytes |

Examples from the example:

- Input count `1` → `01` (single byte)
- Output count `1` → `01`
- scriptPubKey length `25` → `19` (single byte, since 25 < 0xfd)
- scriptSig length `106` → `6a` (single byte, since 106 < 0xfd)

### TXID computation

```
TXID_internal  =  HASH256(serialized_tx)         (32 bytes, raw order)
TXID_displayed =  reverse_bytes(TXID_internal)   (what explorers show)
```

For our example's final tx:

```
HASH256(final_tx_bytes) = 542f8ee9a53c2680e13bed3e30d9170bc3bc5a144a5450dd93eb898db2c6cc45
                          ↑ reverse →
display TXID            = 45ccc6b28d89eb93dd50544a145abcc30b17d9303eed3be180263ca5e98e2f54
```

## 10. Sequence, locktime, RBF

### Sequence (per input)

Originally intended for in-mempool transaction replacement, the `nSequence` field is now overloaded:

| Sequence value | Practical meaning                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `0xffffffff`   | Final sequence. Does not signal RBF. If **all** inputs are final, transaction-level `nLocktime` is disabled. |
| `0xfffffffe`   | Does not signal opt-in RBF, but allows transaction-level `nLocktime` to be active.                           |
| `< 0xfffffffe` | Explicitly signals opt-in RBF under BIP 125.                                                                 |

The example uses `0xfffffffd`, which explicitly signals opt-in RBF under BIP 125 because it is less than `0xfffffffe`. The wire bytes are `fdffffff` (LE).

**Important current-policy note: RBF is mempool policy, not consensus.** Historically, many nodes only replaced transactions that explicitly signaled opt-in RBF via this sequence field. **Since Bitcoin Core v29.0, the `-mempoolfullrbf` option has been removed and full-RBF is the standard behavior in Bitcoin Core.** Replacement policy therefore no longer depends only on the original transaction's opt-in signal. The sequence value is still useful to teach because it explains BIP 125 signaling, older wallet UIs, and the history of transaction replacement; but on today's network, a transaction sent with `nSequence = 0xffffffff` may still be replaced in mempools that use full-RBF policy if a higher-fee conflict is accepted.

For RBF specifically, the sequence value is best understood as policy signaling, not a binding consensus rule. **Separately, `nSequence` does have consensus meaning for two other things:** (a) transaction-level `nLocktime` is ignored only if **all** inputs have final sequence `0xffffffff`; and (b) BIP 68 / `OP_CSV` relative timelocks use `nSequence` bits to encode block-height or time-based relative delays. This example does not use those features, but be aware that "sequence is just a hint" only applies to the RBF/policy framing.

### nLocktime (transaction-level)

A 4-byte LE field at the end of the transaction:

| Value           | Interpretation                                  |
| --------------- | ----------------------------------------------- |
| `0`             | No locktime (always valid as far as time goes)  |
| `1`–`499999999` | Block height — tx is invalid until this block   |
| `≥ 500000000`   | Unix timestamp — tx is invalid before this time |

For block-height locktime, the transaction may be included in blocks with height greater than the locktime value. For time-based locktime, modern Bitcoin compares against Median Time Past, not the miner's current wall-clock time.

The example uses `0` — the transaction can be included immediately.

## 11. The legacy signing preimage

This is the conceptually trickiest part of the example. Spend time here.

### Why a preimage exists

ECDSA signs a fixed-length 32-byte hash. We need a deterministic way to produce that hash from "the transaction we're signing." The serialized transaction itself can't be hashed directly because **the signature would have to be inside the transaction** — a chicken-and-egg problem.

Solution: define a **modified version** of the transaction (the _preimage_ or _sighash preimage_) that:

1. doesn't include the signature (it's not invented yet),
2. commits to everything we want the signature to bind to.

The hash of _that_ is what gets signed. After signing, we drop the placeholder back in for the real signature.

### The legacy P2PKH placeholder rule

For the input currently being signed, replace its `scriptSig` with the **previous output's `scriptPubKey`**. (In Bitcoin documentation this previous-output script used for signing is often called the _scriptCode_; the term appears again in SegWit/BIP143.) For any other inputs in a multi-input legacy transaction, their `scriptSig` fields are empty for that signature hash.

Why this design? It commits the signature to the script that's authorizing the spend, without circular reference to the signature itself. It's a bit ad-hoc, and SegWit (BIP 143) replaced it with a much cleaner serialization.

### SIGHASH types

The signer chooses what the signature commits to via a 1-byte flag:

| Flag      | Name             | What's signed                                                               |
| --------- | ---------------- | --------------------------------------------------------------------------- |
| `0x01`    | `SIGHASH_ALL`    | All outputs, and the transaction's inputs through their outpoints/sequences |
| `0x02`    | `SIGHASH_NONE`   | All inputs, no outputs (rare; "I don't care where it goes")                 |
| `0x03`    | `SIGHASH_SINGLE` | All inputs and only the output at the same index                            |
| `\| 0x80` | `ANYONECANPAY`   | Modifier: only this input is signed; others can be added                    |

The example uses **SIGHASH_ALL = `0x01`**, which is by far the most common.

> **This table is simplified.** `SIGHASH_NONE`, `SIGHASH_SINGLE`, and `ANYONECANPAY` also change how _other_ inputs' sequence numbers and/or inputs are committed to in the preimage. `SIGHASH_SINGLE` additionally has a notorious historical edge case: when its matching output index does not exist, legacy verification hashes a constant value instead of failing. We don't use any of these modes in this example, but be aware they are not just "different flag bytes" — they alter the serialization.

### Where the flag appears

Two places. Confusing to learners but worth nailing down:

1. **In the preimage being hashed:** the 1-byte flag is widened to **4 bytes little-endian** and appended to the preimage _before_ hashing. So we append `01000000`, not `01`.
2. **In the scriptSig push of the signature:** the 1-byte flag is appended to the DER signature so that verifiers know which sighash type to recompute. So the push is `<DER sig>||01`, with `01` (one byte).

Same value, different serialization, depending on where it appears.

### The signing hash

```
preimage = serialized modified tx + 4-byte LE sighash flag
sighash = HASH256(preimage)
```

In the example:

```
preimage = 02000000 01 67d6...22f22 01000000 19 76a914...88ac fdffffff
           01 58f7050000000000 19 76a914...88ac 00000000 01000000
sighash  = 3cfe1f68361180c97f40b338076dfb937559ad7370f7f6a71b59e0ed050b321e
```

That 32-byte hash is what ECDSA actually signs.

## 12. ECDSA, low-R, low-S

### The signing recipe (already covered in section 6, summarized here)

```
Input:  z (32-byte sighash), d (private key)
Choose: k (nonce, deterministic per RFC 6979 in modern wallets)
Compute:
  R = k·G              (a point on the curve)
  r = R.x mod n
  s = k⁻¹ (z + r·d) mod n
Output: (r, s), DER-encoded
```

### DER encoding

DER (Distinguished Encoding Rules, from ASN.1) wraps the two integers `r` and `s` into a self-describing byte string:

```
30 LL 02 RL <R-bytes> 02 SL <S-bytes>
↑  ↑  ↑  ↑  ↑         ↑  ↑  ↑
|  |  |  |  |         |  |  └ S as integer bytes
|  |  |  |  |         |  └ S length
|  |  |  |  |         └ INTEGER tag
|  |  |  |  └ R as integer bytes (BE, with leading 0x00 if MSB ≥ 0x80)
|  |  |  └ R length
|  |  └ INTEGER tag
|  └ total content length
└ SEQUENCE tag
```

### Low-R

If `r`'s most-significant bit is `1`, DER must prepend a `0x00` byte to keep `r` interpreted as positive. That extra byte costs 1 byte of transaction size, which costs fees.

**Low-R grinding:** when signing, retry with different `k` values until you get an `r` whose top bit is `0`. Bitcoin Core has done this since 0.17.

Saves about half a byte on average. Across the network it's a meaningful efficiency.

### Low-S (malleability defense)

ECDSA signatures are malleable: if `(r, s)` is valid, then `(r, n − s)` also verifies mathematically. That means the same spend can have another valid-looking signature encoding, which can change the transaction ID.

Modern Bitcoin wallets produce **low-S** signatures, choosing the canonical half of the possible ECDSA signature values: `s ≤ n/2`. Bitcoin Core's default relay policy treats high-S ECDSA signatures as non-standard, so such transactions generally will not relay through default-policy nodes. This reduces ECDSA signature malleability in practice.

A few standards-history details worth keeping straight (in case students ask):

- **Strict DER encoding** is the consensus rule from **BIP 66**, activated in 2015. That rule rejects malformed DER but does not by itself enforce low-S.
- **Low-S as a consensus rule** was proposed in **BIP 146**, but BIP 146 was **closed without activation** rather than deployed as a soft fork. Low-S today is enforced via Bitcoin Core policy/standardness rules, not consensus.
- **Taproot does not use ECDSA low-S at all.** Taproot (BIP 341) uses **Schnorr signatures** (BIP 340), which use a different signature format and avoid the classic ECDSA `(r, s)` ↔ `(r, n−s)` malleability by construction. A Taproot signature is normally **64 bytes**; it can be **65 bytes** when an explicit non-zero sighash byte is appended (a 64-byte signature implies `SIGHASH_DEFAULT`). In Taproot material, the low-S concept disappears.

For Lecture 1, the takeaway is simple: modern wallets produce canonical low-S signatures today, and the example signature follows that convention.

## 13. TXID byte order

Already covered in [Endianness](#3-endianness), but worth saying again because students will hit it twice — once for the funding tx (when reading from the explorer) and once for the final tx (when looking up what they just built).

The mnemonic I use:

- **Inside the raw transaction → "raw byte order"** (what hashing produced).
- **In an explorer or `bitcoin-cli` → "display byte order"** (raw, reversed).

The conversion is: input is the raw HASH256 result, output is the display-order TXID you would paste into a block explorer.

---

## 14. Fees and vsize

### Fee math

Fees are implicit in Bitcoin: there is no "fee" field in the transaction. Instead:

```
fee = sum(input amounts) − sum(output amounts)
```

The miner who includes your transaction can spend the difference in their coinbase output.

For the example:

```
input amount  = 392,679 sats   (funding tx vout 1)
output amount = 391,000 sats
fee           =   1,679 sats
```

### vsize and fee rate

Block space is the constrained resource, so fee competition is **per byte** (or rather, per virtual byte for SegWit-aware tx).

For a legacy P2PKH transaction, `vsize = size`. Our final tx is 191 bytes, so:

```
fee rate = 1,679 sats / 191 vB ≈ 8.79 sat/vB
```

Reasonable for testnet4.

## 15. Anticipated student questions

### Conceptual

**Q: Why does Bitcoin reverse the TXID for display?**
Display convention. Bitcoin historically represents transaction and block hashes as little-endian 256-bit integers. For _block_ hashes, that integer interpretation is also used in proof-of-work target comparison (TXIDs are not used in PoW). Displaying the integer in normal hex notation produces the reversed byte order. Explorers and `bitcoin-cli` follow that convention.

**Q: Why double-SHA256?**
Mostly historical convention. One commonly given explanation is protection against length-extension-style issues, although that is not usually a practical attack on Bitcoin's specific transaction-hash use. Taproot/Schnorr later moved to BIP340-style tagged hashing instead.

**Q: What if I broadcast the example transaction myself?**
The transaction is already confirmed, so rebroadcasting the same raw transaction will not create a new spend. Nodes may ignore it as already-known or already-confirmed. A conflicting spend of the same UTXO would also be invalid — the UTXO has been spent. Use a fresh UTXO for your own attempt.

**Q: Can I use this on mainnet?**
Technically yes, the format is identical. **Don't.** The keys are public. Use testnet only.

**Q: Why are there two HASH160s in the example?**
One is the _funding_ address's HASH160 (the lock on the coins we're spending). The other is the _receiving_ address's HASH160 (the lock on the coins we're sending). They are not related; they come from two different private keys.

**Q: What stops someone from signing with a different private key?**
Two distinct failure modes, and it's worth distinguishing them:

- If the spender pushes the **public key belonging to the wrong private key**, `OP_EQUALVERIFY` fails because that public key hashes to the wrong HASH160 (the lock won't match).
- If the spender pushes the **correct public key** but signs with the **wrong private key**, `OP_EQUALVERIFY` _passes_ (the pushed pubkey is the right one), but `OP_CHECKSIG` fails because the signature doesn't verify under that pubkey.
  This distinction is useful because the two failures occur at different script checks.

**Q: Why is the previous output's scriptPubKey put into the preimage?**
Legacy quirk. The signing format needs to commit to _what's authorizing the spend_; using the previous output's scriptPubKey as the "scriptCode" was Satoshi's chosen way to do it. SegWit (BIP143) defines a cleaner alternative.

**Q: Is RBF a consensus rule?**
No — RBF is mempool policy, not consensus. `nSequence < 0xfffffffe` explicitly signals opt-in RBF under BIP 125, but **since Bitcoin Core v29.0, full-RBF is standard behavior in Bitcoin Core**, so replacement policy no longer depends only on the original transaction's opt-in signal. The sequence field is still useful to understand BIP 125 signaling, older wallet language, and the history of transaction replacement.

### Mechanical

**Q: Why is the script length in the preimage `0x19` (25), but in the final transaction `0x6a` (106)?**
Because the preimage holds a 25-byte placeholder (the previous scriptPubKey) and the final tx holds the 106-byte real scriptSig (push sig + push pubkey). Different scripts, different lengths.

**Q: Why is the SIGHASH flag sometimes 1 byte and sometimes 4 bytes?**

- 4-byte LE inside the preimage (because Bitcoin serializes integer fields as LE multi-byte).
- 1 byte appended to the DER signature inside scriptSig (so verifiers know which sighash to recompute).
  Same value, different containers.

**Q: Why is the signature push 71 bytes here? Sometimes I see 72.**
The DER-encoded ECDSA signature itself is 70 bytes in this example. Bitcoin then appends the one-byte sighash flag `01` (SIGHASH_ALL) to that signature, so the value pushed into the `scriptSig` is 71 bytes total. That is why the push opcode in front of it is `0x47` (= 71 decimal). Without **low-R** grinding, the DER signature may need one extra byte for `r` (a leading `0x00` to keep `r` interpreted as positive), so the pushed signature-plus-flag value is often 72 bytes instead of 71. Across the network, low-R grinding saves about half a byte on average, which is a meaningful efficiency.

### Math-curious

**Q: Could I implement this without an EC library?**
Yes, but it's painful and easy to get wrong (Sony PS3-level mistakes). For a learning exercise, fine. For real money, never.

**Q: Is ECDSA quantum-safe?**
No. Shor's algorithm breaks both ECDSA and RSA. The hashing of pubkeys into addresses gives you partial protection: until you spend, your pubkey is not on-chain. Once you reveal it, future quantum attackers could derive the private key from the pubkey.

**Q: Why secp256k1 specifically?**
secp256k1 is the curve Satoshi chose, and the exact rationale was not formally documented. One commonly cited practical advantage is that secp256k1 has structure (an endomorphism) that allows efficient implementations, including a roughly 30% scalar-multiplication speedup over comparable NIST curves. For this lecture, the important point is simply: Bitcoin's legacy ECDSA _and_ Taproot Schnorr both use secp256k1.

---

## 16. Resources & further reading

### Foundational

- **Mastering Bitcoin** (Andreas Antonopoulos) — chapters 4–6 cover keys, addresses, transactions. Free online.
- **Programming Bitcoin** (Jimmy Song) — builds Bitcoin from scratch in Python; chapter on EC is the gentlest practical intro.
- **Learn Me a Bitcoin** (learnmeabitcoin.com) — visual explainers of every transaction field. Excellent.

### Cryptography

- Khan Academy — "Modular arithmetic" and "Cryptography" modules.
- Boneh & Shoup, _A Graduate Course in Applied Cryptography_ — free PDF.
- Andrea Corbellini, "Elliptic Curve Cryptography: a gentle introduction" — blog series, four parts, mathematically precise but readable.
- Dan Boneh's Cryptography I (Coursera) — first half is free and worth its weight in gold.

### Bitcoin specifics

- BIP 16 (P2SH), BIP 32 (HD wallets), BIP 39 (mnemonics), BIP 125 (RBF), BIP 143 (SegWit signing), BIP 340/341/342 (Schnorr & Taproot). All readable.
- Bitcoin Core source: `src/script/interpreter.cpp` — the actual Script implementation used by Bitcoin Core.

### Tools to play with after the lecture

- A testnet4 block explorer, such as mempool.space testnet4.
- A testnet4 faucet, such as coinfaucet.eu testnet4, for practice coins.
- bitcoin-cli with `-regtest` — for offline experimentation without touching a public network.
