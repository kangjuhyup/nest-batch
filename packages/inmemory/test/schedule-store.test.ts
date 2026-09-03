import { describe, expect, it } from "vitest";
import { InMemoryScheduleStore } from "@nest-batch/inmemory";

describe("inmemory schedule store / inmemory schedule store를 검증한다", () => {
  it("claims dispatches and fails occurrences / occurrence claim dispatch fail을 저장한다", async () => {
    const store = new InMemoryScheduleStore();
    const candidate = {
      scheduleName: "billing.daily",
      occurrenceId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
      scheduledAt: new Date("2026-01-01T00:00:00.000Z")
    };

    const claimed = await store.claimOccurrence(candidate, {
      ownerId: "scheduler-1",
      claimedAt: new Date("2026-01-01T00:00:01.000Z"),
      claimTtlMs: 30_000
    });

    expect(claimed).toMatchObject({
      occurrenceId: candidate.occurrenceId,
      status: "claimed",
      ownerId: "scheduler-1"
    });
    await expect(
      store.markDispatched(claimed!, {
        ownerId: "scheduler-1",
        dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
      })
    ).resolves.toBe(true);
    await expect(store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId: candidate.occurrenceId,
      status: "dispatched"
    });
  });

  it("rejects owned completion from another owner / 다른 owner의 완료 기록을 거부한다", async () => {
    const store = new InMemoryScheduleStore();
    const claimed = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "schedule:billing.daily:2026-01-01T00:00:00.000Z",
        scheduledAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-1",
        claimedAt: new Date("2026-01-01T00:00:01.000Z")
      }
    );

    await expect(
      store.markDispatched(claimed!, {
        ownerId: "scheduler-2",
        dispatchedAt: new Date("2026-01-01T00:00:02.000Z")
      })
    ).resolves.toBe(false);
  });

  it("records dispatch failures / dispatch 실패를 기록한다", async () => {
    const store = new InMemoryScheduleStore();
    const claimed = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
        scheduledAt: new Date("2026-01-02T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-1",
        claimedAt: new Date("2026-01-02T00:00:01.000Z")
      }
    );

    await expect(
      store.markFailed(claimed!, {
        ownerId: "scheduler-1",
        failedAt: new Date("2026-01-02T00:00:02.000Z"),
        failureReason: "enqueue failed"
      })
    ).resolves.toBe(true);

    await expect(store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      occurrenceId: "schedule:billing.daily:2026-01-02T00:00:00.000Z",
      status: "failed",
      failureReason: "enqueue failed"
    });
  });

  it("keeps occurrence ids scoped by schedule name / occurrence id를 schedule name별로 분리한다", async () => {
    const store = new InMemoryScheduleStore();
    const sharedOccurrenceId = "shared-occurrence";

    const billing = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: sharedOccurrenceId,
        scheduledAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        ownerId: "billing-scheduler",
        claimedAt: new Date("2026-01-01T00:00:01.000Z")
      }
    );
    const settlement = await store.claimOccurrence(
      {
        scheduleName: "settlement.daily",
        occurrenceId: sharedOccurrenceId,
        scheduledAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        ownerId: "settlement-scheduler",
        claimedAt: new Date("2026-01-01T00:00:01.000Z")
      }
    );

    expect(billing).toMatchObject({ scheduleName: "billing.daily" });
    expect(settlement).toMatchObject({ scheduleName: "settlement.daily" });
    await expect(store.findLatestOccurrence("billing.daily")).resolves.toMatchObject({
      ownerId: "billing-scheduler"
    });
    await expect(store.findLatestOccurrence("settlement.daily")).resolves.toMatchObject({
      ownerId: "settlement-scheduler"
    });
  });

  it("filters latest occurrences by status / status로 latest occurrence를 필터링한다", async () => {
    const store = new InMemoryScheduleStore();
    const claimed = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "occ-failed",
        scheduledAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-1",
        claimedAt: new Date("2026-01-01T00:00:01.000Z")
      }
    );
    await store.markFailed(claimed!, {
      ownerId: "scheduler-1",
      failedAt: new Date("2026-01-01T00:00:02.000Z"),
      failureReason: "enqueue failed"
    });
    await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "occ-claimed",
        scheduledAt: new Date("2026-01-02T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-2",
        claimedAt: new Date("2026-01-02T00:00:01.000Z")
      }
    );

    await expect(
      store.findLatestOccurrence("billing.daily", { statuses: ["failed"] })
    ).resolves.toMatchObject({
      occurrenceId: "occ-failed",
      status: "failed"
    });
  });

  it("lists occurrences by status and limit / status와 limit으로 occurrence 목록을 조회한다", async () => {
    const store = new InMemoryScheduleStore();
    const first = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "occ-1",
        scheduledAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-1",
        claimedAt: new Date("2026-01-01T00:00:01.000Z")
      }
    );
    const second = await store.claimOccurrence(
      {
        scheduleName: "billing.daily",
        occurrenceId: "occ-2",
        scheduledAt: new Date("2026-01-02T00:00:00.000Z")
      },
      {
        ownerId: "scheduler-1",
        claimedAt: new Date("2026-01-02T00:00:01.000Z")
      }
    );
    await store.markFailed(first!, {
      ownerId: "scheduler-1",
      failedAt: new Date("2026-01-01T00:00:02.000Z"),
      failureReason: "first"
    });
    await store.markFailed(second!, {
      ownerId: "scheduler-1",
      failedAt: new Date("2026-01-02T00:00:02.000Z"),
      failureReason: "second"
    });

    await expect(store.listOccurrences({ status: "failed", limit: 1 })).resolves.toMatchObject([
      { occurrenceId: "occ-2", failureReason: "second" }
    ]);
  });
});
