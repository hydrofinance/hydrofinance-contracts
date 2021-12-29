const hardhat = require("hardhat");
const {
  getV2DeployerContract,
  getH2Ov1Contract,
  getH2Ov2Address,
  getV2DeployerPluginsContract,
  getH2OV2Contract,
  getV2DeployerAddress,
} = require("./utils");

const ethers = hardhat.ethers;
// const lpNativeAmount = ethers.utils.parseUnits("5", "ether");
// const week = 60 * 60 * 24 * 7;

function getDeployerProps(networkName) {
  let dict = {};
  if (networkName === "moonriver") {
    dict = {
      oldToken: "0xDC151BC48a5F77288cdE9DdbFf2e32e6bcF4791F",
      huckleRouterAddress: "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77",
      finnAddress: "0x9A92B5EBf1F6F6f7d93696FCD44e5Cf75035A756",
      rkittyAddress: "0xC2b0435276139731d82Ae2Fa8928c9b9De0761c1",
    };
  } else if (networkName === "moonbeamAlpha") {
    dict = {
      oldToken: "0x93E737101480C503d31cbd1998Aa839AA4f0cB5C",
      huckleRouterAddress: "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77",
      finnAddress: "0x31b1644f8379a22d25f845a67f1ab346e76001aa",
      rkittyAddress: "0x8353BBf26497cb9288668FdBdDE3c1b81Ee6a715",
    };
  } else {
    throw Error(`Invalid networkName ${networkName}`);
  }
  return dict;
}

async function checkDeployerPluginsOwnership(networkName) {
  const h2ov2 = await getH2OV2Contract(networkName);
  const plugins = await getV2DeployerPluginsContract(networkName);
  const deployer = await getV2DeployerContract(networkName);

  console.log("Checking deployer plugins ownership...");
  const h2ov2Owner = await h2ov2.owner();
  if (h2ov2Owner != plugins.address) {
    if (h2ov2Owner == deployer.address) {
      console.log("Transfering h2ov2 ownership to caller...");
      await (await deployer.transferH2Ov2OwnershipsBack()).wait(1);
    }

    console.log("Transfering h2ov2 ownership...");
    await (await h2ov2.transferOwnership(plugins.address)).wait(1);
  }
}

async function checkDeployerOwnership(networkName) {
  const h2ov2 = await getH2OV2Contract(networkName);
  const plugins = await getV2DeployerPluginsContract(networkName);
  const deployer = await getV2DeployerContract(networkName);

  console.log("Checking deployer ownership...");
  const h2ov2Owner = await h2ov2.owner();
  if (h2ov2Owner != deployer.address) {
    if (h2ov2Owner == plugins.address) {
      console.log("Transfering h2ov2 ownership to caller...");
      await (await plugins.transferOwnershipsBack()).wait(1);
    }

    console.log("Transfering h2ov2 ownership...");
    await (await h2ov2.transferOwnership(deployer.address)).wait(1);
  }
}

async function checkH2Ov1Ownership(networkName) {
  const h2ov1 = await getH2Ov1Contract(networkName);
  const v2Deployer = await getV2DeployerContract(networkName);
  const currentOwner = await h2ov1.owner();
  if (currentOwner != v2Deployer.address) {
    console.log("Transfering h2ov1 ownership...");
    await (await h2ov1.transferOwnership(v2Deployer.address)).wait(1);
  }
}

async function deployV2(networkName) {
  await hardhat.run("compile");

  const signer = await ethers.getSigner();
  const accountAddress = signer.address;

  const deployerProps = getDeployerProps(networkName);

  console.log("Deployer", accountAddress);
  const V2Deployer = await ethers.getContractFactory("V2Deployer");
  const v2Deployer = await V2Deployer.deploy(...Object.values(deployerProps));
  console.log("Deploying...");
  await v2Deployer.deployed();
  console.log("V2 deployer address", v2Deployer.address);
  console.log("H2Ov2 address", await v2Deployer.tokenAddress());
}

async function configureOldToken(networkName) {
  const v2Deployer = await getV2DeployerContract(networkName);

  await checkH2Ov1Ownership(networkName);

  console.log("Configuring...");
  await v2Deployer.configureOldToken();
  console.log("Success!");
}

async function deployV2Plugins(networkName) {
  const h2ov2Address = getH2Ov2Address(networkName);

  const signer = await ethers.getSigner();
  const accountAddress = signer.address;

  const deployerProps = getDeployerProps(networkName);

  console.log("Deployer", accountAddress);
  const V2DeployerPlugins = await ethers.getContractFactory(
    "V2DeployerPlugins"
  );
  const v2DeployerPlugins = await V2DeployerPlugins.deploy(
    h2ov2Address,
    deployerProps.huckleRouterAddress,
    deployerProps.finnAddress
  );
  console.log("Deploying...");
  await v2DeployerPlugins.deployed();
  console.log("V2 deployer plugins address", v2DeployerPlugins.address);
}

async function setupLiquidity(networkName) {
  const plugins = await getV2DeployerPluginsContract(networkName);

  await checkDeployerPluginsOwnership(networkName);

  console.log("Setting liquidity...");
  await (await plugins.setupLiquidityPlugin()).wait(1);

  console.log("LiqPlugin address", await plugins.liqPluginAddress());
}

async function setupDistributor(networkName) {
  const plugins = await getV2DeployerPluginsContract(networkName);

  await checkDeployerPluginsOwnership(networkName);

  console.log("Setting distributor...");
  await (await plugins.setupDistributorPlugin()).wait(1);

  console.log("DistPlugin address", await plugins.distPluginAddress());
}

async function setupV2Migrator(networkName) {
  const deployer = await getV2DeployerContract(networkName);
  const h2ov1 = await getH2Ov1Contract(networkName);

  let amount = null;
  if (networkName === "moonbeamAlpha") {
    const balance = await h2ov1.balanceOf((await ethers.getSigner()).address);
    amount = balance.div(2);
    if (amount.isZero()) {
      throw Error("Zero amount");
    }
  } else {
    throw Error("No amount");
  }

  await checkH2Ov1Ownership(networkName);
  await checkDeployerOwnership(networkName);

  await (await h2ov1.approve(deployer.address, amount)).wait(1);
  console.log("Setting v2migrator...");
  await (await deployer.setupV2Migrator(amount)).wait(1);

  console.log("V2Migrator address", await deployer.v2migratorAddress());
}

async function setupLPMigrator(networkName) {
  const deployer = await getV2DeployerContract(networkName);
  let amount = null;
  if (networkName === "moonbeamAlpha") {
    amount = (
      await ethers.provider.getBalance((await ethers.getSigner()).address)
    ).div(3);
  } else {
    throw Error("No amount");
  }
  await checkDeployerOwnership(networkName);
  console.log("Setting lpmigrator...");
  await (
    await deployer.setupLPMigrator({
      value: amount,
    })
  ).wait(1);
  console.log("LPMigrator address", await deployer.lpMigratorAddress());
}

async function renounceOwnerships(networkName) {
  const v2Deployer = await getV2DeployerContract(networkName);
  try {
    await v2Deployer.transferH2Ov2OwnershipsBack();
    console.log("Renounced H2Ov2!");
  } catch (e) {
    console.error("Failed to transfer H2Ov2 ownership", e);
  }
  try {
    await v2Deployer.transferH2Ov1OwnershipsBack();
    console.log("Renounced H2Ov1!");
  } catch (e) {
    console.error("Failed to transfer H2Ov1 ownership", e);
  }
  try {
    await v2Deployer.transferLpMigratorOwnershipsBack();
    console.log("Renounced LPMigrator!");
  } catch (e) {
    console.error("Failed to transfer LPMigrator ownership", e);
  }
  try {
    const v2DeployerPlugins = await getV2DeployerPluginsContract(networkName);
    await v2DeployerPlugins.transferOwnershipsBack();
    console.log("Renounced V2DeployerPlugins!");
  } catch (e) {
    console.error("Failed to transfer plugins ownership", e);
  }
  console.log("Finished!");
}

async function turnOnFees(networkName) {
  const deployer = await getV2DeployerContract(networkName);
  await deployer.turnOnFees();
}

module.exports = {
  deployV2,
  deployV2Plugins,
  configureOldToken,
  renounceOwnerships,
  setupDistributor,
  setupLiquidity,
  setupV2Migrator,
  setupLPMigrator,
  turnOnFees,
};
