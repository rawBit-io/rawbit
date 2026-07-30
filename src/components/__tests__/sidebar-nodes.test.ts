import { describe, expect, it } from "vitest";
import { allSidebarNodes } from "@/components/sidebar-nodes";
import {
  canGrowGroup,
  collectReservedIndices,
  getNextGapIndex,
} from "@/lib/nodes/fieldUtils";
import type { FieldDefinition, NodeData, NodeTemplate } from "@/types";

const templateByTitle = (title: string): NodeTemplate => {
  const template = allSidebarNodes.find((t) => t.nodeData?.title === title);
  if (!template) throw new Error(`sidebar template not found: ${title}`);
  return template;
};

const forEachStructureField = (
  data: NodeData | undefined,
  callback: (field: FieldDefinition, where: string) => void
) => {
  const structure = data?.inputStructure;
  structure?.ungrouped?.forEach((field) => callback(field, "ungrouped"));
  structure?.groups?.forEach((group) =>
    group.fields.forEach((field) => callback(field, group.title))
  );
  Object.entries(structure?.betweenGroups ?? {}).forEach(([title, fields]) =>
    fields.forEach((field) => callback(field, `betweenGroups:${title}`))
  );
  structure?.afterGroups?.forEach((field) => callback(field, "afterGroups"));
};

describe("sidebar node templates", () => {
  it("marks every dropdown (options) field unconnectable", () => {
    const offenders: string[] = [];
    for (const template of allSidebarNodes) {
      forEachStructureField(template.nodeData, (field, where) => {
        if (field.options?.length && !field.unconnectable) {
          offenders.push(`${template.label} / ${where} / ${field.label}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("marks the identity 'Input' field unconnectable (no handle is rendered)", () => {
    const template = templateByTitle("Input");
    const field = template.nodeData?.inputStructure?.ungrouped?.[0];
    expect(field?.unconnectable).toBe(true);
  });

  it("does not prefill radio nodes with palette color", () => {
    expect(templateByTitle("Radio Send 1").nodeData?.borderColor).toBeUndefined();
    expect(
      templateByTitle("Radio Receive 1").nodeData?.borderColor,
    ).toBeUndefined();
  });

  it("seeds P2WPKH Witness defaults in inputs.vals instead of dead field values", () => {
    const template = templateByTitle("P2WPKH Witness");
    expect(template.nodeData?.inputs?.vals).toEqual({ 0: "02", 30: "21" });
    forEachStructureField(template.nodeData, (field) => {
      expect(field.value).toBeUndefined();
    });
  });

  it("ships the complete Mining & Blocks palette with deterministic mining defaults", () => {
    const miningTemplates = allSidebarNodes.filter(
      (template) => template.category === "Mining & Blocks"
    );

    expect(miningTemplates.map((template) => template.label)).toEqual([
      "Bits → Target",
      "Bitcoin Block Merkle Tree",
      "Mine Nonce Range",
      "Verify Block PoW",
      "Block Header Builder",
      "Raw Block Builder",
    ]);

    const merkleTree = templateByTitle("Bitcoin Block Merkle Tree");
    expect(merkleTree.nodeData?.outputPorts).toEqual([
      {
        label: "merkle root (internal)",
        handleId: "",
        handleTop: "50%",
        showLabel: false,
      },
    ]);
    const txHashes = merkleTree.nodeData?.inputStructure?.groups?.find(
      (group) => group.title === "TX_HASHES[]"
    );
    expect(txHashes).toMatchObject({
      baseIndex: 100,
      expandable: true,
      minInstances: 1,
      maxInstances: 99,
    });
    const txHashKeys = [
      ...(merkleTree.nodeData?.groupInstanceKeys?.["TX_HASHES[]"] ?? []),
    ];
    while (txHashKeys.length < 99) {
      expect(
        canGrowGroup(
          txHashes?.baseIndex ?? 0,
          txHashKeys,
          txHashes?.fields ?? []
        )
      ).toBe(true);
      txHashKeys.push(getNextGapIndex(txHashKeys, txHashes?.baseIndex ?? 0));
    }
    expect(txHashKeys).toHaveLength(99);
    expect(txHashKeys.at(-1)).toBe(9_900);

    const miner = templateByTitle("Mine Nonce Range");
    expect(miner.nodeData?.inputs?.vals).toEqual({
      0: "",
      1: "0",
      2: "100",
      3: "",
    });
    expect(miner.nodeData?.advanceButton).toEqual({
      targetField: 1,
      stepField: 2,
      label: "Mine next batch",
      nextValueOutput: "output-2",
      disableWhenOutput: {
        handleId: "output-1",
        equals: "true",
      },
    });
    expect(miner.nodeData?.outputPorts?.map((port) => port.handleId)).toEqual([
      "output-0",
      "output-1",
      "output-2",
    ]);

    const rawBlock = templateByTitle("Raw Block Builder");
    const transactions = rawBlock.nodeData?.inputStructure?.groups?.find(
      (group) => group.title === "TXS[]"
    );
    expect(transactions).toMatchObject({
      baseIndex: 100,
      expandable: true,
      minInstances: 1,
      maxInstances: 99,
    });
    const keys = [...(rawBlock.nodeData?.groupInstanceKeys?.["TXS[]"] ?? [])];
    while (keys.length < 99) {
      expect(
        canGrowGroup(
          transactions?.baseIndex ?? 0,
          keys,
          transactions?.fields ?? []
        )
      ).toBe(true);
      keys.push(getNextGapIndex(keys, transactions?.baseIndex ?? 0));
    }
    expect(keys.at(-1)).toBe(9_900);
  });

  it.each([
    ["PUBKEYS[]", 1000],
    ["PARTIAL_SIGS[]", 2900],
  ])(
    "MuSig2 Partial Sig Agg can grow %s to all 10 declared instances",
    (title, lastExpectedBase) => {
      const template = templateByTitle("MuSig2 Partial Sig Agg");
      const data = JSON.parse(JSON.stringify(template.nodeData)) as NodeData;
      const group = data.inputStructure?.groups?.find((g) => g.title === title);
      if (!group) throw new Error(`group not found: ${title}`);
      expect(group.maxInstances).toBe(10);

      const keys = [...(data.groupInstanceKeys?.[title] ?? [])];
      expect(keys).toHaveLength(2);

      // Mirror useGroupInstances.handleGroupSize's growth gate: the '+' click
      // is a silent no-op when the next base overlaps another group's
      // reserved indices.
      while (keys.length < (group.maxInstances ?? 0)) {
        expect(canGrowGroup(group.baseIndex, keys, group.fields)).toBe(true);
        const nextBase = getNextGapIndex(keys, group.baseIndex);
        const reserved = collectReservedIndices(data, title);
        const overlaps = group.fields.some((field) =>
          reserved.has(nextBase + field.index)
        );
        expect(overlaps).toBe(false);
        keys.push(nextBase);
        data.groupInstanceKeys = {
          ...(data.groupInstanceKeys ?? {}),
          [title]: keys,
        };
      }

      expect(keys).toHaveLength(10);
      expect(keys[keys.length - 1]).toBe(lastExpectedBase);
    }
  );
});
