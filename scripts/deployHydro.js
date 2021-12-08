const hardhat = require("hardhat");

const ethers = hardhat.ethers;
const lpNativeAmount = ethers.utils.parseUnits("0.00001", "ether");
const week = 60 * 60 * 24 * 7;

// ALPHA
// huckleberr
const routerAddress = "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77";
// WAN USDT
const tokenBAddress = "0x2715aA7156634256aE75240C2c5543814660CD04";
const wMovrAddress = "0x372d0695E75563D9180F8CE31c9924D7e8aaac47";
const reflectTokenAddress = wMovrAddress;
const multisigAddress = "0x60EA7c492BbA67921DFd2fF8190079d55D1Bc020";

// ROPSTEN
// const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// // dai
// const tokenBAddress = "0xad6d458402f60fd3bd25163575031acdce07538d";
// const wMovrAddress = "0xc778417e063141139fce010982780140aa0cd5ab";
// const reflectTokenAddress = wMovrAddress;
// const multisigAddress = "0x60EA7c492BbA67921DFd2fF8190079d55D1Bc020";

// KOVAN
// const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// // dai
// const tokenBAddress = "0x4f96fe3b7a6cf9725f59d353f723c1bdb64ca6aa";
// const wMovrAddress = "0xd0a1e359811322d97991e03f863a0c30c2cf029c";
// const reflectTokenAddress = wMovrAddress;
// const multisigAddress = "0x60EA7c492BbA67921DFd2fF8190079d55D1Bc020";

// uniswap on ropsten
// const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// solar
// const UNISWAP_ROUTER = "0xAA30eF758139ae4a7f798112902Bf6d65612045f";
// moonswap alpha
// const UNISWAP_ROUTER = "0xEA2097B1F1805294797f638A5767A5432D721FFf";

async function main() {
  await hardhat.run("compile");

  const accountAddress = (await ethers.getSigner()).address;
  console.log("Deploying...", accountAddress);

  const gasPrice = ethers.BigNumber.from("9000000000");

  const H2O = await ethers.getContractFactory("H2O");
  const h2o = await H2O.deploy(routerAddress, tokenBAddress);
  console.log("Deploying h2o...");
  await h2o.deployed();
  console.log("h2o address ", h2o.address);
  await h2o.setup(
    reflectTokenAddress,
    [reflectTokenAddress, wMovrAddress],
    [wMovrAddress, reflectTokenAddress]
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

  // const Factory = await ethers.getContractFactory("Factory");
  // const factory = await Factory.deploy(
  //   routerAddress,
  //   tokenBAddress,
  //   multisigAddress,
  //   reflectTokenAddress,
  //   [tokenBAddress, wMovrAddress],
  //   [wMovrAddress, tokenBAddress],
  //   {
  //     value: ethers.utils.parseUnits("0.00001", "ether"),
  //     // gasLimit: 1073680,
  //     // gasPrice: ethers.utils.parseUnits("1", "gwei")
  //   }
  // );
  // console.log("Waiting for confirmation...");
  // await factory.deployed();

  // console.log("Factory deployed to:", factory.address);
  // console.log("Token address:", await factory.token());
  // console.log("Migrator address:", await factory.migrator());
  // console.log("Airdrop address:", await factory.airdrop());
  // console.log("Timelock1 address:", await factory.timelockAddress1());
  // console.log("Timelock2 address:", await factory.timelockAddress2());
  // console.log("Timelock3 address:", await factory.timelockAddress3());
  // console.log("Timelock4 address:", await factory.timelockAddress4());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
