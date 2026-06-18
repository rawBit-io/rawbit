import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK so we control init()/getAddress() and count calls.
const init = vi.fn();
const manifest = vi.fn();
const getAddress = vi.fn();

vi.mock("@trezor/connect-web", () => ({
  default: {
    init: (...args: unknown[]) => init(...args),
    manifest: (...args: unknown[]) => manifest(...args),
    getAddress: (...args: unknown[]) => getAddress(...args),
  },
}));

const addrParams = {
  path: "m/44'/0'/0'/0/0",
  coin: "btc",
  scriptType: "SPENDADDRESS",
  showOnTrezor: false,
};

async function loadGetAddress() {
  // Fresh module each test so the module-level initPromise starts null.
  const mod = await import("../connect");
  return mod.getTrezorAddress;
}

describe("trezor ensureInitialized recovery (NB-02)", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockReset();
    manifest.mockReset();
    getAddress.mockReset();
    getAddress.mockResolvedValue({
      success: true,
      payload: { address: "addr", path: [], serializedPath: "" },
    });
  });

  it("re-inits after a failed init instead of caching the rejection", async () => {
    init.mockRejectedValueOnce(new Error("popup blocked")).mockResolvedValue(undefined);
    const getTrezorAddress = await loadGetAddress();

    // First attempt: init() rejects → the call rejects.
    await expect(getTrezorAddress(addrParams)).rejects.toThrow("popup blocked");

    // Second attempt (user allowed the popup / plugged in the device): init()
    // must be retried, not the stale rejected promise re-awaited.
    await expect(getTrezorAddress(addrParams)).resolves.toMatchObject({
      address: "addr",
    });

    expect(init).toHaveBeenCalledTimes(2);
    expect(getAddress).toHaveBeenCalledTimes(1);
  });

  it("caches a successful init (init called once across calls)", async () => {
    init.mockResolvedValue(undefined);
    const getTrezorAddress = await loadGetAddress();

    await getTrezorAddress(addrParams);
    await getTrezorAddress(addrParams);

    expect(init).toHaveBeenCalledTimes(1);
    expect(getAddress).toHaveBeenCalledTimes(2);
  });
});
