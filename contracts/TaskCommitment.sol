// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./ProviderVault.sol";
import "./VerifierV1.sol";

/**
 * TaskCommitment — Core ACCORD protocol contract
 * 7-state machine:
 * Created → LiabilityReserved → PaymentLinked → DeliverySubmitted →
 * VerifiedPass | VerifiedFail | Expired
 *
 * Binary settlement: pass releases liability, fail slashes immediately.
 * No dispute window. No escape hatch.
 *
 * Practical correction:
 * - spec is committed once at createCommitment
 * - constraints are stored on-chain per task
 * - submitDelivery only submits values (fields), not new rules
 * - verification runs against the committed spec
 */
contract TaskCommitment {
    using ECDSA for bytes32;

    enum TaskState {
        Created,
        LiabilityReserved,
        PaymentLinked,
        DeliverySubmitted,
        VerifiedPass,
        VerifiedFail,
        Expired
    }

    struct Commitment {
        bytes32 taskId;
        bytes32 specHash;
        address providerAA;
        address providerSigner;
        address buyer;
        uint256 liabilityAmount;
        uint256 deadlineTimestamp;
        uint8 verifierVersion;
        bytes32 paymentReference;
        bytes32 commitmentNonce;
        TaskState taskState;
        uint256 createdAt;
    }

    struct DeliveryObject {
        bytes32 taskId;
        bytes32 outputHash;
        uint256 timestamp;
        uint8 schemaVersion;
        address signerAddress;
        bytes32 providerNonce;
        bytes signature;
    }

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 private constant DELIVERY_TYPEHASH = keccak256(
        "DeliveryObject(bytes32 taskId,bytes32 outputHash,uint256 timestamp,uint8 schemaVersion,address signerAddress,bytes32 providerNonce,bytes32 paymentReference)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    ProviderVault public vault;
    VerifierV1 public verifier;
    address public attestationRegistry;
    address public immutable owner;

    mapping(bytes32 => Commitment) public commitments;
    mapping(bytes32 => bool) public usedCommitmentNonces;
    mapping(bytes32 => bool) public usedDeliveryNonces;
    mapping(bytes32 => bool) public usedDeliveryDigests;

    // committed spec storage
    mapping(bytes32 => bytes32) public commitmentSchemaHash;
    mapping(bytes32 => VerifierV1.Constraint[]) internal commitmentConstraints;

    event CommitmentCreated(
        bytes32 indexed taskId,
        address indexed providerAA,
        address indexed buyer,
        uint256 liabilityAmount
    );
    event LiabilityReserved(
        bytes32 indexed taskId,
        address indexed providerAA,
        uint256 amount
    );
    event PaymentLinked(bytes32 indexed taskId, bytes32 paymentReference);
    event DeliverySubmitted(bytes32 indexed taskId, bytes32 outputHash);
    event VerifiedPass(bytes32 indexed taskId, address indexed providerAA);
    event VerifiedFail(
        bytes32 indexed taskId,
        address indexed providerAA,
        bytes32 failReason
    );
    event TaskExpired(bytes32 indexed taskId, address indexed providerAA);

    event VerificationTraceItem(
        bytes32 indexed taskId,
        uint256 indexed index,
        bytes32 fieldKey,
        uint8 constraintType,
        bool passed,
        bytes32 reason
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _vault, address _verifier) {
        require(_vault != address(0), "Zero vault");
        require(_verifier != address(0), "Zero verifier");
        vault = ProviderVault(_vault);
        verifier = VerifierV1(_verifier);
        owner = msg.sender;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("ACCORD")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function setAttestationRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Zero address");
        attestationRegistry = _registry;
    }

    function createCommitment(
        address providerAA,
        address providerSigner,
        bytes32 schemaHash,
        VerifierV1.Constraint[] calldata constraints,
        uint256 liabilityAmount,
        uint256 deadlineTimestamp,
        uint8 verifierVersion,
        bytes32 commitmentNonce
    ) external returns (bytes32 taskId) {
        require(providerAA != address(0), "Zero provider AA");
        require(providerSigner != address(0), "Zero provider signer");
        require(schemaHash != bytes32(0), "Zero schema hash");
        require(liabilityAmount > 0, "Liability must be > 0");
        require(deadlineTimestamp > block.timestamp, "Deadline must be in future");
        require(!usedCommitmentNonces[commitmentNonce], "Nonce already used");

        bytes32 specHash = verifier.hashSpec(schemaHash, constraints);

        taskId = keccak256(
            abi.encode(
                msg.sender,
                providerAA,
                providerSigner,
                specHash,
                liabilityAmount,
                deadlineTimestamp,
                verifierVersion,
                commitmentNonce
            )
        );

        require(commitments[taskId].createdAt == 0, "Task already exists");

        usedCommitmentNonces[commitmentNonce] = true;

        commitments[taskId] = Commitment({
            taskId: taskId,
            specHash: specHash,
            providerAA: providerAA,
            providerSigner: providerSigner,
            buyer: msg.sender,
            liabilityAmount: liabilityAmount,
            deadlineTimestamp: deadlineTimestamp,
            verifierVersion: verifierVersion,
            paymentReference: bytes32(0),
            commitmentNonce: commitmentNonce,
            taskState: TaskState.Created,
            createdAt: block.timestamp
        });

        commitmentSchemaHash[taskId] = schemaHash;

        for (uint256 i = 0; i < constraints.length; i++) {
            VerifierV1.Constraint storage stored = commitmentConstraints[taskId].push();
            stored.constraintType = constraints[i].constraintType;
            stored.fieldKey = constraints[i].fieldKey;
            stored.minValue = constraints[i].minValue;
            stored.maxValue = constraints[i].maxValue;
            stored.expectedValue = constraints[i].expectedValue;
            stored.expectedHash = constraints[i].expectedHash;

            for (uint256 j = 0; j < constraints[i].enumMembers.length; j++) {
                stored.enumMembers.push(constraints[i].enumMembers[j]);
            }
        }

        emit CommitmentCreated(taskId, providerAA, msg.sender, liabilityAmount);
        return taskId;
    }

    function reserveLiability(bytes32 taskId) external {
        Commitment storage c = commitments[taskId];
        require(c.createdAt != 0, "Task not found");
        require(c.taskState == TaskState.Created, "Invalid state");
        require(msg.sender == c.providerAA, "Only provider AA");

        vault.reserveLiability(c.providerAA, c.liabilityAmount);
        c.taskState = TaskState.LiabilityReserved;

        emit LiabilityReserved(taskId, c.providerAA, c.liabilityAmount);
    }

    function linkPayment(bytes32 taskId, bytes32 paymentReference) external {
        Commitment storage c = commitments[taskId];
        require(c.createdAt != 0, "Task not found");
        require(c.taskState == TaskState.LiabilityReserved, "Invalid state");
        require(msg.sender == c.buyer, "Only buyer");
        require(paymentReference != bytes32(0), "Zero payment reference");

        c.paymentReference = paymentReference;
        c.taskState = TaskState.PaymentLinked;

        emit PaymentLinked(taskId, paymentReference);
    }

    function submitDelivery(
        bytes32 taskId,
        DeliveryObject calldata delivery,
        VerifierV1.FieldValue[] calldata fields
    ) external {
        Commitment storage c = commitments[taskId];
        require(c.createdAt != 0, "Task not found");
        require(c.taskState == TaskState.PaymentLinked, "Invalid state");
        require(msg.sender == c.providerAA, "Only provider AA");
        require(block.timestamp <= c.deadlineTimestamp, "Deadline passed");

        require(delivery.taskId == taskId, "Task binding mismatch");
        require(delivery.signerAddress == c.providerSigner, "Signer mismatch");
        require(!usedDeliveryNonces[delivery.providerNonce], "Replay nonce used");

        bytes32 committedSpecHash = verifier.hashSpec(
            commitmentSchemaHash[taskId],
            commitmentConstraints[taskId]
        );
        require(committedSpecHash == c.specHash, "Stored spec corrupted");

        bytes32 deliveryDigest = _deliveryDigest(c, delivery);
        require(!usedDeliveryDigests[deliveryDigest], "Replay digest used");

        address recovered = _recoverSigner(deliveryDigest, delivery.signature);
        require(recovered == c.providerSigner, "Invalid provider signature");

        usedDeliveryNonces[delivery.providerNonce] = true;
        usedDeliveryDigests[deliveryDigest] = true;

        c.taskState = TaskState.DeliverySubmitted;
        emit DeliverySubmitted(taskId, delivery.outputHash);

        (bool passed, VerifierV1.VerificationTrace[] memory trace) = verifier.verify(
            fields,
            commitmentConstraints[taskId],
            c.deadlineTimestamp
        );

        bytes32 failReason = bytes32("UNKNOWN");
        for (uint256 i = 0; i < trace.length; i++) {
            emit VerificationTraceItem(
                taskId,
                i,
                trace[i].fieldKey,
                uint8(trace[i].constraintType),
                trace[i].passed,
                trace[i].reason
            );

            if (!trace[i].passed && failReason == bytes32("UNKNOWN")) {
                failReason = trace[i].reason;
            }
        }

        if (passed) {
            _settlePass(taskId, c);
        } else {
            _settleFail(taskId, c, failReason);
        }
    }

    function expireTask(bytes32 taskId) external {
        Commitment storage c = commitments[taskId];
        require(c.createdAt != 0, "Task not found");
        require(
            c.taskState == TaskState.Created ||
                c.taskState == TaskState.LiabilityReserved ||
                c.taskState == TaskState.PaymentLinked,
            "Cannot expire"
        );
        require(block.timestamp > c.deadlineTimestamp, "Not yet expired");

        if (
            c.taskState == TaskState.LiabilityReserved ||
            c.taskState == TaskState.PaymentLinked
        ) {
            vault.slash(c.providerAA, c.liabilityAmount, c.buyer);
        }

        c.taskState = TaskState.Expired;
        emit TaskExpired(taskId, c.providerAA);

        _recordAttestation(taskId, false, c.providerAA);
    }

    function getCommitment(
        bytes32 taskId
    ) external view returns (Commitment memory) {
        return commitments[taskId];
    }

    function getConstraintCount(bytes32 taskId) external view returns (uint256) {
        return commitmentConstraints[taskId].length;
    }

    function getConstraint(
        bytes32 taskId,
        uint256 index
    ) external view returns (VerifierV1.Constraint memory) {
        require(index < commitmentConstraints[taskId].length, "Constraint index out of bounds");
        return commitmentConstraints[taskId][index];
    }

    function _settlePass(bytes32 taskId, Commitment storage c) internal {
        c.taskState = TaskState.VerifiedPass;
        vault.releaseLiability(c.providerAA, c.liabilityAmount);
        emit VerifiedPass(taskId, c.providerAA);
        _recordAttestation(taskId, true, c.providerAA);
    }

    function _settleFail(
        bytes32 taskId,
        Commitment storage c,
        bytes32 failReason
    ) internal {
        c.taskState = TaskState.VerifiedFail;
        vault.slash(c.providerAA, c.liabilityAmount, c.buyer);
        emit VerifiedFail(taskId, c.providerAA, failReason);
        _recordAttestation(taskId, false, c.providerAA);
    }

    function _recordAttestation(
        bytes32 taskId,
        bool passed,
        address providerAA
    ) internal {
        if (attestationRegistry == address(0)) return;
        IAttestationRegistry(attestationRegistry).record(taskId, passed, providerAA);
    }

    function _deliveryDigest(
        Commitment storage c,
        DeliveryObject calldata delivery
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                DELIVERY_TYPEHASH,
                delivery.taskId,
                delivery.outputHash,
                delivery.timestamp,
                delivery.schemaVersion,
                delivery.signerAddress,
                delivery.providerNonce,
                c.paymentReference
            )
        );

        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        return ECDSA.recover(digest, signature);
    }
}

interface IAttestationRegistry {
    function record(bytes32 taskId, bool passed, address providerAA) external;
}