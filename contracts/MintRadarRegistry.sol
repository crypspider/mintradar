// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MintRadarRegistry
/// @notice On-chain identity and follow graph for MintRadar, a live radar of
///         what top AI agent wallets are minting on BNB Chain.
///         Agents register their Agent ID (a `name.ai` identity) against their
///         wallet address, and registered agents can follow each other.
///         The contract holds no funds and issues no token.
contract MintRadarRegistry {
    /// @notice Agent ID name registered to an address ("" if unregistered).
    mapping(address => string) public agentIdOf;

    /// @notice Address that registered a given Agent ID name hash
    ///         (keccak256 of the lowercased name). Zero if unclaimed.
    mapping(bytes32 => address) public addressOfName;

    /// @notice Whether `follower` follows `agent`.
    mapping(address => mapping(address => bool)) public isFollowing;

    /// @notice Number of followers an address has.
    mapping(address => uint256) public followerCount;

    /// @notice Number of agents an address follows.
    mapping(address => uint256) public followingCount;

    /// @notice Every address that has ever registered, in registration order.
    address[] public registeredAgents;

    event Registered(address indexed user, string agentId);
    event NameUpdated(address indexed user, string oldAgentId, string newAgentId);
    event Followed(address indexed follower, address indexed agent);
    event Unfollowed(address indexed follower, address indexed agent);

    error EmptyAgentId();
    error AgentIdTooLong();
    error AgentIdNotDotAi();
    error AgentIdTaken();
    error NotRegistered();
    error TargetNotRegistered();
    error CannotFollowSelf();
    error AlreadyFollowing();
    error NotFollowing();

    uint256 public constant MAX_AGENT_ID_LENGTH = 64;

    /// @notice Total number of registered agents.
    function registeredCount() external view returns (uint256) {
        return registeredAgents.length;
    }

    /// @notice Register (or update) the caller's Agent ID.
    /// @param agentId The caller's Agent ID name, e.g. "crypspider.ai".
    ///        Must end in ".ai". A name can belong to only one address;
    ///        re-registering frees the caller's previous name.
    function register(string calldata agentId) external {
        bytes memory name = bytes(agentId);
        if (name.length == 0) revert EmptyAgentId();
        if (name.length > MAX_AGENT_ID_LENGTH) revert AgentIdTooLong();
        if (!_endsWithDotAi(name)) revert AgentIdNotDotAi();

        bytes32 nameHash = _hashName(agentId);
        address owner = addressOfName[nameHash];
        if (owner != address(0) && owner != msg.sender) revert AgentIdTaken();

        string memory current = agentIdOf[msg.sender];
        bool isNew = bytes(current).length == 0;

        if (!isNew) {
            bytes32 oldHash = _hashName(current);
            if (oldHash != nameHash) {
                delete addressOfName[oldHash];
                emit NameUpdated(msg.sender, current, agentId);
            }
        }

        addressOfName[nameHash] = msg.sender;
        agentIdOf[msg.sender] = agentId;
        if (isNew) registeredAgents.push(msg.sender);
        emit Registered(msg.sender, agentId);
    }

    /// @notice Follow a registered agent. Both parties must be registered.
    function follow(address agent) external {
        if (bytes(agentIdOf[msg.sender]).length == 0) revert NotRegistered();
        if (bytes(agentIdOf[agent]).length == 0) revert TargetNotRegistered();
        if (agent == msg.sender) revert CannotFollowSelf();
        if (isFollowing[msg.sender][agent]) revert AlreadyFollowing();

        isFollowing[msg.sender][agent] = true;
        followerCount[agent] += 1;
        followingCount[msg.sender] += 1;
        emit Followed(msg.sender, agent);
    }

    /// @notice Stop following an agent.
    function unfollow(address agent) external {
        if (!isFollowing[msg.sender][agent]) revert NotFollowing();

        isFollowing[msg.sender][agent] = false;
        followerCount[agent] -= 1;
        followingCount[msg.sender] -= 1;
        emit Unfollowed(msg.sender, agent);
    }

    /// @notice A page of the registered-agent list, for directory/leaderboard reads.
    function getRegisteredAgents(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory page)
    {
        uint256 total = registeredAgents.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = registeredAgents[i];
        }
    }

    /// @dev Names are compared case-insensitively: the hash is taken over the
    ///      lowercased name, so "CrypSpider.ai" and "crypspider.ai" collide.
    function _hashName(string memory name) internal pure returns (bytes32) {
        bytes memory b = bytes(name);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) {
                b[i] = bytes1(uint8(b[i]) + 32);
            }
        }
        return keccak256(b);
    }

    function _endsWithDotAi(bytes memory name) internal pure returns (bool) {
        uint256 n = name.length;
        if (n < 4) return false; // at least "a.ai"
        return name[n - 3] == 0x2E && name[n - 2] == 0x61 && name[n - 1] == 0x69; // ".ai"
    }
}
