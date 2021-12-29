const { expect } = require("chai");
const { ethers, artifacts } = require("hardhat");
const fs = require("fs");

const day = 24 * 60 * 60;

const FINN_ADDRESS = "0x9A92B5EBf1F6F6f7d93696FCD44e5Cf75035A756";
const RKITTY_ADDRESS = "0xC2b0435276139731d82Ae2Fa8928c9b9De0761c1";

// Huckle
const routerAddress = "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77";
const tokenBAddress = FINN_ADDRESS;
const reflectTokenAddress = RKITTY_ADDRESS;

describe("Airdrop", function () {
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

    const Hydro = await ethers.getContractFactory("H2O");
    this.hydro = await Hydro.deploy(routerAddress, tokenBAddress);
    await this.hydro.deployed();

    await this.hydro.setup(
      reflectTokenAddress,
      [reflectTokenAddress, this.weth],
      [this.weth, reflectTokenAddress]
    );

    const { addresses, amounts } = JSON.parse(
      fs.readFileSync("test/airdrop.json")
    );
    this.amounts = amounts;

    addresses[50] = this.account1.address;
    addresses[51] = this.account2.address;

    const Airdrop = await ethers.getContractFactory("Airdrop");
    this.airdrop = await Airdrop.deploy(this.hydro.address, day);
    await this.airdrop.deployed();

    const partAmount = 100;
    const partsCount = Math.ceil(addresses.length / partAmount);
    for (let partIndex = 0; partIndex < partsCount; partIndex++) {
      const partAddresses = [];
      const partAmounts = [];

      for (
        let index = partAmount * partIndex;
        index < partAmount * (partIndex + 1);
        index++
      ) {
        if (index >= addresses.length) {
          break;
        }
        partAddresses.push(addresses[index]);
        partAmounts.push(amounts[index]);
      }
      await this.airdrop.massUpdate(partAddresses, partAmounts);
    }

    await this.hydro.setIsFeeExempt(this.airdrop.address, true);
    await this.hydro.setIsWalletLimitExempt(this.airdrop.address, true);
    await this.hydro.setIsDividendExempt(this.airdrop.address, true);
  });

  async function start(hydro, airdrop, address) {
    const totalSupply = await hydro.balanceOf(address);
    await hydro.transfer(airdrop.address, totalSupply.mul(75).div(100));

    airdrop.start();
  }

  it("is not able to do stuff when not started", async function () {
    await expect(
      this.airdrop.connect(this.account2).claimAll()
    ).to.be.revertedWith("airdop not started");
    await expect(
      this.airdrop.withdraw(this.account2.address)
    ).to.be.revertedWith("airdop not started");
  });

  it("is not possible to do owner things with non owner", async function () {
    await expect(
      this.airdrop.connect(this.account2).start()
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(
      this.airdrop.connect(this.account2).withdraw(this.account2.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(
      this.airdrop.connect(this.account2).update(this.account2.address, 100)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("is not able to start when there are no tokens", async function () {
    await expect(this.airdrop.start()).to.be.revertedWith(
      "incorrect token balance"
    );
  });

  it("is able to claim all", async function () {
    await start(this.hydro, this.airdrop, this.account1.address);

    const beforeBal = await this.hydro.balanceOf(this.account1.address);
    await this.airdrop.claimAll();
    const afterBal = await this.hydro.balanceOf(this.account1.address);
    expect(afterBal.sub(beforeBal)).to.equal(
      ethers.BigNumber.from(this.amounts[50])
    );

    await this.airdrop.connect(this.account2).claimAll();
    expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
      ethers.BigNumber.from(this.amounts[51])
    );
  });

  it("is not able to claim bigger amount than available", async function () {
    await start(this.hydro, this.airdrop, this.account1.address);

    const initialBalance = ethers.BigNumber.from(this.amounts[51]);
    await expect(
      this.airdrop.connect(this.account2).claim(initialBalance.add(1))
    ).to.be.revertedWith("too big amount");

    await this.airdrop.connect(this.account2).claimAll();
    await expect(
      this.airdrop.connect(this.account2).claim(1)
    ).to.be.revertedWith("already claimed");
  });

  it("is not able to claim when not on whitelist", async function () {
    await start(this.hydro, this.airdrop, this.account1.address);

    await expect(
      this.airdrop.connect(this.account3).claim(1)
    ).to.be.revertedWith("no airdrop");
  });

  it("is not able to withdraw when not finished", async function () {
    await start(this.hydro, this.airdrop, this.account1.address);

    await ethers.provider.send("evm_increaseTime", [60 * 60]);

    await expect(
      this.airdrop.withdraw(this.account1.address)
    ).to.be.revertedWith("airdrop not ended");
  });

  it("is able to withdraw after time passed", async function () {
    await start(this.hydro, this.airdrop, this.account1.address);

    await this.hydro.setIsWalletLimitExempt(this.account3.address, true);

    await this.airdrop.connect(this.account2).claimAll();
    expect(await this.hydro.balanceOf(this.account2.address)).to.equal(
      ethers.BigNumber.from(this.amounts[51])
    );

    await ethers.provider.send("evm_increaseTime", [day + 1]);

    const airdropBalance = await this.hydro.balanceOf(this.airdrop.address);
    await this.airdrop.withdraw(this.account3.address);

    expect(await this.hydro.balanceOf(this.account3.address)).to.equal(
      airdropBalance
    );
  });

  describe("update", async function () {
    beforeEach(async function () {
      await start(this.hydro, this.airdrop, this.account1.address);
    });

    it("is not able to update when no enough tokens", async function () {
      await expect(
        this.airdrop.update(this.account3.address, 100000000)
      ).to.be.revertedWith("incorrect token balance");
    });

    it("is able to decrease token amount", async function () {
      const totalPending = await this.airdrop.totalPending();

      const initialAmount = ethers.BigNumber.from(this.amounts[51]);
      await this.airdrop.update(this.account2.address, 1);

      expect(await this.airdrop.totalPending()).to.equal(
        totalPending.sub(initialAmount.sub(1))
      );
    });

    it("is not able to update when smaller amount than claimed one", async function () {
      const initialAmount = ethers.BigNumber.from(this.amounts[51]);
      await this.airdrop.connect(this.account2).claim(initialAmount.div(2));

      await expect(
        this.airdrop.update(this.account2.address, 1)
      ).to.be.revertedWith("new amount cannot be smaller than claimed amount");
    });

    it("is able to increase update after previous claim", async function () {
      const totalPending = await this.airdrop.totalPending();

      const initialAmount = ethers.BigNumber.from(this.amounts[51]);
      await this.airdrop.connect(this.account2).claim(initialAmount.div(2));

      await this.airdrop.update(this.account2.address, initialAmount.add(1));

      expect(await this.airdrop.totalPending()).to.equal(
        totalPending.sub(initialAmount.div(2)).add(1)
      );
    });

    it("is able to decrease update after previous claim", async function () {
      const totalPending = await this.airdrop.totalPending();

      const initialAmount = ethers.BigNumber.from(this.amounts[51]);
      await this.airdrop.connect(this.account2).claim(initialAmount.div(2));

      await this.airdrop.update(this.account2.address, initialAmount.sub(1));

      expect(await this.airdrop.totalPending()).to.equal(
        totalPending.sub(initialAmount.div(2)).sub(1)
      );
    });
  });
});
