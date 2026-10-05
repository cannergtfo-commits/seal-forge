// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Seal Forge match backdrops.
/// @notice Buyers pay POL straight to that drop's treasury. This contract keeps none of it.
/// The first drop is fixed here: 2,000 editions at 10 POL. Its price, cap, and treasury cannot change.
/// Later drops can be added only by the treasury, and each one is fixed at creation.
contract SealStages {
    string public constant name = "Seal Forge Stage";
    string public constant symbol = "STAGE";
    address public constant treasury = 0x11489040837F585C067C60037eF17e9E1C4B7d81;

    uint256 public nextDrop = 1;
    uint256 public nextId;
    uint256 private entered;

    struct Drop {
        uint256 price;
        uint256 cap;
        uint256 sold;
        address payable payee;
        string uri;
    }

    mapping(uint256 => Drop) private drops;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => uint256) public dropOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => mapping(address => uint256)) public held;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed approved, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event DropAdded(uint256 indexed dropId, uint256 price, uint256 cap, address payee);
    event Minted(uint256 indexed dropId, address indexed buyer, uint256 indexed id);

    error Denied();
    error Bad();
    error Busy();
    error SoldOut();

    constructor() {
        _add(10 ether, 2_000, payable(treasury), "https://play.blazarforce.net/meta/stage/1.json");
    }

    function owner() external pure returns (address) {
        return treasury;
    }

    function drop(uint256 dropId) external view returns (uint256 price, uint256 cap, uint256 sold, address payee, string memory uri) {
        Drop storage row = drops[dropId];
        return (row.price, row.cap, row.sold, row.payee, row.uri);
    }

    function owns(address account, uint256 dropId) external view returns (bool) {
        return account != address(0) && held[dropId][account] > 0;
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        if (ownerOf[id] == address(0)) revert Bad();
        return drops[dropOf[id]].uri;
    }

    /// @dev Price, cap, and payee are stored once and never written again.
    function addDrop(uint256 price, uint256 cap, address payable payee, string calldata uri) external returns (uint256 dropId) {
        if (msg.sender != treasury) revert Denied();
        dropId = _add(price, cap, payee, uri);
    }

    function mint(uint256 dropId) external payable {
        if (entered == 1) revert Busy();
        Drop storage row = drops[dropId];
        if (row.cap == 0 || msg.value != row.price) revert Bad();
        if (row.sold >= row.cap) revert SoldOut();
        entered = 1;
        row.sold += 1;
        uint256 id = nextId + 1;
        nextId = id;
        ownerOf[id] = msg.sender;
        dropOf[id] = dropId;
        balanceOf[msg.sender] += 1;
        held[dropId][msg.sender] += 1;
        emit Transfer(address(0), msg.sender, id);
        emit Minted(dropId, msg.sender, id);
        (bool paid,) = row.payee.call{value: msg.value}("");
        if (!paid) revert Bad();
        _received(msg.sender, address(0), id, "");
        entered = 0;
    }

    function approve(address approved, uint256 id) external {
        address holder = ownerOf[id];
        if (holder == address(0)) revert Bad();
        if (holder != msg.sender && !isApprovedForAll[holder][msg.sender]) revert Denied();
        getApproved[id] = approved;
        emit Approval(holder, approved, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == msg.sender) revert Bad();
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        _move(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        _move(from, to, id);
        _received(to, from, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external {
        _move(from, to, id);
        _received(to, from, id, data);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f;
    }

    receive() external payable {
        revert Bad();
    }

    function _add(uint256 price, uint256 cap, address payable payee, string memory uri) internal returns (uint256 dropId) {
        if (price == 0 || cap == 0 || cap > 1_000_000 || payee == address(0)) revert Bad();
        if (!_https(bytes(uri))) revert Bad();
        dropId = nextDrop;
        nextDrop = dropId + 1;
        drops[dropId] = Drop(price, cap, 0, payee, uri);
        emit DropAdded(dropId, price, cap, payee);
    }

    function _move(address from, address to, uint256 id) internal {
        if (entered == 1) revert Busy();
        if (to == address(0) || from == address(0) || ownerOf[id] != from) revert Bad();
        if (from != msg.sender && getApproved[id] != msg.sender && !isApprovedForAll[from][msg.sender]) revert Denied();
        entered = 1;
        ownerOf[id] = to;
        balanceOf[from] -= 1;
        balanceOf[to] += 1;
        uint256 dropId = dropOf[id];
        held[dropId][from] -= 1;
        held[dropId][to] += 1;
        delete getApproved[id];
        emit Transfer(from, to, id);
        entered = 0;
    }

    function _received(address to, address from, uint256 id, bytes memory data) internal {
        if (to.code.length == 0) return;
        (bool ok, bytes memory ret) = to.call(abi.encodeWithSelector(bytes4(0x150b7a02), msg.sender, from, id, data));
        if (!ok || ret.length < 32 || bytes4(ret) != bytes4(0x150b7a02)) revert Bad();
    }

    function _https(bytes memory raw) internal pure returns (bool) {
        if (raw.length < 12 || raw.length > 200) return false;
        return raw[0] == "h" && raw[1] == "t" && raw[2] == "t" && raw[3] == "p" && raw[4] == "s" && raw[5] == ":" && raw[6] == "/" && raw[7] == "/";
    }
}
