import dns from "node:dns";

/**
 * Fuerza resolución DNS IPv4 en toda la aplicación.
 * Debe ejecutarse ANTES de cualquier operación de red (fetch, connect, etc.).
 */
export function enforceIPv4(): void {
  dns.setDefaultResultOrder("ipv4first");
  const origLookup = dns.lookup;
  dns.lookup = ((domain: string, options: dns.LookupOptions | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void), callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
    if (typeof options === "function") {
      callback = options;
      options = { family: 4 };
    } else if (typeof options === "object" && options !== null) {
      options = { ...options, family: 4 };
    } else {
      options = { family: 4 };
    }
    return origLookup(domain, options, callback!);
  }) as typeof dns.lookup;
}

enforceIPv4();