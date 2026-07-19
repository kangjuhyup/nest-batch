export const toAsyncIterable = async function* <T>(
  items: AsyncIterable<T> | Iterable<T>
): AsyncIterable<T> {
  for await (const item of items) {
    yield item;
  }
};
