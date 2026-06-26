export const DISMISS_NODE_MENUS_EVENT = "rawbit:dismiss-node-menus";

export function dispatchDismissNodeMenusEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DISMISS_NODE_MENUS_EVENT));
}
