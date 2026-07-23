const INSTANCE_PATTERN = /^tgm_[0-9a-z]{20}$/;
const CALLBACK_PATTERN = /^m:(tgm_[0-9a-z]{20}):([0-9a-z]{1,2})$/;
const MAX_OPTION_INDEX = 36 ** 2 - 1;

export function encodeMenuCallback(instanceId: string, optionIndex: number): string {
  if (!INSTANCE_PATTERN.test(instanceId)) throw new Error("Invalid Telegram menu instance id");
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > MAX_OPTION_INDEX) {
    throw new Error("Invalid Telegram menu option index");
  }
  const encoded = `m:${instanceId}:${optionIndex.toString(36)}`;
  if (Buffer.byteLength(encoded, "utf8") > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return encoded;
}

export function decodeMenuCallback(data: string): { instanceId: string; optionIndex: number } | null {
  if (Buffer.byteLength(data, "utf8") > 64) return null;
  const match = CALLBACK_PATTERN.exec(data);
  if (!match) return null;
  const optionIndex = Number.parseInt(match[2]!, 36);
  if (!Number.isSafeInteger(optionIndex) || optionIndex > MAX_OPTION_INDEX) return null;
  return { instanceId: match[1]!, optionIndex };
}
