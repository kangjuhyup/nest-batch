export default async function slowWorker({ delayMs }) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return { done: true };
}
