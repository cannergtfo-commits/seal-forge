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

/// @title Riven Veil packs. 2,000 packs, five cards each, 10,000 cards.
/// @notice Four basic cards and one rare or legendary. Unbound cards can appear in every seal.
/// Payment is taken before the roll. The roll uses the purchase block hash.
contract VeilRivenPacks {
    ICards public immutable cards;
    IBzbPack public immutable bzb;
    address public immutable rewards;
    uint256 public immutable cardCount;
    uint256 public constant PRICE = 15 ether;
    uint256 public constant MAX_PACKS = 2_000;
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

    constructor(address cards_, address bzb_, address rewards_, uint256 cardCount_) {
        if (cards_ == address(0) || bzb_ == address(0) || rewards_ == address(0) || cardCount_ == 0 || cardCount_ > 200) revert Bad();
        cards = ICards(cards_);
        bzb = IBzbPack(bzb_);
        rewards = rewards_;
        cardCount = cardCount_;
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
        uint256 orderId = nextOrder;
        nextOrder = orderId + 1;
        reserved += 1;
        orders[orderId] = Order(msg.sender, faction, uint64(block.number), PRICE);
        _pull(msg.sender, PRICE);
        emit Reserved(orderId, msg.sender, faction);
        lock = 0;
    }

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
            uint8 rarity = i == 4 ? _premium(rand) : 1;
            ids[i] = _pick(rand, i, order.faction, rarity);
            cards.mint(order.buyer, ids[i], 1);
        }
        emit Opened(orderId, order.buyer, order.faction, ids[0], ids[1], ids[2], ids[3], ids[4]);
        lock = 0;
    }

    function _premium(uint256 rand) internal pure returns (uint8) {
        uint256 n = uint256(keccak256(abi.encode(rand, uint256(4)))) % 100;
        return n < 18 ? 3 : 2;
    }

    function _fits(uint256 id, uint8 faction) internal view returns (bool) {
        if (faction == 0) return true;
        uint8 seal = cards.factionOf(id);
        return seal == faction || seal == 6;
    }

    function _pick(uint256 rand, uint256 salt, uint8 faction, uint8 rarity) internal view returns (uint256) {
        uint256 count;
        uint256 chosen;
        for (uint256 id = 1; id <= cardCount; id++) {
            if (!_fits(id, faction)) continue;
            if (cards.rarityOf(id) != rarity) continue;
            count += 1;
            if (uint256(keccak256(abi.encode(rand, salt, id))) % count == 0) chosen = id;
        }
        if (count == 0) {
            if (rarity == 1) revert Bad();
            return _pick(rand, salt + 17, faction, rarity == 3 ? 2 : 1);
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
