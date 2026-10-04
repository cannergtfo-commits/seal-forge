// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Veilforge card editions. URIs and image hashes lock forever at freeze.
/// @notice No admin can change a bound image. Minting is only the pack contract.
contract VeilCards {
    string public constant name = "Veilforge";
    string public constant symbol = "VEIL";

    address public owner;
    address public minter;
    bool public frozen;

    mapping(address => mapping(uint256 => uint256)) private _bal;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => string) private _uri;
    mapping(uint256 => bytes32) public imageOf;
    mapping(uint256 => uint8) public factionOf;
    mapping(uint256 => uint8) public rarityOf;
    mapping(uint256 => bool) public bound;

    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
    event Frozen();

    error Denied();
    error Locked();
    error Bad();

    constructor() {
        owner = msg.sender;
    }

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return _bal[account][id];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) external view returns (uint256[] memory out) {
        if (accounts.length != ids.length) revert Bad();
        out = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) out[i] = _bal[accounts[i]][ids[i]];
    }

    function uri(uint256 id) external view returns (string memory) {
        return _uri[id];
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == msg.sender) revert Bad();
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function seal(uint256 id, uint8 faction, uint8 rarity, bytes32 imageHash, string calldata tokenUri) external {
        if (msg.sender != owner || frozen) revert Denied();
        if (id == 0 || id > 45 || bound[id] || faction == 0 || faction > 5 || rarity == 0 || rarity > 3) revert Bad();
        if (imageHash == bytes32(0) || bytes(tokenUri).length < 40) revert Bad();
        bound[id] = true;
        factionOf[id] = faction;
        rarityOf[id] = rarity;
        imageOf[id] = imageHash;
        _uri[id] = tokenUri;
        emit URI(tokenUri, id);
    }

    function setMinter(address next) external {
        if (msg.sender != owner || frozen || minter != address(0) || next == address(0)) revert Denied();
        minter = next;
    }

    function freeze() external {
        if (msg.sender != owner || frozen || minter == address(0)) revert Denied();
        for (uint256 id = 1; id <= 45; id++) if (!bound[id]) revert Locked();
        frozen = true;
        owner = address(0);
        emit Frozen();
    }

    function mint(address to, uint256 id, uint256 amount) external {
        if (msg.sender != minter || to == address(0) || amount == 0 || !bound[id]) revert Denied();
        _bal[to][id] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
        _accept(msg.sender, address(0), to, id, amount);
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata) external {
        if (to == address(0) || amount == 0) revert Bad();
        if (from != msg.sender && !isApprovedForAll[from][msg.sender]) revert Denied();
        uint256 bal = _bal[from][id];
        if (bal < amount) revert Bad();
        _bal[from][id] = bal - amount;
        _bal[to][id] += amount;
        emit TransferSingle(msg.sender, from, to, id, amount);
        _accept(msg.sender, from, to, id, amount);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0xd9b67a26 || id == 0x0e89341c;
    }

    function _accept(address operator, address from, address to, uint256 id, uint256 amount) internal {
        if (to.code.length == 0) return;
        (bool ok, bytes memory ret) = to.call(abi.encodeWithSelector(bytes4(0xf23a6e61), operator, from, id, amount, bytes("")));
        if (!ok || ret.length < 32 || bytes4(ret) != bytes4(0xf23a6e61)) revert Bad();
    }

    receive() external payable {
        revert Bad();
    }
}
