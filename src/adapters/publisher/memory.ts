import type { ProjectRepository, PublishInput, PublishResult, SitePublisher } from '../../ports';

/**
 * In-memory/repo-backed publisher for L1 tests (does not require HTTP server).
 */
export class MemorySitePublisher implements SitePublisher {
  constructor(private readonly repo: ProjectRepository) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    const { version } = await this.repo.savePublished(
      input.projectId,
      input.files,
      input.html
    );
    return {
      url: `https://mock.atoms.local/s/${input.slug}`,
      version,
    };
  }
}
