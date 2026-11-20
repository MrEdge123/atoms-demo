import type { VirtualFS } from '../domain';

/**
 * Payload accepted by SitePublisher when deploying a compiled HTML bundle.
 */
export interface PublishInput {
  projectId: string;
  slug: string;
  files: VirtualFS;
  html: string;
}

/**
 * Public URL and version metadata returned after a successful publish.
 */
export interface PublishResult {
  url: string;
  version: number;
}

/**
 * Port 5: Publishes compiled artifacts to a public route or external host.
 */
export interface SitePublisher {
  publish(input: PublishInput): Promise<PublishResult>;
}
