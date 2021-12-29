require("@nomiclabs/hardhat-waffle");
require("hardhat-abi-exporter");
require("hardhat-tracer");
require("hardhat-contract-sizer");

const fs = require("fs");
const privateKeys = JSON.parse(fs.readFileSync(".secret.json"));

task("deployV2", "Deploy V2")
  .addOptionalParam(
    "step",
    "Steps: initial (default), configureOldToken, plugins, liqPlugin, distPlugin, v2migrator, lpmigrator, renounceOwnerships, turnOnFees"
  )
  .setAction(async (taskArgs, hre) => {
    const {
      deployV2,
      deployV2Plugins,
      configureOldToken,
      renounceOwnerships,
      setupDistributor,
      setupLiquidity,
      setupV2Migrator,
      setupLPMigrator,
      turnOnFees
    } = require("./scripts/deployV2");
    const step = taskArgs.step || "initial";
    console.log("Step: ", step);
    const networkName = hre.network.name;
    if (step === "initial") {
      await deployV2(networkName);
    } else if (step === "plugins") {
      await deployV2Plugins(networkName);
    } else if (step === "configureOldToken") {
      await configureOldToken(networkName);
    } else if (step === "renounceOwnerships") {
      await renounceOwnerships(networkName);
    } else if (step === "liqPlugin") {
      await setupLiquidity(networkName);
    } else if (step === "distPlugin") {
      await setupDistributor(networkName);
    } else if (step === "v2migrator") {
      await setupV2Migrator(networkName);
    } else if (step === "lpmigrator") {
      await setupLPMigrator(networkName);
    } else if (step === "turnOnFees") {
      await turnOnFees(networkName);
    } else {
      throw Error(`Invalid step: ${step}`);
    }
  });

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
      url: "https://moonbeam-alpha.api.onfinality.io/public",
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
        url: `https://rpc.moonriver.moonbeam.network`,
        blockNumber: 1220700,
      },
      allowUnlimitedContractSize: true,
    },
    moonriverFork: {
      url: "http://127.0.0.1:8545/",
      chainId: 31337,
      accounts: privateKeys,
      timeout: 100000,
    },
  },
};
