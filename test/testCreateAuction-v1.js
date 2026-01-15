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
    // 0. 首先确保网络连接正常
    try {
      const network = await ethers.provider.getNetwork();
      console.log("网络:", network.name, "链ID:", network.chainId);
    } catch (error) {
      console.error("网络连接失败:", error.message);
      throw error;
    }
    
    // 1. 获取 signers，确保至少有3个
    console.log("获取测试账户...");
    let signers;
    try {
      signers = await ethers.getSigners();
      console.log("成功获取", signers.length, "个账户");
    } catch (error) {
      console.error("获取账户失败:", error.message);
      
      // 如果在 Sepolia 上，可能需要配置账户
      if (network.name === 'sepolia') {
        console.log("在 Sepolia 上，检查环境变量...");
        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey) {
          throw new Error("请设置 PRIVATE_KEY 环境变量");
        }
        const wallet = new ethers.Wallet(privateKey, ethers.provider);
        signers = [wallet];
        console.log("使用环境变量私钥创建钱包");
      } else {
        throw error;
      }
    }
    
    // 如果账户不足3个，创建测试账户
    while (signers.length < 3) {
      console.log("账户不足，创建测试账户...");
      const newWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      signers.push(newWallet);
    }
    
    const [owner, bidder1, bidder2] = signers;
    console.log("Owner:", owner.address);
    console.log("Bidder1:", bidder1.address);
    console.log("Bidder2:", bidder2.address);

    // const [owner, bidder1, bidder2] = await ethers.getSigners();
    // console.log("Owner地址:", owner.address);
    // console.log("Bidder1地址:", bidder1?.address || "undefined");
    // console.log("Bidder2地址:", bidder2?.address || "undefined");
    // console.log("网络:", network.name, "链ID:", (await ethers.provider.getNetwork()).chainId);

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
    const auction = await ethers.getContractAt("AuctionContract", nftAuctionProxy.address);
    const approveTx = await auctionTokenInstance.connect(owner).setApprovalForAll(nftAuctionProxy.address, true);
    // 阻塞等待交易被区块链确认的方法
    await approveTx.wait(); // 等待授权交易确认

    // 验证授权是否成功
    const isApproved = await auctionTokenInstance.isApprovedForAll(owner.address, nftAuctionProxy.address);
    if (!isApproved) {
      throw new Error("NFT授权失败！");
    }


    // 时间：链上当前 + 5 秒（保证 > block.timestamp）
    const startTime = (await nowOnChain()) + BigInt(60);
    const duration  = BigInt(60);
    const endTime   = startTime + duration;   

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
    console.log("get address...");

    
    // 给 bidder1 和 bidder2 都 mint 足够的 USDC
    await usdc.connect(owner).transfer(bidder1.address, ethers.parseEther("1000000"));
    await usdc.connect(owner).transfer(bidder2.address, ethers.parseEther("1000000"));

    console.log("transfer...");
    // 设置 PriceFeed
    const Aggregator = await ethers.getContractFactory("AggregatorV3");
    // 1 ETH = 10,000 USD
    const ethFeed = await Aggregator.deploy(ethers.parseEther("10000"));
    // 1 USDC = 1 USD
    const usdFeed = await Aggregator.deploy(ethers.parseEther("1"));
    await auction.setPriceFeed(ethers.ZeroAddress, await ethFeed.getAddress());
    await auction.setPriceFeed(usdcAddress, await usdFeed.getAddress());
    console.log("PriceFeed...");

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