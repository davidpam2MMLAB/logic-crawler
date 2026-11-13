# Project notes

## Purpose and contributions

Logic Crawler is a local website audit project. It combines deterministic link checks with an optional AI review of whether a label matches its destination. It is a separate project from general source-code review tools.

David Pamintuan selected the project for a portfolio, set the privacy and publication boundaries, requested an honest assessment rather than a sales claim, approved the repair scope, and directed a separate AI review before release. The implementation, fixture creation and test execution were performed with AI tools. This repository does not imply every line was hand-written by David or that he is employed by an AI evaluation company.

## Development record

Available project records describe an internal filesystem link audit, a July 2026 standalone adaptation, and a November 2026 repair and evaluation pass. The portfolio version replaces private-site defaults with generic configuration, synthetic examples and a no-cost default mode. Earlier private source and outputs were preserved separately.

This repository starts with a sanitized import. It does not reconstruct or claim a historical Git commit trail. No third-party runtime packages or copied third-party implementation were identified in the reviewed package. Built-in Node APIs provide file access, hashing, tests and optional HTTP transport. A reference HTML parser was used locally to check one URL-parsing edge case; it is not included as a dependency or source.

## Evaluation evidence

The 107 automated checks cover ordinary links, planted defects, fragments, query strings, encoded paths, reachability, exclusions, malformed markup, root and symlink boundaries, stale reports, partial/failed AI transport and response validation. Tests include neutral loopback mock services, without real AI-provider calls. Both clean and defective workshop sites are invented.

A separate AI reviewer (Fable 5.2) checked the exact source and archive, reproduced all 107 tests, challenged the repairs with additional local probes, and found no blocker before portfolio showing. This was an AI code review, not a formal security certification or independent human audit. Private review transcripts and source-site inventories are deliberately not shipped.

## Important limits

- Static HTML-source analysis does not prove buttons, browser flows, PHP or JavaScript behavior works.
- PHP/processing-instruction content is withheld, rather than treated as complete static evidence.
- Ambiguous tag-like text in quoted attributes can make a page incomplete and leave partial attribute text in local excerpts. Such rows are not sent to an AI provider. Keep arbitrary scan outputs private.
- Real-model judgment accuracy, live-provider model compatibility, Windows and hostile concurrent-filesystem behavior remain untested.
- A successful command means the requested checks completed. It does not mean the website is correct.

The optional AI layer is advisory. The reproducible no-AI tests demonstrate engineering and evaluation discipline; they are not a benchmark of semantic judgment quality.
