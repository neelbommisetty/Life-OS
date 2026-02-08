import { describe, expect, test } from "bun:test";
import { createLogger, getLogLevel, setLogLevel } from "../index.js";

describe("packages/logger", () => {
  test("creates namespaced logger methods", () => {
    const logger = createLogger("logger:test");

    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.fatal).toBe("function");
  });

  test("updates and returns log level", () => {
    const original = getLogLevel();

    try {
      setLogLevel("DEBUG");
      expect(getLogLevel()).toBe("DEBUG");

      setLogLevel("ERROR");
      expect(getLogLevel()).toBe("ERROR");
    } finally {
      setLogLevel(original);
    }
  });
});
