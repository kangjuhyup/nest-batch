import { describe, expect, it } from "vitest";
import { defineJob, defineStep } from "@nest-batch/core";
import { InMemoryBatchStorage } from "@nest-batch/inmemory";
import { runCli } from "../src/index.js";

describe("runCli / runCli 동작을 검증한다", () => {
  it("prints help for empty args / 빈 인자에 대해 help를 출력한다", async () => {
    await expect(runCli([])).resolves.toEqual({
      exitCode: 0,
      output: "nest-batch commands: run, status, retry, list"
    });
  });

  it("rejects unknown commands / 알 수 없는 command를 거부한다", async () => {
    await expect(runCli(["unknown"])).resolves.toEqual({
      exitCode: 1,
      output: 'Unknown command "unknown".'
    });
  });

  it("lists registered jobs / 등록된 job 목록을 출력한다", async () => {
    const jobs = [
      defineJob({
        name: "daily-user-import",
        steps: [noopStep("daily-user-import")]
      }),
      defineJob({
        name: "billing-export",
        steps: [noopStep("billing-export")]
      })
    ];

    const result = await runCli(["list"], { jobs });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toEqual({
      jobs: ["billing-export", "daily-user-import"]
    });
  });

  it("runs a registered job with storage / storage를 사용해 등록된 job을 실행한다", async () => {
    const storage = new InMemoryBatchStorage();
    const job = defineJob({
      name: "daily-user-import",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });

    const result = await runCli(
      [
        "run",
        "--job",
        "daily-user-import",
        "--parameters",
        '{"tenant":"acme"}',
        "--execution-id",
        "cli-execution-1"
      ],
      { storage, jobs: [job] }
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      command: "run",
      execution: {
        id: "cli-execution-1",
        jobName: "daily-user-import",
        status: "completed",
        parameters: { tenant: "acme" }
      },
      steps: [
        {
          stepName: "load-users",
          status: "completed"
        }
      ]
    });
    await expect(storage.repository.findById("cli-execution-1")).resolves.toMatchObject({
      id: "cli-execution-1",
      status: "completed"
    });
  });

  it("prints execution status from storage / storage에서 execution 상태를 출력한다", async () => {
    const storage = new InMemoryBatchStorage();
    const job = defineJob({
      name: "daily-user-import",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            return "loaded";
          }
        })
      ]
    });
    await runCli(
      ["run", "--job", "daily-user-import", "--execution-id", "cli-execution-2"],
      { storage, jobs: [job] }
    );

    const result = await runCli(["status", "--execution-id", "cli-execution-2"], { storage });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      command: "status",
      execution: {
        id: "cli-execution-2",
        status: "completed"
      },
      steps: [
        {
          stepName: "load-users",
          status: "completed"
        }
      ]
    });
  });

  it("retries a failed job execution / 실패한 job execution을 재시도한다", async () => {
    const storage = new InMemoryBatchStorage();
    let attempts = 0;
    const job = defineJob({
      name: "flaky-import",
      steps: [
        defineStep({
          name: "load-users",
          execute() {
            attempts += 1;

            if (attempts === 1) {
              throw new Error("temporary failure");
            }

            return "loaded";
          }
        })
      ]
    });

    const failed = await runCli(
      [
        "run",
        "--job",
        "flaky-import",
        "--parameters",
        '{"tenant":"acme"}',
        "--execution-id",
        "failed-execution"
      ],
      { storage, jobs: [job] }
    );
    const retried = await runCli(
      [
        "retry",
        "--job",
        "flaky-import",
        "--parameters",
        '{"tenant":"acme"}',
        "--execution-id",
        "retry-execution"
      ],
      { storage, jobs: [job] }
    );

    expect(failed.exitCode).toBe(1);
    expect(JSON.parse(failed.output).execution.status).toBe("failed");
    expect(retried.exitCode).toBe(0);
    expect(JSON.parse(retried.output)).toMatchObject({
      command: "retry",
      execution: {
        id: "retry-execution",
        status: "completed"
      }
    });
  });
});

const noopStep = (name: string) =>
  defineStep({
    name: `${name}-step`,
    execute() {
      return undefined;
    }
  });
