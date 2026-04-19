require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

module.exports = {
  solidity: "0.8.20",
  networks: {
    kite: {
      url: "https://rpc-testnet.gokite.ai",
      chainId: 2368,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};