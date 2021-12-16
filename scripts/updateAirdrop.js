const hardhat = require("hardhat");
const fs = require("fs");

const ethers = hardhat.ethers;

async function main() {
  await hardhat.run("compile");

  const signers = await ethers.getSigners();

  const { addresses, amounts } = JSON.parse(fs.readFileSync("airdrop.json"));

  const airdrop = await new ethers.Contract(
    "0x0D5C0Cd9e1f1C315B1AeDFe4C5DdC677E082F1aA",
    (
      await hardhat.artifacts.readArtifact("Airdrop")
    ).abi,
    signers[0]
  );

  const alreadyAddedAddresses = [];

  const partAmount = 100;
  const partsCount = Math.ceil(addresses.length / partAmount);
  for (let partIndex = 0; partIndex < partsCount; partIndex++) {
    console.log("mass update", partIndex);
    const partAddresses = [];
    const partAmounts = [];

    for (
      let index = partAmount * partIndex;
      index < partAmount * (partIndex + 1);
      index++
    ) {
      if (index >= addresses.length) {
        break;
      }
      partAddresses.push(addresses[index]);
      partAmounts.push(amounts[index]);
      if (alreadyAddedAddresses.includes(addresses[index])) {
        throw Error(`Address already exist ${addresses[index]}`)
      }
      alreadyAddedAddresses.push(addresses[index]);
    }
    await airdrop.massUpdate(partAddresses, partAmounts);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
