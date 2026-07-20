import { Module } from "@nestjs/common";
import {
  CursorReaderExample,
  FunctionReaderExample,
  IterableReaderExample,
  PageReaderExample
} from "./reader-examples.reader.js";

@Module({
  providers: [
    IterableReaderExample,
    FunctionReaderExample,
    CursorReaderExample,
    PageReaderExample
  ],
  exports: [
    IterableReaderExample,
    FunctionReaderExample,
    CursorReaderExample,
    PageReaderExample
  ]
})
export class ReaderExamplesModule {}
