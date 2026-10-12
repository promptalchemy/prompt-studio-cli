export const VERSION = "0.1.0";

export const DEFAULT_SERVER_URL = "https://mcp.promptstudio.app/mcp";

/** Loopback ports registered together so one client id survives a busy port. */
export const LOOPBACK_PORTS = [53682, 53683, 53684, 53685, 53686, 53687, 53688, 53689, 53690, 53691] as const;

export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export const GENERATE_TIMEOUT_MS = 180 * 1000;

export const POLL_WAIT_MS = 20_000;
