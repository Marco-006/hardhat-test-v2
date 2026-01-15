// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "hardhat/console.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";


// 去掉所有 upgradeable 相关的导入和继承
contract AuctionContract is Initializable, UUPSUpgradeable, ERC721Holder{

    // 拍卖状态枚举
    enum AuctionStatus {
        Pending,
        Active,
        Ended,
        Cancelled
    }

    struct Auction {
        address seller;
        uint256 duration;
        uint256 startPrice;
        uint256 startTime;
        address highestBidder;
        uint256 highestBid;
        address nftContract;
        uint256 tokenId;
        address currency;
        uint256 bidCount;
        AuctionStatus status;}

    mapping(uint256 => Auction) public auctions;
    uint256 public nextAuctionId ;  // 直接初始化

    // 管理员地址
    address public admin;
    
    mapping (address => AggregatorV3Interface) public priceFeeds;

    // 普通构造函数
    // constructor() Ownable() {
    //     // 初始化逻辑可以放在这里
    // }

    function initialize() public initializer {
        admin = msg.sender;
    }


    function _authorizeUpgrade(address) internal view override {
        // 只有管理员可以升级合约
        require(msg.sender == admin, "Only admin can upgrade");
    }
    // 事件定义（保持不变）
    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller, 
        address nftContract,
        uint256 tokenId,
        uint256 startPrice,
        uint256 startTime, 
        uint256 duration,
        address currency);
    
    event BidPlaced(
        uint256 indexed auctionId, 
        address indexed bidder, 
        uint256 amount, 
        address currency);
    event AuctionEnded(
        uint256 indexed auctionId, 
        address indexed winner, 
        uint256 amount);
    // createAuction 函数（保持不变，但去掉可升级相关的初始化）

	// 拍卖流程1： 创建拍卖
    function createAuction(
        address _nftContract,
        uint256 _tokenId,
        uint256 _startTime,
        uint256 _duration,
        uint256 _startPrice,
        address  currency
    ) public returns (uint256) {
        require(_startTime >= block.timestamp, "Start time must be in the future");
        require(_duration > 0, "Duration must be greater than zero");
        require(_startPrice > 0, "Start price must be greater than zero");
        IERC721 nft = IERC721(_nftContract);

        // 转移NFT到合约  每一个拍卖对应一个NFT，所以需要把NFT转移到拍卖合约中
        nft.safeTransferFrom(
            msg.sender,
            address(this),
            _tokenId
        );

        // 获取当前拍卖ID
        uint256 auctionId  =  nextAuctionId;

        auctions[auctionId] = Auction({
            seller: msg.sender,
            duration: _duration,
            startPrice: _startPrice,
            startTime: _startTime,
            highestBidder: address(0),
            highestBid: 0,
            nftContract: _nftContract,
            tokenId: _tokenId,
            currency: currency,
            bidCount: 0,
            status: _startTime > block.timestamp ? AuctionStatus.Pending : AuctionStatus.Active        });

        emit AuctionCreated(
            auctionId,
            msg.sender,
            _nftContract,
            _tokenId,
            _startPrice,
            _startTime,
            _duration,
            currency
        );

        nextAuctionId++;

        console.log("createAuction end...");
        return auctionId;
    }

    // 拍卖流程2： 出价: 判断有效性，退还之前最高出价者，接受新出价并将资金转移到合约
    // 必传参数 nft address, bid amount, 
    function placeBid(
        uint256 _auctionId,
        uint256 amount,
        address placeBidCurrency
    ) external payable {
        // 获取拍卖信息 
        Auction storage auction = auctions[_auctionId];
        require(
            block.timestamp <= auction.startTime + auction.duration,
            "Auction already ended"
        );
        
        // ✏️ 修改：去掉了直接比较 amount 和 auction.highestBid，因为金额单位不同
        
        // 新出价的 USD 价值
        uint256 payValue;
        if (placeBidCurrency == address(0)) {
            // ✏️ 修改：明确要求 msg.value 必须等于传入的 amount 参数
            require(msg.value == amount, "ETH amount mismatch");
            
            // ✏️ 修改：修正计算逻辑，包括除以精度
            payValue = amount * uint(getChainlinkDataFeedLatestAnswer(address(0))) / 1e18;
        } else {
            payValue = amount * uint(getChainlinkDataFeedLatestAnswer(placeBidCurrency)) / 1e18;
        }
        
        // 历史价格的 USD 价值
        uint256 startPriceValue;
        uint256 highestBidValue;
        
        if (auction.currency == address(0)) {
            // ✏️ 修改：同样修正计算逻辑，除以精度
            startPriceValue = auction.startPrice * 
                uint(getChainlinkDataFeedLatestAnswer(address(0))) / 1e18;
            highestBidValue = auction.highestBid * 
                uint(getChainlinkDataFeedLatestAnswer(address(0))) / 1e18;
        } else {
            startPriceValue = auction.startPrice * 
                uint(getChainlinkDataFeedLatestAnswer(auction.currency)) / 1e18;
            highestBidValue = auction.highestBid * 
                uint(getChainlinkDataFeedLatestAnswer(auction.currency)) / 1e18;
        }
        
        // ✏️ 修改：使用 USD 价值进行比较，而不是代币数量
        require(payValue >= startPriceValue, "Bid must be at least starting price");
        require(payValue > highestBidValue, "Bid must be higher than current highest bid");

        // 如果之前有出价，退还之前最高出价者的资金
        if (auction.highestBidder != address(0)) {
            // 以太币退款
            if (auction.currency == address(0)) {               
                (bool success, ) = payable(auction.highestBidder).call{value: auction.highestBid}("");
                require(success, "Refund transfer failed");
            } else {
                // ERC20退款
                // ✏️ 修改：使用 transfer 而不是 transferFrom，因为代币已经在合约中
                IERC20(auction.currency).transfer(
                    auction.highestBidder,
                    auction.highestBid
                );
            }
        }

        // 接受新的出价
        if (placeBidCurrency == address(0)) {
            // 以太币出价
            // ✏️ 修改：这里不需要额外操作，ETH 已通过 msg.value 发送
            // 之前：TODO ETH需要做什么接受吗？
        } else {
            // ERC20出价
            IERC20(placeBidCurrency).transferFrom(
                msg.sender,
                address(this),
                amount
            );
            uint256 currentAmount = IERC20(placeBidCurrency).balanceOf(address(this));
            console.log("placeBid currentAmount...", currentAmount);
        }

        // 更新拍卖状态
        auction.highestBidder = msg.sender;
        auction.highestBid = amount;
        auction.currency = placeBidCurrency;

        emit BidPlaced(_auctionId, msg.sender, amount, placeBidCurrency);
    }
    
    // 拍卖流程3：结束拍卖 : 转移NFT给最高出价者，转移资金：从合约到给卖家
    function endAuction(uint256 _auctionId) external {
        Auction storage auction = auctions[_auctionId];
        require(
            auction.status != AuctionStatus.Ended 
            && auction.status != AuctionStatus.Cancelled,
            "Auction status already ended" 
        );

        require(
            block.timestamp >= auction.startTime + auction.duration,
            "Auction time not yet ended"
        );

        // 转移NFT给最高出价者
        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            auction.highestBidder,
            auction.tokenId
        );

        // 转移资金给卖家
        if (auction.currency == address(0)) {   
            (bool success, ) = payable(auction.seller).call{value: auction.highestBid}("");
            require(success, "Transfer failed");
        } else {
            IERC20(auction.currency).transfer(
                auction.seller,
                auction.highestBid
            );
        }
        auction.status = AuctionStatus.Ended;

        emit AuctionEnded(
            _auctionId,
            auction.highestBidder,
            auction.highestBid);
    }

    function setPriceFeed(
        address tokenAddress,
        address _priceFeed
    ) public {
        priceFeeds[tokenAddress] = AggregatorV3Interface(_priceFeed);
    }

    /**
     * Returns the latest answer.
    */
  function getChainlinkDataFeedLatestAnswer(address tokenAddress) public view returns (int256) {
    AggregatorV3Interface priceFeed = priceFeeds[tokenAddress];
    // prettier-ignore
    (
      /* uint80 roundId */
      ,
      int256 answer,
      /*uint256 startedAt*/
      ,
      /*uint256 updatedAt*/
      ,
      /*uint80 answeredInRound*/
    ) = priceFeed.latestRoundData();
    
    return answer;
  }


    // 简化测试版合约
    function createAuctionSimple(
        address _nftContract,
        uint256 _tokenId,
        uint256 _startTime,
        uint256 _duration,
        uint256 _startPrice,
        address currency
    ) public returns (uint256) {
        require(_startTime >= block.timestamp, "Start time must be in the future");
        
        // 简化：不转移NFT，只记录和触发事件
        
        uint256 auctionId = nextAuctionId;
        
        // 只设置必要字段
        auctions[auctionId] = Auction({
            seller: msg.sender,
            duration: _duration,
            startPrice: _startPrice,
            startTime: _startTime,
            highestBidder: address(0),
            highestBid: 0,
            nftContract: _nftContract,
            tokenId: _tokenId,
            currency: currency,
            bidCount: 0,
            status: AuctionStatus.Pending        });
        
        nextAuctionId++;
        
        emit AuctionCreated(
            auctionId,
            msg.sender,
            _nftContract,
            _tokenId,
            _startPrice,
            _startTime,
            _duration,
            currency
        );
        
        return auctionId;
    }
}