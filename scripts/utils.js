const hardhat = require("hardhat");
const ethers = hardhat.ethers;

function getH2Ov2Address(networkName) {
  if (networkName === "moonriver") {
    throw Error("No moonriver h2ov2 address");
  } else if (networkName === "moonbeamAlpha") {
    return "0x6D9CbfaE02fb3c34ac45fc76d5A8c00Eb65Fe102";
  } else {
    throw Error(`Invalid networkName ${networkName}`);
  }
}

function getH2Ov1Address(networkName) {
  if (networkName === "moonriver") {
    return "0xDC151BC48a5F77288cdE9DdbFf2e32e6bcF4791F";
  } else if (networkName === "moonbeamAlpha") {
    return "0x93E737101480C503d31cbd1998Aa839AA4f0cB5C";
  } else {
    throw Error(`Invalid networkName ${networkName}`);
  }
}

function getV2DeployerAddress(networkName) {
  if (networkName === "moonriver") {
    throw Error("No moonriver v2deployer address");
  } else if (networkName === "moonbeamAlpha") {
    return "0x7210baA376Cae01653e6eB7bF7f93537564e4763";
  } else {
    throw Error(`Invalid networkName ${networkName}`);
  }
}

function getV2DeployerPluginsAddress(networkName) {
  if (networkName === "moonriver") {
    throw Error("No moonriver v2deployerplugins address");
  } else if (networkName === "moonbeamAlpha") {
    return "0xeB58CBaCb5AAF07Dd17cEEA681258Bf6EFc628fc";
  } else {
    throw Error(`Invalid networkName ${networkName}`);
  }
}

async function getContract(address, artifactName) {
  const signer = await ethers.getSigner();
  return await new ethers.Contract(
    address,
    (
      await hardhat.artifacts.readArtifact(artifactName)
    ).abi,
    signer
  );
}

async function getH2Ov1Contract(networkName) {
  return await getContract(getH2Ov1Address(networkName), "H2O");
}

async function getH2OV2Contract(networkName) {
  return await getContract(getH2Ov2Address(networkName), "H2Ov2");
}

async function getV2DeployerContract(networkName) {
  return await getContract(getV2DeployerAddress(networkName), "V2Deployer");
}

async function getV2DeployerPluginsContract(networkName) {
  return await getContract(
    getV2DeployerPluginsAddress(networkName),
    "V2DeployerPlugins"
  );
}

async function getSigner() {
  return await ethers.getSigner();
}

module.exports = {
  getH2OV2Contract,
  getH2Ov1Contract,
  getV2DeployerContract,
  getH2Ov1Address,
  getH2Ov2Address,
  getContract,
  getSigner,
  getV2DeployerPluginsContract,
  getH2Ov2Address,
  getV2DeployerAddress,
};
