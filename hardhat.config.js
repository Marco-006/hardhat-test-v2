require("dotenv").config();   // 必须放在文件最开头
require("@nomicfoundation/hardhat-toolbox");
require("hardhat-deploy");   
require("@openzeppelin/hardhat-upgrades");
require("solidity-coverage");    
require("hardhat-tracer");


/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  networks: {
    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: [process.env.PRIVATE_KEY]
    },
    localhost: {
      url: "http://127.0.0.1:8545",   // 或 http://localhost:8545
      chainId: 31337,                 // hardhat node 默认
    }
  }
  
};
