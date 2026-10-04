// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ICardBazaar {
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

interface IBzbBazaar {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Escrow for Blazar, Kage, and Riven. One card sits here until someone pays BzB or the seller cancels.
/// @notice Founding cards stay on VeilMarket. This stall cannot be pointed at any other collection.
contract VeilBazaar {
    struct Lot {
        address seller;
        address collection;
        uint256 id;
        uint256 price;
        bool live;
    }

    address public immutable blazar;
    address public immutable kage;
    address public immutable riven;
    IBzbBazaar public immutable bzb;
    Lot[] public lots;

    uint256 private lock;
    uint256 private open;
    address private pullFrom;
    uint256 private pullId;

    event Listed(uint256 indexed lotId, address indexed seller, address collection, uint256 id, uint256 price);
    event Sold(uint256 indexed lotId, address indexed buyer);
    event Cancelled(uint256 indexed lotId);

    error Bad();

    constructor(address blazar_, address kage_, address riven_, address bzb_) {
        if (blazar_ == address(0) || kage_ == address(0) || riven_ == address(0) || bzb_ == address(0)) revert Bad();
        if (blazar_ == kage_ || blazar_ == riven_ || kage_ == riven_) revert Bad();
        if (bzb_ == blazar_ || bzb_ == kage_ || bzb_ == riven_) revert Bad();
        blazar = blazar_;
        kage = kage_;
        riven = riven_;
        bzb = IBzbBazaar(bzb_);
    }

    function length() external view returns (uint256) {
        return lots.length;
    }

    function allowed(address collection) public view returns (bool) {
        return collection == blazar || collection == kage || collection == riven;
    }

    function list(address collection, uint256 id, uint256 price) external {
        if (lock == 1 || price == 0 || !allowed(collection)) revert Bad();
        lock = 1;
        _pull(collection, msg.sender, id);
        lots.push(Lot(msg.sender, collection, id, price, true));
        emit Listed(lots.length - 1, msg.sender, collection, id, price);
        lock = 0;
    }

    function buy(uint256 lotId) external {
        if (lock == 1 || lotId >= lots.length) revert Bad();
        Lot storage lot = lots[lotId];
        address seller = lot.seller;
        address collection = lot.collection;
        uint256 id = lot.id;
        uint256 price = lot.price;
        if (!lot.live || seller == msg.sender || !allowed(collection)) revert Bad();
        lock = 1;
        lot.live = false;
        _pay(msg.sender, seller, price);
        _push(collection, msg.sender, id);
        emit Sold(lotId, msg.sender);
        lock = 0;
    }

    function cancel(uint256 lotId) external {
        if (lock == 1 || lotId >= lots.length) revert Bad();
        Lot storage lot = lots[lotId];
        address seller = lot.seller;
        address collection = lot.collection;
        uint256 id = lot.id;
        if (!lot.live || seller != msg.sender || !allowed(collection)) revert Bad();
        lock = 1;
        lot.live = false;
        _push(collection, seller, id);
        emit Cancelled(lotId);
        lock = 0;
    }

    /// @dev Only the card list() is pulling is accepted. A buy, a cancel, or a direct send reverts, so nothing can be pushed back in and stuck.
    function onERC1155Received(address operator, address from, uint256 id, uint256 amount, bytes calldata) external view returns (bytes4) {
        if (open != 1 || operator != address(this) || amount != 1 || !allowed(msg.sender)) revert Bad();
        if (from != pullFrom || id != pullId) revert Bad();
        return this.onERC1155Received.selector;
    }

    function _pull(address collection, address from, uint256 id) internal {
        uint256 beforeBal = ICardBazaar(collection).balanceOf(address(this), id);
        open = 1;
        pullFrom = from;
        pullId = id;
        ICardBazaar(collection).safeTransferFrom(from, address(this), id, 1, "");
        open = 0;
        pullFrom = address(0);
        pullId = 0;
        if (ICardBazaar(collection).balanceOf(address(this), id) != beforeBal + 1) revert Bad();
    }

    function _push(address collection, address to, uint256 id) internal {
        uint256 beforeBal = ICardBazaar(collection).balanceOf(address(this), id);
        if (beforeBal == 0 || to == address(0)) revert Bad();
        ICardBazaar(collection).safeTransferFrom(address(this), to, id, 1, "");
        if (ICardBazaar(collection).balanceOf(address(this), id) != beforeBal - 1) revert Bad();
    }

    function _pay(address from, address to, uint256 amount) internal {
        uint256 beforeBal = bzb.balanceOf(to);
        bool ok = bzb.transferFrom(from, to, amount);
        if (!ok) revert Bad();
        if (bzb.balanceOf(to) < beforeBal + amount) revert Bad();
    }

    receive() external payable {
        revert Bad();
    }
}
