export type VerifierVersion = "V1";

export type TaskState =
  | "CommitmentCreated"
  | "LiabilityReserved"
  | "PaymentLinked"
  | "DeliverySubmitted"
  | "VerifiedPass"
  | "VerifiedFail"
  | "Expired"
  | "LiabilityReleased"
  | "CollateralSlashed";

export type FieldType =
  | "uint256"
  | "int256"
  | "bool"
  | "address"
  | "bytes32"
  | "uint64"
  | "timestamp";

export type ConstraintOp =
  | "field_required"
  | "field_type"
  | "equals"
  | "enum_member"
  | "range"
  | "length"
  | "freshness"
  | "deadline"
  | "timestamp_window"
  | "hash_match"
  | "merkle_root_match"
  | "inclusion_proof"
  | "signature_valid"
  | "signer_in_allowlist"
  | "cross_source_agreement"
  | "reference_equals";

export interface SpecField {
  name: string;
  type: FieldType;
  required: boolean;
}

export interface Constraint {
  field: string;
  op: ConstraintOp;
  value: string | number | boolean | string[] | Record<string, unknown>;
}

export interface TaskSpecV1 {
  schemaVersion: "1";
  taskType: string;
  fields: SpecField[];
  constraints: Constraint[];
}

export interface CommitmentInput {
  taskId: string;
  payerAddress: string;
  providerAddress: string;
  liabilityAmount: string;
  deadlineTimestamp: number;
  verifierVersion: VerifierVersion;
  paymentReference: string;
  commitmentNonce: string;
  spec: TaskSpecV1;
}

export interface DeliveryPayload {
  schemaVersion: string;
  taskId: string;
  outputHash: string;
  timestamp: number;
  paymentReference: string;
  commitmentNonce: string;
  providerNonce: string;
  merkleRoot?: string;
  artifactHash?: string;
  upstreamReferenceProof?: string;
}

export interface SignedDelivery {
  payload: DeliveryPayload;
  signature: string;
  signer: string;
}