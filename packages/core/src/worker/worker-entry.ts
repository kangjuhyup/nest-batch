export const workerEntrySource = `
const { parentPort, workerData } = require("node:worker_threads");

const serializeError = (error) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "Error",
    message: String(error)
  };
};

(async () => {
  try {
    const { moduleUrl, payload } = workerData;
    const module = await import(moduleUrl);
    const runner = typeof module.default === "function" ? module.default : module.run;

    if (typeof runner !== "function") {
      throw new TypeError("Worker thread module must export a default function or run function.");
    }

    const result = await runner(payload);
    parentPort?.postMessage({ ok: true, result });
  } catch (error) {
    parentPort?.postMessage({ ok: false, error: serializeError(error) });
  }
})();
`;
