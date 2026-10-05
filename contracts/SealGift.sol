// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IGiftBzb {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IFoundingPacks {
    function FORGE() external view returns (uint256);
    function orders(uint256) external view returns (address buyer, uint8 faction, uint64 openedAt, uint256 price);
}

/// @title Holds BzB for one Founding Forge pack per player.
/// @notice Send BzB here for the packs. Send POL here for gas; only the keeper can take the POL.
/// BzB leaves only as one pack's price, and only for a player who has never been marked.
/// The pack sale itself must be sent by the keeper, because the pack contract rejects contract buyers.
contract SealGift {
    IGiftBzb public immutable bzb;
    IFoundingPacks public immutable packs;
    address public immutable keeper;
    uint256 public immutable price;
    address public pending;
    uint256 private entered;

    mapping(address => bool) public claimed;
    mapping(uint256 => address) public owed;

    event Reserved(address indexed player);
    event Committed(address indexed player, uint256 indexed orderId);
    event Aborted(address indexed player);

    error Denied();
    error Bad();
    error Empty();
    error Busy();

    constructor(address bzb_, address packs_, address keeper_) {
        if (bzb_ == address(0) || packs_ == address(0) || keeper_ == address(0)) revert Bad();
        uint256 forge = IFoundingPacks(packs_).FORGE();
        if (forge == 0) revert Bad();
        bzb = IGiftBzb(bzb_);
        packs = IFoundingPacks(packs_);
        keeper = keeper_;
        price = forge;
    }

    /// @dev Moves exactly one pack price to the keeper and remembers the player. It does not mark them claimed yet.
    function begin(address player) external {
        if (msg.sender != keeper || entered == 1) revert Denied();
        if (player == address(0) || claimed[player] || pending != address(0)) revert Bad();
        if (bzb.balanceOf(address(this)) < price) revert Empty();
        entered = 1;
        pending = player;
        _send(keeper, price);
        emit Reserved(player);
        entered = 0;
    }

    /// @dev The keeper bought the Founding Forge pack. That player can never be reserved again.
    function commit(address player, uint256 orderId) external {
        if (msg.sender != keeper) revert Denied();
        if (pending != player || player == address(0) || claimed[player] || owed[orderId] != address(0)) revert Bad();
        (address buyer, uint8 faction, , uint256 paid) = packs.orders(orderId);
        if (buyer != keeper || faction != 0 || paid != price) revert Bad();
        pending = address(0);
        claimed[player] = true;
        owed[orderId] = player;
        emit Committed(player, orderId);
    }

    /// @dev Buy failed. The keeper pays the pack price back and the player stays unclaimed.
    function abort() external {
        if (msg.sender != keeper || entered == 1) revert Denied();
        address player = pending;
        if (player == address(0)) revert Bad();
        entered = 1;
        _pull(keeper, price);
        pending = address(0);
        emit Aborted(player);
        entered = 0;
    }

    /// @dev POL sent here can refill the keeper's gas. BzB cannot be withdrawn this way.
    function sweepPol() external {
        if (msg.sender != keeper) revert Denied();
        uint256 amount = address(this).balance;
        if (amount == 0) revert Empty();
        (bool ok, ) = keeper.call{value: amount}("");
        if (!ok) revert Bad();
    }

    receive() external payable {}

    function _send(address to, uint256 amount) internal {
        uint256 beforeBal = bzb.balanceOf(to);
        bool ok = bzb.transfer(to, amount);
        if (!ok || bzb.balanceOf(to) < beforeBal + amount) revert Empty();
    }

    function _pull(address from, uint256 amount) internal {
        uint256 beforeBal = bzb.balanceOf(address(this));
        bool ok = bzb.transferFrom(from, address(this), amount);
        if (!ok || bzb.balanceOf(address(this)) < beforeBal + amount) revert Empty();
    }
}
