import { ethers } from "ethers";

const RPC = "https://rpc-testnet.gokite.ai";

const VAULT_ADDRESS = "0xeB7180d29597Fe59b94c771C0caF6C09C8D25602";
const PROVIDER_ADDRESS = "0xa3f376d76b81aac80182ec83ccc7b6D7221cE3b6";

const ABI = [
  "function getVaultState(address) view returns (uint256,uint256,uint256,bool)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);

  const vault = new ethers.Contract(VAULT_ADDRESS, ABI, provider);

  const [total, liability, available, registered] =
    await vault.getVaultState(PROVIDER_ADDRESS);

  console.log("Registered:", registered);
  console.log("Total Deposited:", total.toString());
  console.log("Outstanding Liability:", liability.toString());
  console.log("Available:", available.toString());
}

main();