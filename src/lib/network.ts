import { networkInterfaces } from "os";
import { headers } from "next/headers";
import { getSetting } from "./settings";

/**
 * Returns the most likely LAN address of this machine (used to build QR URLs
 * that customers can scan from their phones on the same Wi-Fi network).
 * Falls back to the request host if nothing else is available.
 */
export function detectLocalIp(): string | null {
  const nets = networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        candidates.push(net.address);
      }
    }
  }
  // Prefer typical private ranges (192.168.*, 10.*, 172.16-31.*)
  const preferred = candidates.find(
    (ip) =>
      ip.startsWith("192.168.") ||
      ip.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip),
  );
  return preferred || candidates[0] || null;
}

export async function getPublicBaseUrl(): Promise<string> {
  const configured = (await getSetting("public_base_url")).trim();
  if (configured) return configured.replace(/\/+$/, "");

  const ip = detectLocalIp();
  const port = process.env.PORT || "3000";
  if (ip) return `http://${ip}:${port}`;

  // Last-resort: use current request host
  try {
    const h = await headers();
    const host = h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") || "http";
      return `${proto}://${host}`;
    }
  } catch {
    // headers() only works inside a request scope
  }
  return `http://localhost:${port}`;
}
