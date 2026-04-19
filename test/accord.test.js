const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("ACCORD Protocol", function () {
  let deployer, providerAA, providerSigner, buyer, recipient;
  let ausd, vault, verifier, taskCommitment, registry;

  const DEPOSIT_AMOUNT = ethers.parseUnits("100", 6);
  const LARGE_DEPOSIT_AMOUNT = ethers.parseUnits("200", 6);
  const LIABILITY_AMOUNT = ethers.parseUnits("50", 6);

  const ConstraintType = {
    FIELD_REQUIRED: 0,
    EQUALS: 1,
    RANGE: 2,
    HASH_MATCH: 3,
    DEADLINE: 4,
    SIGNATURE_VALID: 5,
    ENUM_MEMBER: 6,
    FRESHNESS: 7,
    TIMESTAMP_WINDOW: 8,
    MERKLE_ROOT_MATCH: 9,
    SIGNER_IN_ALLOWLIST: 10,
  };

  const ValueType = {
    INT: 0,
    HASH: 1,
    ADDRESS: 2,
    BOOL: 3,
  };

  async function registerAndDeposit(amount) {
    await vault.connect(providerAA).registerVault(providerSigner.address);
    await ausd.connect(providerAA).approve(await vault.getAddress(), amount);
    await vault.connect(providerAA).deposit(amount);
  }

  async function createCommitmentAndGetTaskId({
    providerAAAddress,
    providerSignerAddress,
    specHash,
    liability,
    deadline,
    schemaVersion,
    commitmentNonce,
  }) {
    const tx = await taskCommitment
      .connect(buyer)
      .createCommitment(
        providerAAAddress,
        providerSignerAddress,
        specHash,
        liability,
        deadline,
        schemaVersion,
        commitmentNonce
      );

    const receipt = await tx.wait();

    const parsedLogs = receipt.logs
      .map((log) => {
        try {
          return taskCommitment.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const created = parsedLogs.find((log) => log.name === "CommitmentCreated");
    expect(created, "CommitmentCreated event not found").to.exist;

    return created.args.taskId;
  }

  async function getRawWalletFor(address) {
    const accountsConfig = hre.network.config.accounts;

    if (
      !accountsConfig ||
      typeof accountsConfig === "string" ||
      Array.isArray(accountsConfig)
    ) {
      throw new Error(
        "Could not derive raw wallet from network config. This helper expects Hardhat mnemonic-based accounts."
      );
    }

    const mnemonic = accountsConfig.mnemonic;
    const pathBase = accountsConfig.path || "m/44'/60'/0'/0";
    const initialIndex = accountsConfig.initialIndex ?? 0;
    const count = accountsConfig.count ?? 20;
    const passphrase = accountsConfig.passphrase || "";

    for (let i = initialIndex; i < initialIndex + count; i++) {
      const wallet = ethers.HDNodeWallet.fromPhrase(
        mnemonic,
        passphrase,
        `${pathBase}/${i}`
      ).connect(ethers.provider);

      if (wallet.address.toLowerCase() === address.toLowerCase()) {
        return wallet;
      }
    }

    throw new Error(`Could not derive raw wallet for address ${address}`);
  }

  async function signDelivery({
    taskId,
    outputHash,
    timestamp,
    schemaVersion,
    signer,
    providerNonce,
    paymentReference,
  }) {
    const domainSeparator = await taskCommitment.DOMAIN_SEPARATOR();

    const DELIVERY_TYPEHASH = ethers.keccak256(
      ethers.toUtf8Bytes(
        "DeliveryObject(bytes32 taskId,bytes32 outputHash,uint256 timestamp,uint8 schemaVersion,address signerAddress,bytes32 providerNonce,bytes32 paymentReference)"
      )
    );

    const structHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "bytes32",
          "bytes32",
          "bytes32",
          "uint256",
          "uint8",
          "address",
          "bytes32",
          "bytes32",
        ],
        [
          DELIVERY_TYPEHASH,
          taskId,
          outputHash,
          timestamp,
          schemaVersion,
          signer.address,
          providerNonce,
          paymentReference,
        ]
      )
    );

    const digest = ethers.keccak256(
      ethers.concat([ethers.toUtf8Bytes("\x19\x01"), domainSeparator, structHash])
    );

    const rawWallet = await getRawWalletFor(signer.address);
    const sigObj = rawWallet.signingKey.sign(digest);
    const signature = ethers.Signature.from(sigObj).serialized;

    return {
      taskId,
      outputHash,
      timestamp,
      schemaVersion,
      signerAddress: signer.address,
      providerNonce,
      signature,
    };
  }

  beforeEach(async function () {
    [deployer, providerAA, providerSigner, buyer, recipient] =
      await ethers.getSigners();

    const AUSD = await ethers.getContractFactory("AUSD");
    ausd = await AUSD.deploy();

    const ProviderVault = await ethers.getContractFactory("ProviderVault");
    vault = await ProviderVault.deploy(await ausd.getAddress());

    const VerifierV1 = await ethers.getContractFactory("VerifierV1");
    verifier = await VerifierV1.deploy();

    const TaskCommitment = await ethers.getContractFactory("TaskCommitment");
    taskCommitment = await TaskCommitment.deploy(
      await vault.getAddress(),
      await verifier.getAddress()
    );

    const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
    registry = await AttestationRegistry.deploy();

    await vault.setTaskCommitment(await taskCommitment.getAddress());
    await taskCommitment.setAttestationRegistry(await registry.getAddress());
    await registry.setTaskCommitment(await taskCommitment.getAddress());

    await ausd.transfer(providerAA.address, ethers.parseUnits("10000", 6));
    await ausd.transfer(buyer.address, ethers.parseUnits("10000", 6));
  });

  describe("ProviderVault", function () {
    it("allows provider to deposit", async function () {
      await registerAndDeposit(DEPOSIT_AMOUNT);

      const [total, liability, available] = await vault.getVaultState(
        providerAA.address
      );
      expect(total).to.equal(DEPOSIT_AMOUNT);
      expect(liability).to.equal(0);
      expect(available).to.equal(DEPOSIT_AMOUNT);
    });

    it("blocks withdrawal beyond available capacity", async function () {
      await registerAndDeposit(DEPOSIT_AMOUNT);

      await expect(
        vault.connect(providerAA).withdraw(ethers.parseUnits("101", 6))
      ).to.be.revertedWith("Insufficient available capacity");
    });

    it("blocks non-TaskCommitment from reserving liability", async function () {
      await expect(
        vault
          .connect(deployer)
          .reserveLiability(providerAA.address, ethers.parseUnits("10", 6))
      ).to.be.revertedWith("Caller is not TaskCommitment");
    });
  });

  describe("Full flow — PASS with realistic multi-constraint API quote task", function () {
    let taskId;
    let schemaHash;
    let constraints;
    let fields;
    let delivery;
    let expectedQuoteHash;

    beforeEach(async function () {
      await registerAndDeposit(DEPOSIT_AMOUNT);

      schemaHash = ethers.keccak256(
        ethers.toUtf8Bytes("market-quote-api/v1")
      );

      const quotePayloadFieldKey = ethers.keccak256(
        ethers.toUtf8Bytes("quotePayloadHash")
      );
      const observedAtFieldKey = ethers.keccak256(
        ethers.toUtf8Bytes("observedAt")
      );

      const latestBlock = await ethers.provider.getBlock("latest");
      const observedAt = latestBlock.timestamp;

      const quotePayload = JSON.stringify({
        pair: "ETH/USD",
        price: "3521.45",
        venue: "demo-provider",
        observedAt,
      });

      expectedQuoteHash = ethers.keccak256(
        ethers.toUtf8Bytes(quotePayload)
      );

      constraints = [
        {
          constraintType: ConstraintType.FIELD_REQUIRED,
          fieldKey: quotePayloadFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.HASH_MATCH,
          fieldKey: quotePayloadFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: expectedQuoteHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.FIELD_REQUIRED,
          fieldKey: observedAtFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.RANGE,
          fieldKey: observedAtFieldKey,
          minValue: observedAt - 60,
          maxValue: observedAt + 60,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
      ];

      fields = [
        {
          fieldKey: quotePayloadFieldKey,
          exists: true,
          intValue: 0,
          hashValue: expectedQuoteHash,
          addrValue: ethers.ZeroAddress,
          boolValue: false,
          valueType: ValueType.HASH,
        },
        {
          fieldKey: observedAtFieldKey,
          exists: true,
          intValue: observedAt,
          hashValue: ethers.ZeroHash,
          addrValue: ethers.ZeroAddress,
          boolValue: false,
          valueType: ValueType.INT,
        },
      ];

      const specHash = await verifier.hashSpec(schemaHash, constraints);
      const deadline = latestBlock.timestamp + 86400;
      const commitmentNonce = ethers.randomBytes(32);

      taskId = await createCommitmentAndGetTaskId({
        providerAAAddress: providerAA.address,
        providerSignerAddress: providerSigner.address,
        specHash,
        liability: LIABILITY_AMOUNT,
        deadline,
        schemaVersion: 1,
        commitmentNonce,
      });

      await taskCommitment.connect(providerAA).reserveLiability(taskId);

      const paymentRef = ethers.keccak256(
        ethers.toUtf8Bytes("kite-payment-ref-quote-pass")
      );
      await taskCommitment.connect(buyer).linkPayment(taskId, paymentRef);

      const commitment = await taskCommitment.getCommitment(taskId);
      const providerNonce = ethers.randomBytes(32);

      delivery = await signDelivery({
        taskId,
        outputHash: expectedQuoteHash,
        timestamp: observedAt,
        schemaVersion: 1,
        signer: providerSigner,
        providerNonce,
        paymentReference: commitment.paymentReference,
      });
    });

    it("settles PASS, releases liability, and records a passing attestation", async function () {
      await taskCommitment
        .connect(providerAA)
        .submitDelivery(taskId, schemaHash, delivery, fields, constraints);

      const commitment = await taskCommitment.getCommitment(taskId);
      expect(commitment.taskState).to.equal(4); // VerifiedPass

      const [total, liability, available] = await vault.getVaultState(
        providerAA.address
      );
      expect(total).to.equal(DEPOSIT_AMOUNT);
      expect(liability).to.equal(0);
      expect(available).to.equal(DEPOSIT_AMOUNT);

      const attestation = await registry.getAttestation(taskId);
      expect(attestation.passed).to.equal(true);
      expect(attestation.provider).to.equal(providerAA.address);
    });
  });

  describe("Full flow — FAIL with bad payload and stale timestamp", function () {
    it("slashes provider when quote payload hash is wrong and timestamp is stale", async function () {
      await registerAndDeposit(DEPOSIT_AMOUNT);

      const schemaHash = ethers.keccak256(
        ethers.toUtf8Bytes("market-quote-api/v1")
      );

      const quotePayloadFieldKey = ethers.keccak256(
        ethers.toUtf8Bytes("quotePayloadHash")
      );
      const observedAtFieldKey = ethers.keccak256(
        ethers.toUtf8Bytes("observedAt")
      );

      const latestBlock = await ethers.provider.getBlock("latest");
      const nowTs = latestBlock.timestamp;

      const goodPayload = JSON.stringify({
        pair: "ETH/USD",
        price: "3521.45",
        venue: "demo-provider",
        observedAt: nowTs,
      });

      const wrongPayload = JSON.stringify({
        pair: "ETH/USD",
        price: "3199.01",
        venue: "malicious-provider",
        observedAt: nowTs - 7200,
      });

      const expectedQuoteHash = ethers.keccak256(
        ethers.toUtf8Bytes(goodPayload)
      );
      const wrongQuoteHash = ethers.keccak256(
        ethers.toUtf8Bytes(wrongPayload)
      );

      const constraints = [
        {
          constraintType: ConstraintType.FIELD_REQUIRED,
          fieldKey: quotePayloadFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.HASH_MATCH,
          fieldKey: quotePayloadFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: expectedQuoteHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.FIELD_REQUIRED,
          fieldKey: observedAtFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.RANGE,
          fieldKey: observedAtFieldKey,
          minValue: nowTs - 60,
          maxValue: nowTs + 60,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
      ];

      const fields = [
        {
          fieldKey: quotePayloadFieldKey,
          exists: true,
          intValue: 0,
          hashValue: wrongQuoteHash,
          addrValue: ethers.ZeroAddress,
          boolValue: false,
          valueType: ValueType.HASH,
        },
        {
          fieldKey: observedAtFieldKey,
          exists: true,
          intValue: nowTs - 7200,
          hashValue: ethers.ZeroHash,
          addrValue: ethers.ZeroAddress,
          boolValue: false,
          valueType: ValueType.INT,
        },
      ];

      const specHash = await verifier.hashSpec(schemaHash, constraints);
      const deadline = nowTs + 86400;
      const commitmentNonce = ethers.randomBytes(32);

      const taskId = await createCommitmentAndGetTaskId({
        providerAAAddress: providerAA.address,
        providerSignerAddress: providerSigner.address,
        specHash,
        liability: LIABILITY_AMOUNT,
        deadline,
        schemaVersion: 1,
        commitmentNonce,
      });

      await taskCommitment.connect(providerAA).reserveLiability(taskId);

      const paymentRef = ethers.keccak256(
        ethers.toUtf8Bytes("kite-payment-ref-quote-fail")
      );
      await taskCommitment.connect(buyer).linkPayment(taskId, paymentRef);

      const commitment = await taskCommitment.getCommitment(taskId);
      const providerNonce = ethers.randomBytes(32);

      const delivery = await signDelivery({
        taskId,
        outputHash: wrongQuoteHash,
        timestamp: nowTs - 7200,
        schemaVersion: 1,
        signer: providerSigner,
        providerNonce,
        paymentReference: commitment.paymentReference,
      });

      await taskCommitment
        .connect(providerAA)
        .submitDelivery(taskId, schemaHash, delivery, fields, constraints);

      const state = await taskCommitment.getCommitment(taskId);
      expect(state.taskState).to.equal(5); // VerifiedFail

      const [total, liability, available] = await vault.getVaultState(
        providerAA.address
      );
      expect(total).to.equal(ethers.parseUnits("50", 6));
      expect(liability).to.equal(0);
      expect(available).to.equal(ethers.parseUnits("50", 6));

      const attestation = await registry.getAttestation(taskId);
      expect(attestation.passed).to.equal(false);
      expect(attestation.provider).to.equal(providerAA.address);
    });
  });

  describe("Capacity gating", function () {
    it("blocks commitment if provider is undercollateralized", async function () {
      await registerAndDeposit(ethers.parseUnits("40", 6));

      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("schema"));
      const specHash = await verifier.hashSpec(schemaHash, []);

      const latestBlock = await ethers.provider.getBlock("latest");
      const deadline = latestBlock.timestamp + 86400;

      const nonce1 = ethers.randomBytes(32);
      const taskId = await createCommitmentAndGetTaskId({
        providerAAAddress: providerAA.address,
        providerSignerAddress: providerSigner.address,
        specHash,
        liability: ethers.parseUnits("40", 6),
        deadline,
        schemaVersion: 1,
        commitmentNonce: nonce1,
      });

      await taskCommitment.connect(providerAA).reserveLiability(taskId);

      const nonce2 = ethers.randomBytes(32);
      const taskId2 = await createCommitmentAndGetTaskId({
        providerAAAddress: providerAA.address,
        providerSignerAddress: providerSigner.address,
        specHash,
        liability: ethers.parseUnits("1", 6),
        deadline,
        schemaVersion: 1,
        commitmentNonce: nonce2,
      });

      await expect(
        taskCommitment.connect(providerAA).reserveLiability(taskId2)
      ).to.be.revertedWith("Insufficient vault capacity");
    });
  });

  describe("Expiry", function () {
    it("slashes provider on expired task", async function () {
      await registerAndDeposit(DEPOSIT_AMOUNT);

      const schemaHash = ethers.keccak256(
        ethers.toUtf8Bytes("market-quote-api/v1")
      );
      const quotePayloadFieldKey = ethers.keccak256(
        ethers.toUtf8Bytes("quotePayloadHash")
      );

      const constraints = [
        {
          constraintType: ConstraintType.FIELD_REQUIRED,
          fieldKey: quotePayloadFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
      ];

      const specHash = await verifier.hashSpec(schemaHash, constraints);

      const latestBlock = await ethers.provider.getBlock("latest");
      const deadline = latestBlock.timestamp + 60;
      const nonce = ethers.randomBytes(32);

      const taskId = await createCommitmentAndGetTaskId({
        providerAAAddress: providerAA.address,
        providerSignerAddress: providerSigner.address,
        specHash,
        liability: LIABILITY_AMOUNT,
        deadline,
        schemaVersion: 1,
        commitmentNonce: nonce,
      });

      await taskCommitment.connect(providerAA).reserveLiability(taskId);

      const paymentRef = ethers.keccak256(
        ethers.toUtf8Bytes("kite-payment-ref-timeout")
      );
      await taskCommitment.connect(buyer).linkPayment(taskId, paymentRef);

      await ethers.provider.send("evm_increaseTime", [120]);
      await ethers.provider.send("evm_mine");

      await taskCommitment.connect(deployer).expireTask(taskId);

      const state = await taskCommitment.getCommitment(taskId);
      expect(state.taskState).to.equal(6); // Expired

      const [total, liability, available] = await vault.getVaultState(
        providerAA.address
      );
      expect(total).to.equal(ethers.parseUnits("50", 6));
      expect(liability).to.equal(0);
      expect(available).to.equal(ethers.parseUnits("50", 6));
    });
  });

  describe("AttestationRegistry coverage", function () {
    it("records independent attestations across multiple tasks", async function () {
      await registerAndDeposit(LARGE_DEPOSIT_AMOUNT);

      const schemaHash = ethers.keccak256(
        ethers.toUtf8Bytes("market-quote-api/v1")
      );
      const quotePayloadFieldKey = ethers.keccak256(
        ethers.toUtf8Bytes("quotePayloadHash")
      );
      const observedAtFieldKey = ethers.keccak256(
        ethers.toUtf8Bytes("observedAt")
      );

      const latestBlock = await ethers.provider.getBlock("latest");
      const nowTs = latestBlock.timestamp;

      const goodPayload = JSON.stringify({
        pair: "BTC/USD",
        price: "68250.10",
        venue: "demo-provider",
        observedAt: nowTs,
      });

      const expectedQuoteHash = ethers.keccak256(
        ethers.toUtf8Bytes(goodPayload)
      );
      const badQuoteHash = ethers.keccak256(
        ethers.toUtf8Bytes("tampered-payload")
      );

      const constraints = [
        {
          constraintType: ConstraintType.FIELD_REQUIRED,
          fieldKey: quotePayloadFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.HASH_MATCH,
          fieldKey: quotePayloadFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: expectedQuoteHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.FIELD_REQUIRED,
          fieldKey: observedAtFieldKey,
          minValue: 0,
          maxValue: 0,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
        {
          constraintType: ConstraintType.RANGE,
          fieldKey: observedAtFieldKey,
          minValue: nowTs - 60,
          maxValue: nowTs + 60,
          expectedValue: 0,
          expectedHash: ethers.ZeroHash,
          enumMembers: [],
        },
      ];

      const specHash = await verifier.hashSpec(schemaHash, constraints);
      const deadline = nowTs + 86400;

      const passTaskId = await createCommitmentAndGetTaskId({
        providerAAAddress: providerAA.address,
        providerSignerAddress: providerSigner.address,
        specHash,
        liability: LIABILITY_AMOUNT,
        deadline,
        schemaVersion: 1,
        commitmentNonce: ethers.randomBytes(32),
      });

      await taskCommitment.connect(providerAA).reserveLiability(passTaskId);

      const passPaymentRef = ethers.keccak256(
        ethers.toUtf8Bytes("registry-pass-payment")
      );
      await taskCommitment.connect(buyer).linkPayment(passTaskId, passPaymentRef);

      const passCommitment = await taskCommitment.getCommitment(passTaskId);

      const passFields = [
        {
          fieldKey: quotePayloadFieldKey,
          exists: true,
          intValue: 0,
          hashValue: expectedQuoteHash,
          addrValue: ethers.ZeroAddress,
          boolValue: false,
          valueType: ValueType.HASH,
        },
        {
          fieldKey: observedAtFieldKey,
          exists: true,
          intValue: nowTs,
          hashValue: ethers.ZeroHash,
          addrValue: ethers.ZeroAddress,
          boolValue: false,
          valueType: ValueType.INT,
        },
      ];

      const passDelivery = await signDelivery({
        taskId: passTaskId,
        outputHash: expectedQuoteHash,
        timestamp: nowTs,
        schemaVersion: 1,
        signer: providerSigner,
        providerNonce: ethers.randomBytes(32),
        paymentReference: passCommitment.paymentReference,
      });

      await taskCommitment
        .connect(providerAA)
        .submitDelivery(
          passTaskId,
          schemaHash,
          passDelivery,
          passFields,
          constraints
        );

      const failTaskId = await createCommitmentAndGetTaskId({
        providerAAAddress: providerAA.address,
        providerSignerAddress: providerSigner.address,
        specHash,
        liability: LIABILITY_AMOUNT,
        deadline,
        schemaVersion: 1,
        commitmentNonce: ethers.randomBytes(32),
      });

      await taskCommitment.connect(providerAA).reserveLiability(failTaskId);

      const failPaymentRef = ethers.keccak256(
        ethers.toUtf8Bytes("registry-fail-payment")
      );
      await taskCommitment.connect(buyer).linkPayment(failTaskId, failPaymentRef);

      const failCommitment = await taskCommitment.getCommitment(failTaskId);

      const failFields = [
        {
          fieldKey: quotePayloadFieldKey,
          exists: true,
          intValue: 0,
          hashValue: badQuoteHash,
          addrValue: ethers.ZeroAddress,
          boolValue: false,
          valueType: ValueType.HASH,
        },
        {
          fieldKey: observedAtFieldKey,
          exists: true,
          intValue: nowTs,
          hashValue: ethers.ZeroHash,
          addrValue: ethers.ZeroAddress,
          boolValue: false,
          valueType: ValueType.INT,
        },
      ];

      const failDelivery = await signDelivery({
        taskId: failTaskId,
        outputHash: badQuoteHash,
        timestamp: nowTs,
        schemaVersion: 1,
        signer: providerSigner,
        providerNonce: ethers.randomBytes(32),
        paymentReference: failCommitment.paymentReference,
      });

      await taskCommitment
        .connect(providerAA)
        .submitDelivery(
          failTaskId,
          schemaHash,
          failDelivery,
          failFields,
          constraints
        );

      const passAttestation = await registry.getAttestation(passTaskId);
      const failAttestation = await registry.getAttestation(failTaskId);

      expect(passAttestation.passed).to.equal(true);
      expect(failAttestation.passed).to.equal(false);
      expect(passAttestation.provider).to.equal(providerAA.address);
      expect(failAttestation.provider).to.equal(providerAA.address);
    });
  });
});