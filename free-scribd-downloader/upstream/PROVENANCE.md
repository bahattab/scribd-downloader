# Upstream provenance

Repository: https://github.com/themrsami/scribd-downloader
Source: https://github.com/themrsami/scribd-downloader/blob/main/scribd-downloader.py
Observed Git blob SHA: 235400ab80d2c9792861cad0cccc620e94ee7183
Retrieved: 2026-10-18

Local changes: strict URL and Windows filename validation; removal of no-sandbox and automation masking switches; fail on missing or invalid page; remove pageRanges=1 so PDF-sheet validation can detect overflow. The wrapper creates a private temporary profile, validates final page count, enforces limits and returns structured status.

License statement: upstream README says MIT. Fetching root LICENSE returned 404. No claim is made that this statement or a complete license text was independently verified. Original authorship remains with the upstream authors. Local development was requested by the user; this copy has not been published.

The upstream requirements are not copied verbatim; requirements.txt lists the directly used Selenium and pypdf packages, bounded to major versions selected for this adapter. Installation and live Selenium execution were blocked in the current environment.
