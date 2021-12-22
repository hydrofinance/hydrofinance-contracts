const { EtherscanProvider } = require("@ethersproject/providers");
const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

// Uniswap
const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// DAI
const tokenBAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
// WETH
const reflectTokenAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// sushi
const altRouterAddress = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

let context = {};

describe("Hydro", function () {
  beforeEach(async function () {
    this.deadline = Math.round(new Date().getTime() / 1000) + 1000;

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

    const Hydro = await ethers.getContractFactory("H2O");
    this.hydro = await Hydro.deploy(routerAddress, tokenBAddress);
    await this.hydro.deployed();
    await this.hydro.setup(
      reflectTokenAddress,
      [reflectTokenAddress, this.wethAddress],
      [this.wethAddress, reflectTokenAddress]
    );

    this.distributor = await new ethers.Contract(
      await this.hydro.distributor(),
      (
        await artifacts.readArtifact("DividendDistributor")
      ).abi,
      this.account1
    );

    this.pairAddress = await this.hydro.pair();
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
    expect(await this.hydro.autoLiquidityReceiver()).to.equal(
      this.account1.address
    );
    expect(await this.hydro.totalSupply()).to.equal(
      await this.hydro.balanceOf(this.account1.address)
    );
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
      await expect(transfer).to.revertedWith("Transfer amount exceeds the bag size.");

      await this.hydro.setIsWalletLimitExempt(this.account2.address, true);
      await this.hydro.transfer(this.account2.address, amount.mul(2));
      await expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
        amount.mul(2)
      );
    });
  });

  describe("fees", async function () {
    beforeEach(async function () {
      const ethBalance = await ethers.provider.getBalance(
        this.account1.address
      );
      await this.router.swapExactETHForTokens(
        0,
        [this.wethAddress, tokenBAddress],
        this.account1.address,
        this.deadline,
        {
          value: ethBalance.div(2),
        }
      );

      const tokenABal = (await this.hydro.balanceOf(this.account1.address))
        .mul(20)
        .div(100);
      const tokenBBal = await this.tokenB.balanceOf(this.account1.address);
      await this.hydro.approve(
        this.router.address,
        ethers.utils.parseUnits("1", 30)
      );
      await this.tokenB.approve(
        this.router.address,
        ethers.utils.parseUnits("1", 30)
      );

      await this.router.addLiquidity(
        this.hydro.address,
        tokenBAddress,
        tokenABal,
        tokenBBal,
        0,
        0,
        this.account1.address,
        this.deadline
      );
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

    async function buyActions(_tokenBAdddress, _router) {
      const bAddress = _tokenBAdddress || tokenBAddress;
      const router = _router || context.router;

      const amount = ethers.BigNumber.from(10).pow(7);
      tokenB = await new ethers.Contract(
        bAddress,
        (
          await artifacts.readArtifact("IERC20")
        ).abi,
        context.account1
      );

      await context.hydro.transfer(context.account2.address, amount);
      await context.hydro.transfer(context.account3.address, amount);

      await context.hydro
        .connect(context.account2)
        .approve(router.address, ethers.utils.parseUnits("1", 30));
      await tokenB
        .connect(context.account2)
        .approve(router.address, ethers.utils.parseUnits("1", 30));

      await context.hydro
        .connect(context.account3)
        .approve(router.address, ethers.utils.parseUnits("1", 30));
      await tokenB
        .connect(context.account3)
        .approve(router.address, ethers.utils.parseUnits("1", 30));

      // need to do some transaction before proceeding, so that there will be something to swap with
      for (let i = 0; i < 10; i++) {
        const tokenAmount = await context.hydro.balanceOf(
          context.account3.address
        );
        await router
          .connect(context.account3)
          .swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokenAmount,
            1,
            [context.hydro.address, bAddress],
            context.account3.address,
            context.deadline
          );

        const tokenBAmount = await tokenB.balanceOf(context.account3.address);
        await router
          .connect(context.account3)
          .swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokenBAmount,
            1,
            [bAddress, context.hydro.address],
            context.account3.address,
            context.deadline
          );
      }
    }

    it("is buyback working", async function () {
      await buyActions();

      await this.hydro.setSwapBackSettings(
        true,
        ethers.BigNumber.from(10).pow(18 + 9)
      );
      await this.hydro.setTargetLiquidity(100, 100);
      await this.hydro.setDistributionCriteria(0, 0);

      const newAmount = await this.hydro.balanceOf(this.account2.address);

      expect(await this.weth.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );

      const beforeBalance = await this.hydro.balanceOf(this.pairAddress);
      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          1,
          [this.hydro.address, tokenBAddress],
          this.account2.address,
          this.deadline
        );
      const afterBalance = await this.hydro.balanceOf(this.pairAddress);

      expect(afterBalance.sub(beforeBalance).toNumber()).to.be.above(
        newAmount.mul(90).div(100).toNumber()
      );
      expect(await this.weth.balanceOf(this.account1.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );
    });

    it("is changing token works", async function () {
      await buyActions();

      await this.hydro.setSwapBackSettings(
        true,
        ethers.BigNumber.from(10).pow(18 + 9)
      );

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

      const ust = await new ethers.Contract(
        "0xa47c8bf37f92abed4a126bda807a7b7498661acd",
        (
          await artifacts.readArtifact("IERC20")
        ).abi,
        this.account1
      );

      expect(await ust.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );

      await this.hydro.setReflectToken(
        // UST
        "0xa47c8bf37f92abed4a126bda807a7b7498661acd",
        ["0xa47c8bf37f92abed4a126bda807a7b7498661acd", this.wethAddress],
        [this.wethAddress, "0xa47c8bf37f92abed4a126bda807a7b7498661acd"],
        altRouterAddress,
        false
      );

      expect(await ust.balanceOf(this.account1.address)).to.equal(
        ethers.BigNumber.from(0)
      );

      await this.hydro.setSwapBackSettings(true, 1);

      await buyActions();

      await this.hydro.setSwapBackSettings(
        true,
        ethers.BigNumber.from(10).pow(18 + 9)
      );

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

      expect(await ust.balanceOf(this.account1.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );

      await this.distributor.process(500000);
    });

    it("is changing base pair works", async function () {
      await buyActions();

      await this.pair.approve(this.router.address, ethers.utils.parseUnits("1", 30));
      await this.router.removeLiquidity(
        this.hydro.address,
        tokenBAddress,
        await this.pair.balanceOf(this.account1.address),
        0,
        0,
        this.account1.address,
        this.deadline
      );

      await this.router.swapExactTokensForTokens(
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

      await this.hydro.changeLiquiditiyPair(
        this.altRouter.address,
        this.altPairAddress,
        [this.hydro.address, this.wethAddress],
        [this.wethAddress, this.hydro.address],
        [this.wethAddress]
      );

      await this.hydro.setSwapBackSettings(
        false,
        1
      );
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
      await this.hydro.setSwapBackSettings(
        true,
        1
      );

      await buyActions(this.wethAddress, this.altRouter);

      await this.hydro.setSwapBackSettings(
        true,
        ethers.BigNumber.from(10).pow(18 + 9)
      );
      await this.hydro.setTargetLiquidity(100, 100);
      await this.hydro.setDistributionCriteria(0, 0);

      await this.hydro.transfer(this.account2.address, 1000000);
      const beforeBal = await this.hydro.balanceOf(this.altPairAddress);
      const newAmount = await this.hydro.balanceOf(this.account2.address);
      

      await this.hydro.connect(this.account2).approve(
        this.altRouter.address,
        ethers.utils.parseUnits("1", 30)
      );
      await this.weth.connect(this.account2).approve(
        this.altRouter.address,
        ethers.utils.parseUnits("1", 30)
      );
      await this.altRouter
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          newAmount.div(2),
          1,
          [this.hydro.address, this.wethAddress],
          this.account2.address,
          this.deadline
        );
      const afterBal = await this.hydro.balanceOf(this.altPairAddress);

      expect(await this.weth.balanceOf(this.account1.address)).to.not.equal(
        ethers.BigNumber.from(0)
      );
      expect(afterBal.sub(beforeBal).toNumber()).to.be.above(0);
    });
  });
});
