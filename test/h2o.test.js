const { expect } = require("chai");
const {
  addLiquidity,
  buyActions,
  FINN_ADDRESS,
  RKITTY_ADDRESS,
  routerAddress,
} = require("./utils");
const { ethers, artifacts } = require("hardhat");

const day = 24 * 60 * 60;

// FINN
const tokenBAddress = FINN_ADDRESS;

// solar
const altRouterAddress = "0xAA30eF758139ae4a7f798112902Bf6d65612045f";

describe("Hydro", function () {
  beforeEach(async function () {
    this.deadline = Math.round(new Date().getTime() / 1000) + 100000;

    const result = await ethers.getSigners();
    this.account1 = result[0];
    this.account2 = result[1];
    this.account3 = result[2];

    this.tokenBAddress = tokenBAddress;

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
    this.altRouter = await new ethers.Contract(
      altRouterAddress,
      (
        await artifacts.readArtifact("IUniswapV2Router02")
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

    this.pair = await new ethers.Contract(
      this.pairAddress,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );

    const altFactoryAddress = await this.altRouter.factory();
    const altFactory = await new ethers.Contract(
      altFactoryAddress,
      (
        await artifacts.readArtifact("IUniswapV2Factory")
      ).abi,
      this.account1
    );
    await altFactory.createPair(this.hydro.address, this.wethAddress);
    this.altPairAddress = await altFactory.getPair(
      this.hydro.address,
      this.wethAddress
    );
    this.altPair = await new ethers.Contract(
      this.altPairAddress,
      (
        await artifacts.readArtifact("IERC20")
      ).abi,
      this.account1
    );

    context = this;
  });

  it("is correctly configured", async function () {
    expect(await this.hydro.totalSupply()).to.equal(
      await this.hydro.balanceOf(this.account1.address)
    );

    expect(await this.liqPlugin.pair()).to.equal(await this.hydro.pair());
  });

  describe("transferFrom", async function () {
    it("is not taking tax from owner", async function () {
      const totalSupply = await this.hydro.totalSupply();
      const amount = totalSupply.div(100);

      await this.hydro.transfer(this.account2.address, amount);

      expect(await this.hydro.balanceOf(this.account1.address)).to.equal(
        totalSupply.sub(amount)
      );
      expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
        amount
      );
    });

    it("is taking tax from non owner", async function () {
      const totalSupply = await this.hydro.totalSupply();
      const amount = totalSupply.div(100);

      await this.hydro.transfer(this.account2.address, amount);
      await this.hydro
        .connect(this.account2)
        .transfer(this.account3.address, amount);

      expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
        ethers.BigNumber.from(0)
      );
      expect(await this.hydro.balanceOf(this.account3.address)).to.equal(
        amount.mul(95).div(100)
      );
    });

    it("is wallet limit working", async function () {
      const totalSupply = await this.hydro.totalSupply();
      const amount = totalSupply.div(100);

      await this.hydro.setIsWalletLimitExempt(this.account2.address, false);

      // max limit 0.1% of total supply
      await this.hydro.setMaxWallet(1, 1000);
      const transfer = this.hydro.transfer(
        this.account2.address,
        amount.mul(2)
      );
      await expect(transfer).to.revertedWith(
        "Transfer amount exceeds the bag size."
      );

      await this.hydro.setIsWalletLimitExempt(this.account2.address, true);
      await this.hydro.transfer(this.account2.address, amount.mul(2));
      await expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
        amount.mul(2)
      );
    });
  });

  describe("fees", async function () {
    beforeEach(async function () {
      await addLiquidity(this);
    });

    it("is 5% when sending between users", async function () {
      await this.hydro.setIsFeeExempt(this.account1.address, false);

      await this.hydro.transfer(this.account2.address, 10000);

      expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
        ethers.BigNumber.from(9500)
      );
    });

    it("is 10% when selling", async function () {
      const amount = ethers.BigNumber.from(10000);

      await this.hydro.transfer(this.account2.address, amount);

      expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
        amount
      );

      await this.hydro
        .connect(this.account2)
        .approve(this.router.address, ethers.utils.parseUnits("1", 30));

      const beforeBalance = await this.hydro.balanceOf(this.pairAddress);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          amount,
          1,
          [this.hydro.address, tokenBAddress],
          this.account1.address,
          this.deadline
        );
      const afterBalance = await this.hydro.balanceOf(this.pairAddress);

      expect(afterBalance.sub(beforeBalance)).to.equal(amount.mul(90).div(100));
    });

    it("is buyback working", async function () {
      await buyActions(this);

      await this.hydro.setAutoSwapThreshold(1);
      await this.hydro.setAutoDistributorSettings(500000);
      await this.distPlugin.setDistributionCriteria(0, 0);
      await this.distPlugin.setH2ODepositThreshold(0);

      const newAmount = await this.hydro.balanceOf(this.account2.address);

      expect(await this.rkitty.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );

      let currentHydroBal = await this.hydro.balanceOf(this.hydro.address);

      const transferAmount = newAmount.div(2);

      let beforeBalance = await this.hydro.balanceOf(this.pairAddress);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          transferAmount,
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );
      let afterBalance = await this.hydro.balanceOf(this.pairAddress);

      expect(afterBalance.sub(beforeBalance)).to.equal(
        currentHydroBal.add(transferAmount.mul(9).div(10))
      );
      const kittyBal = await this.rkitty.balanceOf(this.account1.address);
      expect(kittyBal).to.not.equal(ethers.BigNumber.from(0));

      currentHydroBal = await this.hydro.balanceOf(this.hydro.address);
      const secondTransfarAmount = transferAmount.div(2);
      beforeBalance = await this.hydro.balanceOf(this.pairAddress);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          transferAmount.div(2),
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );
      afterBalance = await this.hydro.balanceOf(this.pairAddress);

      expect(afterBalance.sub(beforeBalance)).to.equal(
        currentHydroBal.add(secondTransfarAmount.mul(9).div(10))
      );
    });

    it("is changing token to native token works", async function () {
      await buyActions(this);

      await this.hydro.setAutoSwapThreshold(1);
      await this.hydro.setAutoDistributorSettings(500000);
      await this.distPlugin.setDistributionCriteria(0, 0);
      await this.distPlugin.setH2ODepositThreshold(0);

      let newAmount = await this.hydro.balanceOf(this.account2.address);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );

      expect(await this.tokenB.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );
      expect(await this.rkitty.balanceOf(this.distPlugin.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );

      await this.distPlugin.changeRewardToken(
        this.wethAddress,
        routerAddress,
        [this.hydro.address, FINN_ADDRESS, this.wethAddress],
        [this.wethAddress, FINN_ADDRESS, this.wethAddress],
        [this.wethAddress],
        false
      );

      expect(await this.weth.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );

      await this.hydro.setAutoSwapThreshold(0);
      await this.hydro.setAutoDistributorSettings(0);

      await buyActions(this);

      await this.hydro.setAutoSwapThreshold(1);
      await this.hydro.setAutoDistributorSettings(500000);

      newAmount = await this.hydro.balanceOf(this.account2.address);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );

      expect(await this.weth.balanceOf(this.account1.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );
    });

    it("is changing token to non-native token works", async function () {
      await buyActions(this);

      await this.hydro.setAutoSwapThreshold(1);
      await this.hydro.setAutoDistributorSettings(500000);
      await this.distPlugin.setDistributionCriteria(0, 0);
      await this.distPlugin.setH2ODepositThreshold(0);

      let newAmount = await this.hydro.balanceOf(this.account2.address);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );

      expect(await this.tokenB.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );
      expect(await this.rkitty.balanceOf(this.distPlugin.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );

      await this.distPlugin.changeRewardToken(
        FINN_ADDRESS,
        routerAddress,
        [this.hydro.address, FINN_ADDRESS],
        [FINN_ADDRESS, this.wethAddress],
        [this.wethAddress, FINN_ADDRESS],
        false
      );

      expect(await this.tokenB.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );

      await this.hydro.setAutoSwapThreshold(0);
      await this.hydro.setAutoDistributorSettings(0);

      await buyActions(this);

      await this.hydro.setAutoSwapThreshold(1);
      await this.hydro.setAutoDistributorSettings(500000);

      newAmount = await this.hydro.balanceOf(this.account2.address);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );

      expect(await this.tokenB.balanceOf(this.account1.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );
    });

    it("is changing token to h2o token works", async function () {
      await buyActions(this);

      await this.hydro.setAutoSwapThreshold(1);
      await this.hydro.setAutoDistributorSettings(500000);
      await this.distPlugin.setDistributionCriteria(0, 0);
      await this.distPlugin.setH2ODepositThreshold(0);

      let newAmount = await this.hydro.balanceOf(this.account2.address);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );

      expect(await this.tokenB.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );
      expect(await this.rkitty.balanceOf(this.distPlugin.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );

      await this.distPlugin.changeRewardToken(
        this.hydro.address,
        routerAddress,
        [this.hydro.address],
        [this.hydro.address, FINN_ADDRESS, this.wethAddress],
        [this.wethAddress, FINN_ADDRESS, this.hydro.address],
        false
      );

      expect(await this.tokenB.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );

      await this.hydro.setAutoSwapThreshold(0);
      await this.hydro.setAutoDistributorSettings(0);

      await buyActions(this);

      await this.hydro.setAutoSwapThreshold(1);
      await this.hydro.setAutoDistributorSettings(500000);

      const balBefore = await this.hydro.balanceOf(this.account1.address);
      newAmount = await this.hydro.balanceOf(this.account2.address);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );
      const balAfter = await this.hydro.balanceOf(this.account1.address);

      expect(balAfter.sub(balBefore)).to.not.equal(ethers.BigNumber.from(0));
    });

    it("is changing base pair works", async function () {
      await buyActions(this);

      await this.pair.approve(
        this.router.address,
        ethers.utils.parseUnits("1", 30)
      );
      await this.router.removeLiquidity(
        this.hydro.address,
        tokenBAddress,
        await this.pair.balanceOf(this.account1.address),
        0,
        0,
        this.account1.address,
        this.deadline
      );

      await this.router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        await this.tokenB.balanceOf(this.account1.address),
        0,
        [tokenBAddress, this.wethAddress],
        this.account1.address,
        this.deadline
      );

      const tokenABal = (await this.hydro.balanceOf(this.account1.address))
        .mul(20)
        .div(100);
      const tokenBBal = await this.weth.balanceOf(this.account1.address);

      await this.hydro.approve(
        this.altRouter.address,
        ethers.utils.parseUnits("1", 30)
      );
      await this.weth.approve(
        this.altRouter.address,
        ethers.utils.parseUnits("1", 30)
      );

      await this.liqPlugin.changeLiquiditiyPair(
        this.altRouter.address,
        this.altPairAddress
      );

      await this.hydro.setAutoSwapThreshold(0);
      await this.hydro.setAutoDistributorSettings(0);
      await this.altRouter.addLiquidity(
        this.hydro.address,
        this.wethAddress,
        tokenABal,
        tokenBBal,
        0,
        0,
        this.account1.address,
        this.deadline
      );

      await buyActions(this, this.wethAddress, this.altRouter);

      await this.hydro.setAutoSwapThreshold(1);
      await this.hydro.setAutoDistributorSettings(500000);
      await this.distPlugin.setDistributionCriteria(0, 0);
      await this.distPlugin.setH2ODepositThreshold(0);

      await this.hydro.transfer(this.account2.address, 1000000);
      const beforeBal = await this.hydro.balanceOf(this.altPairAddress);
      const newAmount = await this.hydro.balanceOf(this.account2.address);

      await this.hydro
        .connect(this.account2)
        .approve(this.altRouter.address, ethers.utils.parseUnits("1", 30));
      await this.weth
        .connect(this.account2)
        .approve(this.altRouter.address, ethers.utils.parseUnits("1", 30));
      await this.altRouter
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          0,
          [this.hydro.address, this.wethAddress],
          this.account2.address,
          this.deadline
        );
      const afterBal = await this.hydro.balanceOf(this.altPairAddress);

      expect(await this.rkitty.balanceOf(this.account1.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );
      expect(afterBal.sub(beforeBal)).to.not.equal(ethers.BigNumber.from(0));
    });
  });
});
