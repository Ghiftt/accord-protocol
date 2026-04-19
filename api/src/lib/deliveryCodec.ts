import { AbiCoder, keccak256 } from "ethers";
import type { DeliveryPayload } from "./accordTypes";

const abi = AbiCoder.defaultAbiCoder();

export function encodeCanonicalDelivery(payload: DeliveryPayload): string {
  return abi.encode(
    [
      "string",   // schemaVersion
      "bytes32",  // taskId
      "bytes32",  // outputHash
      "uint64",   // timestamp
      "bytes32",  // paymentReference
      "bytes32",  // commitmentNonce
      "bytes32",  // providerNonce
      "bytes32",  // merkleRoot
      "bytes32",  // artifactHash
      "bytes32",  // upstreamReferenceProof
    ],
    [
      payload.schemaVersion,
      payload.taskId,
      payload.outputHash,
      payload.timestamp,
      payload.paymentReference,
      payload.commitmentNonce,
      payload.providerNonce,
      payload.merkleRoot ?? zero32(),
      payload.artifactHash ?? zero32(),
      payload.upstreamReferenceProof ?? zero32(),
    ]
  );
}

export function hashCanonicalDelivery(payload: DeliveryPayload): string {
  return keccak256(encodeCanonicalDelivery(payload));
}

function zero32(): string {
  return "0x" + "00".repeat(32);
}