import {Command} from 'commander';
import {generateFiles, formatFiles, writeFiles} from './generate';
import {checkFiles, checkPassed} from './check';
import {loadConfig, resolveConfig, validateConfig} from './config';
import {buildCliConfig} from './cli-options';
import {logger} from './logger';

/**
 * CLI version, injected at build time from `package.json` (see
 * `tsdown.config.ts`) so the reported version can never drift from the
 * published package.
 */
declare const __PKG_VERSION__: string | undefined;

const program = new Command();

program
  .name('ng-openapi-signals')
  .description('Signal-first OpenAPI client generator for Angular using resource() and fetch().')
  .version(typeof __PKG_VERSION__ === 'string' ? __PKG_VERSION__ : '0.0.0');

program
  .command('generate')
  .description('Generate an Angular signal-based OpenAPI client')
  .option('-i, --input <path>', 'Path to OpenAPI JSON/YAML file')
  .option('-o, --output <path>', 'Output directory')
  .option('-c, --config <path>', 'Path to config file (default: ng-openapi-signals.config.ts)')
  // Left as a tri-state on purpose: passing neither flag must leave `clean`
  // undefined so a `clean: false` in the config file stays in effect. The
  // default (`true`) lives in `DEFAULT_CONFIG`.
  .option('--clean', 'Clean output directory before generation (default: true)')
  .option('--no-clean', 'Preserve existing files in output directory')
  .option('--group-by <mode>', 'Group APIs by tag or path (default: tag)')
  .option('--transport <type>', 'HTTP transport: fetch or httpClient (default: fetch)')
  .option(
    '--default-query-style <style>',
    'Default query param style: form, spaceDelimited, pipeDelimited, or deepObject',
  )
  .option('--default-query-explode <bool>', 'Default query param explode (true/false)')
  .option(
    '--prefer-content-type <type>',
    'Preferred request content type when multiple are offered',
  )
  .option(
    '--signal-mutations',
    'Generate signal-based …Mutation() methods for POST/PUT/PATCH/DELETE (default: false)',
  )
  .option(
    '--date-transformer',
    'Convert ISO-8601 date strings in JSON responses to Date objects (default: false)',
  )
  .option('--dry-run', 'Print the files that would be generated without writing to disk')
  .option('--check', 'Verify generated output is up to date (exits 1 on mismatch; for CI)')
  .option('--verbose', 'Show detailed progress and file lists')
  .action(async (options) => {
    try {
      logger.setVerbose(options.verbose === true);

      const fileConfig = await loadConfig(options.config);
      const config = resolveConfig(buildCliConfig(options), fileConfig);

      validateConfig(config);

      // --check: compare in-memory output against disk, no writes.
      if (options.check) {
        const result = await checkFiles(config);

        if (result.matched.length > 0) {
          logger.success(`${result.matched.length} file(s) up to date.`);
        }

        for (const file of result.outdated) {
          logger.error(`outdated: ${file}`);
        }

        for (const file of result.missing) {
          logger.error(`missing: ${file}`);
        }

        for (const file of result.stale) {
          logger.warn(`stale: ${file} (no longer in spec)`);
        }

        if (result.missing.length > 0) {
          logger.error(
            `${result.missing.length} file(s) missing — run 'ng-openapi-signals generate' to create them.`,
          );
        }

        if (result.outdated.length > 0) {
          logger.error(
            `${result.outdated.length} file(s) outdated — run 'ng-openapi-signals generate' to update them.`,
          );
        }

        if (checkPassed(result)) {
          logger.success('Check passed: generated output is up to date.');
        } else {
          process.exitCode = 1;
        }

        return;
      }

      // --dry-run: generate in memory, list files, no writes.
      if (options.dryRun) {
        const files = await formatFiles(await generateFiles(config));
        const fileCount = Object.keys(files).length;

        for (const fileName of Object.keys(files).sort()) {
          const content = files[fileName];

          if (content !== undefined) {
            const lineCount = content.split('\n').length;

            logger.info(`${fileName} (${lineCount} lines)`);
          }
        }

        logger.success(`Dry run: ${fileCount} file(s) would be written to ${config.output}.`);

        return;
      }

      // Normal generation: generate → format → write once (no double work).
      const files = await generateFiles(config);
      const formatted = await formatFiles(files);
      await writeFiles(config.output, formatted, config.clean);

      const fileCount = Object.keys(formatted).length;

      logger.success(`Generated ${fileCount} file(s) in ${config.output}.`);

      for (const fileName of Object.keys(formatted).sort()) {
        logger.detail(`  ${fileName}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error(message);

      if (logger.verbose && error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }

      process.exitCode = 1;
    }
  });

program.parse();
