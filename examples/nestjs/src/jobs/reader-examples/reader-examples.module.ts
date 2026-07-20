import { Module } from "@nestjs/common";
import {
  CursorReaderExample,
  FileReaderExample,
  FunctionReaderExample,
  HttpReaderExample,
  IterableReaderExample,
  PageReaderExample,
  SqlReaderExample
} from "./reader-examples.reader.js";

@Module({
  providers: [
    IterableReaderExample,
    FunctionReaderExample,
    CursorReaderExample,
    PageReaderExample,
    SqlReaderExample,
    HttpReaderExample,
    FileReaderExample
  ],
  exports: [
    IterableReaderExample,
    FunctionReaderExample,
    CursorReaderExample,
    PageReaderExample,
    SqlReaderExample,
    HttpReaderExample,
    FileReaderExample
  ]
})
export class ReaderExamplesModule {}
