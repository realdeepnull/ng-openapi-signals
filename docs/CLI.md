# CLI Reference

`ng-openapi-signals` is a CLI-first generator. This page documents the command
line interface, the `--check` / `--dry-run` modes and the recommended
config-file workflow.

For the configuration file and all generator options, see
[CONFIGURATION.md](./CONFIGURATION.md). For the generated client itself, see
[RUNTIME.md](./RUNTIME.md).

---

## Generate

```bash
ng-openapi-signals generate --input <openapi-file> --output <output-directory>
```

Install and a four-step quick start are in the [README](../README.md#how-to-start).

### Options

| Option                            | Description                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `-i, --input <path>`              | Path to the OpenAPI JSON or YAML file                                            |
| `-o, --output <path>`             | Output directory for the generated Angular client                                |
| `-c, --config <path>`             | Path to config file (default: `ng-openapi-signals.config.ts`)                    |
| `--clean`                         | Clean output directory before generation (default: true)                         |
| `--no-clean`                      | Preserve existing files in output directory                                      |
| `--group-by <tag\|path>`          | Group APIs by tag or path (default: tag)                                         |
| `--transport <fetch\|httpClient>` | HTTP transport (default: fetch)                                                  |
| `--default-query-style <style>`   | Default query param style: form, spaceDelimited, pipeDelimited, or deepObject    |
| `--default-query-explode <bool>`  | Default query param explode (true/false)                                         |
| `--prefer-content-type <type>`    | Preferred request content type when multiple are offered                         |
| `--signal-mutations`              | Enable signal-based mutation methods (default: false)                            |
| `--date-transformer`              | Convert ISO-8601 date strings in JSON responses to Date objects (default: false) |
| `--dry-run`                       | Print the files that would be generated without writing to disk                  |
| `--check`                         | Verify generated output is up to date (exits 1 on mismatch; for CI)              |
| `--fail-on-stale`                 | With `--check`: also exit 1 for files the spec no longer produces                |
| `--verbose`                       | Show detailed progress and file lists                                            |

### CLI overrides

CLI flags override config file values. Config file values override defaults.

```bash
ng-openapi-signals generate \
  --input ./openapi.json \
  --output ./src/generated/api \
  --group-by path
```

---

## CI: verify generated output

Use `--check` in CI to verify the generated client is up to date:

```bash
ng-openapi-signals generate --input ./openapi.json --output ./src/generated/api --check
```

The command exits with code `1` when generated files are outdated or missing.
Line-ending differences alone (a `core.autocrlf=true` Windows checkout) do not
fail the check — they are reported separately, because the content is identical.

Stale files (on disk but no longer in the spec) are reported as warnings but do
not fail the check. Pass `--fail-on-stale` to make them fatal:

```bash
ng-openapi-signals generate --check --fail-on-stale
```

> A `.gitattributes` with `* text=auto eol=lf` in the consuming repository keeps
> the checkout in LF, which avoids the CRLF warning entirely.

## Preview without writing: `--dry-run`

```bash
ng-openapi-signals generate --input ./openapi.json --output ./src/generated/api --dry-run --verbose
```

Generates the client in memory and lists the files (path + line count) without touching disk.

---

## Recommended: use a config file

Using a config file keeps your setup reproducible and version-controllable:

```bash
ng-openapi-signals generate --config ng-openapi-signals.config.ts
```

The file format, all options and example `package.json` scripts are documented
in [CONFIGURATION.md](./CONFIGURATION.md).
