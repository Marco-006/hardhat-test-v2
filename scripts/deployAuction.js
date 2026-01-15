const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const MyContract = await hre.ethers.getContractFactory("AuctionContract");
  const args = [];              // 构造函数参数，按需填
  const deployed = await MyContract.deploy(...args);

  
  await deployed.waitForDeployment();

  const address = await deployed.getAddress();
  console.log("Contract deployed to:", address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});