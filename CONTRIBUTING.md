# Contributing to Traqr

Thanks for your interest in contributing to Traqr! Here's how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/jiggycapital/traqr-oss.git
cd traqr-oss

# Install dependencies
npm install

# Build packages
npm run build --workspace=packages/core
npm run build --workspace=packages/cli

# Test the CLI locally
node packages/cli/dist/bin/traqr.js --help
```

## Project Structure

```
packages/
  core/       @traqr/core — Config schema, template engine, skill templates
  cli/        traqr — CLI entry point, interactive wizard, commands
```

## How to Contribute

### Adding a Skill Template

Skills are Markdown files in `packages/core/templates/commands/`. Each skill:
- Has YAML frontmatter (name, tier, category, dependencies)
- Uses `{{VARIABLE}}` template syntax for project-specific values
- Includes a Raqr mascot frame in output
- Has an Error Handling section with human-readable translations

Look at `ship.md.tmpl` as the gold standard example.

### Submitting a PR

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `npm run build --workspace=packages/core` to verify
5. Submit a PR with a clear description

### Reporting Issues

Open an issue on GitHub with:
- What you expected
- What happened
- Steps to reproduce
- Your environment (OS, Node version, Claude Code version)

## Code Style

- TypeScript with strict mode
- ESM modules (import/export, not require)
- No external npm dependencies in core or CLI (Node builtins only)
- Imperative commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
