export const createMySqlScaffoldError = (component: string): Error =>
  new Error(`MySQL ${component} is scaffolded but not implemented yet.`);
