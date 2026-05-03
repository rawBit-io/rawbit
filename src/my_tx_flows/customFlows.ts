// rawbit-shadcn/src/my_tx_flows/customFlows.ts

import type { FlowData } from "@/types";

// Import each JSON file.
// Make sure your paths match exactly where they live in your project:

import intro from "@/my_tx_flows/p0_Intro.json";
import intro_p2pkh_p2pk from "@/my_tx_flows/p1_Intro_P2PKH_and_P2PK.json";
import p2_multisig from "@/my_tx_flows/p2_Bare_P2MS_and_P2SH_MultiSig.json";
import locktime_tx from "@/my_tx_flows/p3_Locktime_Intro.json";
import locktime_script from "@/my_tx_flows/p4_Script_timelocks_CLTV_CSV.json";
import op_return from "@/my_tx_flows/p5_OP_Return.json";
import Spilman_channel from "@/my_tx_flows/p6_Spilman_channel.json";
import TX_Malleability from "@/my_tx_flows/p7_TX_malleability.json";
import SegWit_Intro from "@/my_tx_flows/p8_SegWit_intro.json";
import SegWit_P2WSH from "@/my_tx_flows/p9_SegWit_P2WSH.json";
import Wrapped_Addresses from "@/my_tx_flows/p10_Wrapped_Addresses.json";
import Taproot_Intro from "@/my_tx_flows/p11_Taproot_intro.json";
import Taproot_Script from "@/my_tx_flows/p12_Taproot_script.json";
import Taproot_MultiSig from "@/my_tx_flows/p13_Taproot_MultiSig.json";
import MuSig2 from "@/my_tx_flows/p14_MuSig2.json";
import TrezorSigningFlow from "@/my_tx_flows/p15_Trezor_signing_flow.json";
import SummerOfBitcoinPoC from "@/my_tx_flows/p16_Summer_of_Bitcoin_26_PoC.json";

export type CustomFlowLevel = "intro" | "intermediate" | "advanced" | "challenge";

export interface CustomFlowTemplate {
  id: string;
  label: string;
  data: FlowData;
  section: string;
  lessonNo?: number;
  level: CustomFlowLevel;
  tags: string[];
}

// Then build the array, casting each import to FlowData:
export const customFlows: CustomFlowTemplate[] = [
  {
    id: "flow-0",
    label: "Intro",
    data: intro as unknown as FlowData,
    section: "top-level",
    lessonNo: 0,
    level: "intro",
    tags: ["intro", "overview"],
  },
  {
    id: "flow-1",
    label: "Intro P2PKH and P2PK",
    data: intro_p2pkh_p2pk as unknown as FlowData,
    section: "legacy-foundations",
    lessonNo: 1,
    level: "intro",
    tags: ["legacy", "p2pkh", "p2pk"],
  },

  {
    id: "flow-2",
    label: "Multisig: Bare P2MS and P2SH Multisig",
    data: p2_multisig as unknown as FlowData,
    section: "legacy-foundations",
    lessonNo: 2,
    level: "intro",
    tags: ["legacy", "multisig", "p2sh"],
  },
  {
    id: "flow-3",
    label: "Transaction Time Locks (nLocktime & nSequence)",
    data: locktime_tx as unknown as FlowData,
    section: "scripts-timelocks-commitments",
    lessonNo: 3,
    level: "intermediate",
    tags: ["locktime", "nsequence", "transaction"],
  },
  {
    id: "flow-4",
    label: "Script Time Locks (CLTV & CSV)",
    data: locktime_script as unknown as FlowData,
    section: "scripts-timelocks-commitments",
    lessonNo: 4,
    level: "intermediate",
    tags: ["script", "cltv", "csv"],
  },
  {
    id: "flow-5",
    label: "OP_RETURN",
    data: op_return as unknown as FlowData,
    section: "scripts-timelocks-commitments",
    lessonNo: 5,
    level: "intermediate",
    tags: ["script", "op-return", "commitment"],
  },
  {
    id: "flow-6",
    label: "Spilman channel",
    data: Spilman_channel as unknown as FlowData,
    section: "channels",
    lessonNo: 6,
    level: "intermediate",
    tags: ["channel", "payment-channel", "legacy"],
  },
  {
    id: "flow-7",
    label: "TX malleability",
    data: TX_Malleability as unknown as FlowData,
    section: "segwit",
    lessonNo: 7,
    level: "intermediate",
    tags: ["malleability", "txid", "legacy"],
  },
  {
    id: "flow-8",
    label: "SegWit intro",
    data: SegWit_Intro as unknown as FlowData,
    section: "segwit",
    lessonNo: 8,
    level: "intermediate",
    tags: ["segwit", "p2wpkh", "bip143"],
  },
  {
    id: "flow-9",
    label: "SegWit P2WSH",
    data: SegWit_P2WSH as unknown as FlowData,
    section: "segwit",
    lessonNo: 9,
    level: "intermediate",
    tags: ["segwit", "p2wsh", "script"],
  },
  {
    id: "flow-10",
    label: "Wrapped Addresses",
    data: Wrapped_Addresses as unknown as FlowData,
    section: "segwit",
    lessonNo: 10,
    level: "intermediate",
    tags: ["segwit", "wrapped", "p2sh"],
  },
  {
    id: "flow-11",
    label: "Taproot intro",
    data: Taproot_Intro as unknown as FlowData,
    section: "taproot-schnorr-musig",
    lessonNo: 11,
    level: "advanced",
    tags: ["taproot", "schnorr", "p2tr"],
  },
  {
    id: "flow-12",
    label: "Taproot Script",
    data: Taproot_Script as unknown as FlowData,
    section: "taproot-schnorr-musig",
    lessonNo: 12,
    level: "advanced",
    tags: ["taproot", "tapscript", "control-block"],
  },
  {
    id: "flow-13",
    label: "Taproot MultiSig",
    data: Taproot_MultiSig as unknown as FlowData,
    section: "taproot-schnorr-musig",
    lessonNo: 13,
    level: "advanced",
    tags: ["taproot", "multisig", "op-checksigadd"],
  },
  {
    id: "flow-14",
    label: "MuSig2",
    data: MuSig2 as unknown as FlowData,
    section: "taproot-schnorr-musig",
    lessonNo: 14,
    level: "advanced",
    tags: ["musig2", "bip327", "schnorr"],
  },
  {
    id: "flow-15",
    label: "Trezor Signing Flow",
    data: TrezorSigningFlow as unknown as FlowData,
    section: "wallet-signing-labs",
    lessonNo: 15,
    level: "advanced",
    tags: ["trezor", "hardware", "bip39", "bip32", "rfc6979"],
  },
  {
    id: "flow-16",
    label: "Summer of Bitcoin 2026 PoC",
    data: SummerOfBitcoinPoC as unknown as FlowData,
    section: "contributor-challenges",
    lessonNo: 16,
    level: "challenge",
    tags: ["summer-of-bitcoin", "proof-of-competence", "challenge"],
  },
];
