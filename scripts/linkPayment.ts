import { ethers } from "ethers";

const TaskArtifact = require("../artifacts/contracts/TaskCommitment.sol/TaskCommitment.json");

const RPC = "https://rpc-testnet.gokite.ai";
const PRIVATE_KEY = "0x4bba9dff5e9bd5cef2a2b29d7a31abe4b7110de4bd28b04a33b45f11b00e17d3";

const TASK_ADDRESS = "0xAef11Ef564015Aeb5595ebda5E49bd9368d44c22";
const TASK_ID = "0xad9f9c659cd15e6ecce7175efef5e7126235dce944b09036d154d69f81ae6282";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const task = new ethers.Contract(TASK_ADDRESS, TaskArtifact.abi, wallet);

  const c = await task.getCommitment(TASK_ID);

  console.log("Caller:", wallet.address);
  console.log("Buyer on-chain:", c.buyer);
  console.log("Task state before:", Number(c.taskState));
  console.log("Payment reference before:", c.paymentReference);

  const paymentRef = ethers.keccak256(
    ethers.toUtf8Bytes("demo-payment")
  );

  const tx = await task.linkPayment(TASK_ID, paymentRef);
  console.log("TX:", tx.hash);

  await tx.wait();

  const updated = await task.getCommitment(TASK_ID);

  console.log("Task state after:", Number(updated.taskState));
  console.log("Payment reference after:", updated.paymentReference);
  console.log("Payment linked");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});