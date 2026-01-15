const {ethers, deployments} = require("hardhat")
const { expect } = require("chai");
/*  ======================  工具函数  ======================  */
// 链上当前时间（秒）
async function nowOnChain() {
  const block = await ethers.provider.getBlock('latest');
  return BigInt(block.timestamp);   // 保证永远返回 BigInt
  // return (await ethers.provider.getBlock('latest')).timestamp;
}

// 等待链上时间到达某一刻
async function waitUntilChain(timestamp) {
  while ((await nowOnChain()) < timestamp) {
    if (network.name === 'localhost' || network.name === 'hardhat') {
      await network.provider.send('evm_setNextBlockTimestamp', [timestamp.toString()]);
      await network.provider.send('evm_mine');
    } else {
      const sleepMs = Number(timestamp - (await nowOnChain())) * 1000 + 1000;
      await new Promise(r => setTimeout(r, sleepMs));
    }
  }
}
/*  =========================================================  */

describe("Test create AuctionContract", function () {
  this.timeout(120_000);

  it("ETH Test start...", async function () {
    const [owner, bidder1, bidder2] = await ethers.getSigners();
    console.log("网络:", network.name, "链ID:", (await ethers.provider.getNetwork()).chainId);

    /* ------  1. 部署 NFT ------ */
    const auctionToken = await ethers.getContractFactory("AuctionToken");
    const auctionTokenInstance = await auctionToken.deploy();
    await auctionTokenInstance.waitForDeployment();
    const nftAddress = await auctionTokenInstance.getAddress();

    const tokenId = 1;
    const mintTx = await auctionTokenInstance.mint(owner.address, tokenId);
    if ((await mintTx.wait()).status !== 1) throw new Error("mint失败");
    console.log("✅ NFT deployed & minted", nftAddress, "tokenId", tokenId);

    /* ------  2. 拍卖合约 ------ */
    const nftAuctionProxy = await deployments.get("NftAuctionProxy");
    console.log("approve 时用的地址 =", nftAuctionProxy.address);
    const auction = await ethers.getContractAt("AuctionContract", nftAuctionProxy.address);
    const approveTx = await auctionTokenInstance.connect(owner).setApprovalForAll(nftAuctionProxy.address, true);
    // 阻塞等待交易被区块链确认的方法
    await approveTx.wait(); // 等待授权交易确认

    // 验证授权是否成功
    const isApproved = await auctionTokenInstance.isApprovedForAll(owner.address, nftAuctionProxy.address);
    console.log("授权成功了吗？", isApproved);
    if (!isApproved) {
      throw new Error("NFT授权失败！");
    }


    // 时间：链上当前 + 5 秒（保证 > block.timestamp）
    const startTime = (await nowOnChain()) + BigInt(60);
    const duration  = BigInt(60);
    const endTime   = startTime + duration;


    console.log("ownerOf(1) =", await auctionTokenInstance.ownerOf(1));
    console.log("seller     =", owner.address);
    console.log("same?      =", (await auctionTokenInstance.ownerOf(1)) === owner.address);
    

    // 创建拍卖，起拍价 0.1 ETH
    // const createTx = await auction.connect(owner).createAuction(
    //   nftAddress, tokenId, startTime, duration, ethers.parseEther("0.1"), ethers.ZeroAddress
    // );
    // const receipt  = await createTx.wait();
    // const topic    = auction.interface.getEvent("AuctionCreated").topicHash;
    // const log      = receipt.logs.find(l => l.topics[0] === topic);
    // if (!log) throw new Error("AuctionCreated事件未找到");
    // const auctionId = auction.interface.parseLog(log).args.auctionId;
    // console.log("✅ 拍卖创建成功 auctionId...:", auctionId);

    /* ------  检测授权 ------ */
    const proxyAddr = nftAuctionProxy.address;
    console.log("proxy address        =", proxyAddr);
    // 返回“单 Token 授权”地址
    console.log("getApproved(1)       =", await auctionTokenInstance.getApproved(1));
    // 返回“全库授权”布尔值（调用过 setApprovalForAll(proxy, true) 的地址）
    console.log("isApprovedForAll(seller,proxy) =",
                await auctionTokenInstance.isApprovedForAll(owner.address, proxyAddr));

    console.log("查询时用的地址     =", proxyAddr);
    console.log("两次地址相同？     =", nftAuctionProxy.address === proxyAddr);            


    let auctionId;
    try {
      const createTx = await auction.connect(owner).createAuction(
        nftAddress, tokenId, startTime, duration, ethers.parseEther("0.1"), ethers.ZeroAddress
      );
      const receipt  = await createTx.wait();
      const topic    = auction.interface.getEvent("AuctionCreated").topicHash;
      const log      = receipt.logs.find(l => l.topics[0] === topic);
      if (!log) throw new Error("AuctionCreated事件未找到");
      auctionId = auction.interface.parseLog(log).args.auctionId;
      console.log("✅ 拍卖创建成功 auctionId...:", auctionId);
    } catch (err) {
      console.log("createAuction revert reason:",
                  err.reason ?? err.message ?? err);
      throw err;        // 继续让测试失败
    }

    /* ------  3. PriceFeed 和 ERC20 ------ */
    const TestERC20 = await ethers.getContractFactory("TestERC20");
    const usdc = await TestERC20.deploy();
    await usdc.waitForDeployment();
    const usdcAddress = await usdc.getAddress();
    
    // 给 bidder1 和 bidder2 都 mint 足够的 USDC
    await usdc.connect(owner).transfer(bidder1.address, ethers.parseEther("1000000"));
    await usdc.connect(owner).transfer(bidder2.address, ethers.parseEther("1000000"));

    // 设置 PriceFeed
    const Aggregator = await ethers.getContractFactory("AggregatorV3");
    // 1 ETH = 10,000 USD
    const ethFeed = await Aggregator.deploy(ethers.parseEther("10000"));
    // 1 USDC = 1 USD
    const usdFeed = await Aggregator.deploy(ethers.parseEther("1"));
    await auction.setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress());
    await auction.setPriceFeed(usdcAddress, await usdFeed.getAddress());

    /* ------  4. 出价 ------ */
    console.log("开始出价...");
    
    // 第一个出价：bidder1 用 ETH 出价
    // 他想出价 1.5 ETH，这相当于 1.5 * 10000 = 15,000 USD
    console.log("ETH 出价: 1.5 ETH (相当于 15,000 USD)");
    await auction.connect(bidder1).placeBid(
      auctionId, 
      ethers.parseEther("1.5"),  // 参数 amount 会被忽略（ETH 出价时）
      ethers.ZeroAddress, 
      { value: ethers.parseEther("1.5") }
    );

    // 第二个出价：bidder2 用 USDC 出价
    // 他想出价超过 15,000 USD，所以出价 20,000 USDC
    await usdc.connect(bidder2).approve(nftAuctionProxy.address, ethers.MaxUint256);
    console.log("USDC 出价: 20,000 USDC");
    await auction.connect(bidder2).placeBid(
      auctionId, 
      ethers.parseEther("20000"),  // 20000 USDC
      usdcAddress
    );

    /* ------  5. 等待结束 & 收尾 ------ */
    await waitUntilChain(endTime);

    const aucBeforeEnd = await auction.auctions(auctionId);
    // console.log("assert auc...",aucBeforeEnd);
    console.log("assert auc status...",aucBeforeEnd.status);

    console.log("拍卖结束，执行清算...");
    const endTx = await auction.connect(owner).endAuction(auctionId);
    await endTx.wait();

    /* ------  6. 断言 ------ */
    const auc = await auction.auctions(auctionId);
    // console.log("assert auc...",auc);
    console.log("assert auc status...",auc.status);
    expect(auc.highestBid).to.equal(ethers.parseEther("20000"));  // USDC 胜出
    console.log("🎉 测试通过！");
    console.log("获胜者:", auc.highestBidder);
    console.log("获胜出价:", ethers.formatEther(auc.highestBid), "USDC");
    console.log("获胜金额（USD）:", 20000);
  });
});