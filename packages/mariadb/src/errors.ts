export const createMariaDbScaffoldError = (component: string): Error =>
  new Error(`MariaDB ${component} is scaffolded but not implemented yet.`);
