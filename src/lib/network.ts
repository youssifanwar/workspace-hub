import { networkInterfaces } from "os";
import { headers } from "next/headers";
import { getSetting } from "./settings";

/**
 * Returns the most likely LAN IPv4 address of this machine.
 * Used for QR URLs that customers open from phones on the same Wi-Fi.
 */
export function detectLocalIp(): string | null {
  const nets = networkInterfaces();
  const candidates: string[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (
        net.family === "IPv4" &&
        !net.internal &&
        net.address
      ) {
        candidates.push(net.address);
      }
    }
  }

  // Prefer normal private IPv4 ranges.
  const preferred = candidates.find(
    (ip) =>
      ip.startsWith("192.168.") ||
      ip.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip),
  );

  return preferred || candidates[0] || null;
}

/**
 * Returns the base URL customers should use.
 *
 * A configured localhost URL is deliberately ignored because
 * localhost on a customer's phone means the phone itself.
 */
export async function getPublicBaseUrl(): Promise<string> {
  const configured = (
    await getSetting("public_base_url")
  ).trim();

  // Accept configured URL only when it is not localhost.
  if (
    configured &&
    !/^https?:\/\/localhost(?::\d+)?$/i.test(
      configured,
    ) &&
    !/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(
      configured,
    )
  ) {
    return configured.replace(/\/+$/, "");
  }

  const ip = detectLocalIp();
  const port = process.env.PORT || "3000";

  if (ip) {
    return `http://${ip}:${port}`;
  }

  // Last resort: use the current request host.
  try {
    const h = await headers();
    const host = h.get("host");

    if (host) {
      const proto =
        h.get("x-forwarded-proto") || "http";

      // Do not accidentally return localhost when LAN IP exists.
      if (
        !/^localhost(?::\d+)?$/i.test(host) &&
        !/^127\.0\.0\.1(?::\d+)?$/i.test(host)
      ) {
        return `${proto}://${host}`;
      }
    }
  } catch {
    // headers() only works inside a request scope.
  }

  return `http://localhost:${port}`;
}