// rawbit-shadcn/src/my_tx_flows/customFlows.ts

import type { FlowData } from "@/types";

// Import each JSON file.
// Make sure your paths match exactly where they live in your project:

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
import TXID_Computation from "@/my_tx_flows/p15_TXID_Computation.json";
import Coinbase_Transaction from "@/my_tx_flows/p16_Coinbase_Transaction.json";
import Merkle_Tree from "@/my_tx_flows/p18_Merkle_Tree.json";
import Block_Header_PoW from "@/my_tx_flows/p19_Block_Header_PoW.json";

// Then build the array, casting each import to FlowData:
export const customFlows = [
  {
    id: "flow-1",
    label: "Intro P2PKH and P2PK",
    data: intro_p2pkh_p2pk as unknown as FlowData,
  },

  {
    id: "flow-2",
    label: "Multisig: Bare P2MS and P2SH Multisig",
    data: p2_multisig as unknown as FlowData,
  },
  {
    id: "flow-3",
    label: "Transaction Time Locks (nLocktime & nSequence)",
    data: locktime_tx as unknown as FlowData,
  },
  {
    id: "flow-4",
    label: "Script Time Locks (CLTV & CSV)",
    data: locktime_script as unknown as FlowData,
  },
  {
    id: "flow-5",
    label: "OP_RETURN",
    data: op_return as unknown as FlowData,
  },
  {
    id: "flow-6",
    label: "Spilman channel",
    data: Spilman_channel as unknown as FlowData,
  },
  {
    id: "flow-7",
    label: "TX malleability",
    data: TX_Malleability as unknown as FlowData,
  },
  {
    id: "flow-8",
    label: "SegWit intro",
    data: SegWit_Intro as unknown as FlowData,
  },
  {
    id: "flow-9",
    label: "SegWit P2WSH",
    data: SegWit_P2WSH as unknown as FlowData,
  },
  {
    id: "flow-10",
    label: "Wrapped Addresses",
    data: Wrapped_Addresses as unknown as FlowData,
  },
  {
    id: "flow-11",
    label: "Taproot intro",
    data: Taproot_Intro as unknown as FlowData,
  },
  {
    id: "flow-12",
    label: "Taproot Script",
    data: Taproot_Script as unknown as FlowData,
  },
  {
    id: "flow-13",
    label: "Taproot MultiSig",
    data: Taproot_MultiSig as unknown as FlowData,
  },
  {
    id: "flow-14",
    label: "MuSig2",
    data: MuSig2 as unknown as FlowData,
  },
  {
    id: "flow-15",
    label: "Computing a TXID",
    data: TXID_Computation as unknown as FlowData,
  },
  {
    id: "flow-16",
    label: "Coinbase Transaction",
    data: Coinbase_Transaction as unknown as FlowData,
  },
  {
    id: "flow-18",
    label: "Merkle Tree",
    data: Merkle_Tree as unknown as FlowData,
  },
  {
    id: "flow-19",
    label: "Block Header & Proof-of-Work",
    data: Block_Header_PoW as unknown as FlowData,
  },
];
