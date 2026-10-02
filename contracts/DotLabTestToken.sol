// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet-only fixed-supply ERC20. This is not a Pons market or a mainnet token.
contract DotLabTestToken is ERC20 {
    address public creator;
    string public description;
    string public logo;
    string public website;
    string public dot;
    event DotLabTestLaunch(address indexed creator, string name, string symbol, string description, string logo, string website, string dot);

    constructor(string memory name_, string memory symbol_, string memory description_, string memory logo_, string memory website_, string memory dot_) ERC20(name_, symbol_) {
        require(block.chainid == 46630, "Robinhood testnet only");
        require(bytes(name_).length > 0 && bytes(name_).length <= 128, "Invalid name");
        require(bytes(symbol_).length >= 2 && bytes(symbol_).length <= 10, "Invalid ticker");
        for (uint256 i; i < bytes(symbol_).length; ++i) {
            bytes1 c = bytes(symbol_)[i];
            require((c >= 0x41 && c <= 0x5a) || (i > 0 && c >= 0x30 && c <= 0x39), "Invalid ticker");
        }
        require(bytes(description_).length > 0 && bytes(description_).length <= 2000, "Invalid description");
        require(bytes(logo_).length <= 2048 && bytes(website_).length <= 800, "Invalid URL length");
        bytes32 d = keccak256(bytes(dot_));
        require(d == keccak256("green") || d == keccak256("blue") || d == keccak256("yellow") || d == keccak256("pink"), "Invalid Dot");
        creator = msg.sender;
        description = description_;
        logo = logo_;
        website = website_;
        dot = dot_;
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals());
        emit DotLabTestLaunch(msg.sender, name_, symbol_, description_, logo_, website_, dot_);
    }
}
