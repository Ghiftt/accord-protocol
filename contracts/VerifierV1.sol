// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * VerifierV1 — Deterministic constraint verifier for ACCORD protocol
 * Closed constraint vocabulary — any unsupported constraint is rejected
 * Produces a reason trace for every verification run
 * Binary result — pass or fail, no partial credit
 */
contract VerifierV1 {
    enum ConstraintType {
        FIELD_REQUIRED,
        EQUALS,
        RANGE,
        HASH_MATCH,
        DEADLINE,
        SIGNATURE_VALID,
        ENUM_MEMBER,
        FRESHNESS,
        TIMESTAMP_WINDOW,
        MERKLE_ROOT_MATCH,
        SIGNER_IN_ALLOWLIST
    }

    enum ValueType {
        INT,      // 0
        HASH,     // 1
        ADDRESS,  // 2
        BOOL      // 3
    }

    struct Constraint {
        ConstraintType constraintType;
        bytes32 fieldKey;
        int256 minValue;
        int256 maxValue;
        int256 expectedValue;
        bytes32 expectedHash;
        bytes32[] enumMembers;
    }

    struct FieldValue {
        bytes32 fieldKey;
        bool exists;
        int256 intValue;
        bytes32 hashValue;
        address addrValue;
        bool boolValue;
        uint8 valueType; // use ValueType enum values
    }

    struct VerificationTrace {
        bytes32 fieldKey;
        ConstraintType constraintType;
        bool passed;
        bytes32 reason;
    }

    function hashSpec(
        bytes32 schemaHash,
        Constraint[] calldata constraints
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(schemaHash, constraints));
    }

    function verify(
        FieldValue[] calldata fields,
        Constraint[] calldata constraints,
        uint256 deadline
    ) external view returns (bool passed, VerificationTrace[] memory trace) {
        trace = new VerificationTrace[](constraints.length);
        passed = true;

        for (uint256 i = 0; i < constraints.length; i++) {
            Constraint calldata c = constraints[i];
            (FieldValue memory field, bool found) = _findField(fields, c.fieldKey);

            (bool result, bytes32 reason) = _evaluateConstraint(
                c,
                field,
                found,
                deadline
            );

            trace[i] = VerificationTrace({
                fieldKey: c.fieldKey,
                constraintType: c.constraintType,
                passed: result,
                reason: reason
            });

            if (!result) {
                passed = false;
            }
        }

        return (passed, trace);
    }

    function _findField(
        FieldValue[] calldata fields,
        bytes32 fieldKey
    ) internal pure returns (FieldValue memory field, bool found) {
        for (uint256 i = 0; i < fields.length; i++) {
            if (fields[i].fieldKey == fieldKey) {
                return (fields[i], true);
            }
        }

        FieldValue memory empty;
        empty.fieldKey = fieldKey;
        empty.exists = false;
        return (empty, false);
    }

    function _evaluateConstraint(
        Constraint calldata c,
        FieldValue memory field,
        bool found,
        uint256 deadline
    ) internal view returns (bool, bytes32) {
        if (c.constraintType == ConstraintType.FIELD_REQUIRED) {
            bool present = found && field.exists;
            return (present, present ? bytes32("OK") : bytes32("FIELD_MISSING"));
        }

        if (!found || !field.exists) {
            return (false, bytes32("FIELD_MISSING"));
        }

        if (c.constraintType == ConstraintType.EQUALS) {
            if (field.valueType == uint8(ValueType.INT)) {
                bool ok = field.intValue == c.expectedValue;
                return (ok, ok ? bytes32("OK") : bytes32("EQUALS_FAIL"));
            }

            if (field.valueType == uint8(ValueType.HASH)) {
                bool ok = field.hashValue == c.expectedHash;
                return (ok, ok ? bytes32("OK") : bytes32("EQUALS_FAIL"));
            }

            if (field.valueType == uint8(ValueType.ADDRESS)) {
                address expectedAddr = address(uint160(uint256(c.expectedHash)));
                bool ok = field.addrValue == expectedAddr;
                return (ok, ok ? bytes32("OK") : bytes32("EQUALS_FAIL"));
            }

            if (field.valueType == uint8(ValueType.BOOL)) {
                bool expectedBool = c.expectedValue != 0;
                bool ok = field.boolValue == expectedBool;
                return (ok, ok ? bytes32("OK") : bytes32("EQUALS_FAIL"));
            }

            return (false, bytes32("UNSUPPORTED_TYPE"));
        }

        if (c.constraintType == ConstraintType.RANGE) {
            if (field.valueType != uint8(ValueType.INT)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            bool ok = field.intValue >= c.minValue && field.intValue <= c.maxValue;
            return (ok, ok ? bytes32("OK") : bytes32("RANGE_FAIL"));
        }

        if (c.constraintType == ConstraintType.HASH_MATCH) {
            if (field.valueType != uint8(ValueType.HASH)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            bool ok = field.hashValue == c.expectedHash;
            return (ok, ok ? bytes32("OK") : bytes32("HASH_MISMATCH"));
        }

        if (c.constraintType == ConstraintType.DEADLINE) {
            if (field.valueType != uint8(ValueType.INT)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            if (field.intValue < 0) {
                return (false, bytes32("INVALID_TIMESTAMP"));
            }

            uint256 deliveredAt = uint256(field.intValue);
            bool ok = deliveredAt <= deadline && block.timestamp <= deadline;
            return (ok, ok ? bytes32("OK") : bytes32("DEADLINE_FAIL"));
        }

        if (c.constraintType == ConstraintType.SIGNATURE_VALID) {
            if (field.valueType != uint8(ValueType.ADDRESS)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            address expectedSigner = address(uint160(uint256(c.expectedHash)));
            bool ok = field.addrValue == expectedSigner;
            return (ok, ok ? bytes32("OK") : bytes32("SIGNER_MISMATCH"));
        }

        if (c.constraintType == ConstraintType.ENUM_MEMBER) {
            if (field.valueType != uint8(ValueType.HASH)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            for (uint256 i = 0; i < c.enumMembers.length; i++) {
                if (field.hashValue == c.enumMembers[i]) {
                    return (true, bytes32("OK"));
                }
            }

            return (false, bytes32("NOT_IN_ENUM"));
        }

        if (c.constraintType == ConstraintType.FRESHNESS) {
            if (field.valueType != uint8(ValueType.INT)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            if (field.intValue < 0) {
                return (false, bytes32("INVALID_TIMESTAMP"));
            }

            uint256 fieldTs = uint256(field.intValue);
            bool ok = block.timestamp >= fieldTs &&
                (block.timestamp - fieldTs) <= uint256(c.expectedValue);

            return (ok, ok ? bytes32("OK") : bytes32("STALE_DATA"));
        }

        if (c.constraintType == ConstraintType.TIMESTAMP_WINDOW) {
            if (field.valueType != uint8(ValueType.INT)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            bool ok = field.intValue >= c.minValue && field.intValue <= c.maxValue;
            return (ok, ok ? bytes32("OK") : bytes32("TIMESTAMP_WINDOW_FAIL"));
        }

        if (c.constraintType == ConstraintType.MERKLE_ROOT_MATCH) {
            if (field.valueType != uint8(ValueType.HASH)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            bool ok = field.hashValue == c.expectedHash;
            return (ok, ok ? bytes32("OK") : bytes32("MERKLE_ROOT_MISMATCH"));
        }

        if (c.constraintType == ConstraintType.SIGNER_IN_ALLOWLIST) {
            if (field.valueType != uint8(ValueType.ADDRESS)) {
                return (false, bytes32("TYPE_MISMATCH"));
            }

            bytes32 signerAsBytes32 = bytes32(uint256(uint160(field.addrValue)));

            for (uint256 i = 0; i < c.enumMembers.length; i++) {
                if (signerAsBytes32 == c.enumMembers[i]) {
                    return (true, bytes32("OK"));
                }
            }

            return (false, bytes32("SIGNER_NOT_ALLOWED"));
        }

        return (false, bytes32("UNKNOWN_CONSTRAINT"));
    }
}