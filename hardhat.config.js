require("@nomiclabs/hardhat-waffle");

const fs = require("fs");
const privateKeys = JSON.parse(fs.readFileSync(".secret.json"));
const infuraKey = fs.readFileSync(".infurasecret").toString().trim();

module.exports = {
  solidity: {
    version: "0.8.7",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  networks: {
    moonriver: {
      url: "https://rpc.moonriver.moonbeam.network",
      chainId: 1285,
      accounts: privateKeys,
    },
    moonbeamAlpha: {
      url: "https://rpc.testnet.moonbeam.network",
      chainId: 1287,
      accounts: privateKeys,
    },
    ropsten: {
      url: "https://ropsten.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      chainId: 3,
      accounts: privateKeys,
    },
    kovan: {
      url: "https://kovan.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      chainId: 42,
      accounts: privateKeys,
    },
    hardhat: {
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${infuraKey}`,
        blockNumber: 13575639,
        accounts: [
          {
            privateKey:
              "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            balance: 100000000000000000000,
          },
        ],
        allowUnlimitedContractSize: true,
      },
      allowUnlimitedContractSize: true,
    },
  },
};
