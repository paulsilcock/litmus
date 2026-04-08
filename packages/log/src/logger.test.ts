import { Logger as LoggerBase, logContext } from "@litmus/core/log";
import { describe, expect, it } from "vite-plus/test";

import { Logger } from "#litmus-log/logger.ts";

interface LogLine {
  level: number;
  msg: string;
  [key: string]: unknown;
}

function captureLogs() {
  const lines: LogLine[] = [];
  const stream = {
    write(chunk: string) {
      for (const line of chunk.trim().split("\n")) {
        if (line) lines.push(JSON.parse(line));
      }
    },
  };
  return { stream, lines };
}

describe("Logger", () => {
  it("info writes a structured log line with the message and data", () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream });

    logger.info("user created", { userId: "user_1" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      msg: "user created",
      userId: "user_1",
    });
  });

  it("runWithContext adds fields to logs emitted inside the callback", () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream });

    LoggerBase.runWithContext({ requestId: "r1" }, () => {
      logger.info("processing");
    });

    expect(lines[0]).toMatchObject({
      msg: "processing",
      requestId: "r1",
    });
  });

  it("nested runWithContext merges fields with the outer context", () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream });

    LoggerBase.runWithContext({ requestId: "r1" }, () => {
      LoggerBase.runWithContext({ userId: "user_1" }, () => {
        logger.info("hi");
      });
    });

    expect(lines[0]).toMatchObject({
      msg: "hi",
      requestId: "r1",
      userId: "user_1",
    });
  });

  it("context only applies inside the runWithContext scope", () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream });

    LoggerBase.runWithContext({ requestId: "r1" }, () => {
      logger.info("inside");
    });
    logger.info("outside");

    expect(lines[0]).toMatchObject({ msg: "inside", requestId: "r1" });
    expect(lines[1]).toMatchObject({ msg: "outside" });
    expect(lines[1]).not.toHaveProperty("requestId");
  });

  it("logContext binds ClassName.methodName to logs emitted inside the method", async () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream });

    class PlaceOrder {
      @logContext()
      async handle(_cmd: { customerId: string }) {
        logger.info("placing");
      }
    }

    await new PlaceOrder().handle({ customerId: "cust_1" });

    expect(lines[0]).toMatchObject({
      msg: "placing",
      context: "PlaceOrder.handle",
    });
  });

  it("logContext does not log method args by default", async () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream });

    class PlaceOrder {
      @logContext()
      async handle(_cmd: { customerId: string; secret: string }) {
        logger.info("placing");
      }
    }

    await new PlaceOrder().handle({ customerId: "cust_1", secret: "shhh" });

    expect(lines[0]).not.toHaveProperty("secret");
    expect(lines[0]).not.toHaveProperty("customerId");
    expect(lines[0]).not.toHaveProperty("arg0");
  });

  it("logContext mapper merges its returned fields into the context", async () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream });

    class PlaceOrder {
      @logContext((cmd: { customerId: string; secret: string }) => ({
        customerId: cmd.customerId,
      }))
      async handle(_cmd: { customerId: string; secret: string }) {
        logger.info("placing");
      }
    }

    await new PlaceOrder().handle({ customerId: "cust_1", secret: "shhh" });

    expect(lines[0]).toMatchObject({
      msg: "placing",
      context: "PlaceOrder.handle",
      customerId: "cust_1",
    });
    expect(lines[0]).not.toHaveProperty("secret");
  });

  it("context propagates across awaits inside async methods", async () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream });

    class PlaceOrder {
      @logContext()
      async handle() {
        logger.info("before");
        await new Promise((r) => setTimeout(r, 1));
        logger.info("after");
      }
    }

    await new PlaceOrder().handle();

    expect(lines[0]).toMatchObject({
      msg: "before",
      context: "PlaceOrder.handle",
    });
    expect(lines[1]).toMatchObject({
      msg: "after",
      context: "PlaceOrder.handle",
    });
  });

  it("debug is suppressed when level is info", () => {
    const { stream, lines } = captureLogs();
    const logger = new Logger({ destination: stream, level: "info" });

    logger.debug("noisy");
    logger.info("important");

    expect(lines).toHaveLength(1);
    expect(lines[0]?.msg).toBe("important");
  });
});
