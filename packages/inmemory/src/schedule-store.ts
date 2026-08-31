import type {
  ScheduleClaimOptions,
  ScheduleMarkDispatchedOptions,
  ScheduleMarkFailedOptions,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@nest-batch/scheduler-core";

export class InMemoryScheduleStore implements ScheduleStore {
  private readonly occurrences = new Map<string, ScheduleOccurrence>();

  async findLatestOccurrence(scheduleName: string): Promise<ScheduleOccurrence | undefined> {
    const occurrence = [...this.occurrences.values()]
      .filter((candidate) => candidate.scheduleName === scheduleName)
      .sort(compareOccurrenceDesc)[0];

    return occurrence ? cloneOccurrence(occurrence) : undefined;
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: ScheduleClaimOptions
  ): Promise<ScheduleOccurrence | undefined> {
    const existing = this.occurrences.get(candidate.occurrenceId);

    if (existing && !canReclaim(existing, options.claimedAt)) {
      return undefined;
    }

    const claimed: ScheduleOccurrence = {
      ...candidate,
      status: "claimed",
      ownerId: options.ownerId,
      claimedAt: options.claimedAt,
      claimExpiresAt:
        options.claimTtlMs === undefined
          ? undefined
          : new Date(options.claimedAt.getTime() + options.claimTtlMs)
    };
    this.occurrences.set(claimed.occurrenceId, cloneOccurrence(claimed));
    return cloneOccurrence(claimed);
  }

  async markDispatched(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkDispatchedOptions
  ): Promise<boolean> {
    return this.updateOwned(occurrence, options.ownerId, {
      ...occurrence,
      status: "dispatched",
      dispatchedAt: options.dispatchedAt
    });
  }

  async markFailed(
    occurrence: ScheduleOccurrence,
    options: ScheduleMarkFailedOptions
  ): Promise<boolean> {
    return this.updateOwned(occurrence, options.ownerId, {
      ...occurrence,
      status: "failed",
      failedAt: options.failedAt,
      failureReason: options.failureReason
    });
  }

  private updateOwned(
    occurrence: ScheduleOccurrence,
    ownerId: string,
    next: ScheduleOccurrence
  ): boolean {
    const stored = this.occurrences.get(occurrence.occurrenceId);

    if (!stored || stored.status !== "claimed" || stored.ownerId !== ownerId) {
      return false;
    }

    this.occurrences.set(occurrence.occurrenceId, cloneOccurrence(next));
    return true;
  }
}

const canReclaim = (occurrence: ScheduleOccurrence, now: Date): boolean =>
  occurrence.status === "claimed" &&
  occurrence.claimExpiresAt !== undefined &&
  occurrence.claimExpiresAt.getTime() <= now.getTime();

const cloneOccurrence = (occurrence: ScheduleOccurrence): ScheduleOccurrence => ({
  ...occurrence,
  scheduledAt: new Date(occurrence.scheduledAt),
  claimedAt: occurrence.claimedAt ? new Date(occurrence.claimedAt) : undefined,
  claimExpiresAt: occurrence.claimExpiresAt ? new Date(occurrence.claimExpiresAt) : undefined,
  dispatchedAt: occurrence.dispatchedAt ? new Date(occurrence.dispatchedAt) : undefined,
  failedAt: occurrence.failedAt ? new Date(occurrence.failedAt) : undefined
});

const compareOccurrenceDesc = (
  left: ScheduleOccurrence,
  right: ScheduleOccurrence
): number => {
  const diff = right.scheduledAt.getTime() - left.scheduledAt.getTime();
  return diff === 0 ? right.occurrenceId.localeCompare(left.occurrenceId) : diff;
};
