import { EventEmitter } from 'node:events';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

import { execFile } from 'node:child_process';
import {
  createFeedbackIssue,
  feedbackRepoSlug,
  feedbackReportingConfigured,
  findSensitiveContent,
} from '../src/feedbackReport';

const execFileMock = execFile as unknown as jest.Mock;

function ghSucceeds(url: string) {
  execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
    callback(null, `${url}\n`, '');
    return new EventEmitter();
  });
}

function ghFails(message: string) {
  execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
    callback(new Error('Command failed'), '', message);
    return new EventEmitter();
  });
}

describe('feedbackReport', () => {
  const envKeys = ['DALUX_MCP_FEEDBACK_REPO', 'DALUX_MCP_FEEDBACK_GITHUB_TOKEN', 'GITHUB_TOKEN', 'DALUX_MCP_FEEDBACK_USE_GH_CLI'] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    execFileMock.mockReset();
  });

  afterAll(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe('feedbackRepoSlug', () => {
    it('defaults to the server\'s own repo', () => {
      expect(feedbackRepoSlug()).toBe('bruadam/dalux-build');
    });

    it('honours an override', () => {
      process.env.DALUX_MCP_FEEDBACK_REPO = 'someone/fork';
      expect(feedbackRepoSlug()).toBe('someone/fork');
    });
  });

  describe('feedbackReportingConfigured', () => {
    it('is false with no token and no gh CLI flag', () => {
      expect(feedbackReportingConfigured()).toBe(false);
    });

    it('is true once a token is set', () => {
      process.env.DALUX_MCP_FEEDBACK_GITHUB_TOKEN = 'ghp_abc';
      expect(feedbackReportingConfigured()).toBe(true);
    });

    it('falls back to GITHUB_TOKEN', () => {
      process.env.GITHUB_TOKEN = 'ghp_abc';
      expect(feedbackReportingConfigured()).toBe(true);
    });

    it('is true with the gh CLI flag and no token', () => {
      process.env.DALUX_MCP_FEEDBACK_USE_GH_CLI = '1';
      expect(feedbackReportingConfigured()).toBe(true);
    });
  });

  describe('findSensitiveContent', () => {
    it('finds nothing in a clean report', () => {
      expect(findSensitiveContent('Tool always returns empty list', 'Calling list_files on any project returns []')).toEqual([]);
    });

    it('flags an email address', () => {
      expect(findSensitiveContent('bug', 'Contact me at bruno@example.com for details')).toContainEqual(
        expect.objectContaining({ field: 'body', kind: 'an email address' }),
      );
    });

    it('flags an API key', () => {
      expect(findSensitiveContent('bug', 'Token was ghp_abcdefghijklmnopqrst1234')).toContainEqual(
        expect.objectContaining({ kind: 'an API key or token' }),
      );
    });

    it('flags a Dalux identifier', () => {
      expect(findSensitiveContent('bug', 'happens when projectId: S3135780168 is used')).toContainEqual(
        expect.objectContaining({ kind: 'a Dalux project/file/task identifier' }),
      );
    });

    it('flags a Dalux base URL', () => {
      expect(findSensitiveContent('bug', 'seen against https://acme.dalux.com/api')).toContainEqual(
        expect.objectContaining({ kind: 'a Dalux base URL' }),
      );
    });

    it('flags an IP address', () => {
      expect(findSensitiveContent('bug', 'server at 10.0.0.42 failed')).toContainEqual(expect.objectContaining({ kind: 'an IP address' }));
    });

    it('checks the title as well as the body', () => {
      expect(findSensitiveContent('Bug from bruno@example.com', 'clean body')).toContainEqual(
        expect.objectContaining({ field: 'title' }),
      );
    });
  });

  describe('createFeedbackIssue', () => {
    it('posts via the REST API when a token is set', async () => {
      process.env.DALUX_MCP_FEEDBACK_GITHUB_TOKEN = 'ghp_abc';
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ html_url: 'https://github.com/bruadam/dalux-build/issues/99', number: 99 }),
        text: async () => '',
      })) as unknown as typeof fetch;

      try {
        const result = await createFeedbackIssue('bug', 'Title', 'Body');
        expect(result).toEqual({ url: 'https://github.com/bruadam/dalux-build/issues/99', number: 99 });
        expect(global.fetch).toHaveBeenCalledWith(
          'https://api.github.com/repos/bruadam/dalux-build/issues',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ Authorization: 'Bearer ghp_abc' }),
            body: JSON.stringify({ title: 'Title', body: 'Body', labels: ['bug'] }),
          }),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects with the response body when the REST API call fails', async () => {
      process.env.DALUX_MCP_FEEDBACK_GITHUB_TOKEN = 'ghp_abc';
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({}),
        text: async () => 'Forbidden',
      })) as unknown as typeof fetch;

      try {
        await expect(createFeedbackIssue('bug', 'Title', 'Body')).rejects.toThrow(/HTTP 403/);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('posts via the gh CLI when no token is set but the flag is on', async () => {
      process.env.DALUX_MCP_FEEDBACK_USE_GH_CLI = '1';
      ghSucceeds('https://github.com/bruadam/dalux-build/issues/42');

      const result = await createFeedbackIssue('enhancement', 'Title', 'Body');

      expect(result).toEqual({ url: 'https://github.com/bruadam/dalux-build/issues/42', number: 42 });
      const [file, args] = execFileMock.mock.calls[0];
      expect(file).toBe('gh');
      expect(args).toEqual([
        'issue',
        'create',
        '--repo',
        'bruadam/dalux-build',
        '--title',
        'Title',
        '--body',
        'Body',
        '--label',
        'enhancement',
      ]);
    });

    it('wraps a gh CLI failure in a helpful message', async () => {
      process.env.DALUX_MCP_FEEDBACK_USE_GH_CLI = '1';
      ghFails('gh: not logged in');

      await expect(createFeedbackIssue('bug', 'Title', 'Body')).rejects.toThrow(/gh auth login/);
    });

    it('rejects when nothing is configured', async () => {
      await expect(createFeedbackIssue('bug', 'Title', 'Body')).rejects.toThrow(/No GitHub credentials configured/);
    });
  });
});
