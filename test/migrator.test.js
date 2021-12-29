const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

const day = 24 * 60 * 60;

const FINN_ADDRESS = "0x9A92B5EBf1F6F6f7d93696FCD44e5Cf75035A756";
const RKITTY_ADDRESS = "0xC2b0435276139731d82Ae2Fa8928c9b9De0761c1";

// Huckle
const routerAddress = "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77";
const tokenBAddress = FINN_ADDRESS;
const reflectTokenAddress = RKITTY_ADDRESS;

// solar
const altRouterAddress = "0xAA30eF758139ae4a7f798112902Bf6d65612045f";

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
    this.wethAddress = await this.router.WETH();
    this.weth = await new ethers.Contract(
      this.wethAddress,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );

    const Hydro = await ethers.getContractFactory("H2O");
    this.hydro = await Hydro.deploy(routerAddress, tokenBAddress);
    await this.hydro.deployed();

    await this.hydro.setup(
      reflectTokenAddress,
      [reflectTokenAddress, this.wethAddress],
      [this.wethAddress, reflectTokenAddress]
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
      [tokenBAddress, this.wethAddress],
      [this.wethAddress, tokenBAddress],
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
      this.wethAddress,
      [this.wethAddress],
      [this.wethAddress]
    );

    const { router, tokenB } = await this.migrator.routerCandidate();
    expect(router).to.equal(altRouterAddress);
    expect(tokenB).to.equal(this.wethAddress);

    await ethers.provider.send("evm_increaseTime", [60 * 60]);

    await expect(this.migrator.upgradeRouter()).to.revertedWith(
      "Delay has not passed"
    );
  });

  it("should change to new router", async function () {
    await this.migrator.proposeRouter(
      altRouterAddress,
      this.wethAddress,
      [this.wethAddress],
      [this.wethAddress]
    );

    await ethers.provider.send("evm_increaseTime", [8 * day]);

    await this.migrator.upgradeRouter();

    expect(await this.migrator.routerAddress()).to.equal(altRouterAddress);
    expect((await this.migrator.routerCandidate()).router).to.equal(
      ethers.constants.AddressZero
    );

    const lpAddress = await this.altRouterFactory.getPair(
      this.hydro.address,
      this.wethAddress
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

  describe("fake router", async function () {
    beforeEach(async function () {
      const FakeRouter = await ethers.getContractFactory("FakeRouter");
      this.fakeRouter = await FakeRouter.deploy(routerAddress);
      await this.fakeRouter.deployed();
    });

    it("should return funds", async function () {
      const initialHydroBalance = await this.hydro.balanceOf(
        this.account1.address
      );
      const initialWethBalance = await this.weth.balanceOf(
        this.account1.address
      );


      await this.migrator.proposeRouter(
        this.fakeRouter.address,
        this.wethAddress,
        [this.wethAddress],
        [this.wethAddress]
      );

      await ethers.provider.send("evm_increaseTime", [8 * day]);

      await this.migrator.upgradeRouter();

      const afterHydroBalance = await this.hydro.balanceOf(
        this.account1.address
      );
      const afterWethBalance = await this.weth.balanceOf(this.account1.address);

      expect(afterHydroBalance.sub(initialHydroBalance)).to.not.equal(0);
      expect(afterWethBalance.sub(initialWethBalance)).to.not.equal(0);
    });
  });
});
