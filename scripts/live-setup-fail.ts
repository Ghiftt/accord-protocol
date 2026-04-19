import { ethers } from "ethers";
import { provider, providerAA, buyer, ADDRESSES, PROVIDER_SIGNER_ADDRESS, VerifierArtifact, VaultArtifact, TaskArtifact, AUSDArtifact } from "./config";

async function main() {
  const vault = new ethers.Contract(ADDRESSES.Vault, VaultArtifact.abi, providerAA);
  const taskAsBuyer = new ethers.Contract(ADDRESSES.TaskCommitment, TaskArtifact.abi, buyer);
  const taskAsProvider = new ethers.Contract(ADDRESSES.TaskCommitment, TaskArtifact.abi, providerAA);
  const ausd = new ethers.Contract(ADDRESSES.AUSD, AUSDArtifact.abi, providerAA);
  const verifier = new ethers.Contract(ADDRESSES.Verifier, VerifierArtifact.abi, provider);

  console.log("ProviderAA:", providerAA.address);
  console.log("Buyer:", buyer.address);

  // Approve + deposit
  const depositAmount = ethers.parseUnits("50", 6);
  console.log("\n--- Approving AUSD ---");
  await (await ausd.approve(ADDRESSES.Vault, depositAmount)).wait();
  console.log("Approved");

  console.log("\n--- Depositing into vault ---");
  await (await vault.deposit(depositAmount)).wait();
  console.log("Deposited");

  // Build spec with HASH_MATCH constraint
  // Provider must deliver exactly "demo-output-pass" — we will deliver "demo-output-fail"
  const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("demo-constraints-fail-v1"));
  const expectedOutputHash = ethers.keccak256(ethers.toUtf8Bytes("demo-output-pass"));
  const FIELD_OUTPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes("outputHash"));

  const constraints = [
    {
      constraintType: 3, // HASH_MATCH
      fieldKey: FIELD_OUTPUT_HASH,
      minValue: 0,
      maxValue: 0,
      expectedValue: 0,
      expectedHash: expectedOutputHash,
      enumMembers: [],
    }
  ];

  const liabilityAmount = ethers.parseUnits("10", 6);
  const deadlineTimestamp = Math.floor(Date.now() / 1000) + 3600;
  const verifierVersion = 1;
  const commitmentNonce = ethers.randomBytes(32);

  console.log("\n--- Creating commitment ---");
  const createTx = await taskAsBuyer.createCommitment(
    providerAA.address,
    PROVIDER_SIGNER_ADDRESS,
    schemaHash,
    constraints,
    liabilityAmount,
    deadlineTimestamp,
    verifierVersion,
    commitmentNonce
  );
  const receipt = await createTx.wait();
  console.log("Commitment TX:", createTx.hash);

  let taskId: string | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = taskAsBuyer.interface.parseLog(log);
      if (parsed?.name === "CommitmentCreated") {
        taskId = parsed.args.taskId;
        break;
      }
    } catch {}
  }

  if (!taskId) throw new Error("Could not extract taskId");
  console.log("Task ID:", taskId);

  console.log("\n--- Reserving liability ---");
  await (await taskAsProvider.reserveLiability(taskId)).wait();
  console.log("Liability reserved");

  const paymentRef = ethers.keccak256(ethers.toUtf8Bytes("demo-payment-fail-" + Date.now()));
  console.log("\n--- Linking payment ---");
  await (await taskAsBuyer.linkPayment(taskId, paymentRef)).wait();
  console.log("Payment linked");

  console.log("\n=== DONE ===");
  console.log("Task ID:", taskId);
  console.log("Use this in live-delivery-fail.ts");
}

main().catch((err) => {
  console.error("FAILED:", err.reason || err.message);
  process.exit(1);
});