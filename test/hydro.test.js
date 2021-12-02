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

    const Hydro = await ethers.getContractFactory("Hydro");
    this.hydro = await Hydro.deploy(routerAddress, tokenBAddress);
    await this.hydro.deployed();
    await this.hydro.setup(
      reflectTokenAddress,
      [reflectTokenAddress, this.weth],
      [this.weth, reflectTokenAddress]
    );
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
  });
});
