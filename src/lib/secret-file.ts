import { lstatSync, readFileSync } from "node:fs";

export function resolveSecret(
  name: string,
  source: Record<string, string | undefined>,
): string | undefined {
  const direct = source[name];
  const fileName = source[`${name}_FILE`];
  if (direct !== undefined && fileName !== undefined) {
    throw new Error(`${name}: define solo una fuente, variable o archivo`);
  }
  if (direct !== undefined) {
    const value = direct.trim();
    if (!value) throw new Error(`${name}: el valor no puede estar vacío`);
    return value;
  }
  if (fileName === undefined) return undefined;

  const metadata = lstatSync(fileName);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${name}_FILE debe ser un archivo regular, no un enlace`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${name}_FILE debe tener permisos 0600 o más restrictivos`);
  }
  const value = readFileSync(fileName, "utf8").replace(/[\r\n]+$/, "");
  if (!value) throw new Error(`${name}_FILE no puede estar vacío`);
  return value;
}
