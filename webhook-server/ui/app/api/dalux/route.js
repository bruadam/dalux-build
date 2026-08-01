import { createClient } from "dalux-build-api";
import {
  errorResponse,
  requireString,
  resolveBaseUrl,
} from "../../../lib/server";

export const runtime = "nodejs";

const actions = {
  async projects(client) {
    const response = await client.projects.listProjects();
    return response?.items || [];
  },
  async fileAreas(client, payload) {
    const projectId = requireString(payload.projectId, "projectId");
    const response = await client.fileAreas.getFileAreas(projectId);
    return response?.items || [];
  },
  async catalog(client, payload) {
    const projectId = requireString(payload.projectId, "projectId");
    const fileAreaId = requireString(payload.fileAreaId, "fileAreaId");
    const [folders, files] = await Promise.all([
      client.folders.getAllFolders(projectId, fileAreaId),
      client.files.getAllFiles(projectId, fileAreaId),
    ]);
    return { folders, files };
  },
};

export async function POST(request) {
  try {
    const payload = await request.json();
    const action = actions[payload?.action];
    if (!action) {
      const error = new Error("Unknown Dalux catalog action");
      error.status = 400;
      throw error;
    }
    const apiKey = requireString(payload.apiKey, "DALUX_API_KEY");
    const baseUrl = resolveBaseUrl(payload.baseUrl);
    const client = createClient({ apiKey, baseUrl });
    return Response.json({ ok: true, data: await action(client, payload) });
  } catch (error) {
    return errorResponse(error);
  }
}
