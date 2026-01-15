const {ethers, deployments} = require("hardhat")
const { expect } = require("chai");


describe("Test deploy NFT", function () {

    it("ETH Test start...", async function () {
        const [owner, bidder1, bidder2] = await ethers.getSigners();

        // 部署ERC721 NFT 合约
        const auctionToken = await ethers.getContractFactory("AuctionToken");
        const auctionTokenInstance = await auctionToken.deploy();
        auctionTokenInstance.waitForDeployment();
        const erc721Address = await auctionTokenInstance.getAddress();
        console.log("NFT deployed at:", erc721Address);

        // 挖矿铸造NFT
        // for (let index = 0; index < 10; index++) {
        //     auctionTokenInstance.mint(owner.address, index);            
        // }
        const tokenId = 1;
        auctionTokenInstance.mint(owner.address, tokenId);  
        console.log("Minted NFTs token id:", tokenId);  
        console.log("Minted NFTs to owner:", owner.address);

        
    });
});