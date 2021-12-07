const { EtherscanProvider } = require("@ethersproject/providers");
const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");

// Uniswap
const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
// USDT
const tokenBAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7";
// USDC
const reflectTokenAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

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
    this.weth = await this.router.WETH();
    this.tokenB = await new ethers.Contract(
      tokenBAddress,
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
      [reflectTokenAddress, this.weth],
      [this.weth, reflectTokenAddress]
    );

    this.pairAddress = await this.hydro.pair();
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
        [this.weth, tokenBAddress],
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
      await this.tokenB
        .connect(this.account2)
        .approve(this.router.address, ethers.utils.parseUnits("1", 30));

      const beforeBalance = await this.hydro.balanceOf(this.pairAddress);

      // const pair = await new ethers.Contract(
      //   this.pairAddress,
      //   (
      //     await artifacts.readArtifact("IUniswapV2Pair")
      //   ).abi,
      //   this.account1
      // );

      // const ethBalance = await ethers.provider.getBalance(
      //   this.account1.address
      // );
      // await this.router.swapExactETHForTokens(
      //   0,
      //   [this.weth, tokenBAddress],
      //   this.account2.address,
      //   this.deadline,
      //   {
      //     value: ethBalance.div(3),
      //   }
      // );

      await this.router
        .connect(this.account2)
        .swapExactTokensForTokensSupportingFeeOnTransferTokens(
          amount,
          0,
          [this.hydro.address, this.tokenB.address],
          this.account2.address,
          this.deadline
        );
      const afterBalance = await this.hydro.balanceOf(this.pairAddress);

      expect(afterBalance.sub(beforeBalance), amount.mul(90).div(100));
    });
  });
});
