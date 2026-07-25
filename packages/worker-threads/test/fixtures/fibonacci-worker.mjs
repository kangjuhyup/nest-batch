export default function fibonacciWorker({ n }) {
  const fibonacci = (value) => {
    if (value <= 1) {
      return value;
    }

    return fibonacci(value - 1) + fibonacci(value - 2);
  };

  return { value: fibonacci(n) };
}
