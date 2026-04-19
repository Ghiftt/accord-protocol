import { ethers } from "ethers";
import { providerAA, providerSigner, ADDRESSES, TaskArtifact } from "./config";

const TASK_ID = "0x8c920b438b5728e4eec859123eb222726726b28f95b0b0bca024b7ab7e37b9cf";

async function main() {
  const task = new ethers.Contract(ADDRESSES.TaskCommitment, TaskArtifact.abi, providerAA);

  const c = await task.getCommitment(TASK_ID);
  console.log("Task state:", Number(c.taskState));

  if (Number(c.taskState) !== 2) {
    throw new Error(`Task must be in state 2. Current: ${Number(c.taskState)}`);
  }

  // Intentionally wrong output hash — spec committed "demo-output-pass"
  const outputHash = ethers.keccak256(ethers.toUtf8Bytes("demo-output-fail"));
  const timestamp = Math.floor(Date.now() / 1000);
  const providerNonce = ethers.randomBytes(32);

  const domain = {
    name: "ACCORD",
    version: "1",
    chainId: 2368,
    verifyingContract: ADDRESSES.TaskCommitment,
  };

  const types = {
    DeliveryObject: [
      { name: "taskId", type: "bytes32" },
      { name: "outputHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
      { name: "schemaVersion", type: "uint8" },
      { name: "signerAddress", type: "address" },
      { name: "providerNonce", type: "bytes32" },
      { name: "paymentReference", type: "bytes32" },
    ],
  };

  const value = {
    taskId: TASK_ID,
    outputHash,
    timestamp,
    schemaVersion: 1,
    signerAddress: providerSigner.address,
    providerNonce,
    paymentReference: c.paymentReference,
  };

  const signature = await providerSigner.signTypedData(domain, types, value);

  const delivery = {
    taskId: TASK_ID,
    outputHash,
    timestamp,
    schemaVersion: 1,
    signerAddress: providerSigner.address,
    providerNonce,
    signature,
  };

  // Field delivers WRONG hash — verifier will reject
  const FIELD_OUTPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes("outputHash"));
  const fields = [
    {
      fieldKey: FIELD_OUTPUT_HASH,
      exists: true,
      intValue: 0,
      hashValue: outputHash, // wrong — spec expects "demo-output-pass"
      addrValue: ethers.ZeroAddress,
      boolValue: false,
      valueType: 1,
    }
  ];

  console.log("\n--- Submitting FAIL delivery ---");
  const tx = await task.submitDelivery(TASK_ID, delivery, fields);
  const receipt = await tx.wait();
  console.log("TX:", receipt.hash);

  const updated = await task.getCommitment(TASK_ID);
  const state = Number(updated.taskState);
  console.log("Final state:", state);

  if (state === 4) console.log("Result: VERIFIED PASS ✅");
  else if (state === 5) console.log("Result: VERIFIED FAIL — collateral slashed ✅");
  else console.log("Unexpected state:", state);
}

main().catch((err) => {
  console.error("FAILED:", err.reason || err.message);
  process.exit(1);
});