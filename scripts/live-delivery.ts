import { ethers } from "ethers";
import { provider, providerAA, providerSigner, ADDRESSES, TaskArtifact, VerifierArtifact } from "./config";

const TASK_ID = "0x886f5b3421192ca419476b0690743ee9f9da1158477b2b9bf6ae7e12d3d32094";

async function main() {
  const task = new ethers.Contract(ADDRESSES.TaskCommitment, TaskArtifact.abi, providerAA);

  const c = await task.getCommitment(TASK_ID);
  console.log("Task state:", Number(c.taskState));
  console.log("Payment reference:", c.paymentReference);

  if (Number(c.taskState) !== 2) {
    throw new Error(`Task must be in state 2 (PaymentLinked). Current: ${Number(c.taskState)}`);
  }

  const outputHash = ethers.keccak256(ethers.toUtf8Bytes("demo-output-pass"));
  const timestamp = Math.floor(Date.now() / 1000);
  const schemaVersion = 1;
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
    schemaVersion,
    signerAddress: providerSigner.address,
    providerNonce,
    paymentReference: c.paymentReference,
  };

  const signature = await providerSigner.signTypedData(domain, types, value);
  console.log("Signed by providerSigner:", providerSigner.address);

  const delivery = {
    taskId: TASK_ID,
    outputHash,
    timestamp,
    schemaVersion,
    signerAddress: providerSigner.address,
    providerNonce,
    signature,
  };

  const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("demo-constraints-v1"));
  const fields: any[] = [];
  const constraints: any[] = [];

  console.log("\n--- Submitting delivery ---");
  const tx = await task.submitDelivery(TASK_ID, delivery, fields);
  const receipt = await tx.wait();
  console.log("TX:", receipt.hash);

  const updated = await task.getCommitment(TASK_ID);
  const state = Number(updated.taskState);
  console.log("Final state:", state);

  if (state === 4) console.log("Result: VERIFIED PASS ✅");
  else if (state === 5) console.log("Result: VERIFIED FAIL ❌");
  else console.log("Unexpected state:", state);
}

main().catch((err) => {
  console.error("FAILED:", err.reason || err.message);
  process.exit(1);
});