export const createPostgresScaffoldError = (component: string): Error =>
  new Error(`Postgres ${component} is scaffolded but not implemented yet.`);
