export const createScheduleOccurrenceId = (scheduleName: string, scheduledAt: Date): string => {
  return `schedule:${scheduleName}:${scheduledAt.toISOString()}`;
};
