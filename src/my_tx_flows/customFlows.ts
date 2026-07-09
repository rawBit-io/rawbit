// rawbit-shadcn/src/my_tx_flows/customFlows.ts

import type { FlowData } from "@/types";

// Import each JSON file.
// Make sure your paths match exactly where they live in your project:

import intro from "@/my_tx_flows/p0_Intro_P2PKH.json";
import p2pk from "@/my_tx_flows/p1_P2PK_vs_P2PKH.json";
import p2pkhMultiInputSigning from "@/my_tx_flows/p2_P2PKH_multi_input_signing.json";
import bareMultisig from "@/my_tx_flows/p3_Bare_MultiSig.json";
import p2shTimelocks from "@/my_tx_flows/p4_P2SH_and_Timelocks.json";
import p2shRecoveryOpReturn from "@/my_tx_flows/p5_P2SH_and_OP_Return.json";
import atomicSwapHtlc from "@/my_tx_flows/p8_Atomic Swap (HTLC Coinswap).json";
import segwit from "@/my_tx_flows/p9_SegWit.json";
import txMalleability from "@/my_tx_flows/misc/p6_TX_Malleability.json";
import bip110 from "@/my_tx_flows/misc/p7_BIP110.json";
import intro_p2pkh_p2pk from "@/my_tx_flows/old/p1_Intro_P2PKH_and_P2PK.json";
import p2_multisig from "@/my_tx_flows/old/p2_Bare_P2MS_and_P2SH_MultiSig.json";
import locktime_tx from "@/my_tx_flows/old/p3_Locktime_Intro.json";
import locktime_script from "@/my_tx_flows/old/p4_Script_timelocks_CLTV_CSV.json";
import op_return from "@/my_tx_flows/old/p5_OP_Return.json";
import Spilman_channel from "@/my_tx_flows/old/p6_Spilman_channel.json";
import TX_Malleability from "@/my_tx_flows/old/p7_TX_malleability.json";
import SegWit_Intro from "@/my_tx_flows/old/p8_SegWit_intro.json";
import SegWit_P2WSH from "@/my_tx_flows/old/p9_SegWit_P2WSH.json";
import Wrapped_Addresses from "@/my_tx_flows/old/p10_Wrapped_Addresses.json";
import Taproot_Intro from "@/my_tx_flows/old/p11_Taproot_intro.json";
import Taproot_Script from "@/my_tx_flows/old/p12_Taproot_script.json";
import Taproot_MultiSig from "@/my_tx_flows/old/p13_Taproot_MultiSig.json";
import MuSig2 from "@/my_tx_flows/old/p14_MuSig2.json";
import TrezorSigningFlow from "@/my_tx_flows/old/p15_Trezor_signing_flow.json";
import SummerOfBitcoinPoC from "@/my_tx_flows/old/p16_Summer_of_Bitcoin_26_PoC.json";

export type CustomFlowLevel =
  | "intro"
  | "intermediate"
  | "advanced"
  | "challenge";

export interface CustomFlowTemplate {
  id: string;
  label: string;
  data: FlowData;
  section: string;
  flowNo?: number;
  level: CustomFlowLevel;
  tags: string[];
}

// Then build the array, casting each import to FlowData:
export const customFlows: CustomFlowTemplate[] = [
  {
    id: "flow-0",
    label: "Intro P2PKH",
    data: intro as unknown as FlowData,
    section: "top-level",
    flowNo: 0,
    level: "intro",
    tags: ["intro", "overview"],
  },
  {
    id: "flow-01",
    label: "P2PK vs P2PKH",
    data: p2pk as unknown as FlowData,
    section: "legacy",
    level: "intro",
    tags: ["intro", "legacy", "p2pk"],
  },
  {
    id: "flow-02",
    label: "P2PKH Multi-Input Signing",
    data: p2pkhMultiInputSigning as unknown as FlowData,
    section: "legacy",
    level: "intermediate",
    tags: ["legacy", "p2pkh", "multi-input", "signing", "transaction"],
  },
  {
    id: "flow-03",
    label: "Bare Multisig",
    data: bareMultisig as unknown as FlowData,
    section: "legacy",
    level: "intermediate",
    tags: ["legacy", "multisig", "p2ms", "script"],
  },
  {
    id: "flow-03-p2sh-timelocks",
    label: "P2SH and Timelocks",
    data: p2shTimelocks as unknown as FlowData,
    section: "legacy",
    level: "intermediate",
    tags: ["legacy", "p2sh", "timelock", "csv", "multisig", "recovery"],
  },
  {
    id: "flow-04",
    label: "P2SH Recovery with OP_RETURN",
    data: p2shRecoveryOpReturn as unknown as FlowData,
    section: "legacy",
    level: "intermediate",
    tags: ["legacy", "p2sh", "op-return", "redeemscript", "recovery"],
  },
  {
    id: "flow-08-atomic-swap-htlc",
    label: "Atomic Swap (HTLC Coinswap)",
    data: atomicSwapHtlc as unknown as FlowData,
    section: "legacy",
    flowNo: 8,
    level: "advanced",
    tags: ["legacy", "p2sh", "htlc", "atomic-swap", "coinswap", "timelock"],
  },
  {
    id: "flow-09-segwit",
    label: "SegWit",
    data: segwit as unknown as FlowData,
    section: "segwit",
    flowNo: 9,
    level: "intermediate",
    tags: ["segwit", "p2wpkh", "bip143", "witness", "transaction"],
  },
  {
    id: "flow-06-tx-malleability",
    label: "Transaction Malleability",
    data: txMalleability as unknown as FlowData,
    section: "misc",
    flowNo: 6,
    level: "intermediate",
    tags: ["malleability", "txid", "legacy", "scriptsig", "segwit"],
  },
  {
    id: "flow-07-bip110",
    label: "Embed Picture in P2SH (up to 73 KiB, BIP110-compliant)",
    data: bip110 as unknown as FlowData,
    section: "misc",
    flowNo: 7,
    level: "intermediate",
    tags: ["bip110", "p2sh", "data", "picture", "policy", "spam"],
  },
  {
    id: "flow-1",
    label: "Intro P2PKH and P2PK",
    data: intro_p2pkh_p2pk as unknown as FlowData,
    section: "legacy-foundations",
    flowNo: 1,
    level: "intro",
    tags: ["legacy", "p2pkh", "p2pk"],
  },

  {
    id: "flow-2",
    label: "Multisig: Bare P2MS and P2SH Multisig",
    data: p2_multisig as unknown as FlowData,
    section: "legacy-foundations",
    flowNo: 2,
    level: "intro",
    tags: ["legacy", "multisig", "p2sh"],
  },
  {
    id: "flow-3",
    label: "Transaction Time Locks (nLocktime & nSequence)",
    data: locktime_tx as unknown as FlowData,
    section: "scripts-timelocks-commitments",
    flowNo: 3,
    level: "intermediate",
    tags: ["locktime", "nsequence", "transaction"],
  },
  {
    id: "flow-4",
    label: "Script Time Locks (CLTV & CSV)",
    data: locktime_script as unknown as FlowData,
    section: "scripts-timelocks-commitments",
    flowNo: 4,
    level: "intermediate",
    tags: ["script", "cltv", "csv"],
  },
  {
    id: "flow-5",
    label: "OP_RETURN",
    data: op_return as unknown as FlowData,
    section: "scripts-timelocks-commitments",
    flowNo: 5,
    level: "intermediate",
    tags: ["script", "op-return", "commitment"],
  },
  {
    id: "flow-6",
    label: "Spilman channel",
    data: Spilman_channel as unknown as FlowData,
    section: "channels",
    flowNo: 6,
    level: "intermediate",
    tags: ["channel", "payment-channel", "legacy"],
  },
  {
    id: "flow-7",
    label: "TX malleability",
    data: TX_Malleability as unknown as FlowData,
    section: "segwit-legacy",
    flowNo: 7,
    level: "intermediate",
    tags: ["malleability", "txid", "legacy"],
  },
  {
    id: "flow-8",
    label: "SegWit intro",
    data: SegWit_Intro as unknown as FlowData,
    section: "segwit-legacy",
    flowNo: 8,
    level: "intermediate",
    tags: ["segwit", "p2wpkh", "bip143"],
  },
  {
    id: "flow-9",
    label: "SegWit P2WSH",
    data: SegWit_P2WSH as unknown as FlowData,
    section: "segwit-legacy",
    flowNo: 9,
    level: "intermediate",
    tags: ["segwit", "p2wsh", "script"],
  },
  {
    id: "flow-10",
    label: "Wrapped Addresses",
    data: Wrapped_Addresses as unknown as FlowData,
    section: "segwit-legacy",
    flowNo: 10,
    level: "intermediate",
    tags: ["segwit", "wrapped", "p2sh"],
  },
  {
    id: "flow-11",
    label: "Taproot intro",
    data: Taproot_Intro as unknown as FlowData,
    section: "taproot-schnorr-musig",
    flowNo: 11,
    level: "advanced",
    tags: ["taproot", "schnorr", "p2tr"],
  },
  {
    id: "flow-12",
    label: "Taproot Script",
    data: Taproot_Script as unknown as FlowData,
    section: "taproot-schnorr-musig",
    flowNo: 12,
    level: "advanced",
    tags: ["taproot", "tapscript", "control-block"],
  },
  {
    id: "flow-13",
    label: "Taproot MultiSig",
    data: Taproot_MultiSig as unknown as FlowData,
    section: "taproot-schnorr-musig",
    flowNo: 13,
    level: "advanced",
    tags: ["taproot", "multisig", "op-checksigadd"],
  },
  {
    id: "flow-14",
    label: "MuSig2",
    data: MuSig2 as unknown as FlowData,
    section: "taproot-schnorr-musig",
    flowNo: 14,
    level: "advanced",
    tags: ["musig2", "bip327", "schnorr"],
  },
  {
    id: "flow-15",
    label: "Trezor Signing Flow",
    data: TrezorSigningFlow as unknown as FlowData,
    section: "wallet-signing-labs",
    flowNo: 15,
    level: "advanced",
    tags: ["trezor", "hardware", "bip39", "bip32", "rfc6979"],
  },
  {
    id: "flow-16",
    label: "Summer of Bitcoin 2026 PoC",
    data: SummerOfBitcoinPoC as unknown as FlowData,
    section: "contributor-challenges",
    flowNo: 16,
    level: "challenge",
    tags: ["summer-of-bitcoin", "proof-of-competence", "challenge"],
  },
];
