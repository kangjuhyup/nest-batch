import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestBatchRunner } from "@nest-batch/nest";
import { AppModule } from "./app.module.js";

const app = await NestFactory.createApplicationContext(AppModule);

await app.get(NestBatchRunner).run(
  "daily-billing",
  { tenant: "example" },
  { ownerId: "nestjs-example-main" }
);

await app.close();
