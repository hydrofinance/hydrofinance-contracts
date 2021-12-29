const { ethers, artifacts } = require("hardhat");

const FINN_ADDRESS = "0x9A92B5EBf1F6F6f7d93696FCD44e5Cf75035A756";
const RKITTY_ADDRESS = "0xC2b0435276139731d82Ae2Fa8928c9b9De0761c1";

// Huckle
const routerAddress = "0x2d4e873f9Ab279da9f1bb2c532d4F06f67755b77";

async function buyActions(context, _tokenBAdddress, _router) {
  const bAddress = _tokenBAdddress || context.tokenBAddress;
  const router = _router || context.router;

  const amount = ethers.BigNumber.from(10).pow(8);
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
  for (let i = 0; i < 4; i++) {
    const tokenAmount = await context.hydro.balanceOf(context.account3.address);
    await router
      .connect(context.account3)
      .swapExactTokensForTokensSupportingFeeOnTransferTokens(
        tokenAmount,
        0,
        [context.hydro.address, bAddress],
        context.account3.address,
        context.deadline
      );

    const tokenBAmount = await tokenB.balanceOf(context.account3.address);
    await router
      .connect(context.account3)
      .swapExactTokensForTokensSupportingFeeOnTransferTokens(
        tokenBAmount,
        0,
        [bAddress, context.hydro.address],
        context.account3.address,
        context.deadline
      );
  }
}

async function addLiquidity(context) {
  const ethBalance = await ethers.provider.getBalance(context.account1.address);
  await context.router.swapExactETHForTokens(
    0,
    [context.wethAddress, context.tokenBAddress],
    context.account1.address,
    context.deadline,
    {
      value: ethBalance.div(2),
    }
  );

  const tokenABal = (await context.hydro.balanceOf(context.account1.address))
    .mul(20)
    .div(100);
  const tokenBBal = await context.tokenB.balanceOf(context.account1.address);
  await context.hydro.approve(
    context.router.address,
    ethers.utils.parseUnits("1", 30)
  );
  await context.tokenB.approve(
    context.router.address,
    ethers.utils.parseUnits("1", 30)
  );

  await context.router.addLiquidity(
    context.hydro.address,
    context.tokenBAddress,
    tokenABal,
    tokenBBal,
    0,
    0,
    context.account1.address,
    context.deadline
  );
}

module.exports = {
  buyActions,
  addLiquidity,
  FINN_ADDRESS,
  RKITTY_ADDRESS,
  routerAddress,
};
