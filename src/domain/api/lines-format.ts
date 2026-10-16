// Format version of the lines resource (GET /api/v1/network/lines/:revisionId). The body is built by
// server code from the published rows, so its shape can change under the same revision URL: the
// version is in the body (linesSchema) and in the service worker's lines cache name, so a bump is a
// refetch, never a parse failure of an old cached copy. Pure, dependency-free (the worker imports it).
export const LINES_FORMAT_VERSION = 1;
