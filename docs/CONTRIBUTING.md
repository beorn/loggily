# Contributing to Loggily

## Development Setup

```bash
git clone https://github.com/beorn/loggily.git
cd loggily
bun install
bun run test        # Run tests
bun run typecheck   # Type check
```

## Code Style

- TypeScript strict mode
- ESM imports only (`import`/`export`, never `require`)
- Factory functions over classes
- Zero external dependencies

## Testing

All changes should include tests. Run the test suite before submitting:

```bash
bun run test
```

Tests must be silent on success. Use `vi.spyOn(console, 'log').mockImplementation(() => {})` to suppress output in tests.

## Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with tests
4. Ensure `bun run test` and `bun run typecheck` pass
5. Commit with [conventional commit](https://conventionalcommits.org/) messages
6. Push and open a pull request

## Commit Messages

- `feat:` -- New features
- `fix:` -- Bug fixes
- `docs:` -- Documentation only
- `test:` -- Test additions
- `refactor:` -- Code changes that neither fix bugs nor add features
- `chore:` -- Maintenance tasks

## Design Principles

1. **Logger-first** -- Spans are loggers with timing, not separate concepts
2. **Minimal surface** -- Few, well-designed functions
3. **Type safe** -- TypeScript enforces correct usage (e.g., `?.` for disabled levels)
4. **Zero-cost** -- Optional chaining skips argument evaluation when disabled
5. **Structured** -- JSON in production, readable console in development

## Questions?

Open an issue for discussion before starting large changes.
