const { ethers } = require("hardhat");

async function main() {
  const FakeRouter = await ethers.getContractFactory("FakeRouter");
  const fakeRouter = await FakeRouter.deploy(
    "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77"
  );
  console.log("Waiting for confirmation");
  await fakeRouter.deployed();

  console.log("Address", fakeRouter.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
