/**
 * Reading of OpenAPI documents from local files and web addresses.
 *
 * The command accepts either a file path or an HTTP(S) URL as its schema argument.
 * This module decides which one it was given, loads the document text, and reports
 * failures with a message naming the source, so later steps only deal with text.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

/** URL protocols downloaded over the network. */
const REMOTE_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Time allowed for downloading a remote document before giving up, in milliseconds. */
const FETCH_TIMEOUT_MS = 30_000;

/** Contents and metadata for a text file. */
export interface FileContent {
  /** The file contents. */
  readonly text: string;

  /** The file base name. */
  readonly name: string;
}

/**
 * Read an OpenAPI document from a file path or URL.
 *
 * HTTP and HTTPS URLs are downloaded, `file:` URLs are read from disk, and anything
 * else is treated as a file path. Windows paths such as `C:\api.yaml` are treated
 * as file paths even though they also parse as URLs.
 *
 * @param source The file path or URL.
 * @returns The document contents and file name.
 * @throws Error If the file cannot be read or the download fails.
 */
export async function readOpenApiSource(source: string): Promise<FileContent> {
  const url = URL.canParse(source) ? new URL(source) : undefined;

  if (url !== undefined && REMOTE_PROTOCOLS.has(url.protocol)) {
    return fetchRemoteFile(url);
  }

  const path = url?.protocol === "file:" ? fileURLToPath(url) : source;
  return {text: await readFile(path, "utf8"), name: basename(path)};
}

/**
 * Download a text file from an HTTP or HTTPS URL.
 *
 * The file name is the last segment of the URL path, or the host name if the path
 * has no segments, so the generated header stays the same between runs.
 *
 * @param url The URL to download.
 * @returns The response body and file name.
 * @throws Error If the request fails, times out, or returns a non-success status.
 */
async function fetchRemoteFile(url: URL): Promise<FileContent> {
  let response: Response;
  try {
    response = await fetch(url, {signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
  } catch (error) {
    // Node reports network failures as "fetch failed" and puts the useful detail in `cause`
    const detail = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const reason = detail instanceof Error ? detail.message : String(detail);
    throw new Error(`Could not download ${url.href}: ${reason}`);
  }

  if (!response.ok) {
    throw new Error(`Could not download ${url.href}: the server responded with ${response.status} ${response.statusText}`.trimEnd());
  }

  const name = decodePathSegment(basename(url.pathname)) || url.hostname;
  return {text: await response.text(), name};
}

/**
 * Decode percent-encoded characters in a URL path segment.
 *
 * @param segment The encoded path segment.
 * @returns The decoded segment, or the original segment if it contains invalid escapes.
 */
function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
