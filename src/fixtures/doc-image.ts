/**
 * Fixtures for tests and offline development: a tiny valid document photo and
 * the sample LLM JSON payloads that the pipeline consumes/produces.
 */
import type { ImageDoc } from "../shared/contract";

/** 1x1 transparent PNG as a base64 data URL (valid, tiny). */
export const DOC_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const DOC_INPUT_FIXTURE: ImageDoc = {
  kind: "image",
  dataUrl: DOC_IMAGE_DATA_URL,
  mimeType: "image/png",
};
