import path from 'node:path';
import { vol } from 'memfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs');

const { getActionDirs, runBuildActions } = await import('./build-actions.ts');

const rootDir = '/repo';

function seedFs(files: Record<string, string>): void {
  vol.fromJSON(files, rootDir);
}

beforeEach(() => {
  vol.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getActionDirs', () => {
  it('returns root-managed actions only', () => {
    seedFs({
      '/repo/alpha/action.yml': '',
      '/repo/beta/README.md': '',
      '/repo/.github/action.yml': '',
      '/repo/project-assigner/action.yml': '',
      '/repo/scripts/action.yml': '',
    });

    expect(getActionDirs(rootDir).sort()).toEqual(
      [path.join(rootDir, 'alpha'), path.join(rootDir, 'project-assigner')].sort(),
    );
  });
});

describe('runBuildActions', () => {
  it('returns an error when ncc is unavailable', () => {
    const error = vi.fn();

    expect(runBuildActions({ rootDir, error })).toBe(1);
    expect(error).toHaveBeenCalledWith('ncc is not installed. Run pnpm install before building actions.');
  });

  it('skips building when no root-managed actions exist', () => {
    const log = vi.fn();
    seedFs({
      '/repo/node_modules/@vercel/ncc/dist/ncc/cli.js': '',
    });

    expect(runBuildActions({ rootDir, log })).toBe(0);
    expect(log).toHaveBeenCalledWith('No root-managed actions found. Skipping build.');
  });

  it('builds actions with ncc', () => {
    const log = vi.fn();
    const actionDir = path.join(rootDir, 'my-action');
    const spawn = vi.fn((_, __, options: { cwd: string }) => {
      seedFs({
        [`${options.cwd}/dist/index.js`]: 'module.exports = {};',
      });

      return { status: 0 };
    });

    seedFs({
      '/repo/node_modules/@vercel/ncc/dist/ncc/cli.js': '',
      '/repo/my-action/action.yml': '',
      '/repo/my-action/src/index.ts': 'export {};',
    });

    expect(runBuildActions({ rootDir, log, spawn })).toBe(0);
    expect(log).toHaveBeenCalledWith('Building my-action');
    expect(spawn).toHaveBeenCalledOnce();
    expect(vol.existsSync(path.join(actionDir, 'dist', 'index.js'))).toBe(true);
  });

  it('builds project-assigner from index.js', () => {
    const log = vi.fn();
    let capturedArgs: string[] = [];
    const spawn = vi.fn((_command: string, args: string[]) => {
      capturedArgs = args;
      return { status: 0 };
    });

    seedFs({
      '/repo/node_modules/@vercel/ncc/dist/ncc/cli.js': '',
      '/repo/project-assigner/action.yml': '',
      '/repo/project-assigner/index.js': 'module.exports = {};',
    });

    expect(runBuildActions({ rootDir, log, spawn })).toBe(0);
    expect(log).toHaveBeenCalledWith('Building project-assigner');
    expect(spawn).toHaveBeenCalledOnce();
    expect(capturedArgs).toContain('index.js');
  });

  it('fails when an action is missing src/index.ts', () => {
    const error = vi.fn();

    seedFs({
      '/repo/node_modules/@vercel/ncc/dist/ncc/cli.js': '',
      '/repo/my-action/action.yml': '',
    });

    expect(runBuildActions({ rootDir, error })).toBe(1);
    expect(error).toHaveBeenCalledWith('my-action is missing src/index.ts.');
  });

  it('fails when project-assigner is missing index.js', () => {
    const error = vi.fn();

    seedFs({
      '/repo/node_modules/@vercel/ncc/dist/ncc/cli.js': '',
      '/repo/project-assigner/action.yml': '',
    });

    expect(runBuildActions({ rootDir, error })).toBe(1);
    expect(error).toHaveBeenCalledWith('project-assigner is missing index.js.');
  });
});
