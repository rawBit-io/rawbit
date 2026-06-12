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

  it("seeds P2WPKH Witness defaults in inputs.vals instead of dead field values", () => {
    const template = templateByTitle("P2WPKH Witness");
    expect(template.nodeData?.inputs?.vals).toEqual({ 0: "02", 30: "21" });
    forEachStructureField(template.nodeData, (field) => {
      expect(field.value).toBeUndefined();
    });
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
