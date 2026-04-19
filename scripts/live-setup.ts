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

  // Register vault
  console.log("\n--- Registering vault ---");
  try {
    await (await vault.registerVault(PROVIDER_SIGNER_ADDRESS)).wait();
    console.log("Vault registered");
  } catch (e: any) {
    if (e?.reason === "Vault already registered") {
      console.log("Vault already registered — skipping");
    } else {
      throw e;
    }
  }

  // Approve + deposit
  const depositAmount = ethers.parseUnits("50", 6);
  console.log("\n--- Approving AUSD ---");
  await (await ausd.approve(ADDRESSES.Vault, depositAmount)).wait();
  console.log("Approved");

  const balance = await ausd.balanceOf(providerAA.address);
  console.log("AUSD balance:", ethers.formatUnits(balance, 6));

  console.log("\n--- Depositing into vault ---");
  await (await vault.deposit(depositAmount)).wait();
  console.log("Deposited");

  // Build spec
  const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("demo-constraints-v1"));
  const constraints: any[] = [];
  const specHash = await verifier.hashSpec(schemaHash, constraints);

  const liabilityAmount = ethers.parseUnits("10", 6);
  const deadlineTimestamp = Math.floor(Date.now() / 1000) + 3600;
  const verifierVersion = 1;
  const commitmentNonce = ethers.randomBytes(32);

  console.log("\n--- Creating commitment ---");
  const createTx = await taskAsBuyer.createCommitment(
    providerAA.address,           // providerAA
    PROVIDER_SIGNER_ADDRESS,      // providerSigner
    schemaHash,                   // schemaHash
    constraints,                  // constraints[]
    liabilityAmount,              // liabilityAmount
    deadlineTimestamp,            // deadlineTimestamp
    verifierVersion,              // verifierVersion
    commitmentNonce               // commitmentNonce
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

  // Reserve liability
  console.log("\n--- Reserving liability ---");
  await (await taskAsProvider.reserveLiability(taskId)).wait();
  console.log("Liability reserved");

  // Link payment
  const paymentRef = ethers.keccak256(ethers.toUtf8Bytes("demo-payment-" + Date.now()));
  console.log("\n--- Linking payment ---");
  await (await taskAsBuyer.linkPayment(taskId, paymentRef)).wait();
  console.log("Payment linked");

  console.log("\n=== DONE ===");
  console.log("Task ID:", taskId);
  console.log("Use this in live-delivery.ts");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});