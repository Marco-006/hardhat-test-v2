// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8;

// interface 是 Solidity 的“纯函数签名类型”，零状态、零实现，专为跨合约解耦调用和标准化规范而生。
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract AggregatorV3 is AggregatorV3Interface{

   int256 answer;

   constructor(int256 _answer) {
        answer = _answer;
    }
    
    function decimals() external pure returns (uint8) {
        return 18;
    }

    function description() external pure returns (string memory) {
        return "a test price feeder";
    }

    function version() external pure returns (uint256) {
        return 0;
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, answer, 0, 0, 0);
    }

    function latestRoundData()
        public
        view
        returns (uint80, int256, uint256, uint256, uint80) 
    {
        return (0, answer, 0, 0, 0);
    }

    function setPrice(int256 _answer) public {
        answer = _answer;
    }

}