const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

// Uniswap
const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// USDT
const tokenBAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7";
// USDC
const reflectTokenAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("Factory", function () {
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
    this.weth = await this.router.WETH();

    const Factory = await ethers.getContractFactory("Factory");
    this.factory = await Factory.deploy(
      routerAddress,
      tokenBAddress,
      this.account2.address,
      reflectTokenAddress,
      [tokenBAddress, this.weth],
      [this.weth, tokenBAddress],
      {
        value: ethers.utils.parseUnits("0.1", "ether"),
      }
    );
    await this.factory.deployed();

    this.hydroAddress = await this.factory.token();
    this.hydro = await new ethers.Contract(
      this.hydroAddress,
      (
        await artifacts.readArtifact("H2O")
      ).abi,
      this.account1
    );
  });

  it("should set airdrop owner", async function () {
    const airdrop = await new ethers.Contract(
      await this.factory.airdrop(),
      (
        await artifacts.readArtifact("Ownable")
      ).abi,
      this.account1
    );

    expect(await airdrop.owner()).to.equal(this.account1.address);
  });

  it("should factory not have any tokens", async function () {
    expect(await this.hydro.balanceOf(this.factory.address)).to.equal(
      ethers.BigNumber.from(0)
    );
  });

  it("should account 2 other account have 1% of tokens", async function () {
    expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
      (await this.hydro.totalSupply()).div(100)
    );
  });

  it("should timelocks have correct amount of tokens", async function () {
    expect(
      await this.hydro.balanceOf(await this.factory.timelockAddress1())
    ).to.equal((await this.hydro.totalSupply()).div(100));
    expect(
      await this.hydro.balanceOf(await this.factory.timelockAddress2())
    ).to.equal((await this.hydro.totalSupply()).div(100));
    expect(
      await this.hydro.balanceOf(await this.factory.timelockAddress3())
    ).to.equal((await this.hydro.totalSupply()).div(100));
    expect(
      await this.hydro.balanceOf(await this.factory.timelockAddress4())
    ).to.equal((await this.hydro.totalSupply()).div(100));
  });

  describe("LPMigrator", async function () {
    beforeEach(async function () {
      this.migratorAddress = await this.factory.migrator();
      this.migrator = await new ethers.Contract(
        this.migratorAddress,
        (
          await artifacts.readArtifact("LPMigrator")
        ).abi,
        this.account2
      );
      this.routerFactory = await new ethers.Contract(
        await this.router.factory(),
        (
          await artifacts.readArtifact("IUniswapV2Factory")
        ).abi,
        this.account2
      );
    });

    it("should initialize liq & transfer ownership", async function () {
      expect(await this.migrator.owner()).to.equal(this.account2.address);
      expect(await this.migrator.initialized()).to.equal(true);
      const lpAddress = await this.routerFactory.getPair(
        this.hydroAddress,
        tokenBAddress
      );
      const lp = await new ethers.Contract(
        lpAddress,
        (
          await artifacts.readArtifact("IERC20")
        ).abi,
        this.account2
      );
      expect(
        (await lp.balanceOf(this.migrator.address)).toString()
      ).to.not.equal("0");
    });
  });
});
