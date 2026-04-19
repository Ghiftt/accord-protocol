import { ethers } from "ethers";

const RPC = "https://rpc-testnet.gokite.ai";
const PROVIDER_AA_PRIVATE_KEY = "0x3f560fe96ad61243d9f149d8704bba34d50a05d57d1921fcea8e71ebdaa254e4";
const TOKEN_ADDRESS = "0xEB9c6D7aE3df18aD7e63C18dad43D7882F0aD82f";
const VAULT_ADDRESS = "0xeB7180d29597Fe59b94c771C0caF6C09C8D25602";
const AMOUNT = ethers.parseUnits("1", 6); // adjust decimals

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)"
];

const VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function getVaultState(address providerAA) external view returns (uint256,uint256,uint256,bool)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const providerAA = new ethers.Wallet(PROVIDER_AA_PRIVATE_KEY, provider);

  const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, providerAA);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, providerAA);

  const bal = await token.balanceOf(providerAA.address);
  console.log("ProviderAA token balance:", bal.toString());

  const approveTx = await token.approve(VAULT_ADDRESS, AMOUNT);
  console.log("Approve TX:", approveTx.hash);
  await approveTx.wait();

  const depositTx = await vault.deposit(AMOUNT);
  console.log("Deposit TX:", depositTx.hash);
  await depositTx.wait();

  const state = await vault.getVaultState(providerAA.address);
  console.log("Vault state:", {
    totalDeposited: state[0].toString(),
    outstandingLiability: state[1].toString(),
    available: state[2].toString(),
    registered: state[3]
  });
}

main().catch(console.error);