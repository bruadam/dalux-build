jest.mock('../src/feedbackReport', () => ({
  ...jest.requireActual('../src/feedbackReport'),
  createFeedbackIssue: jest.fn(),
  feedbackReportingConfigured: jest.fn(),
}));

import type { DaluxClient } from 'dalux-build-api';
import { createFeedbackIssue, feedbackReportingConfigured } from '../src/feedbackReport';
import { reportFeedback } from '../src/tools/feedback';

const createFeedbackIssueMock = createFeedbackIssue as jest.Mock;
const feedbackReportingConfiguredMock = feedbackReportingConfigured as jest.Mock;

const fakeClient = {} as DaluxClient;

describe('tools/feedback', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns a preview and posts nothing when confirmed is omitted', async () => {
    const result = await reportFeedback(fakeClient, {
      type: 'bug',
      title: 'search_file_content ignores topK on markdown files',
      body: 'Passing topK: 1 still returns every match for a .md file, unlike .docx/.xlsx.',
    });

    expect(result.posted).toBe(false);
    expect(result.preview).toMatchObject({
      type: 'bug',
      title: 'search_file_content ignores topK on markdown files',
      repo: 'bruadam/dalux-build',
    });
    expect(createFeedbackIssueMock).not.toHaveBeenCalled();
  });

  it('returns a preview and posts nothing when confirmed is explicitly false', async () => {
    const result = await reportFeedback(fakeClient, {
      type: 'enhancement',
      title: 'Add a list_forms filter',
      body: 'Would be useful to filter by formTypeId.',
      confirmed: false,
    });

    expect(result.posted).toBe(false);
    expect(createFeedbackIssueMock).not.toHaveBeenCalled();
  });

  it('posts once confirmed is true and reporting is configured', async () => {
    feedbackReportingConfiguredMock.mockReturnValue(true);
    createFeedbackIssueMock.mockResolvedValue({ url: 'https://github.com/bruadam/dalux-build/issues/7', number: 7 });

    const result = await reportFeedback(fakeClient, {
      type: 'bug',
      title: 'Title',
      body: 'Body',
      confirmed: true,
    });

    expect(result).toEqual({ posted: true, url: 'https://github.com/bruadam/dalux-build/issues/7', number: 7 });
    expect(createFeedbackIssueMock).toHaveBeenCalledWith('bug', 'Title', 'Body');
  });

  it('reports not-configured instead of throwing when confirmed but no credentials are set', async () => {
    feedbackReportingConfiguredMock.mockReturnValue(false);

    const result = await reportFeedback(fakeClient, {
      type: 'bug',
      title: 'Title',
      body: 'Body',
      confirmed: true,
    });

    expect(result.posted).toBe(false);
    expect(result.message).toContain('no GitHub credentials configured');
    expect(createFeedbackIssueMock).not.toHaveBeenCalled();
  });

  it('refuses to post — even when confirmed — if the body looks like it contains project data', async () => {
    feedbackReportingConfiguredMock.mockReturnValue(true);

    const result = await reportFeedback(fakeClient, {
      type: 'bug',
      title: 'Title',
      body: 'Fails for projectId: S3135780168888324096 specifically.',
      confirmed: true,
    });

    expect(result).toMatchObject({ posted: false, blocked: true });
    expect(result.message).toContain('Dalux project/file/task identifier');
    expect(createFeedbackIssueMock).not.toHaveBeenCalled();
  });

  it('refuses an unconfirmed call too, before it would ever reach a preview', async () => {
    const result = await reportFeedback(fakeClient, {
      type: 'bug',
      title: 'Title',
      body: 'Reproduced with bruno@example.com as the test user.',
    });

    expect(result).toMatchObject({ posted: false, blocked: true });
    expect(result.preview).toBeUndefined();
  });
});
