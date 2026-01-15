const {ethers, deployments} = require("hardhat")
const { expect } = require("chai");

/*  ======  工具函数  ======  */
// 链上当前时间（秒）
async function nowOnChain() {
    return (await ethers.provider.getBlock('latest')).timestamp;
  }
  
  // 等待链上时间到达某一刻
  async function waitUntilChain(timestamp) {
    while ((await nowOnChain()) < timestamp) {
      if (network.name === 'localhost' || network.name === 'hardhat') {
        await network.provider.send('evm_setNextBlockTimestamp', [timestamp]);
        await network.provider.send('evm_mine');
      } else {
        const sleepMs = Number(timestamp - (await nowOnChain())) * 1000 + 1000;
        await new Promise(r => setTimeout(r, sleepMs));
      }
    }
  }
  /*  ======================  */

describe("Test create AuctionContract", function () {
    // Sepolia 需要更长的超时
    this.timeout(120000);

    it("ETH Test start...", async function () {
        console.log("当前网络:", network.name);
        console.log("网络ID:", (await ethers.provider.getNetwork()).chainId);
        const all = await deployments.all();
        console.log("All deployed contracts:", Object.keys(all));
        const [owner, bidder1, bidder2] = await ethers.getSigners();

        /* ******  部署 NFT  ****** */
        console.log("......start NFT.......")
        // 问题：每次需要owner执行，所以不行
        // const nftDeployment = await deployments.get("Nft");
        // console.log("nft address..:", nftDeployment.address);
        // const auctionToken = await ethers.getContractAt("AuctionToken", nftDeployment.address);
        const auctionToken = await ethers.getContractFactory("AuctionToken");
        const auctionTokenInstance = await auctionToken.deploy();
        await auctionTokenInstance.waitForDeployment();
        const nftAddress = await auctionTokenInstance.getAddress();
        console.log("NFT deployed at...:", nftAddress);

        const tokenId = 1
        const tx =  await auctionTokenInstance.mint(owner.address, tokenId, 
           {
            gasLimit: 300000,  // 明确指定 gas limit
            gasPrice: (await ethers.provider.getFeeData()).gasPrice * 12n / 10n, 
          });
        const mintReceipt = await tx.wait();
        if (mintReceipt.status === 1) {
            console.log("✅ mint 成功，区块:", mintReceipt.blockNumber);
        } else {
        // status === 0 表示交易被 revert
            throw new Error("mint 失败，交易回滚");
        }
        console.log("Minted  NFTs tokenId:", tokenId);
        console.log("Minted 10 NFTs to owner:", owner.address);


        /* ******  拍卖合约  ****** */
        console.log("......start 拍卖合约......");
        const nftAuctionProxy = await deployments.get("NftAuctionProxy");
        console.log("...nftAuctionProxy address..:", nftAuctionProxy.address);
        console.log("拍卖合约, 部署交易hash...:", nftAuctionProxy.transactionHash);

        const nftAuctionInstance = await ethers.getContractAt("AuctionContract", nftAuctionProxy.address);
        console.log("nftAuctionProxy deployed at success...");
        await auctionTokenInstance.connect(owner).setApprovalForAll(nftAuctionProxy.address, true);

        // 链上当前时间（秒）不能使用本地时间
        const block = await ethers.provider.getBlock('latest');
        const now = block.timestamp;          // 已经是 BigInt
        const createAuctionTx = await nftAuctionInstance.connect(owner).createAuction(
            nftAddress,
            tokenId, 
            now, 
            60,
            1,
            ethers.ZeroAddress,
            //  ethers 帮你自动估算，限额更精准、价格更省，但可能在网络拥堵时排队稍久
            {
                gasLimit: 300000,  // 明确指定 gas limit
                gasPrice: (await ethers.provider.getFeeData()).gasPrice * 12n / 10n, // +20%
            }
        );
        const receipt = await createAuctionTx.wait();
        // console.log("✅ 拍卖创建完成，区块:", receipt.blockNumber, "状态:", receipt.status);
        if (receipt.status !== 1) throw new Error("创建拍卖失败");
        console.log("createAuction...完整 receipt：", JSON.stringify(receipt, null, 2));
        // 获取拍卖ID：找事件，从事件中获取
        const topic = nftAuctionInstance.interface.getEvent("AuctionCreated").topicHash;
        const log = receipt.logs.find(l => l.topics[0] === topic);
        const parsed = nftAuctionInstance.interface.parseLog(log);
        if (!log) throw new Error("AuctionCreated 事件未找到");

        const currentAuctionId = parsed.args.auctionId
        console.log("拍卖创建成功，auctionId:", currentAuctionId);

         // price feed
        console.log("......start Feed......")
        const TestERC20 = await ethers.getContractFactory("TestERC20");
        const testERC20 = await TestERC20.deploy();
        await testERC20.waitForDeployment();
        const UsdcAddress = await testERC20.getAddress();

        let txERC20 = await testERC20.connect(owner).transfer(bidder1, ethers.parseEther("1000"))
        await txERC20.wait()

        const aggreagatorV3 = await ethers.getContractFactory("AggregatorV3");
        const priceFeedEthDeploy = await aggreagatorV3.deploy(ethers.parseEther("10000"));
        const priceFeedEth = await priceFeedEthDeploy.waitForDeployment();
        const priceFeedEthAddress = await priceFeedEth.getAddress();
        console.log("ethFeed...", priceFeedEthAddress);   

         const priceFeedUSDCDeploy = await aggreagatorV3.deploy(ethers.parseEther("1"))
         const priceFeedUSDC = await priceFeedUSDCDeploy.waitForDeployment()
         const priceFeedUSDCAddress = await priceFeedUSDC.getAddress()
         console.log("usdcFeed...: ", priceFeedUSDCAddress) 
         const token2Usd = [
             {
                 token: ethers.ZeroAddress,
                 usdAddress: priceFeedEthAddress
             },
             {
                 token: UsdcAddress,
                 usdAddress: priceFeedEthAddress
             }
         ]
 
        //  问题：在执行setPriceFeed的时候  可能会出现偶先错误
         for (let index = 0; index < token2Usd.length; index++) {
             const { token, usdAddress }  = token2Usd[index];
             try {
                await nftAuctionInstance.setPriceFeed(token, usdAddress,           
                    {
                    gasLimit: 300000,  // 明确指定 gas limit
                    gasPrice: (await ethers.provider.getFeeData()).gasPrice * 12n / 10n, // +20%
                    });
              } catch (e) {
                console.log(e.reason ?? e.message);
              }
         } 
         console.log("......end Feed......")
        
         console.log("......start bid......")
         // 出价
        // ETH参与竞价
        const bidTx1 = await nftAuctionInstance.connect(bidder1).placeBid(currentAuctionId, ethers.parseEther("1.5"), ethers.ZeroAddress, 
            { value: ethers.parseEther("1.5"), 
              gasLimit: 300000, 
              gasPrice: (await ethers.provider.getFeeData()).gasPrice * 12n / 10n
            });
        const bidReceipt = await bidTx1.wait();
        if (bidReceipt.status !== 1) {
            console.log("ETH bid, 完整 receipt...：", JSON.stringify(bidReceipt, null, 2));
            throw new Error("创建拍卖失败");
        }

        // USDC参与竞价
        const approvetx = await testERC20.connect(bidder2).approve(nftAuctionProxy.address, ethers.MaxUint256)
        await approvetx.wait()
        const usdctx = await nftAuctionInstance.connect(bidder2).placeBid(currentAuctionId, ethers.parseEther("101"), UsdcAddress);
        await usdctx.wait()
        console.log("......end bid......")

        // // // 结束拍卖
        await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
        await nftAuctionInstance.connect(owner).endAuction(0);

        // 验证拍卖结果
        const auction = await nftAuctionInstance.auctions(0);
        expect(auction.ended).to.be.true;
        expect(auction.highestBid).to.equal(ethers.parseEther("1.5"));
        console.log("ETH Test end...");
    });
});