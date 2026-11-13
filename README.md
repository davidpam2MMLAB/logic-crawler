# Logic Crawler

A local website review tool with two layers:

1. **Wiring:** checks the static links a visitor can reach from configured entry pages, including file destinations, fragments, unlinked pages and links to configured private routes.
2. **Optional AI sense review:** compares link labels with destination excerpts, then asks for a second review of proposed mismatches. Incomplete evidence and failed requests remain unresolved.

This is Logic Crawler, a website link-and-meaning project. It is not a general source-code correctness scanner. It does not click buttons, run PHP, render JavaScript, test authentication or certify that a website works.

A portfolio project owned and directed by David Pamintuan, with AI-assisted implementation and review. See [project notes](PROJECT-NOTES.md) for contributions, test evidence and limits. Licensing is awaiting the owner’s choice.

## Try it without AI

Use Node 20 or later. There are no package dependencies to install. From this folder:

```sh
npm test
node run.mjs fixtures/clean --out out/clean-report
npm run demo
```

Open `out/defective-report/logic-crawl-report.html`. The defective fixture has exactly one missing destination, one missing fragment and one unreachable page. Its “Pricing and plans” link leads to a login page: this is a planted **semantic** mismatch for optional AI review, not a mechanical broken link.

To review your own files:

```sh
node run.mjs /path/to/site --out /path/to/reports
```

An explicit site folder is required. AI is off by default, even if provider keys exist. `--wiring-only` is an optional explicit synonym for the default. The output directory must be outside the selected source. Before a new attempt, existing named report files are moved to a unique folder under output `history/`, then replaced with fresh run state. Nothing is permanently deleted. Output directory aliases and linked report artifacts are refused. On macOS, use canonical paths rather than system aliases such as `/tmp` when choosing output folders. Do not use the same output directory for concurrent runs. Keep the source tree unchanged while scanning.

Each completed scan writes:

- `site-inventory.json`: wiring findings, exclusions, unsupported links, scope and summary.
- `unique-links.json`: the versioned, deduplicated public link evidence for AI review.
- `logic-report.json`: a fresh skipped, completed, incomplete or failed AI review.
- `logic-crawl-report.html`: a readable combined report.
- `run-manifest.json`: run identity, input digest and completion status.

Exit 0 means the requested checks finished, **not** that the website has no defects. Exit 2 means incomplete wiring or AI review. Exit 1 means invalid input or a fatal run error. A fatal run invalidates the active JSON files and leaves an unfinished HTML notice plus a failed manifest. Early bad-flag or bad-root attempts also retire a recognizable previous output set, when that destination can be safely accessed. Unsafe destinations and malformed or duplicate `--out` options leave prior output untouched. Disposable running/failed placeholders do not create history copies. Historical reports remain explicitly archived, not active. Standalone `report.mjs` requires matching JSON plus a completed/incomplete manifest in the same folder.

## Set scope

Run `npm run audit -- /path/to/site --out /path/to/reports` to use the npm alias. Like the main command, it requires a root argument.

Pass a JSON config with `--config config.json`. `logic-crawl.config.example.json` is a neutral example, not an active default.

- `entries`: exact root-relative entry files; default `index.html`. Missing, excluded or private entries make the scan incomplete.
- `exclude`: root-relative paths or directory prefixes, not globs. Default `.git`, `node_modules`, `backup`, `staging`, `_archive`, `internal`. Hidden path segments are always excluded. Supplying a list replaces the default list. Unknown config keys, glob characters, dot-path segments and trailing slashes on file scope paths are rejected rather than silently ignored.
- `privatePaths`: root-relative private route prefixes; default `admin`. Public links into them are flagged, but their links are not traversed or sent to AI. This does not prove server exposure.

Explicit exclude/private paths must match real, correctly spelled paths: case mismatches are refused, and unmatched paths make the scan incomplete and block AI calls. The built-in default paths may be absent without error; omit explicit scope settings to use those defaults.

Scanned-but-unreachable pages are listed as orphans. Their links do not enter public findings or the AI workload. Skipped symlinks/excluded paths and unsupported links are shown separately. A linked excluded destination is unresolved by policy, not declared broken.

## Optional AI

AI requests send link text, source/destination filenames, destination title/heading, up to 1,000 characters of page excerpt, and up to 2,000 characters near a fragment target. Only enable AI for content you intend to send to that endpoint. Findings and excerpts can themselves contain sensitive material; keep your output private.

For a local OpenAI-compatible service you already run, set `provider`, `model` and `baseUrl` in your own config, then:

```sh
node run.mjs /path/to/site --out /path/to/reports --config config.json --ai
```

Supported transport shapes: `openai-compatible`, `openai` and `anthropic`. Only loopback HTTP/HTTPS endpoints work without additional permission. Remote endpoints require HTTPS and both `--ai --allow-remote`. URL spellings such as `127.1` normalize to the same allowed loopback address. They may incur charges on your provider account. This project never enables or purchases a model for you. Keys are read from the environment variable named by `apiKeyEnv`; do not put credentials in config or URLs.

`timeoutMs` defaults to 30,000 and is limited to 10–120,000. `batchSize` is 1–32, default 8; `concurrency` is 1–8, default 2. Invalid responses, duplicate/out-of-batch indices, transport failures and verifier failures cannot become clean results. Unresolved and dismissed rows identify their index, source and destination. Findings take filenames and labels from the input, not invented model output. Unknown coverage remains visible and produces exit 2. Matching run IDs and input digests prevent mixing older AI results with fresh wiring.

Loopback provider tests prove transport shapes and error handling. **No real-model accuracy or live commercial-provider compatibility benchmark has been run.** Do not present passing tests as evidence that semantic judgments are accurate. Website text is treated as untrusted data in prompts; this does not eliminate prompt injection.

## Limits

The parser uses a quote-aware static HTML scanner, not a browser DOM. It handles anchor and image-map links, image-only anchor labels from alt text, and browser top fragments. Scripts, styles and comments are withheld, including unterminated blocks. Any file containing a PHP/processing-instruction opener is withheld in its entirety: no title, heading, excerpt, section or outbound link is extracted. Such reachable pages make wiring incomplete, and they remain unresolved locally without any provider call. Malformed destination evidence and links without visible labels are also kept out of provider calls. Dynamic routes, JavaScript navigation, other malformed markup, CSS visibility and server rewrites are outside coverage. Pages using `<base href>` are explicitly incomplete rather than resolved by guesswork. Declarations and unterminated attribute text are withheld from excerpts. Detected malformed markup makes the scan incomplete; recovery can find later anchors, but is not a full browser error-recovery algorithm. Simple comparison text such as `a<b` inside quoted attributes is accepted; tag-like markup inside quoted values may be conservatively flagged incomplete. External URLs are classified but never fetched. Fragment excerpts are a bounded slice near the target, not a proven complete section. Destination path spelling is checked against directory entries so wrong-case URLs are reported even on case-insensitive disks. A trailing slash on a file is reported as a bad destination.

Symlink files/directories/cycles are not followed. Outside-root destinations are rejected. These checks assume a stable local tree, not a hostile process changing files during a scan. The scan reads source; only output files are written. Tests cover local macOS/Node behavior; Windows and actual browser workflows have not been verified.

## Project record

Development is AI-assisted. The project notes describe the owner’s direction and the work performed by AI tools. The examples contain only synthetic fixture sites and their regenerated reports. Private website inventories, local paths and review transcripts are excluded from this repository.

The current source has 107 passing automated checks, and a separate AI reviewer reproduced them and found no blocker before portfolio showing. This is not a real-model semantic-accuracy benchmark or a certification service. See [project notes](PROJECT-NOTES.md).
