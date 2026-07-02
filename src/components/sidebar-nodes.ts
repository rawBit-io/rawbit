// src/components/sidebar-nodes.ts

import type { NodeTemplate } from "@/types";
import {
  DEFAULT_TX_PARSE_FIELDS,
  buildTxFieldExtractOutputPorts,
} from "@/lib/nodes/txFieldExtract";
import { buildOpcodeInputState } from "@/lib/opcodeNodeData";

/**
 * Node templates organized by categories:
 * - Canvas & Inputs
 * - Encoding & Script Data
 * - Transactions
 * - Keys & Addresses
 * - Hashes
 * - Signing & Verification
 * - Logic & Checks
 */
export const allSidebarNodes: NodeTemplate[] = [
  // ------------------------------------------------------------------
  // INPUT/DATA
  // ------------------------------------------------------------------
  {
    functionName: "identity",
    label: "Input",
    category: "Canvas & Inputs",
    subcategory: "General",
    description: "Simple data entry node to accept raw user input",
    type: "calculation",
    nodeData: {
      functionName: "identity",
      title: "Input",
      showField: true,
      numInputs: 0,
      value: "",

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          { index: 0, label: "INPUT VALUE:", rows: 1, unconnectable: true },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "shadcn_group_node",
    label: "Group Node",
    category: "Canvas & Inputs",
    subcategory: "General",
    description: "Container to group multiple nodes (no nesting).",
    type: "shadcnGroup",
    nodeData: {
      isGroup: true,
      groupFlash: false,
      width: 380,
      height: 220,
      title: "Group Node",
      fontSize: 44,
    },
  },
  {
    functionName: "shadcn_text_info",
    label: "Text Info Node",
    category: "Canvas & Inputs",
    subcategory: "General",
    description: "Displays markdown text with adjustable font size",
    type: "shadcnTextInfo",
    nodeData: {
      content: "Double-click to edit",
      fontSize: 28,
      width: 300,
      height: 200,
      title: "Text Info Node",
    },
  },
  {
    functionName: "concat_all",
    label: "Concat",
    category: "Canvas & Inputs",
    subcategory: "General",
    description: "Concatenate multiple elements (general purpose)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "Concat",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: [] },
      compactConcatInputs: true,

      version: 0,
      result: "",
      inputStructure: {
        groups: [
          {
            title: "INPUTS[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 1,
            maxInstances: 99,
            fields: [
              {
                index: 0,
                label: "Value:",
                placeholder: "<input>",
                rows: 1,
                autoResizeMaxRows: 3,
              },
            ],
          },
        ],
        ungrouped: [],
        afterGroups: [],
      },
      groupInstances: { "INPUTS[]": 2 },
      groupInstanceKeys: { "INPUTS[]": [0, 100] },
      baseHeight: 80,
    },
  },

  // ------------------------------------------------------------------
  // DATA FORMATTING
  // ------------------------------------------------------------------
  {
    type: "opCodeNode",
    functionName: "op_code_select",
    label: "Opcode Sequence",
    category: "Encoding & Script Data",
    subcategory: "Script Opcodes",
    description: "Build a sequence of Opcodes and output the final hex.",
    nodeData: {
      title: "Opcode Sequence",
      result: "",
      ...buildOpcodeInputState([]),
    },
  },
  {
    type: "scriptViewer",
    functionName: "script_viewer",
    label: "Script Viewer",
    category: "Encoding & Script Data",
    subcategory: "Script Opcodes",
    description:
      "Read-only: connect a script hex and see it disassembled into indented, readable opcodes.",
    nodeData: {
      functionName: "script_viewer",
      title: "Script Viewer",
      numInputs: 1,
      value: "",
      inputStructure: {
        ungrouped: [{ index: 0, label: "SCRIPT HEX:", rows: 1 }],
        groups: [],
        afterGroups: [],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "uint32_to_little_endian_4_bytes",
    label: "Uint32 → LE-4",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description:
      "Convert uint32 to 4-byte LE hex (version, locktime, vout, sequence)",
    type: "calculation",
    nodeData: {
      functionName: "uint32_to_little_endian_4_bytes",
      title: "Uint32 → LE-4",
      numInputs: 1,

      value: "2",

      groupInstances: {},
      inputs: { val: "2" },
      result: "",
    },
  },
  {
    functionName: "sighash_type_to_le4",
    label: "SIGHASH Type → LE-4",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description:
      "Encode a 1-byte SIGHASH type as the 4-byte LE suffix used in signature preimages",
    type: "calculation",
    nodeData: {
      functionName: "sighash_type_to_le4",
      title: "SIGHASH Type → LE-4",
      numInputs: 1,

      value: "01",

      groupInstances: {},
      inputs: { val: "01" },
      result: "",
      inputStructure: {
        ungrouped: [{ index: 0, label: "SIGHASH TYPE:", rows: 1 }],
      },
    },
  },
  {
    functionName: "encode_varint",
    label: "Int → VarInt",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description: "Creates variable-length integer for Bitcoin protocol",
    type: "calculation",
    nodeData: {
      functionName: "encode_varint",
      title: "Int → VarInt",
      numInputs: 1,

      groupInstances: {},
      result: "",
      inputs: { val: "1" },
    },
  },
  {
    functionName: "satoshi_to_8_le",
    label: "Satoshi → LE-8",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description: "Convert a satoshi value to 8-byte little-endian",
    type: "calculation",
    nodeData: {
      functionName: "satoshi_to_8_le",
      title: "Satoshi → LE-8",
      numInputs: 1,

      value: "50000000",

      groupInstances: {},
      inputs: { val: "50000000" },
      result: "",
    },
  },
  {
    functionName: "reverse_txid_bytes",
    label: "TXID → Reversed",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description: "Reverses byte order of transaction IDs",
    type: "calculation",
    nodeData: {
      functionName: "reverse_txid_bytes",
      title: "TXID → Reversed",
      numInputs: 1,

      groupInstances: {},
      result: "",
      inputs: { val: "" },
    },
  },
  {
    functionName: "varint_encoded_byte_length",
    label: "Data → VarInt Length",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description: "Length of hex as VarInt",
    type: "calculation",
    nodeData: {
      functionName: "varint_encoded_byte_length",
      title: "Data → VarInt Length",
      numInputs: 1,

      groupInstances: {},
      inputs: { val: "76a914..." },
      result: "",
    },
  },
  {
    functionName: "encode_script_push_data",
    label: "Data → Push Opcode",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description:
      "Get Bitcoin Script push opcode for hex data (returns only the opcode)",
    type: "calculation",
    nodeData: {
      functionName: "encode_script_push_data",
      title: "Data → Push Opcode",

      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Hex Data:",
            rows: 2,
            placeholder: "Enter hex data to calculate push opcode",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "bip110_picture_p2sh_scripts",
    label: "Picture → P2SH Scripts",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description:
      "Load an image and split it into BIP110-sized P2SH redeemScripts",
    type: "calculation",
    nodeData: {
      functionName: "bip110_picture_p2sh_scripts",
      title: "Picture → P2SH Scripts",
      numInputs: 2,
      paramExtraction: "multi_val",
      version: 0,
      inputs: { vals: { 0: "", 1: "" } },
      result: "",
      outputPorts: [{ label: "scripts", handleId: "", showHandle: false }],
      outputValues: {},
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Picture hex:",
            rows: 3,
            autoResizeMaxRows: 4,
            placeholder: "Load an image file or paste hex bytes",
            fileInput: "image-hex",
            fileInputLabel: "Load Image",
            accept: "image/*",
            maxFileBytes: 73 * 1024,
          },
          {
            index: 1,
            label: "Compressed pubkey:",
            rows: 2,
            autoResizeMaxRows: 3,
            placeholder: "33-byte compressed pubkey, starts 02 or 03",
            comment:
              "Appended as <pubkey> OP_CHECKSIG so each reveal spend still requires your signature.",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "int_to_script_bytes",
    label: "Int → ScriptBytes",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description:
      "Unsigned integer → minimal little-endian hex (no push-opcode). " +
      "Use for CSV, CLTV, arithmetic opcodes, etc.",
    type: "calculation",
    nodeData: {
      functionName: "int_to_script_bytes",
      title: "Int → ScriptBytes",

      numInputs: 1,

      version: 0,
      inputs: { val: 0 },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Integer value:",
            rows: 1,
            placeholder: "e.g. 4404774",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "text_to_hex",
    label: "Text → Hex",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description:
      "Convert UTF-8 text to hex encoding (e.g., '2009' → '32303039')",
    type: "calculation",
    nodeData: {
      functionName: "text_to_hex",
      title: "Text → Hex",

      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Text input:",
            rows: 1,
            placeholder: "e.g., 2009",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "hex_to_text",
    label: "Hex → Text",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description:
      "Decode hex-encoded UTF-8 text (e.g., '32303039' → '2009')",
    type: "calculation",
    nodeData: {
      functionName: "hex_to_text",
      title: "Hex → Text",

      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Hex input:",
            rows: 2,
            autoResizeMaxRows: 5,
            placeholder: "e.g., 32303039",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "blocks_to_sequence_number", // Changed
    label: "Blocks → Relative Lock", // Changed
    category: "Encoding & Script Data",
    subcategory: "Locktime & Sequence Encoding",
    description: "Block-based relative lock value for nSequence/CSV",
    type: "calculation",
    nodeData: {
      functionName: "blocks_to_sequence_number", // Changed
      title: "Blocks → Relative Lock", // Changed

      numInputs: 1,

      version: 0,
      inputs: { val: 10 },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Delay (blocks):",
            rows: 1,
            placeholder: "e.g., 10",
          },
        ],
      },
      groupInstances: {},
    },
  },

  // ------------------------------------------------------------------
  // TRANSACTION TEMPLATES
  // ------------------------------------------------------------------
  {
    functionName: "concat_all",
    label: "TX Template legacy",
    category: "Transactions",
    subcategory: "General",
    description:
      "Example specialised concat node with fields for version, input count, etc.",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "TX Template legacy",
      paramExtraction: "multi_val",
      numInputs: 12,
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "VERSION[4]:",
            rows: 1,
            comment:
              "Transaction version (4-byte LE). Legacy-only template: no marker/flag, no witnesses.",
          },
          {
            index: 10,
            label: "INPUT_COUNT (VarInt):",
            rows: 1,
            small: true,
            comment: "Number of inputs (varint).",
          },
        ],
        betweenGroups: {
          "INPUTS[]": [
            {
              index: 2_000,
              label: "OUTPUT_COUNT (VarInt):",
              rows: 1,
              small: true,
              comment: "Number of outputs (varint).",
            },
          ],
        },
        afterGroups: [
          {
            index: 4_000,
            label: "LOCKTIME[4]:",
            placeholder: "00000000",
            rows: 1,
            comment: "nLockTime (4-byte LE). Use 00000000 if none.",
          },
        ],
        groups: [
          {
            title: "INPUTS[]",
            baseIndex: 1_000,
            expandable: true,
            fieldCountToAdd: 5,
            minInstances: 1,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "TXID[32]:",
                placeholder: "Prev TX ID",
                rows: 2,
                comment:
                  "Previous transaction ID in little-endian (reversed byte order).",
              },
              {
                index: 10,
                label: "VOUT[4]:",
                placeholder: "00000000",
                rows: 1,
                comment: "Output index (4-byte LE).",
              },
              {
                index: 20,
                label: "SCRIPT_LENGTH (VarInt):",
                rows: 1,
                allowEmpty00: true,
                comment:
                  "Length of scriptSig in bytes (varint). For legacy spends this should be non-zero.",
              },
              {
                index: 30,
                label: "SCRIPT_SIG[]:",
                placeholder: "<sig> <pk>",
                rows: 3,
                allowEmptyBlank: true,
                comment:
                  "Unlocking script. P2PKH: <sig> <pubkey>. P2SH: push redeem script (non-SegWit).",
              },
              {
                index: 40,
                label: "SEQUENCE[4]:",
                placeholder: "ffffffff",
                rows: 1,
                comment:
                  "nSequence (4-byte LE). ffffffff = final; lower values enable locktime/RBF.",
              },
            ],
          },
          {
            title: "OUTPUTS[]",
            baseIndex: 3_000,
            expandable: true,
            fieldCountToAdd: 3,
            minInstances: 1,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "AMOUNT[8]:",
                placeholder: "Satoshis (hex)",
                rows: 1,
                comment: "Amount in satoshis (8-byte LE).",
              },
              {
                index: 10,
                label: "SCRIPT_PUBKEY_LENGTH:",
                rows: 1,
                small: true,
                comment: "Length of scriptPubKey (varint).",
              },
              {
                index: 20,
                label: "SCRIPT_PUBKEY[]:",
                placeholder: "Locking script",
                rows: 3,
                comment:
                  "Locking script, e.g., P2PKH (76a9...88ac) or P2SH (a9...87).",
              },
            ],
          },
        ],
      },
      groupInstances: { "INPUTS[]": 1, "OUTPUTS[]": 1 },
      groupInstanceKeys: { "INPUTS[]": [1_000], "OUTPUTS[]": [3_000] },
      baseHeight: 120,
    },
  },
  {
    functionName: "concat_all",
    label: "TX Template",
    category: "Transactions",
    subcategory: "General",
    description:
      "Assembles any Bitcoin transaction: legacy, SegWit, or mixed. For SegWit/mixed, include marker+flag and witnesses. Legacy inputs need '00' witness.",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "TX Template",
      paramExtraction: "multi_val",
      numInputs: 15,
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "VERSION[4]:",
            rows: 1,
            placeholder: "02000000",
            comment: "Transaction version",
          },
          {
            index: 10,
            label: "MARKER[1]:",
            rows: 1,
            placeholder: "00 or empty",
            small: true,
            allowEmptyBlank: true,
            comment:
              "SegWit marker. Use 00 only if at least one input has witness data; leave empty for legacy-only.",
          },
          {
            index: 20,
            label: "FLAG[1]:",
            rows: 1,
            placeholder: "01 or empty",
            small: true,
            allowEmptyBlank: true,
            comment:
              "SegWit flag. Use 01 only if at least one input has witness data; leave empty for legacy-only.",
          },
          {
            index: 30,
            label: "INPUT_COUNT (VarInt):",
            rows: 1,
            placeholder: "01",
            small: true,
            comment: "Number of inputs (varint)",
          },
        ],
        groups: [
          {
            title: "INPUTS[]",
            baseIndex: 1000,
            expandable: true,
            fieldCountToAdd: 5,
            minInstances: 1,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "TXID[32]:",
                placeholder: "Previous TX ID (reversed)",
                rows: 2,
              },
              {
                index: 10,
                label: "VOUT[4]:",
                placeholder: "00000000",
                rows: 1,
              },
              {
                index: 20,
                label: "SCRIPT_LENGTH (VarInt):",
                rows: 1,
                allowEmpty00: true,
                placeholder: "00 for SegWit, varies for others",
                comment:
                  "00=SegWit, 17=P2SH-P2WPKH, 23=P2SH-P2WSH, varies=legacy",
              },
              {
                index: 30,
                label: "SCRIPT_SIG[]:",
                placeholder: "Empty for native SegWit",
                rows: 2,
                allowEmptyBlank: true,
                comment:
                  "Native SegWit: empty | Nested: 0014[hash] | Legacy: full script",
              },
              {
                index: 40,
                label: "SEQUENCE[4]:",
                placeholder: "fdffffff",
                rows: 1,
              },
            ],
          },
          {
            title: "OUTPUTS[]",
            baseIndex: 3000,
            expandable: true,
            fieldCountToAdd: 3,
            minInstances: 1,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "AMOUNT[8]:",
                placeholder: "Satoshis (hex, LE)",
                rows: 1,
              },
              {
                index: 10,
                label: "SCRIPT_PUBKEY_LENGTH:",
                rows: 1,
                small: true,
                placeholder: "19",
              },
              {
                index: 20,
                label: "SCRIPT_PUBKEY[]:",
                placeholder: "Locking script",
                rows: 2,
              },
            ],
          },
          {
            title: "WITNESSES[]",
            baseIndex: 5000,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 1,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "WITNESS_DATA[]:",
                placeholder: "Legacy input: 00 | SegWit input: witness stack",
                rows: 3,
                allowEmptyBlank: true,
                comment:
                  "Every transaction input needs a witness entry when marker+flag are present. Use 00 for legacy inputs; use the serialized witness stack for SegWit inputs.",
              },
            ],
          },
        ],
        betweenGroups: {
          "INPUTS[]": [
            {
              index: 2000,
              label: "OUTPUT_COUNT (VarInt):",
              rows: 1,
              placeholder: "01",
              small: true,
              comment: "Number of outputs (varint)",
            },
          ],
        },
        afterGroups: [
          {
            index: 6000,
            label: "LOCKTIME[4]:",
            placeholder: "00000000",
            rows: 1,
          },
        ],
      },
      groupInstances: {
        "INPUTS[]": 1,
        "OUTPUTS[]": 1,
        "WITNESSES[]": 1,
      },
      groupInstanceKeys: {
        "INPUTS[]": [1000],
        "OUTPUTS[]": [3000],
        "WITNESSES[]": [5000],
      },
      baseHeight: 150,
    },
  },
  {
    functionName: "concat_all",
    label: "P2WPKH Witness",
    category: "Transactions",
    subcategory: "Witnesses & Control Blocks",
    description: "Witness data for P2WPKH input (signature + pubkey)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "P2WPKH Witness",
      paramExtraction: "multi_val",
      numInputs: 5,
      inputs: { vals: { 0: "02", 30: "21" } },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "ITEM_COUNT:",
            placeholder: "02",
            rows: 1,
            small: true,
          },
          {
            index: 10,
            label: "SIG_LENGTH:",
            placeholder: "48",
            rows: 1,
            small: true,
          },
          {
            index: 20,
            label: "SIGNATURE+SIGHASH:",
            placeholder: "304502...01",
            rows: 3,
          },
          {
            index: 30,
            label: "PUBKEY_LENGTH:",
            placeholder: "21",
            rows: 1,
            small: true,
          },
          {
            index: 40,
            label: "PUBKEY:",
            placeholder: "02a1b2c3...",
            rows: 2,
          },
        ],
        groups: [],
        afterGroups: [],
      },
      groupInstances: {},
      baseHeight: 100,
    },
  },
  {
    functionName: "concat_all",
    label: "P2WSH Witness",
    category: "Transactions",
    subcategory: "Witnesses & Control Blocks",
    description: "Witness data for P2WSH input (flexible for any script type)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "P2WSH Witness",
      paramExtraction: "multi_val",
      numInputs: 5, // item_count + 2 initial pairs
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "ITEM_COUNT:",
            placeholder: "03, 04, etc",
            rows: 1,
            comment: "Total witness stack items",
          },
        ],
        groups: [
          {
            title: "WITNESS_ITEMS[]",
            baseIndex: 1000,
            expandable: true,
            fieldCountToAdd: 2,
            minInstances: 1,
            maxInstances: 20,
            fields: [
              {
                index: 0,
                label: "ITEM LENGTH (VarInt):",
                placeholder: "00 (empty), 47 (sig), 21 (pubkey), etc",
                rows: 1,
                comment: "VarInt length of this item",
              },
              {
                index: 10,
                label: "ITEM BYTES:",
                placeholder: "Actual bytes for this item (empty if length=00)",
                rows: 3,
                allowEmptyBlank: true,
                comment: "Leave empty when length is 00 (empty item)",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: {
        "WITNESS_ITEMS[]": 2,
      },
      groupInstanceKeys: {
        "WITNESS_ITEMS[]": [1000, 1100],
      },
      baseHeight: 120,
    },
  },
  {
    functionName: "concat_all",
    label: "P2TR Witness (Key-Path)",
    category: "Transactions",
    subcategory: "Witnesses & Control Blocks",
    description:
      "Witness for Taproot key-path spend (item_count, sig_length, signature)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "P2TR Witness (Key-Path)",
      paramExtraction: "multi_val",
      numInputs: 3,
      inputs: { vals: ["01", "40", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "ITEM_COUNT (1B):",
            rows: 1,
            placeholder: "01",
            comment: "Usually 0x01 for key-path",
          },
          {
            index: 1,
            label: "SIG_LENGTH (VarInt):",
            rows: 1,
            placeholder: "40",
            comment: "Length of Schnorr sig (0x40 for 64 bytes)",
          },
          {
            index: 2,
            label: "SIGNATURE (64-65B hex):",
            rows: 2,
            placeholder: "<sig>",
          },
        ],
      },
      groupInstances: {},
      result: "",
      baseHeight: 100,
    },
  },
  {
    functionName: "concat_all",
    label: "Taproot Control Block",
    category: "Transactions",
    subcategory: "Witnesses & Control Blocks",
    description:
      "Build the control block for a script-path spend (parity byte + internal key + optional merkle path).",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "Taproot Control Block",
      paramExtraction: "multi_val",
      numInputs: 3,
      inputs: { vals: { 0: "c0" } },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "First Byte (c0/c1):",
            rows: 1,
            placeholder: "c0 or c1",
          },
          {
            index: 100,
            label: "Internal Key P:",
            rows: 2,
            placeholder: "<32B x-only pubkey>",
          },
          {
            index: 200,
            label: "Merkle Path:",
            rows: 3,
            placeholder: "<concat of 32B siblings>",
            allowEmptyBlank: true,
            emptyLabel: "empty",
          },
        ],
      },
      groupInstances: {},
      result: "",
      baseHeight: 120,
    },
  },
  {
    functionName: "concat_all",
    label: "P2TR Witness (Script-Path)",
    category: "Transactions",
    subcategory: "Witnesses & Control Blocks",
    description:
      "Witness for Taproot script-path spend (stack items + script + control block)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "P2TR Witness (Script-Path)",
      paramExtraction: "multi_val",
      numInputs: 7, // item_count + one stack item + script + control block
      inputs: { vals: ["", "", "", "", "", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "ITEM_COUNT (1B):",
            rows: 1,
            placeholder: "Number of stack items",
          },
        ],
        groups: [
          {
            title: "STACK_ITEMS[]",
            baseIndex: 1000,
            expandable: true,
            fieldCountToAdd: 2,
            minInstances: 1,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "ITEM_LENGTH (VarInt):",
                rows: 1,
                placeholder: "<len>",
              },
              {
                index: 10,
                label: "ITEM_BYTES (hex):",
                rows: 2,
                placeholder: "<stack item>",
                allowEmptyBlank: true,
                comment:
                  'Toggle "∅" to push an empty element (e.g., OP_IF false branch).',
              },
            ],
          },
        ],
        afterGroups: [
          {
            index: 2000,
            label: "SCRIPT_LENGTH (VarInt):",
            rows: 1,
            placeholder: "<len(script)>",
          },
          {
            index: 2010,
            label: "SCRIPT (hex):",
            rows: 3,
            placeholder: "<tapscript hex>",
          },
          {
            index: 2020,
            label: "CONTROL_BLOCK_LENGTH (VarInt):",
            rows: 1,
            placeholder: "<len(control block)>",
          },
          {
            index: 2030,
            label: "CONTROL_BLOCK (hex):",
            rows: 3,
            placeholder: "<control block hex>",
          },
        ],
      },
      groupInstances: { "STACK_ITEMS[]": 1 },
      groupInstanceKeys: { "STACK_ITEMS[]": [1000] },
      result: "",
      baseHeight: 140,
    },
  },
  // DATA TO SIGN (SEGWIT) Node - Builds BIP143 signing data WITHOUT sighash
  {
    functionName: "concat_all",
    label: "Data to Sign (SegWit)",
    category: "Transactions",
    subcategory: "Preimages",
    description:
      "Builds BIP143 signing message for ONE SegWit input (without SIGHASH - add separately)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "Data to Sign (SegWit)",
      paramExtraction: "multi_val",
      numInputs: 10, // Reduced from 11 - no SIGHASH
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "VERSION[4]:",
            rows: 1,
            placeholder: "02000000",
            comment: "Transaction version (little-endian)",
          },
          {
            index: 10,
            label: "HASH_PREVOUTS[32]:",
            rows: 2,
            placeholder: "SHA256d of all inputs' outpoints",
            comment: "⚡ SHARED: Same for all inputs with SIGHASH_ALL",
          },
          {
            index: 20,
            label: "HASH_SEQUENCE[32]:",
            rows: 2,
            placeholder: "SHA256d of all inputs' sequences",
            comment: "⚡ SHARED: Same for all inputs with SIGHASH_ALL",
          },
          {
            index: 30,
            label: "OUTPOINT[36]:",
            rows: 2,
            placeholder: "TXID (32 bytes) + VOUT (4 bytes)",
            comment: "🔄 UNIQUE: This specific input's outpoint",
          },
          {
            index: 40,
            label: "SCRIPTCODE_LENGTH:",
            rows: 1,
            placeholder: "19 for P2WPKH, varies for P2WSH",
            comment: "Varint length of the script code",
          },
          {
            index: 50,
            label: "SCRIPTCODE:",
            rows: 3,
            placeholder: "P2WPKH: 1976a914[hash]88ac | P2WSH: witnessScript",
            comment:
              "🔄 UNIQUE: P2WPKH uses standard script, P2WSH uses the actual script",
          },
          {
            index: 60,
            label: "AMOUNT[8]:",
            rows: 1,
            placeholder: "Satoshis in little-endian",
            comment: "🔄 UNIQUE: Value of the UTXO being spent",
          },
          {
            index: 70,
            label: "SEQUENCE[4]:",
            rows: 1,
            placeholder: "fdffffff",
            comment: "🔄 UNIQUE: This input's sequence number",
          },
          {
            index: 80,
            label: "HASH_OUTPUTS[32]:",
            rows: 2,
            placeholder: "SHA256d of all outputs",
            comment: "⚡ SHARED: Same for all inputs with SIGHASH_ALL",
          },
          {
            index: 90,
            label: "LOCKTIME[4]:",
            rows: 1,
            placeholder: "00000000",
            comment: "Transaction locktime",
          },
        ],
        groups: [],
        afterGroups: [],
      },
      groupInstances: {},
      baseHeight: 200,
    },
  },
  // DATA TO SIGN (TAPROOT) Node - Builds key-path SigMsg (epoch 0x00, SIGHASH_DEFAULT)
  {
    functionName: "concat_all",
    label: "Data to Sign (Taproot)",
    category: "Transactions",
    subcategory: "Preimages",
    description:
      "Builds Taproot key-path SigMsg (epoch 0x00, SIGHASH_DEFAULT) for one input; run TapSighash tagged hash on the result",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "Data to Sign (Taproot)",
      paramExtraction: "multi_val",
      numInputs: 11,
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "EPOCH:",
            rows: 1,
            placeholder: "00",
            comment: "Fixed 0x00 for current Taproot epoch",
          },
          {
            index: 10,
            label: "HASH TYPE:",
            rows: 1,
            placeholder: "00",
            comment: "0x00 = SIGHASH_DEFAULT (key-path)",
          },
          {
            index: 20,
            label: "VERSION[4] (LE):",
            rows: 1,
            placeholder: "02000000",
            comment: "Transaction version (little-endian)",
          },
          {
            index: 30,
            label: "LOCKTIME[4] (LE):",
            rows: 1,
            placeholder: "00000000",
            comment: "nLockTime (little-endian)",
          },
          {
            index: 40,
            label: "HASH_PREVOUTS[32]:",
            rows: 2,
            placeholder: "SHA256 of all outpoints",
            comment: "⚡ SHARED: txidLE||vout for every input (single SHA256)",
          },
          {
            index: 50,
            label: "HASH_AMOUNTS[32]:",
            rows: 2,
            placeholder: "SHA256 of all amounts (8B LE each)",
            comment: "⚡ SHARED: amounts for every input (8-byte LE)",
          },
          {
            index: 60,
            label: "HASH_SCRIPTPUBKEYS[32]:",
            rows: 2,
            placeholder: "SHA256 of all scriptPubKeys (len + bytes)",
            comment: "⚡ SHARED: each with varlen prefix",
          },
          {
            index: 70,
            label: "HASH_SEQUENCES[32]:",
            rows: 2,
            placeholder: "SHA256 of all sequences",
            comment: "⚡ SHARED: sequences for every input (4-byte LE)",
          },
          {
            index: 80,
            label: "HASH_OUTPUTS[32]:",
            rows: 2,
            placeholder: "SHA256 of all serialized outputs",
            comment: "⚡ SHARED: amount + script for every output",
          },
          {
            index: 90,
            label: "SPEND TYPE:",
            rows: 1,
            placeholder: "00",
            comment: "0x00 = key-path, no annex (ext_flag*2 + annex)",
          },
          {
            index: 100,
            label: "INPUT INDEX[4] (LE):",
            rows: 1,
            placeholder: "00000000",
            comment: "Which input is being signed (little-endian)",
          },
        ],
        groups: [],
        afterGroups: [],
      },
      groupInstances: {},
      baseHeight: 220,
    },
  },

  // ------------------------------------------------------------------
  // CRYPTOGRAPHIC OPERATIONS
  // ------------------------------------------------------------------
  {
    functionName: "hash160_hex",
    label: "Data → HASH160",
    category: "Hashes",
    subcategory: "General",
    description: "Performs RIPEMD160(SHA256) on input hex",
    type: "calculation",
    nodeData: {
      functionName: "hash160_hex",
      title: "Data → HASH160",
      paramExtraction: "single_val",

      numInputs: 1,

      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [{ index: 0, label: "INPUT HEX:", rows: 2 }],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "double_sha256_hex",
    label: "Data → SHA-256d",
    category: "Hashes",
    subcategory: "General",
    description: "SHA256(SHA256()) on input hex",
    type: "calculation",
    nodeData: {
      functionName: "double_sha256_hex",
      title: "Data → SHA-256d",

      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [{ index: 0, label: "Input Hex:", rows: 2 }],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "sha256_hex",
    label: "Data → SHA-256",
    category: "Hashes",
    subcategory: "General",
    description: "Compute a single SHA-256 of hex-encoded data",
    type: "calculation",
    nodeData: {
      functionName: "sha256_hex",
      title: "Data → SHA-256",

      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [{ index: 0, label: "Input Hex:", rows: 2 }],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "sign_as_bitcoin_core_low_r",
    label: "Sign TX (Low-R)",
    category: "Signing & Verification",
    subcategory: "General",
    description: "ECDSA signature with low-R style, like Bitcoin Core",
    type: "calculation",
    nodeData: {
      functionName: "sign_as_bitcoin_core_low_r",
      title: "Sign TX (Low-R)",
      paramExtraction: "multi_val",
      numInputs: 2,

      inputs: {
        vals: ["", ""],
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Private Key (32 bytes hex):",
            placeholder: "<privkey hex>",
            rows: 2,
          },
          {
            index: 1,
            label: "Message Hash (32 bytes hex):",
            placeholder: "<32-byte hash>",
            rows: 2,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "sign_tx_rfc6979",
    label: "Sign TX (RFC6979)",
    category: "Signing & Verification",
    subcategory: "ECDSA",
    description:
      "ECDSA signature with deterministic RFC6979 nonce and low-S normalization, without low-R grinding.",
    type: "calculation",
    nodeData: {
      functionName: "sign_tx_rfc6979",
      title: "Sign TX (RFC6979 / Trezor-style)",
      paramExtraction: "multi_val",
      numInputs: 2,

      inputs: {
        vals: ["", ""],
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Private Key (32 bytes hex):",
            placeholder: "<privkey hex>",
            rows: 2,
          },
          {
            index: 1,
            label: "Message Hash (32 bytes hex):",
            placeholder: "<32-byte hash>",
            rows: 2,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "tagged_hash",
    label: "Tagged Hash",
    category: "Hashes",
    subcategory: "General",
    description: "Compute tagged_hash(tag, data) used by BIP340/341/342",
    type: "calculation",
    nodeData: {
      functionName: "tagged_hash",
      title: "Tagged Hash",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: ["BIP0340/challenge", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Tag:",
            rows: 1,
            placeholder: "TapTweak / TapLeaf / TapBranch / ...",
          },
          {
            index: 1,
            label: "Data (hex):",
            rows: 3,
            placeholder: "<hex data>",
          },
        ],
      },
      result: "",
      groupInstances: {},
    },
  },
  {
    functionName: "taproot_tree_builder",
    label: "Taproot Tree Builder",
    category: "Transactions",
    subcategory: "Builders",
    description:
      "Build a Taproot taptree root from leaf hashes (left-to-right pairing). Also outputs per-leaf paths and tree structure.",
    type: "calculation",
    nodeData: {
      functionName: "taproot_tree_builder",
      title: "Taproot Tree Builder",
      paramExtraction: "multi_val",
      numInputs: 1,
      inputs: { vals: [] },
      outputLayout: "taproot_tree_builder",
      taprootLeafIndex: 0,
      outputPorts: [
        { label: "root", handleId: "", handleTop: "50%", showLabel: false },
        {
          label: "path",
          handleId: "output-1",
          handleTopSource: "taproot-path-select",
          showLabel: false,
        },
      ],
      inputStructure: {
        ungrouped: [],
        groups: [
          {
            title: "LEAF_HASHES[]",
            baseIndex: 1000,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 1,
            maxInstances: 20,
            fields: [
              {
                index: 0,
                label: "Leaf Hash (TapLeaf hex):",
                rows: 2,
                placeholder: "<32B hex>",
                comment:
                  "Order defines the policy tree (paired left-to-right).",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: { "LEAF_HASHES[]": 1 },
      groupInstanceKeys: { "LEAF_HASHES[]": [1000] },
      result: "",
    },
  },
  {
    functionName: "schnorr_sign_bip340",
    label: "Schnorr Sign (BIP340)",
    category: "Signing & Verification",
    subcategory: "Schnorr",
    description:
      "Create a 64-byte BIP340 Schnorr signature (Taproot key-path). Uses deterministic nonce if Aux Rand is empty.",
    type: "calculation",
    nodeData: {
      functionName: "schnorr_sign_bip340",
      title: "Schnorr Sign (BIP340)",
      paramExtraction: "multi_val",
      numInputs: 3,
      inputs: {
        vals: ["", "", "__EMPTY__"],
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Private Key (32B hex):",
            rows: 2,
            placeholder: "<privkey hex>",
          },
          {
            index: 1,
            label: "Message Hash (32B hex):",
            rows: 2,
            placeholder: "<msg32 hex>",
          },
          {
            index: 2,
            label: "Aux Rand (32B hex, optional):",
            rows: 2,
            placeholder: "32B hex",
            allowEmptyBlank: true,
            unconnectable: false,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "schnorr_verify_bip340",
    label: "Schnorr Verify (BIP340)",
    category: "Signing & Verification",
    subcategory: "Schnorr",
    description: "Verify a 64-byte BIP340 Schnorr signature",
    type: "calculation",
    nodeData: {
      functionName: "schnorr_verify_bip340",
      title: "Schnorr Verify (BIP340)",
      paramExtraction: "multi_val",
      numInputs: 3,
      inputs: { vals: ["", "", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "X-only PubKey (32B hex):",
            rows: 2,
            placeholder: "<x-only pubkey>",
          },
          {
            index: 1,
            label: "Message Hash (32B hex):",
            rows: 2,
            placeholder: "<msg32 hex>",
          },
          {
            index: 2,
            label: "Signature (64B hex):",
            rows: 2,
            placeholder: "<sig64 hex>",
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "schnorr_batch_verify_demo",
    label: "Schnorr Batch Demo",
    category: "Signing & Verification",
    subcategory: "Schnorr",
    description: "Illustrate batch verify combination of multiple BIP340 sigs",
    type: "calculation",
    nodeData: {
      functionName: "schnorr_batch_verify_demo",
      title: "Schnorr Batch Demo",
      paramExtraction: "multi_val",
      numInputs: 3,
      inputs: { vals: [] },
      inputStructure: {
        groups: [
          {
            title: "TRIPLES[] (pk,msg,sig)",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 3,
            minInstances: 1,
            maxInstances: 6,
            fields: [
              {
                index: 0,
                label: "X-only PubKey:",
                rows: 2,
                placeholder: "<32B hex>",
              },
              {
                index: 1,
                label: "Message Hash:",
                rows: 2,
                placeholder: "<32B hex>",
              },
              {
                index: 2,
                label: "Signature:",
                rows: 2,
                placeholder: "<64B hex>",
              },
            ],
          },
        ],
        ungrouped: [],
        afterGroups: [],
      },
      groupInstances: { "TRIPLES[] (pk,msg,sig)": 1 },
      groupInstanceKeys: { "TRIPLES[] (pk,msg,sig)": [0] },
      result: "",
    },
  },

  // ------------------------------------------------------------------
  // KEY & ADDRESS
  // ------------------------------------------------------------------
  {
    functionName: "random_256",
    label: "Random 32 Bytes",
    category: "Keys & Addresses",
    subcategory: "Entropy & HD Wallets",
    description:
      "Generates random 256-bit (32 bytes) entropy suitable for a Bitcoin private key / secret key",
    type: "calculation",
    nodeData: {
      functionName: "random_256",
      title: "Random 32 Bytes",
      hasRegenerate: true,
      forceRegenerate: true,
      dirty: true,
      numInputs: 0,
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "entropy_to_bip39_mnemonic",
    label: "Entropy → BIP39 Mnemonic",
    category: "Keys & Addresses",
    subcategory: "Entropy & HD Wallets",
    description:
      "Converts BIP39 entropy hex into English mnemonic words. 32 bytes produces 24 words.",
    type: "calculation",
    nodeData: {
      functionName: "entropy_to_bip39_mnemonic",
      title: "Entropy → BIP39 Mnemonic",
      hasRegenerate: false,
      forceRegenerate: false,
      numInputs: 1,
      inputs: { val: "" },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Entropy Hex:",
            placeholder: "16, 20, 24, 28, or 32 bytes hex",
            rows: 3,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "bip39_mnemonic_to_seed",
    label: "BIP39 Mnemonic → Seed",
    category: "Keys & Addresses",
    subcategory: "Entropy & HD Wallets",
    description:
      "Derives the 64-byte BIP39 seed with PBKDF2-HMAC-SHA512. Optional passphrase defaults to empty.",
    type: "calculation",
    nodeData: {
      functionName: "bip39_mnemonic_to_seed",
      title: "BIP39 Mnemonic → Seed",
      paramExtraction: "multi_val",
      hasRegenerate: false,
      forceRegenerate: false,
      numInputs: 2,
      inputs: { vals: ["", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Mnemonic Words:",
            placeholder: "12, 15, 18, 21, or 24 BIP39 words",
            rows: 4,
          },
          {
            index: 1,
            label: "Passphrase (optional):",
            placeholder: "<blank by default>",
            rows: 1,
            allowEmptyBlank: true,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "bip32_derive_private_key",
    label: "BIP32 Derive Private Key",
    category: "Keys & Addresses",
    subcategory: "Entropy & HD Wallets",
    description:
      "Derives a BIP32 child private key from a seed and path, e.g. m/44'/1'/0'/0/0.",
    type: "calculation",
    nodeData: {
      functionName: "bip32_derive_private_key",
      title: "BIP32 Derive Private Key",
      paramExtraction: "multi_val",
      hasRegenerate: false,
      forceRegenerate: false,
      numInputs: 2,
      inputs: { vals: ["", "m/44'/1'/0'/0/0"] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Seed Hex:",
            placeholder: "16 to 64 bytes hex; typically 64-byte BIP39 seed",
            rows: 4,
          },
          {
            index: 1,
            label: "Derivation Path:",
            placeholder: "m/44'/1'/0'/0/0",
            rows: 1,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "public_key_from_private_key",
    label: "PrivKey → PubKey",
    category: "Keys & Addresses",
    subcategory: "Key Conversion & Tweaks",
    description: "Derives compressed public key from private key",
    type: "calculation",
    nodeData: {
      functionName: "public_key_from_private_key",
      title: "PrivKey → PubKey",
      hasRegenerate: false,
      forceRegenerate: false,
      numInputs: 1,

      groupInstances: {},
      result: "",
      inputs: { val: "" },
    },
  },
  {
    functionName: "ecies_encrypt",
    label: "ECIES Encrypt",
    category: "Signing & Verification",
    subcategory: "Encryption",
    description:
      "Encrypt hex data to a secp256k1 public key with an authenticated ECIES-style envelope",
    type: "calculation",
    nodeData: {
      functionName: "ecies_encrypt",
      title: "ECIES Encrypt",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: ["", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Recipient PubKey:",
            placeholder: "<compressed or uncompressed pubkey hex>",
            rows: 2,
          },
          {
            index: 1,
            label: "Plaintext Hex:",
            placeholder: "<data to encrypt>",
            rows: 3,
            autoResizeMaxRows: 6,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "ecies_decrypt",
    label: "ECIES Decrypt",
    category: "Signing & Verification",
    subcategory: "Encryption",
    description:
      "Decrypt and authenticate a rawBit ECIES-style envelope with the recipient private key",
    type: "calculation",
    nodeData: {
      functionName: "ecies_decrypt",
      title: "ECIES Decrypt",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: ["", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Recipient PrivKey:",
            placeholder: "<recipient private key hex>",
            rows: 2,
          },
          {
            index: 1,
            label: "Envelope Hex:",
            placeholder: "<ECIES Encrypt result>",
            rows: 4,
            autoResizeMaxRows: 8,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "xonly_pubkey",
    label: "Even-Y PrivKey → X-only PubKey",
    category: "Keys & Addresses",
    subcategory: "Key Conversion & Tweaks",
    description:
      "Derive x-only public key (Taproot/Schnorr). Input should already be even-Y (use Even-Y PrivKey first).",
    type: "calculation",
    nodeData: {
      functionName: "xonly_pubkey",
      title: "Even-Y PrivKey → X-only PubKey",
      numInputs: 1,
      inputs: { val: "" },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Even-Y Private Key (32B hex):",
            rows: 2,
            placeholder: "<privkey hex>",
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "even_y_private_key",
    label: "PrivKey → Even-Y PrivKey",
    category: "Keys & Addresses",
    subcategory: "Key Conversion & Tweaks",
    description:
      "Adjust secret so corresponding x-only pubkey has even Y (Taproot tweak helper).",
    type: "calculation",
    nodeData: {
      functionName: "even_y_private_key",
      title: "PrivKey → Even-Y PrivKey",
      numInputs: 1,
      inputs: { val: "" },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Private Key (32B hex):",
            rows: 2,
            placeholder: "<privkey hex>",
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "xonly_pubkey_from_private_key",
    label: "PrivKey → X-only PubKey",
    category: "Keys & Addresses",
    subcategory: "Key Conversion & Tweaks",
    description:
      "Derive x-only pubkey, parity bit, and parity-adjusted secret for Taproot/Schnorr",
    type: "calculation",
    nodeData: {
      functionName: "xonly_pubkey_from_private_key",
      title: "PrivKey → X-only PubKey",
      numInputs: 1,
      inputs: { val: "" },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Private Key (32B hex):",
            rows: 2,
            placeholder: "<privkey hex>",
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "p2tr_address_from_xonly",
    label: "X-only → P2TR Address",
    category: "Keys & Addresses",
    subcategory: "Address & ScriptPubKey",
    description: "Build Taproot bech32m address from x-only pubkey",
    type: "calculation",
    nodeData: {
      functionName: "p2tr_address_from_xonly",
      title: "X-only → P2TR Address",
      numInputs: 1,
      networkDependent: true,
      selectedNetwork: "testnet",
      inputs: { selectedNetwork: "testnet", val: "" },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "X-only PubKey (32B hex):",
            rows: 2,
            placeholder: "<x-only pubkey>",
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "taproot_tweaked_privkey",
    label: "Taproot Tweak (PrivKey → q')",
    category: "Keys & Addresses",
    subcategory: "Key Conversion & Tweaks",
    description:
      "Compute tweaked (even-Y) private key for Taproot key-path signing",
    type: "calculation",
    nodeData: {
      functionName: "taproot_tweaked_privkey",
      title: "Taproot Tweak (PrivKey → q')",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: ["", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Internal Secret Key (32B hex):",
            rows: 2,
            placeholder: "<privkey hex>",
          },
          {
            index: 1,
            label: "Merkle Root (32B hex, optional):",
            rows: 2,
            placeholder: "leave empty for key-path only",
            allowEmptyBlank: true,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "taproot_tweak_xonly_pubkey",
    label: "Taproot Tweak (X-only → Q)",
    category: "Keys & Addresses",
    subcategory: "Key Conversion & Tweaks",
    description:
      "Verifier-side TapTweak using internal x-only pubkey to get output Q and parity byte",
    type: "calculation",
    nodeData: {
      functionName: "taproot_tweak_xonly_pubkey",
      title: "Taproot Tweak (X-only → Q)",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: ["", ""] },
      outputLayout: "taproot_tweak_xonly_pubkey",
      outputPorts: [
        {
          label: "Q (x-only)",
          handleId: "",
          handleTop: "50%",
          showLabel: false,
        },
        {
          label: "parity (c0/c1)",
          handleId: "output-1",
          handleTopSource: "taproot-output-parity",
          showLabel: false,
        },
        {
          label: "tweak (32B)",
          handleId: "output-2",
          showHandle: false,
          showLabel: false,
        },
      ],
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Internal X-only PubKey (32B hex):",
            rows: 2,
            placeholder: "<x-only pubkey>",
          },
          {
            index: 1,
            label: "Merkle Root (32B hex, optional):",
            rows: 2,
            placeholder: "leave empty for key-path only",
            allowEmptyBlank: true,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "musig2_aggregate_pubkeys",
    label: "MuSig2 Aggregate PubKeys",
    category: "Signing & Verification",
    subcategory: "MuSig2",
    description:
      "BIP327 KeyAgg over compressed pubkeys: coefficients + aggregated x-only pubkey",
    type: "calculation",
    nodeData: {
      functionName: "musig2_aggregate_pubkeys",
      title: "MuSig2 Aggregate PubKeys",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: [] },
      inputStructure: {
        groups: [
          {
            title: "PUBKEYS[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 2,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "Compressed PubKey:",
                rows: 2,
                placeholder: "<33B hex (02/03...)>",
              },
            ],
          },
        ],
        ungrouped: [],
        afterGroups: [],
      },
      groupInstances: { "PUBKEYS[]": 2 },
      groupInstanceKeys: { "PUBKEYS[]": [0, 100] },
      outputPorts: [{ label: "aggregated_pubkey", handleId: "" }],
      result: "",
    },
  },
  {
    functionName: "musig2_nonce_gen",
    label: "MuSig2 Nonce Gen",
    category: "Signing & Verification",
    subcategory: "MuSig2",
    description:
      "Each signer generates a BIP327 nonce pair from secret key, aggregate key context, message, randomness, and signer pubkey",
    type: "calculation",
    nodeData: {
      functionName: "musig2_nonce_gen",
      title: "MuSig2 Nonce Gen",
      paramExtraction: "multi_val",
      numInputs: 5,
      inputs: { vals: [] },
      outputLayout: "musig2_nonce_gen",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Secret Key (32B hex):",
            rows: 2,
            placeholder: "<secret key>",
          },
          {
            index: 1,
            label: "Output Key Q (32B x-only hex, optional):",
            rows: 2,
            placeholder: "<aggregate key context>",
          },
          {
            index: 2,
            label: "Message (hex):",
            rows: 2,
            placeholder: "<msg bytes>",
            allowNull: true,
            nullLabel: "null",
          },
          {
            index: 3,
            label: "Rand (32B hex):",
            rows: 2,
            placeholder: "<aux randomness>",
          },
          {
            index: 4,
            label: "Signer PubKey (33B compressed hex):",
            rows: 2,
            placeholder: "<02/03...>",
          },
        ],
        afterGroups: [],
      },
      groupInstances: {},
      outputPorts: [
        {
          label: "pubnonce (66B)",
          handleId: "",
          handleTop: "33%",
          handleTopSource: "musig2-pubnonce",
          showLabel: false,
        },
        {
          label: "secnonce (97B)",
          handleId: "output-1",
          handleTop: "66%",
          handleTopSource: "musig2-secnonce",
          showLabel: false,
        },
      ],
      result: "",
    },
  },
  {
    functionName: "musig2_nonce_agg",
    label: "MuSig2 Nonce Agg",
    category: "Signing & Verification",
    subcategory: "MuSig2",
    description: "Aggregate pubnonces into aggnonce",
    type: "calculation",
    nodeData: {
      functionName: "musig2_nonce_agg",
      title: "MuSig2 Nonce Agg",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: [] },
      inputStructure: {
        groups: [
          {
            title: "PUBNONCES[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 2,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "Pubnonce (66B hex):",
                rows: 2,
                placeholder: "<R1||R2>",
              },
            ],
          },
        ],
        ungrouped: [],
        afterGroups: [],
      },
      groupInstances: { "PUBNONCES[]": 2 },
      groupInstanceKeys: { "PUBNONCES[]": [0, 100] },
      result: "",
    },
  },
  {
    functionName: "musig2_partial_sign",
    label: "MuSig2 Partial Sign",
    category: "Signing & Verification",
    subcategory: "MuSig2",
    description: "Each signer produces a MuSig2 partial signature",
    type: "calculation",
    nodeData: {
      functionName: "musig2_partial_sign",
      title: "MuSig2 Partial Sign",
      paramExtraction: "multi_val",
      numInputs: 5,
      inputs: { vals: [] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Secret Key (32B hex):",
            rows: 2,
            placeholder: "<secret key>",
          },
          {
            index: 1,
            label: "Secnonce (97B hex):",
            rows: 2,
            placeholder: "<k1||k2||P>",
          },
          {
            index: 2,
            label: "Aggnonce (66B hex):",
            rows: 2,
            placeholder: "<R1||R2>",
          },
          {
            index: 3,
            label: "Message Hash (32B hex):",
            rows: 2,
            placeholder: "<msg hash>",
          },
          {
            index: 4,
            label: "Taproot Tweak (32B hex, optional):",
            rows: 2,
            placeholder: "leave empty for no tweak",
            allowEmptyBlank: true,
          },
        ],
        groups: [
          {
            title: "PUBKEYS[]",
            baseIndex: 100,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 2,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "Compressed PubKey:",
                rows: 2,
                placeholder: "<33B hex (02/03...)>",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: { "PUBKEYS[]": 2 },
      groupInstanceKeys: { "PUBKEYS[]": [100, 200] },
      result: "",
    },
  },
  {
    functionName: "musig2_partial_sig_verify",
    label: "MuSig2 Partial Sig Verify",
    category: "Signing & Verification",
    subcategory: "MuSig2",
    description:
      "Verify one signer's MuSig2 partial signature against the shared session context",
    type: "calculation",
    nodeData: {
      functionName: "musig2_partial_sig_verify",
      title: "MuSig2 Partial Sig Verify",
      paramExtraction: "multi_val",
      numInputs: 6,
      inputs: { vals: [] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Partial Sig (32B hex):",
            rows: 2,
            placeholder: "<s_i>",
          },
          {
            index: 1,
            label: "Signer Pubnonce (66B hex):",
            rows: 2,
            placeholder: "<R1_i||R2_i>",
          },
          {
            index: 2,
            label: "Signer PubKey (33B compressed hex):",
            rows: 2,
            placeholder: "<02/03...>",
          },
          {
            index: 3,
            label: "Aggnonce (66B hex):",
            rows: 2,
            placeholder: "<R1||R2>",
          },
          {
            index: 4,
            label: "Message Hash (32B hex):",
            rows: 2,
            placeholder: "<msg hash>",
          },
          {
            index: 5,
            label: "Taproot Tweak (32B hex, optional):",
            rows: 2,
            placeholder: "leave empty for no tweak",
            allowEmptyBlank: true,
          },
        ],
        groups: [
          {
            title: "PUBKEYS[]",
            baseIndex: 100,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 2,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "Compressed PubKey:",
                rows: 2,
                placeholder: "<33B hex (02/03...)>",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: { "PUBKEYS[]": 2 },
      groupInstanceKeys: { "PUBKEYS[]": [100, 200] },
      result: "",
    },
  },
  {
    functionName: "musig2_partial_sig_agg",
    label: "MuSig2 Partial Sig Agg",
    category: "Signing & Verification",
    subcategory: "MuSig2",
    description:
      "Combine partial sigs (same count as pubkeys) into a final Schnorr signature",
    type: "calculation",
    nodeData: {
      functionName: "musig2_partial_sig_agg",
      title: "MuSig2 Partial Sig Agg",
      paramExtraction: "multi_val",
      numInputs: 3,
      inputs: { vals: [] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Aggnonce (66B hex):",
            rows: 2,
            placeholder: "<R1||R2>",
          },
          {
            index: 1,
            label: "Message Hash (32B hex):",
            rows: 2,
            placeholder: "<msg hash>",
          },
          {
            index: 2,
            label: "Taproot Tweak (32B hex, optional):",
            rows: 2,
            placeholder: "leave empty for no tweak",
            allowEmptyBlank: true,
          },
        ],
        groups: [
          {
            title: "PUBKEYS[]",
            baseIndex: 100,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 2,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "Compressed PubKey:",
                rows: 2,
                placeholder: "<33B hex (02/03...)>",
              },
            ],
          },
          {
            title: "PARTIAL_SIGS[]",
            // 2000 keeps the full PUBKEYS[] range (100..1000 for 10
            // instances) collision-free; 1000 blocked the 10th pubkey.
            baseIndex: 2000,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 2,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "Partial Sig (32B hex):",
                rows: 2,
                placeholder: "<s_i>",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: {
        "PUBKEYS[]": 2,
        "PARTIAL_SIGS[]": 2,
      },
      groupInstanceKeys: {
        "PUBKEYS[]": [100, 200],
        "PARTIAL_SIGS[]": [2000, 2100],
      },
      result: "",
    },
  },

  // ------------------------------------------------------------------
  // UTILITY
  // ------------------------------------------------------------------
  {
    functionName: "script_verification",
    label: "Verify Script",
    category: "Signing & Verification",
    subcategory: "General",
    description: "Bitcoin script debugger/verifier",
    type: "calculation",
    nodeData: {
      functionName: "script_verification",
      title: "Verify Script",
      paramExtraction: "multi_val",
      numInputs: 6,
      inputs: { vals: ["", "", "", "0", "", ""] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "scriptSig_hex",
            rows: 3,
            placeholder: "Hex-encoded scriptSig",
            allowEmptyBlank: true,
          },
          {
            index: 1,
            label: "scriptPubKey_hex",
            rows: 3,
            placeholder: "Hex-encoded scriptPubKey",
          },
          {
            index: 2,
            label: "tx_hex",
            rows: 3,
            placeholder: "Hex-encoded Transaction",
          },
          {
            index: 3,
            label: "input_index_to_verify",
            rows: 1,
            placeholder: "0",
            unconnectable: true,
          },
          {
            index: 4,
            label: "exclude_flags",
            rows: 1,
            placeholder: "e.g., WITNESS,CLEANSTACK",
            unconnectable: true,
          },
          {
            index: 5,
            label: "spent_amount_sats",
            rows: 1,
            placeholder: "Amount in satoshis (for SegWit/Taproot)",
            unconnectable: false, // This CAN be connected for dynamic amounts
            allowEmptyBlank: true,
          },
        ],
        groups: [
          {
            title: "Taproot prevouts",
            baseIndex: 100,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 0,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "prevout_amount_sats",
                rows: 1,
                placeholder: "Amount (sats)",
                allowEmptyBlank: true,
              },
              {
                index: 1,
                label: "prevout_scriptPubKey_hex",
                rows: 3,
                placeholder: "Hex-encoded scriptPubKey",
                allowEmptyBlank: true,
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: {},
      groupInstanceKeys: {},
      result: "",

      error: false,
    },
  },

  {
    functionName: "hash160_to_p2sh_address",
    label: "HASH160 → P2SH Address",
    category: "Keys & Addresses",
    subcategory: "Address & ScriptPubKey",
    description:
      "Builds a legacy P2SH address from the 20‑byte HASH160 of a redeem script (works for nested‑SegWit too). ",
    type: "calculation",
    nodeData: {
      functionName: "hash160_to_p2sh_address",
      title: "HASH160 → P2SH Address",
      numInputs: 1,

      networkDependent: true,
      selectedNetwork: "testnet",

      groupInstances: {},
      result: "",
      inputs: {
        selectedNetwork: "testnet",
        val: "",
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Redeem HASH160:",
            rows: 2,
            placeholder: "20-byte hash (40 hex characters)",
            comment:
              "Hash of the redeem script. Use Data → HASH160 if you have the script bytes.",
          },
        ],
      },
    },
  },
  {
    functionName: "date_to_unix_timestamp",
    label: "Date → Unix Time",
    category: "Encoding & Script Data",
    subcategory: "Locktime & Sequence Encoding",
    description: "Convert human-readable date to Unix timestamp for CLTV",
    type: "calculation",
    nodeData: {
      functionName: "date_to_unix_timestamp",
      title: "Date → Unix Time",

      numInputs: 1,

      version: 0,
      inputs: { val: "2025-01-01T00:00:00Z" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Date (UTC):",
            rows: 1,
            placeholder: "2025-01-01T00:00:00Z",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "reverse_bytes_4",
    label: "4-Byte → Reversed",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description: "Reverse byte order of 4-byte hex values (sequence, locktime)",
    type: "calculation",
    nodeData: {
      functionName: "reverse_bytes_4",
      title: "4-Byte → Reversed",
      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "4-byte hex:",
            rows: 1,
            placeholder: "e.g., fffffffd",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "hours_to_sequence_number",
    label: "Hours → Relative Lock",
    category: "Encoding & Script Data",
    subcategory: "Locktime & Sequence Encoding",
    description:
      "Time-based relative lock for nSequence/CSV. Accepts hours (decimals allowed, e.g., 1.5 for 90 minutes)",
    type: "calculation",
    nodeData: {
      functionName: "hours_to_sequence_number",
      title: "Hours → Relative Lock",

      numInputs: 1,

      version: 0,
      inputs: { val: 1 },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Delay (hours):",
            rows: 1,
            placeholder: "e.g., 13 or 1.5",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "opcode_to_value",
    label: "Opcode → Value",
    category: "Encoding & Script Data",
    subcategory: "Script Opcodes",
    description:
      "Convert numeric opcodes (OP_0 to OP_16, OP_1NEGATE) to their integer values",
    type: "calculation",
    nodeData: {
      functionName: "opcode_to_value",
      title: "Opcode → Value",

      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Opcode hex:",
            rows: 1,
            placeholder: "e.g., 5a (OP_10)",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "encode_sequence_block_flag",
    label: "Sequence → Block Flag",
    category: "Encoding & Script Data",
    subcategory: "Locktime & Sequence Encoding",
    description: "Prepare sequence value for block-based CSV (no modification)",
    type: "calculation",
    nodeData: {
      functionName: "encode_sequence_block_flag",
      title: "Sequence → Block Flag",
      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Sequence value (blocks):",
            rows: 1,
            placeholder: "e.g., 10 or 4320",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "encode_sequence_time_flag",
    label: "Sequence → Time Flag",
    category: "Encoding & Script Data",
    subcategory: "Locktime & Sequence Encoding",
    description:
      "Add time-based flag (bit 22) to sequence value for time-based CSV",
    type: "calculation",
    nodeData: {
      functionName: "encode_sequence_time_flag",
      title: "Sequence → Time Flag",
      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Sequence value (time units):",
            rows: 1,
            placeholder: "e.g., 8 or 5063",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "verify_signature",
    label: "Verify Signature",
    category: "Signing & Verification",
    subcategory: "ECDSA",
    description: "ECDSA signature verification (Bitcoin-style DER, secp256k1)",
    type: "calculation",
    nodeData: {
      functionName: "verify_signature",
      title: "Verify Signature",
      paramExtraction: "multi_val",
      numInputs: 3,

      inputs: {
        vals: ["", "", ""],
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Public Key (33 or 65 bytes hex):",
            placeholder: "<pubkey hex>",
            rows: 2,
          },
          {
            index: 1,
            label: "Message Hash (32 bytes hex):",
            placeholder: "<32-byte hash>",
            rows: 2,
          },
          {
            index: 2,
            label: "Signature (DER hex):",
            placeholder: "<DER signature hex>",
            rows: 2,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    /* ─ TX PARSER ───────────────────────────────────────────────────────
       Replaces the old "TX Field Extract" palette entry. extract_tx_field
       stays fully supported for existing/external flows — only the palette
       entry was removed; the self-parsing TX Parser is a superset. */
    functionName: "parse_tx_field",
    label: "TX Parser",
    category: "Transactions",
    subcategory: "Parsing & Inspection",
    description:
      "Parse a raw transaction byte-by-byte (legacy + SegWit + Taproot) and extract fields incl. witness data",
    type: "calculation",
    nodeData: {
      functionName: "parse_tx_field",
      title: "TX Parser",
      paramExtraction: "multi_val",
      numInputs: 2,
      result: "",
      inputs: { vals: ["", "0"] },
      txFieldExtractMode: "dynamic",
      txExtractFields: [...DEFAULT_TX_PARSE_FIELDS],
      outputPorts: buildTxFieldExtractOutputPorts([...DEFAULT_TX_PARSE_FIELDS]),

      inputStructure: {
        ungrouped: [
          /* 0 ─ raw transaction hex (can be cabled) */
          {
            index: 0,
            label: "Raw TX (hex):",
            rows: 3,
            placeholder: "<transaction hex>",
          },

          /* 1 ─ vin/vout index used by per-input/per-output fields.
             Witness stack items are addressed in the field name itself
             (vin.witness.item0 … / vin.witness.last). */
          {
            index: 1,
            label: "VIN/VOUT Index:",
            rows: 1,
            placeholder: "0",
          },
        ],
      },

      groupInstances: {},
    },
  },
  {
    functionName: "trezor_get_address",
    label: "Trezor Get Address",
    category: "Signing & Verification",
    subcategory: "Trezor",
    description:
      "Manual browser-side Trezor Connect call that asks the device to display and return an address.",
    type: "trezorAction",
    nodeData: {
      functionName: "trezor_get_address",
      title: "Trezor Get Address",
      hideCode: true,
      hardwareAction: "trezor_get_address",
      hardwareActionLabel: "Get Address",
      paramExtraction: "multi_val",
      numInputs: 4,
      inputs: { vals: ["", "testnet", "SPENDADDRESS", "true"] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Derivation Path:",
            placeholder: "m/44'/1'/0'/0/0",
            rows: 1,
            comment: "Path must match the rawBit BIP32 derivation path.",
          },
          {
            index: 1,
            label: "Coin:",
            placeholder: "testnet",
            rows: 1,
            comment: "Trezor Connect coin name/shortcut. Use testnet for this flow.",
          },
          {
            index: 2,
            label: "Script Type:",
            placeholder: "SPENDADDRESS",
            rows: 1,
            comment: "Use SPENDADDRESS for legacy P2PKH.",
          },
          {
            index: 3,
            label: "Show On Trezor:",
            unconnectable: true, // dropdown, no cables
            options: ["true", "false"],
            comment: "Keep true for classroom address confirmation.",
          },
        ],
      },
      outputPorts: [
        {
          label: "address",
          handleId: "",
          handleTop: "50%",
          showLabel: false,
        },
      ],
      groupInstances: {},
      result: "",
      hardwareStatus: "idle",
      hardwareStatusText: "Press Get Address to ask Trezor to confirm the path.",
      dirty: false,
    },
  },
  {
    functionName: "build_trezor_sign_transaction_params",
    label: "Trezor Sign Params",
    category: "Signing & Verification",
    subcategory: "Trezor",
    description:
      "Build the structured Trezor Connect signTransaction params JSON from expandable inputs, outputs, and previous raw transactions.",
    type: "calculation",
    nodeData: {
      functionName: "build_trezor_sign_transaction_params",
      title: "Trezor Sign Params",
      paramExtraction: "multi_val",
      numInputs: 13,
      inputs: {
        vals: {
          0: "testnet",
          1: "1",
          2: "0",
          1020: "0",
          1040: "ffffffff",
          1050: "AUTO",
          3020: "AUTO",
        },
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Coin:",
            placeholder: "testnet",
            rows: 1,
            comment: "Trezor Connect coin name/shortcut, for example testnet.",
          },
          {
            index: 1,
            label: "Version:",
            placeholder: "1",
            rows: 1,
            comment: "Transaction version as a decimal uint32, usually 1 or 2.",
          },
          {
            index: 2,
            label: "Locktime:",
            placeholder: "0",
            rows: 1,
            comment: "Transaction locktime as a decimal uint32. Use 0 for no locktime.",
          },
        ],
        groups: [
          {
            title: "INPUTS[]",
            baseIndex: 1000,
            expandable: true,
            fieldCountToAdd: 6,
            minInstances: 1,
            maxInstances: 10,
            fields: [
              {
                index: 0,
                label: "Derivation Path:",
                placeholder: "m/44'/1'/0'/0/0",
                rows: 1,
                comment:
                  "BIP32 path for the key Trezor should use to sign this input, e.g. m/44'/1'/0'/0/0.",
              },
              {
                index: 10,
                label: "Previous TXID (display order):",
                placeholder: "<32-byte txid>",
                rows: 2,
                comment:
                  "32-byte transaction id as shown by wallets/explorers. Do not reverse the bytes.",
              },
              {
                index: 20,
                label: "Previous Output Index:",
                placeholder: "0",
                rows: 1,
                comment: "Decimal vout index of the UTXO being spent.",
              },
              {
                index: 30,
                label: "Input Amount (sats):",
                placeholder: "146263",
                rows: 1,
                comment:
                  "UTXO amount in satoshis. Must match the selected output in Previous Raw TX Hex.",
              },
              {
                index: 40,
                label: "Sequence:",
                placeholder: "ffffffff or fffffffd",
                rows: 1,
                comment:
                  "Trezor expects a uint32 number. Use decimal or display-order hex like fffffffd. Do not reverse it to fdffffff.",
              },
              {
                index: 50,
                label: "Input Script Type:",
                unconnectable: true, // dropdown, no cables
                options: [
                  "AUTO",
                  "SPENDADDRESS",
                  "SPENDWITNESS",
                  "SPENDP2SHWITNESS",
                  "SPENDTAPROOT",
                ],
                comment:
                  "AUTO infers from the path purpose: 44, 49, 84, or 86.",
              },
            ],
          },
          {
            title: "OUTPUTS[]",
            baseIndex: 3000,
            expandable: true,
            fieldCountToAdd: 3,
            minInstances: 1,
            maxInstances: 20,
            fields: [
              {
                index: 0,
                label: "Address or Change Path:",
                placeholder: "<address> or m/44'/1'/0'/1/0",
                rows: 1,
                comment:
                  "Use a destination address for external outputs, or a BIP32 path for Trezor change outputs.",
              },
              {
                index: 10,
                label: "Amount (sats):",
                placeholder: "145000",
                rows: 1,
                comment: "Output amount in satoshis.",
              },
              {
                index: 20,
                label: "Output Script Type:",
                unconnectable: true, // dropdown, no cables
                options: [
                  "AUTO",
                  "PAYTOADDRESS",
                  "PAYTOWITNESS",
                  "PAYTOP2SHWITNESS",
                  "PAYTOTAPROOT",
                ],
                comment:
                  "AUTO infers script type for change paths. Address outputs use PAYTOADDRESS.",
              },
            ],
          },
          {
            title: "PREVIOUS RAW TXS[]",
            baseIndex: 5000,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 1,
            maxInstances: 20,
            fields: [
              {
                index: 0,
                label: "Previous Raw TX Hex:",
                placeholder: "<previous transaction hex>",
                rows: 5,
                allowEmptyBlank: true,
                comment:
                  "Full raw transaction hex for the transaction that created the UTXO. Order does not need to match INPUTS[].",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: {
        "INPUTS[]": 1,
        "OUTPUTS[]": 1,
        "PREVIOUS RAW TXS[]": 1,
      },
      groupInstanceKeys: {
        "INPUTS[]": [1000],
        "OUTPUTS[]": [3000],
        "PREVIOUS RAW TXS[]": [5000],
      },
      result: "",
      baseHeight: 180,
      dirty: false,
    },
  },
  {
    functionName: "trezor_sign_transaction",
    label: "Trezor Sign",
    category: "Signing & Verification",
    subcategory: "Trezor",
    description:
      "Browser-side Trezor Connect signing call that accepts prebuilt signTransaction params JSON.",
    type: "trezorAction",
    nodeData: {
      functionName: "trezor_sign_transaction",
      title: "Trezor Sign",
      hideCode: true,
      hardwareAction: "trezor_sign_transaction",
      hardwareActionLabel: "Sign",
      paramExtraction: "multi_val",
      numInputs: 1,
      inputs: {
        vals: {
          0: "",
        },
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "signTransaction Params JSON:",
            placeholder: "Trezor Sign Params output",
            rows: 8,
            comment:
              "This JSON is sent to Trezor Connect when you press Sign.",
          },
        ],
      },
      outputPorts: [
        {
          label: "signed tx",
          handleId: "",
          handleTop: "50%",
          showLabel: false,
        },
      ],
      groupInstances: {},
      result: "",
      hardwareStatus: "idle",
      hardwareStatusText:
        "Press Sign to send the structured transaction request to Trezor.",
      dirty: false,
    },
  },
  {
    functionName: "compare_equal",
    label: "Compare (==)",
    category: "Logic & Checks",
    subcategory: "Comparisons",
    description: "Checks that ALL inputs are byte-for-byte identical",
    type: "calculation",
    nodeData: {
      functionName: "compare_equal",
      title: "Compare (==)",
      paramExtraction: "multi_val",
      numInputs: 2, // initial pair
      inputs: { vals: [] },
      result: "",
      /* one expandable group VALUES[] (min 2, max 12) */
      inputStructure: {
        groups: [
          {
            title: "VALUES[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 2,
            maxInstances: 12,
            fields: [
              {
                index: 0,
                label: "Value:",
                rows: 2,
                placeholder: "<hex or text>",
              },
            ],
          },
        ],
        ungrouped: [],
        afterGroups: [],
      },
      groupInstances: { "VALUES[]": 2 },
      groupInstanceKeys: { "VALUES[]": [0, 100] },
    },
  },
  {
    /* ─ Compare Numbers ─ */
    functionName: "compare_numbers",
    label: "Compare Numbers",
    category: "Logic & Checks",
    subcategory: "Comparisons",
    description: "Tests a numeric relation (<, >, ≤, ≥) between two values",
    type: "calculation",
    nodeData: {
      functionName: "compare_numbers",
      title: "Compare Numbers",
      paramExtraction: "multi_val",
      numInputs: 3, // [left, operator, right]
      inputs: { vals: ["", "<", ""] },
      result: "",

      inputStructure: {
        ungrouped: [
          { index: 0, label: "Left value:", rows: 1, placeholder: "e.g. 5" },
          {
            index: 1,
            label: "Operator:",
            unconnectable: true, // dropdown, no cables
            options: ["<", ">", "<=", ">="],
          },
          { index: 2, label: "Right value:", rows: 1, placeholder: "e.g. 10" },
        ],
      },

      groupInstances: {},
    },
  },

  {
    /* ─ Math Operation ─ */
    functionName: "math_operation",
    label: "Math Operation",
    category: "Logic & Checks",
    subcategory: "Math",
    description:
      "Performs basic math operations: add/plus (+), subtract/minus (−), multiply/times (×), or divide (÷) on two values",
    type: "calculation",
    nodeData: {
      functionName: "math_operation",
      title: "Math Operation",
      paramExtraction: "multi_val",
      numInputs: 3, // [left, operator, right]
      inputs: { vals: ["", "+", ""] },
      result: "",
      inputStructure: {
        ungrouped: [
          { index: 0, label: "Left value:", rows: 1, placeholder: "e.g. 5" },
          {
            index: 1,
            label: "Operator:",
            unconnectable: true,
            options: ["+", "-", "*", "/"],
          },
          { index: 2, label: "Right value:", rows: 1, placeholder: "e.g. 10" },
        ],
      },
      groupInstances: {},
    },
  },

  // Specialized nodes for Bitcoin transaction building

  // PREVOUTS Node - Concatenates all inputs' outpoints (txid + vout)
  {
    functionName: "concat_all",
    label: "PREVOUTS Builder",
    category: "Transactions",
    subcategory: "Builders",
    description:
      "Builds concatenated prevouts for transaction signing (all txid+vout pairs)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "PREVOUTS Builder",
      paramExtraction: "multi_val",
      numInputs: 2, // Initial: 1 input (2 fields)
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [],
        groups: [
          {
            title: "PREVOUTS[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 2,
            minInstances: 1,
            maxInstances: 20,
            fields: [
              {
                index: 0,
                label: "TXID[32]:",
                placeholder: "Previous transaction ID (reversed)",
                rows: 2,
                comment: "32-byte transaction ID in reversed byte order",
              },
              {
                index: 10,
                label: "VOUT[4]:",
                placeholder: "00000000",
                rows: 1,
                comment: "Output index in little-endian (4 bytes)",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: { "PREVOUTS[]": 1 },
      groupInstanceKeys: { "PREVOUTS[]": [0] },
      baseHeight: 100,
    },
  },

  // SEQUENCE Node - Concatenates all inputs' sequence values
  {
    functionName: "concat_all",
    label: "SEQUENCE Builder",
    category: "Transactions",
    subcategory: "Builders",
    description: "Builds concatenated sequence values for transaction signing",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "SEQUENCE Builder",
      paramExtraction: "multi_val",
      numInputs: 1, // Initial: 1 sequence
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [],
        groups: [
          {
            title: "SEQUENCES[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 1,
            maxInstances: 20,
            fields: [
              {
                index: 0,
                label: "SEQUENCE[4]:",
                placeholder: "fdffffff",
                rows: 1,
                comment:
                  "4-byte sequence (LE). Use fdffffff for RBF, ffffffff for final",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: { "SEQUENCES[]": 1 },
      groupInstanceKeys: { "SEQUENCES[]": [0] },
      baseHeight: 80,
    },
  },
  // SCRIPTS Node - Concatenates compact_size(scriptPubKey) + scriptPubKey per input
  {
    functionName: "concat_all",
    label: "scriptPubKeys",
    category: "Transactions",
    subcategory: "Builders",
    description:
      "Builds compact_size(scriptPubKey) || scriptPubKey for each input (Taproot hash_scripts)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "scriptPubKeys",
      paramExtraction: "multi_val",
      numInputs: 2, // Initial: 1 input (2 fields)
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [],
        groups: [
          {
            title: "scriptPubKeys",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 2,
            minInstances: 1,
            maxInstances: 99,
            instanceLabelPrefix: "Input",
            fields: [
              {
                index: 0,
                label: "Compact Size:",
                placeholder: "<compact_size>",
                rows: 1,
              },
              {
                index: 10,
                label: "scriptPubKey:",
                placeholder: "<scriptPubKey>",
                rows: 3,
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: { scriptPubKeys: 1 },
      groupInstanceKeys: { scriptPubKeys: [0] },
      baseHeight: 120,
    },
  },

  // OUTPOINT Node - Single outpoint (txid + vout) for specific input signing
  {
    functionName: "concat_all",
    label: "OUTPOINT Builder",
    category: "Transactions",
    subcategory: "Builders",
    description:
      "Builds a single outpoint (txid+vout) for BIP143 signing of specific input",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "OUTPOINT Builder",
      paramExtraction: "multi_val",
      numInputs: 2,
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "TXID[32]:",
            placeholder: "Transaction ID of UTXO being spent (reversed)",
            rows: 2,
            comment: "The specific input's previous transaction ID",
          },
          {
            index: 10,
            label: "VOUT[4]:",
            placeholder: "00000000",
            rows: 1,
            comment: "The specific input's output index (little-endian)",
          },
        ],
        groups: [],
        afterGroups: [],
      },
      groupInstances: {},
      baseHeight: 80,
    },
  },

  // OUTPUTS Node - Concatenates all outputs (amount + script_length + script)
  {
    functionName: "concat_all",
    label: "OUTPUTS Builder",
    category: "Transactions",
    subcategory: "Builders",
    description:
      "Builds concatenated outputs for transaction (amount+script_length+script)",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "OUTPUTS Builder",
      paramExtraction: "multi_val",
      numInputs: 3, // Initial: 1 output (3 fields)
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [],
        groups: [
          {
            title: "OUTPUTS[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 3,
            minInstances: 1,
            maxInstances: 20,
            fields: [
              {
                index: 0,
                label: "AMOUNT[8]:",
                placeholder: "e.g., 3069020000000000",
                rows: 1,
                comment: "Amount in satoshis as 8-byte little-endian hex",
              },
              {
                index: 10,
                label: "SCRIPT_LENGTH:",
                placeholder: "e.g., 16",
                rows: 1,
                small: true,
                comment:
                  "Script length as varint (usually 16 for P2WPKH, 19 for P2PKH)",
              },
              {
                index: 20,
                label: "SCRIPT_PUBKEY:",
                placeholder: "e.g., 0014[20-byte-hash]",
                rows: 2,
                comment: "The locking script (scriptPubKey)",
              },
            ],
          },
        ],
        afterGroups: [],
      },
      groupInstances: { "OUTPUTS[]": 1 },
      groupInstanceKeys: { "OUTPUTS[]": [0] },
      baseHeight: 100,
    },
  },
  // SCRIPTCODE Node - Builds the script code for BIP143 signing
  {
    functionName: "concat_all",
    label: "SCRIPTCODE Builder",
    category: "Transactions",
    subcategory: "Builders",
    description:
      "Builds scriptcode for BIP143 signing. P2WPKH: standard P2PKH script. P2WSH: the witness script",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "SCRIPTCODE Builder",
      paramExtraction: "multi_val",
      numInputs: 4, // For P2WPKH: 4 parts
      inputs: { vals: [] },

      version: 0,
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "PREFIX:",
            placeholder: "76a9 for P2WPKH, empty for P2WSH",
            rows: 1,
            allowEmptyBlank: true,
            comment: "OP_DUP OP_HASH160 for P2WPKH, leave empty for P2WSH",
          },
          {
            index: 10,
            label: "PUSH_OPCODE:",
            placeholder: "14 for P2WPKH, leave empty for P2WSH",
            rows: 1,
            allowEmptyBlank: true,
            comment:
              "Push opcode: 14 for 20-byte hash, or appropriate for P2WSH script",
          },
          {
            index: 20,
            label: "SCRIPT/HASH:",
            placeholder: "20-byte hash for P2WPKH, full script for P2WSH",
            rows: 3,
            comment:
              "P2WPKH: 20-byte pubkey hash | P2WSH: complete witness script",
          },
          {
            index: 30,
            label: "SUFFIX:",
            placeholder: "88ac for P2WPKH, empty for P2WSH",
            rows: 1,
            allowEmptyBlank: true,
            comment:
              "OP_EQUALVERIFY OP_CHECKSIG for P2WPKH, leave empty for P2WSH",
          },
        ],
        groups: [],
        afterGroups: [],
        // Add a help text section
        helpText:
          "P2WPKH: 76a9 | 14 | [20-byte-hash] | 88ac\nP2WSH: [empty] | [empty] | [witness-script] | [empty]",
      },
      groupInstances: {},
      baseHeight: 120,
    },
  },
  {
    functionName: "hash160_to_p2pkh_address",
    label: "HASH160 → P2PKH Address",
    category: "Keys & Addresses",
    subcategory: "Address & ScriptPubKey",
    description: "Creates a Base58 P2PKH address from a 20-byte HASH160",
    type: "calculation",
    nodeData: {
      functionName: "hash160_to_p2pkh_address",
      title: "HASH160 → P2PKH Address",
      numInputs: 1,

      networkDependent: true,
      selectedNetwork: "testnet",

      groupInstances: {},
      result: "",
      inputs: {
        selectedNetwork: "testnet",
        val: "",
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "HASH160:",
            rows: 2,
            placeholder: "20-byte hash (40 hex characters)",
          },
        ],
      },
    },
  },
  {
    functionName: "hash160_to_p2wpkh_address",
    label: "HASH160 → P2WPKH Address",
    category: "Keys & Addresses",
    subcategory: "Address & ScriptPubKey",
    description:
      "Creates a bech32 SegWit v0 P2WPKH address from a 20‑byte HASH160",
    type: "calculation",
    nodeData: {
      functionName: "hash160_to_p2wpkh_address",
      title: "HASH160 → P2WPKH Address",
      numInputs: 1,

      networkDependent: true,
      selectedNetwork: "testnet",

      groupInstances: {},
      result: "",
      inputs: { selectedNetwork: "testnet", val: "" },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "HASH160:",
            rows: 2,
            placeholder: "20‑byte hash (40 hex)",
          },
        ],
      },
    },
  },
  {
    functionName: "sha256_to_p2wsh_address",
    label: "SHA256 → P2WSH Address",
    category: "Keys & Addresses",
    subcategory: "Address & ScriptPubKey",
    description:
      "Creates a bech32 SegWit v0 P2WSH address from a 32‑byte SHA‑256 script‑hash",
    type: "calculation",
    nodeData: {
      functionName: "sha256_to_p2wsh_address",
      title: "SHA256 → P2WSH Address",
      numInputs: 1,

      networkDependent: true,
      selectedNetwork: "testnet",

      groupInstances: {},
      result: "",
      inputs: { selectedNetwork: "testnet", val: "" },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "SHA‑256 (script‑hash):",
            rows: 2,
            placeholder: "32‑byte hash (64 hex)",
          },
        ],
      },
    },
  },
  {
    functionName: "hex_byte_length",
    label: "Hex → Byte Length",
    category: "Encoding & Script Data",
    subcategory: "Bytes, Integers & Pushdata",
    description:
      "Returns the number of bytes a hex‑encoded string represents (whitespace ignored).",
    type: "calculation",

    nodeData: {
      // ↓ this must match the back‑end function & function_specs entry
      functionName: "hex_byte_length",
      title: "Hex → Byte Length",
      numInputs: 1,

      groupInstances: {},
      result: "",

      // initial input values
      inputs: { val: "" },

      // UI layout for the config panel
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Hex string:",
            rows: 4,
            placeholder: "e.g. 0200000001…",
          },
        ],
      },
    },
  },
  {
    functionName: "address_to_scriptpubkey",
    label: "Address → ScriptPubKey",
    category: "Keys & Addresses",
    subcategory: "Address & ScriptPubKey",
    description:
      "Converts any Bitcoin address to its scriptPubKey. Auto-detects P2PKH, P2SH, P2WPKH, P2WSH, P2TR (Taproot), and future witness versions",
    type: "calculation",
    nodeData: {
      functionName: "address_to_scriptpubkey",
      title: "Address → ScriptPubKey",
      numInputs: 1,

      version: 0,
      inputs: { val: "" },
      result: "",
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "Bitcoin Address:",
            rows: 2,
            placeholder: "Any address format (1..., 3..., bc1...)",
          },
        ],
      },
      groupInstances: {},
    },
  },
  {
    functionName: "concat_all",
    label: "Taproot Preimage (Base)",
    category: "Transactions",
    subcategory: "Preimages",
    description:
      "Build Taproot SigMsg fields 0–10 (epoch, sighash_type, version, locktime, hash_*). hash_outputs is optional (NONE/SINGLE).",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "Taproot Preimage (Base)",
      paramExtraction: "multi_val",
      numInputs: 11,
      inputs: {
        vals: [
          "00", // epoch
          "00", // sighash_type
          "02000000", // version
          "00000000", // locktime
          "", // hash_prevouts
          "", // hash_amounts
          "", // hash_scripts
          "", // hash_sequences
          "", // hash_outputs (optional)
          "00", // spend_type
          "00000000", // input_index
        ],
      },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "EPOCH (1B):",
            rows: 1,
            placeholder: "00",
            comment: "Version byte for future sighash upgrades (always 00 now)",
          },
          {
            index: 1,
            label: "SIGHASH_TYPE (1B):",
            rows: 1,
            placeholder: "00 / 01 / 02 / 03",
            comment: "Taproot sighash flag (BIP342 semantics)",
          },
          {
            index: 2,
            label: "VERSION (4B LE):",
            rows: 1,
            placeholder: "01000000",
            comment: "Transaction version (little-endian)",
          },
          {
            index: 3,
            label: "LOCKTIME (4B LE):",
            rows: 1,
            placeholder: "00000000",
            comment: "nLockTime (little-endian)",
          },
          {
            index: 4,
            label: "HASH_PREVOUTS (32B):",
            rows: 2,
            placeholder: "<sha256 of all outpoints>",
            comment: "Shared across inputs: sha256 of all outpoints",
          },
          {
            index: 5,
            label: "HASH_AMOUNTS (32B):",
            rows: 2,
            placeholder: "<sha256 of all amounts>",
            comment: "NEW in Taproot: sha256 of all input amounts",
          },
          {
            index: 6,
            label: "HASH_SCRIPTS (32B):",
            rows: 2,
            placeholder: "<sha256 of all scriptPubKeys>",
            comment: "NEW in Taproot: sha256 of all input scriptPubKeys",
          },
          {
            index: 7,
            label: "HASH_SEQUENCES (32B):",
            rows: 2,
            placeholder: "<sha256 of all sequences>",
            comment: "Shared across inputs: sha256 of all sequences",
          },
          {
            index: 8,
            label: "HASH_OUTPUTS (32B, optional):",
            rows: 2,
            placeholder: "<sha256 of outputs, leave empty for NONE>",
            allowEmptyBlank: true,
            comment:
              'Sha256 of all outputs; toggle "Allow Empty/None" for SIGHASH_NONE/SINGLE.',
          },
          {
            index: 9,
            label: "SPEND_TYPE (1B):",
            rows: 1,
            placeholder: "00 (key) / 02 (script)",
            comment: "00 = key-path, 02 = script-path (annex sets bit 0x01)",
          },
          {
            index: 10,
            label: "INPUT_INDEX (4B LE):",
            rows: 1,
            placeholder: "00000000",
            comment:
              "Little-endian vin index being signed (0-based; 00000000 for single-input txs)",
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "concat_all",
    label: "Taproot Preimage (Script Add-on)",
    category: "Transactions",
    subcategory: "Preimages",
    description:
      "Append script-path fields (tapleaf_hash, key_version, codesep_pos) to the base Taproot preimage",
    type: "calculation",
    nodeData: {
      functionName: "concat_all",
      title: "Taproot Preimage (Script Add-on)",
      paramExtraction: "multi_val",
      numInputs: 4,
      inputs: { vals: ["", "", "00", "ffffffff"] },
      inputStructure: {
        ungrouped: [
          {
            index: 0,
            label: "BASE_PREIMAGE (hex):",
            rows: 3,
            placeholder: "Connect from Taproot Preimage (Base)",
          },
          {
            index: 1,
            label: "TAPLEAF_HASH (32B):",
            rows: 2,
            placeholder: "<hash of script leaf>",
          },
          {
            index: 2,
            label: "KEY_VERSION (1B):",
            rows: 1,
            placeholder: "00",
            unconnectable: true,
          },
          {
            index: 3,
            label: "CODESEP_POS (4B LE):",
            rows: 1,
            placeholder: "ffffffff",
            unconnectable: true,
          },
        ],
      },
      groupInstances: {},
      result: "",
    },
  },
  {
    functionName: "bip67_sort_pubkeys",
    label: "BIP-67 PubKey Sort",
    category: "Keys & Addresses",
    subcategory: "Multisig Keys",
    description:
      "Sort public keys lexicographically per BIP-67 for deterministic multisig. Shows original positions after sorting (e.g., '2,4,1,3')",
    type: "calculation",
    nodeData: {
      functionName: "bip67_sort_pubkeys",
      title: "BIP-67 PubKey Sort",
      paramExtraction: "multi_val",
      numInputs: 2, // Start with 2 pubkeys
      inputs: { vals: [] },

      version: 0,
      result: "",
      hasOutputHandle: false, // No output handle as requested
      inputStructure: {
        groups: [
          {
            title: "PUBLIC_KEYS[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 2, // At least 2 for multisig
            maxInstances: 20, // Reasonable max for multisig
            fields: [
              {
                index: 0,
                label: "Public Key:",
                placeholder: "02/03... (compressed) or 04... (uncompressed)",
                rows: 2,
                comment:
                  "33-byte compressed or 65-byte uncompressed public key in hex",
              },
            ],
          },
        ],
        ungrouped: [],
        afterGroups: [],
      },
      groupInstances: { "PUBLIC_KEYS[]": 2 },
      groupInstanceKeys: { "PUBLIC_KEYS[]": [0, 100] },
      baseHeight: 100,
    },
  },
  // In sidebar-nodes.ts, add this in the Utility category:

  {
    functionName: "check_result",
    label: "Check Result",
    category: "Logic & Checks",
    subcategory: "Assertions",
    description:
      "Raises an error if ANY input is not 'true'. Use to convert comparison results to errors.",
    type: "calculation",
    nodeData: {
      functionName: "check_result",
      title: "Check Result",
      paramExtraction: "multi_val",
      numInputs: 1, // initial single input
      inputs: { vals: [] },
      result: "",
      /* one expandable group VALUES[] (min 1, max 12) - same as Compare (==) */
      inputStructure: {
        groups: [
          {
            title: "VALUES[]",
            baseIndex: 0,
            expandable: true,
            fieldCountToAdd: 1,
            minInstances: 1,
            maxInstances: 12,
            fields: [
              {
                index: 0,
                label: "Value:",
                rows: 1,
                placeholder: "true/false",
              },
            ],
          },
        ],
        ungrouped: [],
        afterGroups: [],
      },
      groupInstances: { "VALUES[]": 1 },
      groupInstanceKeys: { "VALUES[]": [0] },
    },
  },
];
