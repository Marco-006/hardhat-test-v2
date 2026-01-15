// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AuctionToken is ERC721Enumerable, Ownable {
    string private _tokenURI;

    constructor() 
        ERC721("MyFirstNFT", "MFN") 
        Ownable(msg.sender) {}

    function mint(address to, uint256 tokenId) external onlyOwner {
        _mint(to, tokenId);
    }

    // function _baseURI() internal view override returns (string memory) {
    //     return _baseTokenURI;
    // }

    // function setBaseURI(string memory baseURI) external onlyOwner {
    //     _baseTokenURI = baseURI;
    // }

    
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        return _tokenURI;
    }

    function setTokenURI(string memory newTokenURI) external onlyOwner {
        _tokenURI = newTokenURI;
    }

}