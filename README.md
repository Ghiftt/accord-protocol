---

# **ACCORD — Deterministic Agent SLA Enforcement for Provable Outcomes**

---

## **Overview**

**ACCORD is an on-chain enforcement system that makes agent payments conditional on provable outcomes.**

It is designed for agent-to-agent payments using x402, where execution is fast and autonomous, but outcome correctness is not guaranteed.

When you send an agent to pay for a task, you should not have to hope the result is correct. ACCORD makes correctness enforceable.

ACCORD does not evaluate quality, intent, or effort. It only enforces what can be strictly defined and verified.

---

## **The Problem**

In agent-based systems today, agents can discover services and execute payments automatically. Payments settle instantly using x402. But services return outputs with no built-in enforcement of correctness.

If a service returns incorrect data, incomplete output, or nothing at all — the payment still succeeds.

There is no deterministic mechanism that ties payment to a provable outcome.

Existing approaches try to solve this with escrow systems that delay payment flow, reputation systems that rely on history rather than enforcement, or arbitration that requires human judgment. None of these provide a mechanical, on-chain consequence for failure.

---

## **What ACCORD Does**

ACCORD reduces enforcement to a single invariant:

* a task is defined as a set of strict, verifiable constraints
* the service backs its claim with a bond
* the result is checked on-chain
* failure results in automatic slashing

There is no interpretation layer between output and consequence.

---

## **Core Mechanism**

> **Define the outcome. Lock a bond. If the result doesn’t match, the money is lost.**

---

## **System Flow**

### **1. Define**

The expected outcome is expressed using fixed schemas and deterministic constraint types — numeric ranges, exact value equality, hash matches, deadlines. These constraints define what counts as success.

---

### **2. Commit**

The full specification is hashed and stored on-chain. This is the immutable reference for verification. Nobody can change what success means after the fact.

---

### **3. Bond**

The service locks a bond before execution. This is not a deposit — it is a public commitment that the output will satisfy the constraints. Skin in the game.

---

### **4. Pay**

Payment is executed using x402. ACCORD does not intercept, delay, escrow, or modify the payment flow.

**The service gets paid first. Then it has to prove it delivered.**

---

### **5. Deliver**

The service submits its result as ABI-encoded data matching the expected schema.

---

### **6. Verify**

A deterministic Solidity contract evaluates the submitted output against the original constraints.

The result is binary:

* PASS
* FAIL

No external inputs. No opinions.

---

### **7. Enforce**

* PASS → bond is returned
* FAIL → bond is slashed automatically

The outcome is final.

---
 

## **Spec Compiler**

Defining deterministic constraints manually is complex. ACCORD includes a spec compiler that converts natural language intent into structured, verifiable specifications.

---

**Input**

> "Fetch the current BTC price from Binance and return it with a timestamp no older than 5 seconds"

---

**Compiled Output**

* schema: `{ price: uint256, timestamp: uint256 }`
* constraints:

  * `price > 0`
  * `timestamp ≥ now - 5s`
  * `source == BINANCE_API`

---

Agents pay for real-time price data dozens of times per minute in trading and research workflows. A stale price or wrong source can cause real financial loss.

The service cannot claim a valid or fresh response unless these constraints are actually satisfied. If it returns incorrect, stale, or fabricated data — the bond is slashed automatically.

The compiler is off-chain and does not participate in verification. It only produces the specification that the on-chain system enforces.

---


## **Proof Trail on Kite**

Every key action emits an on-chain event — commitment creation, bond locking, output submission, verification result, enforcement outcome.

Together these form a verifiable trail of:

* what was agreed
* what was delivered
* what consequence followed

This is ACCORD’s proof trail on Kite, indexed and visible in real time.

---

## **Kite Integration**

ACCORD is built on KiteAI Testnet and uses x402 as its payment rail.

* on-chain contracts handle verification and enforcement natively on Kite
* agent identity can be tied to Kite identity systems
* coordination can be automated via account abstraction and session keys

No modification to Kite’s payment flow is required.

---

## **Design Constraints**

ACCORD only works when outcomes are:

* strictly defined
* machine-verifiable
* deterministic

It does not support:

* subjective evaluation
* probabilistic outputs
* creative or open-ended tasks

This is intentional. The moment you introduce judgment, you lose enforcement.

---

## **Why This Matters**

As agents become capable of discovering services, executing payments, and coordinating tasks autonomously, they need systems that ensure outcomes are not optional and failure has consequence.

Without enforcement, autonomy introduces risk.

ACCORD exists so that:

> **your agent either gets what it paid for — or the service loses money automatically.**

---

Built for the KiteAI Hackathon 2026.
























