import { Wallet } from "ethers";
import type { DeliveryPayload, SignedDelivery } from "./accordTypes";

export const DELIVERY_DOMAIN_NAME = "ACCORD Delivery";
export const DELIVERY_DOMAIN_VERSION = "1";

export function buildDeliveryDomain(chainId: number, verifyingContract: string) {
  return {
    name: DELIVERY_DOMAIN_NAME,
    version: DELIVERY_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

export const DELIVERY_TYPES = {
  Delivery: [
    { name: "schemaVersion", type: "string" },
    { name: "taskId", type: "bytes32" },
    { name: "outputHash", type: "bytes32" },
    { name: "timestamp", type: "uint64" },
    { name: "paymentReference", type: "bytes32" },
    { name: "commitmentNonce", type: "bytes32" },
    { name: "providerNonce", type: "bytes32" },
    { name: "merkleRoot", type: "bytes32" },
    { name: "artifactHash", type: "bytes32" },
    { name: "upstreamReferenceProof", type: "bytes32" },
  ],
};

export async function signDelivery(
  wallet: Wallet,
  chainId: number,
  verifyingContract: string,
  payload: DeliveryPayload
): Promise<SignedDelivery> {
  const domain = buildDeliveryDomain(chainId, verifyingContract);

  const typedPayload = {
    ...payload,
    merkleRoot: payload.merkleRoot ?? zero32(),
    artifactHash: payload.artifactHash ?? zero32(),
    upstreamReferenceProof: payload.upstreamReferenceProof ?? zero32(),
  };

  const signature = await wallet.signTypedData(domain, DELIVERY_TYPES, typedPayload);

  return {
    payload: typedPayload,
    signature,
    signer: await wallet.getAddress(),
  };
}

function zero32(): string {
  return "0x" + "00".repeat(32);
}