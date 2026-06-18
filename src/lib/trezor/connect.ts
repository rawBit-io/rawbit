import TrezorConnect from "@trezor/connect-web";

type TrezorFailurePayload = {
  error?: string;
  message?: string;
  code?: string;
};

type TrezorResult<T> =
  | { success: true; payload: T }
  | { success: false; payload: TrezorFailurePayload };

type TrezorAddressScriptType =
  | "SPENDADDRESS"
  | "SPENDMULTISIG"
  | "SPENDWITNESS"
  | "SPENDP2SHWITNESS"
  | "SPENDTAPROOT";

export type TrezorAddressPayload = {
  address: string;
  path?: number[];
  serializedPath?: string;
};

export type TrezorSignedTransactionPayload = {
  signatures?: string[];
  serializedTx: string;
  txid?: string;
};

type TrezorSignTransactionParams = Record<string, unknown>;

let manifestRegistered = false;
let initPromise: Promise<void> | null = null;

function getAppUrl() {
  const configured = import.meta.env.VITE_TREZOR_CONNECT_APP_URL;
  if (configured && String(configured).trim()) return String(configured).trim();
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://rawbit.example";
}

function getManifestEmail() {
  const configured = import.meta.env.VITE_TREZOR_CONNECT_EMAIL;
  if (configured && String(configured).trim()) return String(configured).trim();
  return "rawbit-demo@example.com";
}

function getAppName() {
  const configured = import.meta.env.VITE_TREZOR_CONNECT_APP_NAME;
  if (configured && String(configured).trim()) return String(configured).trim();
  return "rawBit";
}

function buildManifest() {
  return {
    appName: getAppName(),
    appUrl: getAppUrl(),
    email: getManifestEmail(),
  };
}

function getCoreMode() {
  const configured = import.meta.env.VITE_TREZOR_CONNECT_CORE_MODE;
  const normalized = configured ? String(configured).trim() : "";
  if (
    normalized === "auto" ||
    normalized === "iframe" ||
    normalized === "popup" ||
    normalized === "suite-desktop" ||
    normalized === "suite-web"
  ) {
    return normalized;
  }
  return "auto";
}

async function ensureInitialized() {
  if (!initPromise) {
    // A failed init() leaves the SDK uninitialized, so re-calling it is valid.
    // Clear the cached promise on rejection (with an identity guard so a
    // concurrent retry's newer promise is not clobbered) — otherwise the stale
    // rejection is re-thrown on every later call and Trezor stays dead for the
    // whole session even after the user fixes the cause (popup/device). A
    // resolved init stays cached so init() is never called twice on success.
    const pending = TrezorConnect.init({
      manifest: buildManifest(),
      coreMode: getCoreMode(),
      popup: true,
    });
    initPromise = pending;
    pending.catch(() => {
      if (initPromise === pending) initPromise = null;
    });
  }

  await initPromise;

  if (!manifestRegistered) {
    TrezorConnect.manifest(buildManifest());
  }

  manifestRegistered = true;
}

function errorFromPayload(payload: TrezorFailurePayload) {
  return payload.error || payload.message || payload.code || "Trezor request failed";
}

export function parseTrezorBoolean(value: string, fallback: boolean) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "yes", "1", "on"].includes(normalized)) return true;
  if (["false", "no", "0", "off"].includes(normalized)) return false;
  throw new Error(`Expected true or false, got "${value}"`);
}

function parseAddressScriptType(value: string): TrezorAddressScriptType {
  const normalized = value.trim() || "SPENDADDRESS";
  if (
    normalized === "SPENDADDRESS" ||
    normalized === "SPENDMULTISIG" ||
    normalized === "SPENDWITNESS" ||
    normalized === "SPENDP2SHWITNESS" ||
    normalized === "SPENDTAPROOT"
  ) {
    return normalized;
  }
  throw new Error(`Unsupported Trezor address scriptType "${value}"`);
}

export async function getTrezorAddress(params: {
  path: string;
  coin: string;
  scriptType: string;
  showOnTrezor: boolean;
}) {
  await ensureInitialized();

  const result = (await TrezorConnect.getAddress({
    path: params.path,
    coin: params.coin,
    scriptType: parseAddressScriptType(params.scriptType),
    showOnTrezor: params.showOnTrezor,
  })) as TrezorResult<TrezorAddressPayload>;

  if (!result.success) {
    throw new Error(errorFromPayload(result.payload));
  }

  return result.payload;
}

function parseSignTransactionParams(raw: string): TrezorSignTransactionParams {
  const value = raw.trim();
  if (!value) throw new Error("signTransaction params JSON is required");

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`signTransaction params JSON is invalid: ${message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("signTransaction params JSON must be an object");
  }

  return parsed as TrezorSignTransactionParams;
}

export async function signTrezorTransaction(paramsJson: string) {
  await ensureInitialized();

  const params = parseSignTransactionParams(paramsJson);

  const result = (await TrezorConnect.signTransaction(
    params as unknown as Parameters<typeof TrezorConnect.signTransaction>[0]
  )) as TrezorResult<TrezorSignedTransactionPayload>;

  if (!result.success) {
    throw new Error(errorFromPayload(result.payload));
  }

  if (!result.payload.serializedTx) {
    throw new Error("Trezor response did not include serializedTx");
  }

  return result.payload;
}
