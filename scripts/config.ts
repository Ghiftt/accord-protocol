import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

export const RPC_URL = "https://rpc-testnet.gokite.ai";
export const provider = new ethers.JsonRpcProvider(RPC_URL);

export const providerAA = new ethers.Wallet(process.env.PROVIDER_AA_PRIVATE_KEY!, provider);
export const providerSigner = new ethers.Wallet(process.env.PROVIDER_SIGNER_PRIVATE_KEY!, provider);
export const buyer = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY!, provider);
export const admin = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

export const PROVIDER_SIGNER_ADDRESS = process.env.PROVIDER_SIGNER_ADDRESS!;
export const PROVIDER_AA_ADDRESS = process.env.PROVIDER_AA_ADDRESS!;

export const ADDRESSES = {
  AUSD: process.env.AUSD_ADDRESS!,
  Vault: process.env.VAULT_ADDRESS!,
  Verifier: process.env.VERIFIER_ADDRESS!,
  TaskCommitment: process.env.TASK_COMMITMENT_ADDRESS!,
  AttestationRegistry: process.env.ATTESTATION_REGISTRY_ADDRESS!,
};

export const VerifierArtifact = require("../artifacts/contracts/VerifierV1.sol/VerifierV1.json");
export const VaultArtifact = require("../artifacts/contracts/ProviderVault.sol/ProviderVault.json");
export const TaskArtifact = require("../artifacts/contracts/TaskCommitment.sol/TaskCommitment.json");
export const AUSDArtifact = require("../artifacts/contracts/AUSD.sol/AUSD.json");
export const RegistryArtifact = require("../artifacts/contracts/AttestationRegistry.sol/AttestationRegistry.json");