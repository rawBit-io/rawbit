import { Handle, Position } from "@xyflow/react";

import {
  GROUP_BUNDLE_PORT_SOURCE_HANDLE,
  GROUP_BUNDLE_PORT_TARGET_HANDLE,
} from "@/lib/flow/groupEdgeBundling";

export function GroupBundlePortNode() {
  return (
    <div className="group-bundle-port-node" aria-hidden="true">
      <Handle
        id={GROUP_BUNDLE_PORT_TARGET_HANDLE}
        type="target"
        position={Position.Left}
        className="group-bundle-port-handle"
        isConnectable={false}
      />
      <Handle
        id={GROUP_BUNDLE_PORT_SOURCE_HANDLE}
        type="source"
        position={Position.Right}
        className="group-bundle-port-handle"
        isConnectable={false}
      />
    </div>
  );
}
