/**
 * @traqr/cli — Public API
 *
 * Re-exports the file writer for programmatic use.
 * CLI commands are accessed via the traqr binary, not this module.
 */

export { writeFiles, type WriteOptions, type WriteResult } from './lib/writer.js'
