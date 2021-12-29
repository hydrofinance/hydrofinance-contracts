const { expect } = require("chai");
const {
  addLiquidity,
  buyActions,
  FINN_ADDRESS,
  RKITTY_ADDRESS,
  routerAddress,
} = require("./utils");
const { ethers, artifacts, network } = require("hardhat");

// FINN
const tokenBAddress = FINN_ADDRESS;

const day = 24 * 60 * 60;

describe("Plugins", async function () {
  beforeEach(async function () {
    this.deadline = Math.round(new Date().getTime() / 1000) + 1000000000;

    this.tokenBAddress = tokenBAddress;
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
    const factoryAddress = await this.router.factory();
    this.factory = await new ethers.Contract(
      factoryAddress,
      (
        await artifacts.readArtifact("IUniswapV2Factory")
      ).abi,
      this.account1
    );
    this.wethAddress = await this.router.WETH();
    this.tokenB = await new ethers.Contract(
      tokenBAddress,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );
    this.weth = await new ethers.Contract(
      this.wethAddress,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );
    this.rkitty = await new ethers.Contract(
      RKITTY_ADDRESS,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );

    const Hydro = await ethers.getContractFactory("H2Ov2");
    this.hydro = await Hydro.deploy(day);
    await this.hydro.deployed();

    await this.factory.createPair(this.hydro.address, tokenBAddress);
    this.pairAddress = await this.factory.getPair(
      this.hydro.address,
      tokenBAddress
    );

    const LiqPlugin = await ethers.getContractFactory("H2OLiquidityPlugin");
    this.liqPlugin = await LiqPlugin.deploy(this.hydro.address);
    await this.liqPlugin.deployed();
    await this.liqPlugin.setupLiquiditiyPair(routerAddress, this.pairAddress);
    await this.hydro.setupPlugin(1, this.liqPlugin.address);

    const DistPlugin = await ethers.getContractFactory("H2ODistributorPlugin");
    this.distPlugin = await DistPlugin.deploy(this.hydro.address);
    await this.distPlugin.deployed();
    await this.distPlugin.setupBaseRouter(
      routerAddress,
      [this.hydro.address, FINN_ADDRESS, this.wethAddress],
      [this.wethAddress, FINN_ADDRESS, this.hydro.address]
    );
    await this.distPlugin.setupRewardToken(
      RKITTY_ADDRESS,
      routerAddress,
      [this.hydro.address, FINN_ADDRESS, RKITTY_ADDRESS],
      [RKITTY_ADDRESS, FINN_ADDRESS, this.wethAddress],
      [this.wethAddress, FINN_ADDRESS, RKITTY_ADDRESS]
    );
    await this.hydro.setupPlugin(2, this.distPlugin.address);

    await addLiquidity(this);

    this.otherLiqPlugin = await LiqPlugin.deploy(this.hydro.address);
    await this.otherLiqPlugin.deployed();

    this.otherDistPlugin = await DistPlugin.deploy(this.hydro.address);
    await this.otherDistPlugin.deployed();
  });

  it("should not be able to setup plugin that already setup", async function () {
    await expect(
      this.hydro.setupPlugin(1, this.otherLiqPlugin.address)
    ).to.be.revertedWith("Plugin already setup");
    await expect(
      this.hydro.setupPlugin(2, this.otherDistPlugin.address)
    ).to.be.revertedWith("Plugin already setup");
  });

  it("should not be able to propse plugin that is invalid", async function () {
    const LiqPlugin = await ethers.getContractFactory("H2OLiquidityPlugin");
    const otherLiqPlugin = await LiqPlugin.deploy(RKITTY_ADDRESS);
    await otherLiqPlugin.deployed();

    await expect(
      this.hydro.proposePlugin(1, otherLiqPlugin.address)
    ).to.be.revertedWith("Plugin not valid");
    await expect(
      this.hydro.proposePlugin(2, otherLiqPlugin.address)
    ).to.be.revertedWith("Plugin not valid");
  });

  it("should not propose approval delay", async function () {
    await expect(this.hydro.proposeApprovalDelay(10)).to.be.revertedWith(
      "Delay too small"
    );

    await expect(this.hydro.upgradeApprovalDelay()).to.be.revertedWith(
      "There is no candidate"
    );

    await this.hydro.proposeApprovalDelay(day * 5);
    await expect(this.hydro.upgradeApprovalDelay()).to.be.revertedWith(
      "Delay has not passed"
    );
  });

  it("should update approval delay", async function () {
    await this.hydro.proposeApprovalDelay(day * 5);
    await ethers.provider.send("evm_increaseTime", [1 * day + 10]);
    await this.hydro.upgradeApprovalDelay();
    expect(await this.hydro.approvalDelay()).to.equal(
      ethers.BigNumber.from(day * 5)
    );
    expect(await this.hydro.proposedApprovalDelay()).to.equal(
      ethers.BigNumber.from(0)
    );
  });

  it("should not change liquidity plugin", async function () {
    await expect(this.hydro.upgradePlugin(1)).to.be.revertedWith(
      "There is no candidate"
    );

    await this.otherLiqPlugin.setupLiquiditiyPair(
      routerAddress,
      this.pairAddress
    );

    await this.hydro.proposePlugin(1, this.otherLiqPlugin.address);
    await expect(this.hydro.upgradePlugin(1)).to.be.revertedWith(
      "Delay has not passed"
    );
  });

  it("should correctly change liquidity plugin", async function () {
    await this.otherLiqPlugin.setupLiquiditiyPair(
      routerAddress,
      this.pairAddress
    );
    // transfer to check if it will be returned
    await this.hydro.transfer(this.liqPlugin.address, 1000);

    const pairBal = await this.hydro.balanceOf(this.pairAddress);
    expect(pairBal).to.not.equal(ethers.BigNumber.from(0));

    const hydroBal = await this.hydro.balanceOf(this.hydro.address);
    await this.hydro.proposePlugin(1, this.otherLiqPlugin.address);
    await ethers.provider.send("evm_increaseTime", [1 * day + 10]);
    await this.hydro.upgradePlugin(1);
    const afterHydroBal = await this.hydro.balanceOf(this.hydro.address);
    const afterPairBal = await this.hydro.balanceOf(this.pairAddress);

    const propPlugin = await this.hydro.pluginCandidates(1);
    expect(propPlugin.implementation).to.equal(ethers.constants.AddressZero);
    expect(await this.hydro.plugin(1)).to.equal(this.otherLiqPlugin.address);
    expect(afterHydroBal.sub(hydroBal)).to.not.equal(ethers.BigNumber.from(0));
    expect(afterPairBal.sub(pairBal)).to.equal(ethers.BigNumber.from(0));

    await this.hydro.swapBackAll();

    expect(await this.hydro.balanceOf(this.pairAddress)).to.equal(
      afterPairBal.add(afterHydroBal.mul(2).div(10))
    );
    expect(await this.hydro.balanceOf(this.hydro.address)).to.equal(
      ethers.BigNumber.from(0)
    );
  });

  it("should not change distributor plugin", async function () {
    await expect(this.hydro.upgradePlugin(2)).to.be.revertedWith(
      "There is no candidate"
    );

    await this.otherDistPlugin.setupBaseRouter(
      routerAddress,
      [this.hydro.address, FINN_ADDRESS, this.wethAddress],
      [this.wethAddress, FINN_ADDRESS, this.hydro.address]
    );
    await this.otherDistPlugin.setupRewardToken(
      RKITTY_ADDRESS,
      routerAddress,
      [this.hydro.address, FINN_ADDRESS, RKITTY_ADDRESS],
      [RKITTY_ADDRESS, FINN_ADDRESS, this.wethAddress],
      [this.wethAddress, FINN_ADDRESS, RKITTY_ADDRESS]
    );
    await this.hydro.proposePlugin(2, this.otherDistPlugin.address);
    await expect(this.hydro.upgradePlugin(2)).to.be.revertedWith(
      "Delay has not passed"
    );
  });

  it("should correctly change distributor plugin", async function () {
    await this.otherDistPlugin.setupBaseRouter(
      routerAddress,
      [this.hydro.address, FINN_ADDRESS, this.wethAddress],
      [this.wethAddress, FINN_ADDRESS, this.hydro.address]
    );
    await this.otherDistPlugin.setupRewardToken(
      RKITTY_ADDRESS,
      routerAddress,
      [this.hydro.address, FINN_ADDRESS, RKITTY_ADDRESS],
      [RKITTY_ADDRESS, FINN_ADDRESS, this.wethAddress],
      [this.wethAddress, FINN_ADDRESS, RKITTY_ADDRESS]
    );
    // transfer to check if it will be returned
    await this.hydro.transfer(this.distPlugin.address, 1000);
    await this.router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      100000000,
      0,
      [this.hydro.address, FINN_ADDRESS, RKITTY_ADDRESS],
      this.distPlugin.address,
      this.deadline
    );
    expect(await this.rkitty.balanceOf(this.distPlugin.address)).to.not.equal(
      ethers.BigNumber.from(0)
    );

    const hydroBal = await this.hydro.balanceOf(this.hydro.address);
    await this.hydro.proposePlugin(2, this.otherDistPlugin.address);
    await ethers.provider.send("evm_increaseTime", [1 * day + 10]);
    await this.hydro.upgradePlugin(2);
    const afterHydroBal = await this.hydro.balanceOf(this.hydro.address);

    const propPlugin = await this.hydro.pluginCandidates(2);
    expect(propPlugin.implementation).to.equal(ethers.constants.AddressZero);
    expect(await this.hydro.plugin(2)).to.equal(this.otherDistPlugin.address);
    expect(afterHydroBal.sub(hydroBal).gt(ethers.BigNumber.from(1000))).to.be
      .true;

    await expect(this.hydro.swapBackAll()).to.revertedWith(
      "Need to update holders to swapback"
    );

    await this.hydro.configureDividendHolders([this.account1.address], true);

    await buyActions(this);

    await this.otherDistPlugin.setDistributionCriteria(0, 0);
    await this.otherDistPlugin.setH2ODepositThreshold(0);

    await this.hydro.swapBackAll();
    await this.hydro.process(500000, false);

    const kittyBal = await this.rkitty.balanceOf(this.account1.address);
    expect(kittyBal).to.not.equal(ethers.BigNumber.from(0));
  });
});
