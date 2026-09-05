import type {
  ScheduleClaimOptions,
  ScheduleFindLatestOccurrenceOptions,
  ScheduleListOccurrencesOptions,
  ScheduleMarkDispatchedOptions,
  ScheduleMarkFailedOptions,
  ScheduleOccurrence,
  ScheduleOccurrenceCandidate,
  ScheduleStore
} from "@rv-nest-batch/core/scheduler";

export class InMemoryScheduleStore implements ScheduleStore {
  private readonly occurrences = new Map<string, ScheduleOccurrence>();

  async findLatestOccurrence(
    scheduleName: string,
    options: ScheduleFindLatestOccurrenceOptions = {}
  ): Promise<ScheduleOccurrence | undefined> {
    const occurrence = [...this.occurrences.values()]
      .filter((candidate) => candidate.scheduleName === scheduleName)
      .filter((candidate) => matchesStatuses(candidate, options.statuses))
      .sort(compareOccurrenceDesc)[0];

    return occurrence ? cloneOccurrence(occurrence) : undefined;
  }

  async listOccurrences(
    options: ScheduleListOccurrencesOptions = {}
  ): Promise<readonly ScheduleOccurrence[]> {
    return [...this.occurrences.values()]
      .filter((candidate) => options.scheduleName === undefined || candidate.scheduleName === options.scheduleName)
      .filter((candidate) => options.status === undefined || candidate.status === options.status)
      .sort(compareOccurrenceDesc)
      .slice(0, normalizeLimit(options.limit))
      .map(cloneOccurrence);
  }

  async claimOccurrence(
    candidate: ScheduleOccurrenceCandidate,
    options: ScheduleClaimOptions
  ): Promise<ScheduleOccurrence | undefined> {
    const key = occurrenceKey(candidate.scheduleName, candidate.occurrenceId);
    const existing = this.occurrences.get(key);

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
    this.occurrences.set(key, cloneOccurrence(claimed));
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
    const stored = this.occurrences.get(occurrenceKey(occurrence.scheduleName, occurrence.occurrenceId));

    if (!stored || stored.status !== "claimed" || stored.ownerId !== ownerId) {
      return false;
    }

    this.occurrences.set(occurrenceKey(occurrence.scheduleName, occurrence.occurrenceId), cloneOccurrence(next));
    return true;
  }
}

const occurrenceKey = (scheduleName: string, occurrenceId: string): string =>
  `${scheduleName}\u0000${occurrenceId}`;

const matchesStatuses = (
  occurrence: ScheduleOccurrence,
  statuses: readonly ScheduleOccurrence["status"][] | undefined
): boolean => statuses === undefined || statuses.length === 0 || statuses.includes(occurrence.status);

const normalizeLimit = (limit: number | undefined): number | undefined => {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError("Schedule occurrence list limit must be a non-negative safe integer.");
  }
  return limit;
};

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
