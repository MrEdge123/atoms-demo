import type {
  ProjectRepository,
  PublishInput,
  PublishResult,
  SitePublisher,
} from '../../ports';

/**
 * Publishes compiled production HTML into the repository and serves it at /s/[slug].
 */
export class SameOriginSitePublisher implements SitePublisher {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly apiBaseUrl: string
  ) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    const { version } = await this.repo.savePublished(
      input.projectId,
      input.files,
      input.html
    );
    const base = this.apiBaseUrl.replace(/\/$/, '');
    return {
      url: `${base}/s/${input.slug}`,
      version,
    };
  }
}
