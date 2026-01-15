const { deployments, upgrades, ethers } = require("hardhat");

const fs = require("fs");
const path = require("path");

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { save } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("......start erc20......");
  const nftContractFactory = await ethers.getContractFactory("TestERC20");
  const args = [];              // 构造函数参数，按需填
  const deployed = await nftContractFactory.deploy(...args);
  await deployed.waitForDeployment();

  const address = await deployed.getAddress();
  console.log("Contract deployed to:", address);

  
  const storePath = path.resolve(__dirname, "./.cache/Nft.json");

  
  fs.writeFileSync(
    storePath,
    JSON.stringify({
      address,
      abi: nftContractFactory.interface.format("json"),
    })
  );

  await save("erc20", {
    abi: nftContractFactory.interface.format("json"),
    address: address,
  })
};

module.exports.tags = ["deployERC20"];
