const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. AUSD
  const AUSD = await hre.ethers.getContractFactory("AUSD");
  const ausd = await AUSD.deploy();
  await ausd.waitForDeployment();
  const ausdAddress = await ausd.getAddress();
  console.log("AUSD:", ausdAddress);

  // 2. ProviderVault
  const ProviderVault = await hre.ethers.getContractFactory("ProviderVault");
  const vault = await ProviderVault.deploy(ausdAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("ProviderVault:", vaultAddress);

  // 3. VerifierV1
  const VerifierV1 = await hre.ethers.getContractFactory("VerifierV1");
  const verifier = await VerifierV1.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log("VerifierV1:", verifierAddress);

  // 4. TaskCommitment
  const TaskCommitment = await hre.ethers.getContractFactory("TaskCommitment");
  const taskCommitment = await TaskCommitment.deploy(vaultAddress, verifierAddress);
  await taskCommitment.waitForDeployment();
  const taskCommitmentAddress = await taskCommitment.getAddress();
  console.log("TaskCommitment:", taskCommitmentAddress);

  // 5. AttestationRegistry
  const AttestationRegistry = await hre.ethers.getContractFactory("AttestationRegistry");
  const registry = await AttestationRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("AttestationRegistry:", registryAddress);

  // 6. Wire
  await (await vault.setTaskCommitment(taskCommitmentAddress)).wait();
  console.log("Vault -> TaskCommitment wired");

  await (await taskCommitment.setAttestationRegistry(registryAddress)).wait();
  console.log("TaskCommitment -> Registry wired");

  await (await registry.setTaskCommitment(taskCommitmentAddress)).wait();
  console.log("Registry -> TaskCommitment wired");

  // 7. Save
  const fs = require("fs");
  const deployment = {
    network: hre.network.name,
    deployedAt: new Date().toISOString(),
    contracts: {
      AUSD: ausdAddress,
      ProviderVault: vaultAddress,
      VerifierV1: verifierAddress,
      TaskCommitment: taskCommitmentAddress,
      AttestationRegistry: registryAddress,
    },
  };
  fs.writeFileSync("deployment.json", JSON.stringify(deployment, null, 2));
  console.log("\n=== DONE ===");
  console.log(deployment.contracts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});