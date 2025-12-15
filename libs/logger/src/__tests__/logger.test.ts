import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadLogger = async () => import('../index.js');

describe('logger', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('defaults to info level', async () => {
    const { getLogLevel } = await loadLogger();

    expect(getLogLevel()).toBe('INFO');
  });

  it('emits info and above at the default log level', async () => {
    const { createLogger } = await loadLogger();

    const trace = vi.spyOn(console, 'trace').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createLogger('test');

    logger.trace('first-trace');
    logger.debug('first-debug');
    logger.info('first-info');
    logger.error('first-error');

    expect(trace).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('[test] first-info');
    expect(error).toHaveBeenCalledWith('[test] first-error');
  });

  it('allows enabling verbose logging via setLogLevel', async () => {
    const { createLogger, setLogLevel, getLogLevel } = await loadLogger();

    const trace = vi.spyOn(console, 'trace').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    setLogLevel('TRACE');

    const logger = createLogger('test');

    logger.trace('second-trace', { value: 0 });
    logger.debug('second-debug', { value: 1 });
    logger.info('second-info', { value: 2 });

    expect(getLogLevel()).toBe('TRACE');
    expect(trace).toHaveBeenCalledWith('[test] second-trace', { value: 0 });
    expect(debug).toHaveBeenCalledWith('[test] second-debug', { value: 1 });
    expect(info).toHaveBeenCalledWith('[test] second-info', { value: 2 });
  });

  it('respects thresholds when raising the log level', async () => {
    const { createLogger, setLogLevel } = await loadLogger();

    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createLogger('threshold');

    setLogLevel('WARN');

    logger.debug('skip-debug');
    logger.info('skip-info');
    logger.warn('emit-warn', { reason: 'threshold' });
    logger.error('emit-error');

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[threshold] emit-warn', {
      reason: 'threshold',
    });
    expect(error).toHaveBeenCalledWith('[threshold] emit-error');
  });
});
