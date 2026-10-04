// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ICardMarket {
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

interface IBzbMarket {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title Escrow listings. A card sits here until someone pays BzB or the seller cancels.
contract VeilMarket {
    struct Lot {
        address seller;
        uint256 id;
        uint256 price;
        bool live;
    }

    ICardMarket public immutable cards;
    IBzbMarket public immutable bzb;
    Lot[] public lots;
    uint256 private lock;

    event Listed(uint256 indexed lotId, address indexed seller, uint256 id, uint256 price);
    event Sold(uint256 indexed lotId, address indexed buyer);
    event Cancelled(uint256 indexed lotId);

    error Bad();
    error Busy();

    constructor(address cards_, address bzb_) {
        if (cards_ == address(0) || bzb_ == address(0)) revert Bad();
        cards = ICardMarket(cards_);
        bzb = IBzbMarket(bzb_);
    }

    function length() external view returns (uint256) {
        return lots.length;
    }

    function list(uint256 id, uint256 price) external {
        if (lock == 1 || price == 0) revert Bad();
        lock = 1;
        cards.safeTransferFrom(msg.sender, address(this), id, 1, "");
        lots.push(Lot(msg.sender, id, price, true));
        emit Listed(lots.length - 1, msg.sender, id, price);
        lock = 0;
    }

    function buy(uint256 lotId) external {
        if (lock == 1 || lotId >= lots.length) revert Bad();
        Lot storage lot = lots[lotId];
        if (!lot.live || lot.seller == msg.sender) revert Bad();
        lock = 1;
        lot.live = false;
        _pay(msg.sender, lot.seller, lot.price);
        cards.safeTransferFrom(address(this), msg.sender, lot.id, 1, "");
        emit Sold(lotId, msg.sender);
        lock = 0;
    }

    function cancel(uint256 lotId) external {
        if (lock == 1 || lotId >= lots.length) revert Bad();
        Lot storage lot = lots[lotId];
        if (!lot.live || lot.seller != msg.sender) revert Bad();
        lock = 1;
        lot.live = false;
        cards.safeTransferFrom(address(this), lot.seller, lot.id, 1, "");
        emit Cancelled(lotId);
        lock = 0;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(cards)) revert Bad();
        return this.onERC1155Received.selector;
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
