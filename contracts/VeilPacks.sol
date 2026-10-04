// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ICards {
    function mint(address to, uint256 id, uint256 amount) external;
    function factionOf(uint256 id) external view returns (uint8);
    function rarityOf(uint256 id) external view returns (uint8);
}

interface IBzbPack {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title Founding packs. 10,000 packs, five cards each, 50,000 cards.
/// @notice Payment is taken before the roll. The roll uses the purchase block hash,
/// so the buyer cannot read the cards and then decide whether to pay.
/// Anyone may settle an order. There is no refund and no admin withdraw.
contract VeilPacks {
    ICards public immutable cards;
    IBzbPack public immutable bzb;
    address public immutable rewards;
    uint256 public constant FORGE = 1 ether;
    uint256 public constant SEAL = 1.25 ether;
    uint256 public constant MAX_PACKS = 10_000;
    uint256 public sold;
    uint256 public reserved;
    uint256 public nextOrder;
    uint256 private lock;

    struct Order {
        address buyer;
        uint8 faction;
        uint64 openedAt;
        uint256 price;
    }

    mapping(uint256 => Order) public orders;

    event Reserved(uint256 indexed orderId, address indexed buyer, uint8 faction);
    event Opened(uint256 indexed orderId, address indexed buyer, uint8 faction, uint256 id0, uint256 id1, uint256 id2, uint256 id3, uint256 id4);

    error Bad();
    error Busy();
    error Early();
    error SoldOut();

    constructor(address cards_, address bzb_, address rewards_) {
        if (cards_ == address(0) || bzb_ == address(0) || rewards_ == address(0)) revert Bad();
        cards = ICards(cards_);
        bzb = IBzbPack(bzb_);
        rewards = rewards_;
    }

    function remaining() external view returns (uint256) {
        uint256 used = sold + reserved;
        return used >= MAX_PACKS ? 0 : MAX_PACKS - used;
    }

    /// @param faction 0 any seal, 1 elf, 2 human, 3 goblin, 4 robot, 5 demon.
    function buy(uint8 faction) external {
        if (lock == 1) revert Busy();
        if (faction > 5 || msg.sender != tx.origin) revert Bad();
        if (sold + reserved >= MAX_PACKS) revert SoldOut();
        lock = 1;
        uint256 price = faction == 0 ? FORGE : SEAL;
        uint256 orderId = nextOrder;
        nextOrder = orderId + 1;
        reserved += 1;
        orders[orderId] = Order(msg.sender, faction, uint64(block.number), price);
        _pull(msg.sender, price);
        emit Reserved(orderId, msg.sender, faction);
        lock = 0;
    }

    /// @dev Callable by anyone once the purchase block has a hash. Mints to the buyer.
    function settle(uint256 orderId) external {
        Order memory order = orders[orderId];
        if (order.buyer == address(0)) revert Bad();
        if (lock == 1) revert Busy();
        if (block.number <= order.openedAt) revert Early();
        bytes32 mix = blockhash(order.openedAt);
        if (mix == bytes32(0)) {
            if (block.number <= order.openedAt + 256) revert Early();
            mix = keccak256(abi.encode("VEIL.LATE", orderId, order.buyer, order.faction));
        }
        lock = 1;
        delete orders[orderId];
        reserved -= 1;
        sold += 1;
        _send(rewards, order.price);
        uint256 rand = uint256(keccak256(abi.encode(mix, order.buyer, orderId, order.faction)));
        uint256[5] memory ids;
        for (uint256 i = 0; i < 5; i++) {
            ids[i] = _pick(rand, i, order.faction, _rarity(rand, i));
            cards.mint(order.buyer, ids[i], 1);
        }
        emit Opened(orderId, order.buyer, order.faction, ids[0], ids[1], ids[2], ids[3], ids[4]);
        lock = 0;
    }

    function _rarity(uint256 rand, uint256 i) internal pure returns (uint8) {
        uint256 n = uint256(keccak256(abi.encode(rand, i, uint256(1)))) % 100;
        if (n < 13) return 3;
        if (n < 38) return 2;
        return 1;
    }

    function _pick(uint256 rand, uint256 salt, uint8 faction, uint8 rarity) internal view returns (uint256) {
        uint256 count;
        uint256 chosen;
        for (uint256 id = 1; id <= 45; id++) {
            if (faction != 0 && cards.factionOf(id) != faction) continue;
            if (cards.rarityOf(id) != rarity) continue;
            count += 1;
            if (uint256(keccak256(abi.encode(rand, salt, id))) % count == 0) chosen = id;
        }
        if (count == 0) {
            if (rarity == 1) revert Bad();
            return _pick(rand, salt + 17, faction, 1);
        }
        return chosen;
    }

    function _pull(address from, uint256 amount) internal {
        uint256 beforeBal = bzb.balanceOf(address(this));
        bool ok = bzb.transferFrom(from, address(this), amount);
        if (!ok || bzb.balanceOf(address(this)) < beforeBal + amount) revert Bad();
    }

    function _send(address to, uint256 amount) internal {
        uint256 beforeBal = bzb.balanceOf(to);
        bool ok = bzb.transfer(to, amount);
        if (!ok || bzb.balanceOf(to) < beforeBal + amount) revert Bad();
    }

    receive() external payable {
        revert Bad();
    }
}
