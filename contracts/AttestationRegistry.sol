// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * AttestationRegistry — On-chain outcome records for ACCORD protocol
 * Every verified task outcome is permanently recorded here
 * Provider delivery history is public and portable
 * Failures are permanently visible — no erasure
 */
contract AttestationRegistry {
    address public taskCommitment;
    address public immutable owner;

    struct Attestation {
        bytes32 taskId;
        address provider;
        bool passed;
        uint256 timestamp;
        uint256 blockNumber;
    }

    mapping(bytes32 => Attestation) public attestations;
    mapping(address => bytes32[]) public providerHistory;
    mapping(address => uint256) public providerPassCount;
    mapping(address => uint256) public providerFailCount;

    bytes32[] public allAttestations;

    event AttestationRecorded(
        bytes32 indexed taskId,
        address indexed provider,
        bool passed,
        uint256 timestamp
    );

    event TaskCommitmentUpdated(address indexed newTaskCommitment);

    modifier onlyTaskCommitment() {
        require(msg.sender == taskCommitment, "Caller is not TaskCommitment");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setTaskCommitment(address _taskCommitment) external onlyOwner {
        require(_taskCommitment != address(0), "Zero address");
        taskCommitment = _taskCommitment;
        emit TaskCommitmentUpdated(_taskCommitment);
    }

    // Called by TaskCommitment on every terminal state
    function record(bytes32 taskId, bool passed, address provider) external onlyTaskCommitment {
        require(attestations[taskId].timestamp == 0, "Already attested");
        require(provider != address(0), "Zero provider");

        attestations[taskId] = Attestation({
            taskId: taskId,
            provider: provider,
            passed: passed,
            timestamp: block.timestamp,
            blockNumber: block.number
        });

        providerHistory[provider].push(taskId);
        allAttestations.push(taskId);

        if (passed) {
            providerPassCount[provider]++;
        } else {
            providerFailCount[provider]++;
        }

        emit AttestationRecorded(taskId, provider, passed, block.timestamp);
    }

    function getAttestation(bytes32 taskId) external view returns (Attestation memory) {
        return attestations[taskId];
    }

    function getProviderHistory(address provider) external view returns (bytes32[] memory) {
        return providerHistory[provider];
    }

    function getProviderStats(address provider) external view returns (
        uint256 totalTasks,
        uint256 passed,
        uint256 failed,
        uint256 successRate
    ) {
        uint256 p = providerPassCount[provider];
        uint256 f = providerFailCount[provider];
        uint256 total = p + f;
        uint256 rate = total == 0 ? 0 : (p * 100) / total;
        return (total, p, f, rate);
    }

    function getTotalAttestations() external view returns (uint256) {
        return allAttestations.length;
    }
}