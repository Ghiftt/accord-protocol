import { keccak256, toUtf8Bytes } from "ethers";
import type { TaskSpecV1 } from "./accordTypes";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function hashTaskSpec(spec: TaskSpecV1): string {
  const normalized = stableStringify(spec);
  return keccak256(toUtf8Bytes(normalized));
}