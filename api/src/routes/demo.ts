import { Router } from "express";
import { getTask, listTasks, saveTask } from "../lib/store";
import { hashTaskSpec } from "../lib/specHash";
import type {
  CommitmentInput,
  DeliveryPayload,
  SignedDelivery
} from "../lib/accordTypes";

export const demoRouter = Router();

demoRouter.get("/tasks", (_req, res) => {
  res.json({ tasks: listTasks() });
});

demoRouter.post("/task/create", (req, res) => {
  const input = req.body as CommitmentInput;
  const specHash = hashTaskSpec(input.spec);

  const record = saveTask({
    taskId: input.taskId,
    specHash,
    commitment: input,
    state: "CommitmentCreated"
  });

  res.json(record);
});

demoRouter.post("/task/:taskId/reserve", (req, res) => {
  const task = getTask(req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (task.state !== "CommitmentCreated") {
    return res.status(400).json({
      error: `Cannot reserve from state ${task.state}`
    });
  }

  task.state = "LiabilityReserved";
  saveTask(task);

  res.json(task);
});

demoRouter.post("/task/:taskId/link-payment", (req, res) => {
  const task = getTask(req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (task.state !== "LiabilityReserved") {
    return res.status(400).json({
      error: `Cannot link payment from state ${task.state}`
    });
  }

  const { paymentReference } = req.body as { paymentReference: string };

  if (!paymentReference) {
    return res.status(400).json({
      error: "paymentReference required"
    });
  }

  task.paymentReference = paymentReference;
  task.state = "PaymentLinked";
  saveTask(task);

  res.json(task);
});

demoRouter.post("/task/:taskId/submit-delivery", (req, res) => {
  const task = getTask(req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (task.state !== "PaymentLinked") {
    return res.status(400).json({
      error: `Cannot submit delivery from state ${task.state}`
    });
  }

  const delivery = req.body as SignedDelivery;

  if (!delivery?.payload) {
    return res.status(400).json({
      error: "delivery payload required"
    });
  }

  task.signedDelivery = delivery;
  task.state = "DeliverySubmitted";
  task.result = undefined;

  saveTask(task);

  res.json(task);
});

demoRouter.post("/task/:taskId/verify", (req, res) => {
  console.log("NEW VERIFY ROUTE RUNNING");

  const task = getTask(req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (
    task.state === "VerifiedPass" ||
    task.state === "VerifiedFail" ||
    task.state === "Expired"
  ) {
    return res.status(400).json({
      error: "Task already finalized",
      state: task.state,
      result: task.result
    });
  }

  if (task.state !== "DeliverySubmitted") {
    return res.status(400).json({
      error: `Cannot verify from state ${task.state}`
    });
  }

  if (!task.signedDelivery) {
    return res.status(400).json({
      error: "No delivery submitted"
    });
  }

  const payload = task.signedDelivery.payload as DeliveryPayload;

  if (task.paymentReference !== payload.paymentReference) {
    task.state = "VerifiedFail";
    task.result = {
      status: "FAIL",
      reason: "payment mismatch"
    };
    saveTask(task);
    return res.json(task);
  }

  const now = Math.floor(Date.now() / 1000);

  if (now > (task.commitment?.deadlineTimestamp ?? 0)) {
    task.state = "Expired";
    task.result = {
      status: "TIMEOUT",
      reason: "deadline passed"
    };
    saveTask(task);
    return res.json(task);
  }

  if (!payload.outputHash || payload.outputHash === zero32()) {
    task.state = "VerifiedFail";
    task.result = {
      status: "FAIL",
      reason: "invalid output"
    };
    saveTask(task);
    return res.json(task);
  }

  task.state = "VerifiedPass";
  task.result = {
    status: "PASS",
    reason: "verification passed"
  };

  saveTask(task);
  return res.json(task);
});

demoRouter.post("/task/:taskId/reset", (req, res) => {
  const task = getTask(req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  task.state = "CommitmentCreated";
  task.paymentReference = task.commitment?.paymentReference;
  task.signedDelivery = undefined;
  task.result = undefined;

  saveTask(task);

  res.json(task);
});

function zero32(): string {
  return "0x" + "00".repeat(32);
}