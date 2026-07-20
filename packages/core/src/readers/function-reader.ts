import type { ChunkStepExecutionContext } from "../types/step.js";
import { createIterableSession, type Reader, type ReaderSession } from "./reader.js";

export interface FunctionReader<Item, TCheckpoint = unknown> extends Reader<Item, TCheckpoint> {}

export interface FunctionReaderDefinition<Item, TCheckpoint = unknown> {
  readonly kind: "function";
  readonly read: ReaderFunction<Item, TCheckpoint>;
}

export type ReaderFunction<Item, TCheckpoint = unknown> = (
  context: ChunkStepExecutionContext<TCheckpoint>
) =>
  | AsyncIterable<Item>
  | Iterable<Item>
  | ReaderSession<Item, TCheckpoint>
  | Promise<AsyncIterable<Item> | Iterable<Item> | ReaderSession<Item, TCheckpoint>>;

export const createFunctionReader = <Item, TCheckpoint = unknown>(
  read: ReaderFunction<Item, TCheckpoint>
): FunctionReader<Item, TCheckpoint> => ({
  async open(context) {
    const result = await read(context);

    if (hasSessionLifecycle<Item, TCheckpoint>(result)) {
      return result;
    }

    return createIterableSession<Item, TCheckpoint>(result);
  }
});

const hasSessionLifecycle = <Item, TCheckpoint>(
  value: AsyncIterable<Item> | Iterable<Item> | ReaderSession<Item, TCheckpoint>
): value is ReaderSession<Item, TCheckpoint> => {
  return typeof value === "object" && value !== null && ("checkpoint" in value || "close" in value);
};
