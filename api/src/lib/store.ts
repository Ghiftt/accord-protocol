import type { CommitmentInput, SignedDelivery, TaskState } from "./accordTypes";

export interface DemoTaskRecord {
  taskId: string;
  specHash: string;
  commitment?: CommitmentInput;
  state: TaskState;
  paymentReference?: string;
  signedDelivery?: SignedDelivery;
  result?: {
    status: "PASS" | "FAIL" | "TIMEOUT";
    reason: string;
  };
}

const tasks = new Map<string, DemoTaskRecord>();

export function saveTask(task: DemoTaskRecord): DemoTaskRecord {
  tasks.set(task.taskId, task);
  return task;
}

export function getTask(taskId: string): DemoTaskRecord | undefined {
  return tasks.get(taskId);
}

export function listTasks(): DemoTaskRecord[] {
  return [...tasks.values()];
}