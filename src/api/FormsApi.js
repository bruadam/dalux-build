'use strict';

const { convertToModel } = require('../models/convert');
const { FormsListResponseSchema, FormResponseSchema } = require('../models/forms');

/**
 * API methods for forms on a project.
 */
class FormsApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve forms on a project.
   * GET /2.1/projects/{projectId}/forms
   * @param {string} projectId
   * @param {object} [params] - Optional filters (e.g. updatedAfter)
   * @returns {Promise<object>} FormsListResponse ({ items, metadata?, links? })
   */
  async getProjectForms(projectId, params = {}) {
    const response = await this._client.get(`/2.1/projects/${projectId}/forms`, params);
    return convertToModel(response, FormsListResponseSchema, 'FormsListResponse');
  }

  /**
   * Retrieve a specific form.
   * GET /1.2/projects/{projectId}/forms/{formId}
   * @param {string} projectId
   * @param {string} formId
   * @returns {Promise<object>} FormResponse ({ data, links? })
   */
  async getForm(projectId, formId) {
    const response = await this._client.get(`/1.2/projects/${projectId}/forms/${formId}`);
    return convertToModel(response, FormResponseSchema, 'FormResponse');
  }

  /**
   * Retrieve attachments on forms on a project in incremental updates.
   * GET /2.1/projects/{projectId}/forms/attachments
   * @param {string} projectId
   * @param {object} [params] - Optional filters (e.g. updatedAfter)
   * @returns {Promise<object>}
   */
  getProjectFormAttachments(projectId, params = {}) {
    return this._client.get(`/2.1/projects/${projectId}/forms/attachments`, params);
  }
}

module.exports = FormsApi;
