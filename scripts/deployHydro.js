const hardhat = require("hardhat");

const ethers = hardhat.ethers;
const lpNativeAmount = ethers.utils.parseUnits("5", "ether");
const week = 60 * 60 * 24 * 7;

// MOONRIVER
// huckleberr
const routerAddress = "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77";
// rkitty
const reflectTokenAddress = "0xC2b0435276139731d82Ae2Fa8928c9b9De0761c1";
const finnAddress = "0x9A92B5EBf1F6F6f7d93696FCD44e5Cf75035A756";
// finn
const tokenBAddress = finnAddress;
const multisigAddress = "0x855246BE70485D9FCcF91d91bD4050CEf60b20cC";

// ALPHA
// huckleberr
// const routerAddress = "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77";
// OUR OWN TOKEN
// const tokenBAddress = "0xc9a83Ae57fCe2eA09a276C0C33ab2F2260BE99F1";
// const multisigAddress = "0x60EA7c492BbA67921DFd2fF8190079d55D1Bc020";

// ROPSTEN
// const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// // dai
// const tokenBAddress = "0xad6d458402f60fd3bd25163575031acdce07538d";
// const wMovrAddress = "0xc778417e063141139fce010982780140aa0cd5ab";
// const reflectTokenAddress = wMovrAddress;
// const multisigAddress = "0x60EA7c492BbA67921DFd2fF8190079d55D1Bc020";


async function main() {
  await hardhat.run("compile");

  const signer = await ethers.getSigner();
  const accountAddress = (await ethers.getSigner()).address;
  console.log("Deploying...", accountAddress);

  const router = await new ethers.Contract(
    routerAddress,
    (
      await hardhat.artifacts.readArtifact("IUniswapV2Router02")
    ).abi,
    signer
  );
  const wMovrAddress = await router.WETH();
  // const reflectTokenAddress = wMovrAddress;

  const H2O = await ethers.getContractFactory("H2O");
  const h2o = await H2O.deploy(routerAddress, tokenBAddress);
  console.log("Deploying h2o...");
  await h2o.deployed();
  console.log("h2o address ", h2o.address);
  await h2o.setup(
    reflectTokenAddress,
    [reflectTokenAddress, finnAddress, wMovrAddress],
    [wMovrAddress, finnAddress, reflectTokenAddress]
  );
  console.log("setup finished");

  const bal = await h2o.balanceOf(accountAddress);
  if (bal.isZero()) {
    throw Error("Balance zero");
  }

  const liquidityAmount = bal.mul(20).div(100);
  const airdropAmount = bal.mul(75).div(100);
  const teamAmount = bal.sub(liquidityAmount).sub(airdropAmount);
  console.log(
    "Token amounts",
    liquidityAmount.toString(),
    airdropAmount.toString(),
    teamAmount.toString()
  );

  // TEAM TIMELOCKS

  async function createTimelock(partAmount, releaseTime) {
    const TokenTimelock = await ethers.getContractFactory("TokenTimelock");
    const timelock = await TokenTimelock.deploy(
      h2o.address,
      multisigAddress,
      releaseTime
    );
    console.log("Deploying timelock...");
    await timelock.deployed();
    console.log("Timelock deployed", timelock.address, releaseTime);

    await h2o.setIsDividendExempt(timelock.address, true);
    await h2o.setIsFeeExempt(timelock.address, true);
    await h2o.setIsWalletLimitExempt(timelock.address, true);
    console.log("transfer to timelock");
    await h2o.transfer(timelock.address, partAmount);
  }

  console.log("transfer to team");
  const currentTime = Math.round(new Date().getTime() / 1000);
  const month = 60 * 60 * 24 * 7 * 4;
  const teamPartAmount = teamAmount.div(5);
  if (multisigAddress !== accountAddress) {
    await h2o.transfer(multisigAddress, teamPartAmount);
  }
  await createTimelock(teamPartAmount, currentTime + month);
  await createTimelock(teamPartAmount, currentTime + 2 * month);
  await createTimelock(teamPartAmount, currentTime + 3 * month);
  await createTimelock(teamPartAmount, currentTime + 4 * month);

  // AIRDROP

  const Airdrop = await ethers.getContractFactory("Airdrop");
  const airdrop = await Airdrop.deploy(h2o.address, week);
  console.log("Deploying airdrop...");
  await airdrop.deployed();
  console.log("Airdrop address", airdrop.address);
  console.log("airdrop transfering ownership");
  await airdrop.transferOwnership(accountAddress);
  console.log("airdrop dividend exempt");
  await h2o.setIsDividendExempt(airdrop.address, true);
  console.log("airdrop fee exempt");
  await h2o.setIsFeeExempt(airdrop.address, true);
  console.log("airdrop wallet exempt");
  await (await h2o.setIsWalletLimitExempt(airdrop.address, true)).wait(1);

  console.log("transfer to airdrop");
  await h2o.transfer(airdrop.address, airdropAmount);

  // MIGRATOR

  const LPMigrator = await ethers.getContractFactory("LPMigrator");
  const migrator = await LPMigrator.deploy(h2o.address, routerAddress, week);
  console.log("Deploying migrator...");
  await migrator.deployed();
  console.log("Migrator address ", migrator.address);

  console.log("migrator dividend exempt");
  await h2o.setIsDividendExempt(migrator.address, true);
  console.log("migrator fee exempt");
  await h2o.setIsFeeExempt(migrator.address, true);
  console.log("migrator wallet exempt");
  await (await h2o.setIsWalletLimitExempt(migrator.address, true)).wait(1);
  console.log("transfer to migrator");
  await (await h2o.transfer(migrator.address, liquidityAmount)).wait(1);
  console.log("initializing liquidity");
  await migrator.initializeLiquidity(
    tokenBAddress,
    [tokenBAddress, wMovrAddress],
    [wMovrAddress, tokenBAddress],
    {
      value: lpNativeAmount,
    }
  );
  console.log("migrator transfering ownership");
  await migrator.transferOwnership(multisigAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
