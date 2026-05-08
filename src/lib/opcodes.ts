/*  src/lib/opcodes.ts
    ---------------------------------------------------------------
    Houses the full OP‑code catalogue plus related types so it can
    be reused without bloating every component that needs it.
    --------------------------------------------------------------- */

export interface OpItem {
  name: string;
  hex: string;
  description: string;
}

export const OP_CODES = {
  mostCommon: [
    { name: "OP_DUP", hex: "76", description: "Duplicates the top stack item" },
    { name: "OP_HASH160", hex: "a9", description: "SHA-256 then RIPEMD-160" },
    {
      name: "OP_EQUALVERIFY",
      hex: "88",
      description: "Consumes and compares two byte arrays; fails if they differ",
    },
    {
      name: "OP_CHECKSIG",
      hex: "ac",
      description: "Checks a signature against a public key and transaction digest",
    },
    {
      name: "OP_EQUAL",
      hex: "87",
      description: "Compares two byte arrays",
    },
    {
      name: "OP_RETURN",
      hex: "6a",
      description: "Fails the script; used for unspendable data outputs",
    },
    { name: "OP_0", hex: "00", description: "Pushes empty value onto stack" },
    { name: "OP_1", hex: "51", description: "Pushes 1 onto stack" },
    { name: "OP_2", hex: "52", description: "Pushes 2 onto stack" },
    { name: "OP_3", hex: "53", description: "Pushes 3 onto stack" },
    {
      name: "OP_CHECKMULTISIG",
      hex: "ae",
      description: "Checks m-of-n ECDSA signatures (disabled in Tapscript)",
    },
  ],
  scriptTemplates: [
    {
      name: "P2PKH_PREFIX",
      hex: "76a914",
      description: "OP_DUP OP_HASH160 PUSH(20)",
    },
    {
      name: "P2PKH_SUFFIX",
      hex: "88ac",
      description: "OP_EQUALVERIFY OP_CHECKSIG",
    },
    { name: "P2SH_PREFIX", hex: "a914", description: "OP_HASH160 PUSH(20)" },
    { name: "P2SH_SUFFIX", hex: "87", description: "OP_EQUAL" },
    {
      name: "P2WPKH_REDEEM",
      hex: "0014",
      description: "Version 0 + PUSH(20) for witness program",
    },
    {
      name: "P2WSH_REDEEM",
      hex: "0020",
      description: "Version 0 + PUSH(32) for witness program",
    },
    {
      name: "P2TR_PREFIX",
      hex: "5120",
      description: "OP_1 + PUSH(32) for taproot witness program",
    },
    {
      name: "OP_RETURN_PREFIX",
      hex: "6a",
      description: "OP_RETURN (null data output)",
    },
    {
      name: "2OF3_MULTISIG_PREFIX",
      hex: "5221",
      description: "OP_2 + PUSH(33) (start of 2-of-3)",
    },
    {
      name: "2OF3_MULTISIG_SUFFIX",
      hex: "5253ae",
      description: "OP_2 OP_3 OP_CHECKMULTISIG",
    },
  ],
  constants: [
    {
      name: "OP_0 / OP_FALSE",
      hex: "00",
      description: "Empty array of bytes (often used as false)",
    },
    { name: "OP_1NEGATE", hex: "4f", description: "Push -1 onto the stack" },
    { name: "OP_1 / OP_TRUE", hex: "51", description: "Push 1 onto the stack" },
    { name: "OP_2", hex: "52", description: "Push 2 onto the stack" },
    { name: "OP_3", hex: "53", description: "Push 3 onto the stack" },
    { name: "OP_4", hex: "54", description: "Push 4 onto the stack" },
    { name: "OP_5", hex: "55", description: "Push 5 onto the stack" },
    { name: "OP_6", hex: "56", description: "Push 6 onto the stack" },
    { name: "OP_7", hex: "57", description: "Push 7 onto the stack" },
    { name: "OP_8", hex: "58", description: "Push 8 onto the stack" },
    { name: "OP_9", hex: "59", description: "Push 9 onto the stack" },
    { name: "OP_10", hex: "5a", description: "Push 10 onto the stack" },
    { name: "OP_11", hex: "5b", description: "Push 11 onto the stack" },
    { name: "OP_12", hex: "5c", description: "Push 12 onto the stack" },
    { name: "OP_13", hex: "5d", description: "Push 13 onto the stack" },
    { name: "OP_14", hex: "5e", description: "Push 14 onto the stack" },
    { name: "OP_15", hex: "5f", description: "Push 15 onto the stack" },
    { name: "OP_16", hex: "60", description: "Push 16 onto the stack" },
  ],
  flowControl: [
    { name: "OP_NOP", hex: "61", description: "No operation" },
    {
      name: "OP_IF",
      hex: "63",
      description: "Consumes top value; executes branch if true",
    },
    {
      name: "OP_NOTIF",
      hex: "64",
      description: "Consumes top value; executes branch if false",
    },
    {
      name: "OP_ELSE",
      hex: "67",
      description: "Execute if previous IF/NOTIF not executed",
    },
    { name: "OP_ENDIF", hex: "68", description: "End IF/NOTIF/ELSE block" },
    {
      name: "OP_VERIFY",
      hex: "69",
      description: "Consumes top value; fails if false",
    },
    { name: "OP_RETURN", hex: "6a", description: "Fails the script immediately" },
  ],
  stackOperations: [
    {
      name: "OP_TOALTSTACK",
      hex: "6b",
      description: "Moves item from main to alt stack",
    },
    {
      name: "OP_FROMALTSTACK",
      hex: "6c",
      description: "Moves item from alt to main stack",
    },
    { name: "OP_2DROP", hex: "6d", description: "Removes top two stack items" },
    {
      name: "OP_2DUP",
      hex: "6e",
      description: "Duplicates top two stack items",
    },
    {
      name: "OP_3DUP",
      hex: "6f",
      description: "Duplicates top three stack items",
    },
    { name: "OP_2OVER", hex: "70", description: "Copies items 3 and 4 to top" },
    {
      name: "OP_2ROT",
      hex: "71",
      description: "Moves 5th and 6th items to top",
    },
    {
      name: "OP_2SWAP",
      hex: "72",
      description: "Swaps top two pairs of items",
    },
    {
      name: "OP_IFDUP",
      hex: "73",
      description: "Duplicates top item if it's not 0",
    },
    { name: "OP_DEPTH", hex: "74", description: "Pushes the stack size" },
    { name: "OP_DROP", hex: "75", description: "Removes top stack item" },
    { name: "OP_DUP", hex: "76", description: "Duplicates top stack item" },
    {
      name: "OP_NIP",
      hex: "77",
      description: "Removes second-to-top stack item",
    },
    {
      name: "OP_OVER",
      hex: "78",
      description: "Copies second-to-top stack item to top",
    },
    {
      name: "OP_PICK",
      hex: "79",
      description: "Consumes n, then copies item n positions back to the top",
    },
    {
      name: "OP_ROLL",
      hex: "7a",
      description: "Consumes n, then moves item n positions back to the top",
    },
    { name: "OP_ROT", hex: "7b", description: "Rotates the top three items" },
    { name: "OP_SWAP", hex: "7c", description: "Swaps the top two items" },
    {
      name: "OP_TUCK",
      hex: "7d",
      description: "Copies the top item after the second item",
    },
  ],
  stringOperations: [
    {
      name: "OP_SIZE",
      hex: "82",
      description: "Pushes byte length of top item without removing it",
    },
  ],
  bitwiseLogic: [
    {
      name: "OP_EQUAL",
      hex: "87",
      description: "Compares top two byte arrays; pushes true or false",
    },
    {
      name: "OP_EQUALVERIFY",
      hex: "88",
      description: "Consumes and compares top two byte arrays; fails if they differ",
    },
  ],
  arithmetic: [
    { name: "OP_1ADD", hex: "8b", description: "Adds 1 to the top item" },
    {
      name: "OP_1SUB",
      hex: "8c",
      description: "Subtracts 1 from the top item",
    },
    {
      name: "OP_NEGATE",
      hex: "8f",
      description: "Flips the sign of the top item",
    },
    { name: "OP_ABS", hex: "90", description: "Makes the top item positive" },
    { name: "OP_NOT", hex: "91", description: "If top is 0 push 1 else 0" },
    {
      name: "OP_0NOTEQUAL",
      hex: "92",
      description: "If top is 0 push 0 else 1",
    },
    { name: "OP_ADD", hex: "93", description: "Adds the top two items" },
    {
      name: "OP_SUB",
      hex: "94",
      description: "Subtracts top from second-top item",
    },
    { name: "OP_BOOLAND", hex: "9a", description: "1 if both items are not 0" },
    { name: "OP_BOOLOR", hex: "9b", description: "1 if either item is not 0" },
    { name: "OP_NUMEQUAL", hex: "9c", description: "1 if numbers are equal" },
    {
      name: "OP_NUMEQUALVERIFY",
      hex: "9d",
      description: "Compares top two numbers and fails if they differ",
    },
    {
      name: "OP_NUMNOTEQUAL",
      hex: "9e",
      description: "1 if numbers not equal",
    },
    { name: "OP_LESSTHAN", hex: "9f", description: "1 if second-top < top" },
    { name: "OP_GREATERTHAN", hex: "a0", description: "1 if second-top > top" },
    {
      name: "OP_LESSTHANOREQUAL",
      hex: "a1",
      description: "1 if second-top <= top",
    },
    {
      name: "OP_GREATERTHANOREQUAL",
      hex: "a2",
      description: "1 if second-top >= top",
    },
    {
      name: "OP_MIN",
      hex: "a3",
      description: "Returns smaller of two numbers",
    },
    { name: "OP_MAX", hex: "a4", description: "Returns larger of two numbers" },
    {
      name: "OP_WITHIN",
      hex: "a5",
      description: "Checks x in range min <= x < max",
    },
  ],
  cryptographic: [
    {
      name: "OP_RIPEMD160",
      hex: "a6",
      description: "RIPEMD-160 hash of top item",
    },
    { name: "OP_SHA1", hex: "a7", description: "SHA-1 hash of top item" },
    { name: "OP_SHA256", hex: "a8", description: "SHA-256 hash of top item" },
    { name: "OP_HASH160", hex: "a9", description: "RIPEMD-160(SHA-256)" },
    { name: "OP_HASH256", hex: "aa", description: "SHA-256(SHA-256)" },
    {
      name: "OP_CODESEPARATOR",
      hex: "ab",
      description: "Marks start of sig‑checked data",
    },
    {
      name: "OP_CHECKSIG",
      hex: "ac",
      description: "Checks a signature against a public key and transaction digest",
    },
    {
      name: "OP_CHECKSIGVERIFY",
      hex: "ad",
      description: "Runs OP_CHECKSIG, then fails if false",
    },
    {
      name: "OP_CHECKMULTISIG",
      hex: "ae",
      description: "Checks m-of-n ECDSA signatures (disabled in Tapscript)",
    },
    {
      name: "OP_CHECKMULTISIGVERIFY",
      hex: "af",
      description: "Runs OP_CHECKMULTISIG, then fails if false",
    },
  ],
  tapscript: [
    {
      name: "OP_CHECKSIGADD",
      hex: "ba",
      description:
        "Tapscript: valid signature increments counter; empty signature leaves it unchanged; invalid signature fails",
    },
  ],
  timelock: [
    {
      name: "OP_CHECKLOCKTIMEVERIFY",
      hex: "b1",
      description: "Fails if transaction nLockTime does not satisfy top value",
    },
    {
      name: "OP_CHECKSEQUENCEVERIFY",
      hex: "b2",
      description: "Fails if input relative locktime does not satisfy top value",
    },
  ],
  reserved: [
    // Note: OP_SUCCESSx opcodes are intentionally omitted; in Tapscript they
    // immediately succeed and are reserved for future upgrades.
    { name: "OP_NOP1", hex: "b0", description: "Reserved for future use" },
    { name: "OP_NOP4", hex: "b3", description: "Reserved for future use" },
    { name: "OP_NOP5", hex: "b4", description: "Reserved for future use" },
    { name: "OP_NOP6", hex: "b5", description: "Reserved for future use" },
    { name: "OP_NOP7", hex: "b6", description: "Reserved for future use" },
    { name: "OP_NOP8", hex: "b7", description: "Reserved for future use" },
    { name: "OP_NOP9", hex: "b8", description: "Reserved for future use" },
    { name: "OP_NOP10", hex: "b9", description: "Reserved for future use" },
  ],
} as const;

export type OpCodeCategories = keyof typeof OP_CODES;

/* A friendly map for UI */
export const categoryNames: Record<OpCodeCategories, string> = {
  mostCommon: "Most Common",
  scriptTemplates: "Script Templates",
  constants: "Constants",
  flowControl: "Flow Control",
  stackOperations: "Stack Operations",
  stringOperations: "String Operations",
  bitwiseLogic: "Bitwise Logic",
  arithmetic: "Arithmetic",
  cryptographic: "Cryptographic",
  tapscript: "Tapscript (BIP342)",
  timelock: "Timelock",
  reserved: "Reserved",
};

/* Helper: locate an OpItem by name */
export function findOpItemByName(name: string): OpItem | null {
  for (const key in OP_CODES) {
    const found = OP_CODES[key as OpCodeCategories].find(
      (o) => o.name === name
    );
    if (found) return found;
  }
  return null;
}
