import { Injectable, Module } from "@nestjs/common";

export interface IntegrationEventOutboxDispatchResult {
  readonly claimedCount: number;
}

export interface IntegrationEventOutboxDispatchContext {
  readonly workerId: string;
  readonly signal: AbortSignal;
}

export interface IntegrationOutboxMessage {
  readonly id: string;
  readonly event: IntegrationEventPayload;
}

export interface IntegrationEventPayload {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface IntegrationEventPublishContext {
  readonly outboxMessageId: string;
  readonly workerId: string;
  readonly signal: AbortSignal;
}

@Injectable()
export class IntegrationEventPublisher {
  async publish(
    event: IntegrationEventPayload,
    context: IntegrationEventPublishContext
  ): Promise<void> {
    context.signal.throwIfAborted();
    void event;
  }
}

@Injectable()
export class IntegrationEventOutboxDispatcher {
  constructor(private readonly publisher: IntegrationEventPublisher) {}

  async dispatchBatch(
    context: IntegrationEventOutboxDispatchContext
  ): Promise<IntegrationEventOutboxDispatchResult> {
    context.signal.throwIfAborted();
    const messages = await this.claimBatch(context);

    for (const message of messages) {
      context.signal.throwIfAborted();
      await this.publisher.publish(message.event, {
        outboxMessageId: message.id,
        workerId: context.workerId,
        signal: context.signal
      });
    }

    return { claimedCount: messages.length };
  }

  private async claimBatch(
    context: IntegrationEventOutboxDispatchContext
  ): Promise<readonly IntegrationOutboxMessage[]> {
    context.signal.throwIfAborted();
    return [];
  }
}

@Module({
  providers: [IntegrationEventPublisher, IntegrationEventOutboxDispatcher],
  exports: [IntegrationEventOutboxDispatcher]
})
export class VoteOutboxModule {}
