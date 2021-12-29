const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const { Signer } = require("ethers");

const blacklistedAddresses = [
  "0xa7324C8c487fdA048363386181b3F7c57BA6263c", // huckle pair
  "0x0D5C0Cd9e1f1C315B1AeDFe4C5DdC677E082F1aA", // airdrop
  "0x1638e402a06c454B8426D987079E908dfC106409", // timelock 1
  "0x22b32f4743364AAEd06EDeE8bb7131e43BCc4F71", // timelock 2
  "0x261A5C7389990fA233351295DE5865ddf783F3Ba", // timelock 3
  "0x56653Ed8BaB5d927dA8E7FdD137509BB62dc5E37", // timelock 4
  "0x4407c6cC7075A771519B8d004adCdC786432Eb12", // excursions
  "0xDC151BC48a5F77288cdE9DdbFf2e32e6bcF4791F", // H2O
  "0xB7Cb2440b5fD5B9CbeCd7e63c4d88d497a6D22fB", // old distributor
  "0x36A58BEd6347DAE855D4B5E29d21A93E1dE66450", // migrator
];

const getHoldersFromCSV = () => {
  const csvData = fs.readFileSync("scripts/holders.csv").toString();
  const lines = csvData.split(/\r\n|\n/);
  const holders = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      const address = line
        .split(",")[0]
        .replace('"', "")
        .replace('"', "")
        .trim();
      if (address.length === 0) {
        return;
      }
      if (!ethers.utils.isAddress(address)) {
        throw Error("Not an address " + address);
      }
      const chksAddress = ethers.utils.getAddress(address);
      if (blacklistedAddresses.includes(chksAddress)) {
        console.log("blacklisted", chksAddress);
        return;
      }
      holders.push(chksAddress);
    }
  });
  return holders;
};

const previousRedeployerAddress = null;

async function main() {
  const holders = getHoldersFromCSV();
  if (holders.length < 100) {
    throw Error("Invalid holders length");
  }
  console.log("Holders", holders);

  const signer = await ethers.getSigner();

  const h2o = await new ethers.Contract(
    "0xDC151BC48a5F77288cdE9DdbFf2e32e6bcF4791F",
    (
      await artifacts.readArtifact("H2O")
    ).abi,
    signer
  );

  if (previousRedeployerAddress) {
    // it is used when something will go wrong
    return
  }

  const Redeployer = await ethers.getContractFactory("DistributorRedeployer");
  const redeployer = await Redeployer.deploy();
  console.log("Waiting for confirmation");
  await redeployer.deployed();

  console.log("Transfering ownership...", redeployer.address);
  await (await h2o.transferOwnership(redeployer.address)).wait(1);

  try {
    console.log("Redeploying...");
    await redeployer.redeploy();

    console.log("Redeployed...");

    const partAmount = 20;
    const partsCount = Math.ceil(holders.length / partAmount);
    for (let partIndex = 0; partIndex < partsCount; partIndex++) {
      console.log("mass update", partIndex);
      const partAddresses = [];

      for (
        let index = partAmount * partIndex;
        index < partAmount * (partIndex + 1);
        index++
      ) {
        if (index >= holders.length) {
          break;
        }
        partAddresses.push(holders[index]);
      }
      console.log("Configuring dividend exempts", partIndex, partAddresses.length, partsCount, holders.length, partAddresses);
      await redeployer.configureDividendExempts(partAddresses);
    }
    console.log("Success!");
  } catch (e) {
    console.log("Error", e);
  }

  console.log("Transfering ownership back...");
  await redeployer.transferH2OOwnership();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
