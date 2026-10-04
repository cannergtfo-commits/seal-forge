// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IBzb {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title Pays 0.25 BzB for a signed win. Fund it by transferring BzB here. There is no withdraw.
contract VeilRewards {
    IBzb public immutable bzb;
    address public immutable keeper;
    uint256 public constant WIN = 250_000_000_000_000_000;
    uint256 public constant DAILY = 4;
    mapping(bytes32 => bool) public paid;
    mapping(address => uint256) public dayOf;
    mapping(address => uint256) public claimedOnDay;
    uint256 private lock;

    error Denied();
    error Empty();
    error Cap();
    error Paid();

    constructor(address token, address keeper_) {
        if (token == address(0) || keeper_ == address(0)) revert Denied();
        bzb = IBzb(token);
        keeper = keeper_;
    }

    function inner(address player, bytes32 matchId) public view returns (bytes32) {
        return keccak256(abi.encode(bytes32("VEIL.WIN.v1"), block.chainid, address(this), player, matchId));
    }

    function claim(bytes32 matchId, bytes calldata sig) external {
        if (lock == 1 || paid[matchId]) revert Paid();
        if (_recover(inner(msg.sender, matchId), sig) != keeper) revert Denied();
        uint256 day = block.timestamp / 1 days;
        if (dayOf[msg.sender] != day) {
            dayOf[msg.sender] = day;
            claimedOnDay[msg.sender] = 0;
        }
        if (claimedOnDay[msg.sender] >= DAILY) revert Cap();
        if (bzb.balanceOf(address(this)) < WIN) revert Empty();
        paid[matchId] = true;
        claimedOnDay[msg.sender] += 1;
        lock = 1;
        _send(msg.sender, WIN);
        lock = 0;
    }

    function _send(address to, uint256 amount) internal {
        uint256 beforeBal = bzb.balanceOf(to);
        bool ok = bzb.transfer(to, amount);
        if (!ok) revert Empty();
        if (bzb.balanceOf(to) < beforeBal + amount) revert Empty();
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert Denied();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert Denied();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert Denied();
        bytes32 eth = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        address signer = ecrecover(eth, v, r, s);
        if (signer == address(0)) revert Denied();
        return signer;
    }

    receive() external payable {
        revert Denied();
    }
}
