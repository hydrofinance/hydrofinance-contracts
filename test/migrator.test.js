const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

const day = 24 * 60 * 60;

// Uniswap
const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// DAI
const tokenBAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
// WETH
const reflectTokenAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// sushi
const altRouterAddress = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

describe("LPMigrator", function () {
  beforeEach(async function () {
    const result = await ethers.getSigners();
    this.account1 = result[0];
    this.account2 = result[1];
    this.account3 = result[2];

    this.router = await new ethers.Contract(
      routerAddress,
      (
        await artifacts.readArtifact("IUniswapV2Router02")
      ).abi,
      this.account1
    );
    this.altRouter = await new ethers.Contract(
      altRouterAddress,
      (
        await artifacts.readArtifact("IUniswapV2Router02")
      ).abi,
      this.account1
    );
    this.routerFactory = await new ethers.Contract(
      await this.router.factory(),
      (
        await artifacts.readArtifact("IUniswapV2Factory")
      ).abi,
      this.account1
    );
    this.altRouterFactory = await new ethers.Contract(
      await this.altRouter.factory(),
      (
        await artifacts.readArtifact("IUniswapV2Factory")
      ).abi,
      this.account1
    );
    this.weth = await this.router.WETH();

    const Hydro = await ethers.getContractFactory("H2O");
    this.hydro = await Hydro.deploy(routerAddress, tokenBAddress);
    await this.hydro.deployed();

    await this.hydro.setup(
      reflectTokenAddress,
      [reflectTokenAddress, this.weth],
      [this.weth, reflectTokenAddress]
    );

    const LPMigrator = await ethers.getContractFactory("LPMigrator");
    this.migrator = await LPMigrator.deploy(
      this.hydro.address,
      routerAddress,
      day
    );
    await this.migrator.deployed();
    await this.hydro.setIsFeeExempt(this.migrator.address, true);
    await this.hydro.setIsWalletLimitExempt(this.migrator.address, true);
    await this.hydro.setIsDividendExempt(this.migrator.address, true);

    await this.hydro.transfer(this.migrator.address, 10000000);

    await this.migrator.initializeLiquidity(
      tokenBAddress,
      [tokenBAddress, this.weth],
      [this.weth, tokenBAddress],
      {
        value: ethers.utils.parseUnits("0.00001", "ether"),
      }
    );
  });

  it("should initialize liq", async function () {
    expect(await this.migrator.initialized()).to.equal(true);

    const lpAddress = await this.routerFactory.getPair(
      this.hydro.address,
      tokenBAddress
    );
    const lp = await new ethers.Contract(
      lpAddress,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );
    expect((await lp.balanceOf(this.migrator.address)).toString()).to.not.equal(
      "0"
    );
  });

  it("should not change to new router because of timelock", async function () {
    await this.migrator.proposeRouter(
      altRouterAddress,
      this.weth,
      [this.weth],
      [this.weth]
    );

    const { router, tokenB } = await this.migrator.routerCandidate();
    expect(router).to.equal(altRouterAddress);
    expect(tokenB).to.equal(this.weth);

    await ethers.provider.send("evm_increaseTime", [60 * 60]);

    await expect(this.migrator.upgradeRouter()).to.revertedWith(
      "Delay has not passed"
    );
  });

  it("should change to new router", async function () {
    await this.migrator.proposeRouter(
      altRouterAddress,
      this.weth,
      [this.weth],
      [this.weth]
    );

    await ethers.provider.send("evm_increaseTime", [8 * day]);

    await this.migrator.upgradeRouter();

    expect(await this.migrator.routerAddress()).to.equal(altRouterAddress);
    expect((await this.migrator.routerCandidate()).router).to.equal(
      ethers.constants.AddressZero
    );

    const lpAddress = await this.altRouterFactory.getPair(
      this.hydro.address,
      this.weth
    );
    const lp = await new ethers.Contract(
      lpAddress,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );
    expect((await lp.balanceOf(this.migrator.address)).toString()).to.not.equal(
      "0"
    );

    const oldLpAddress = await this.routerFactory.getPair(
      this.hydro.address,
      tokenBAddress
    );
    const oldLp = await new ethers.Contract(
      oldLpAddress,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );
    expect((await oldLp.balanceOf(this.migrator.address)).toString()).to.equal(
      "0"
    );
  });

  it("should not increate approval delay", async function () {
    await expect(this.migrator.increaseApprovalDelayTo(60)).to.revertedWith(
      "!new approval delay smaller than old"
    );
  });

  it("should increate approval delay", async function () {
    await this.migrator.increaseApprovalDelayTo(8 * day);
    expect(await this.migrator.approvalDelay()).to.equal(
      ethers.BigNumber.from(8 * day)
    );
  });
});
