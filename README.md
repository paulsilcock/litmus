# Litmus

A framework for building applications with agentic AI capabilities.

Monorepo powered by [Vite+](https://viteplus.dev) (`vp`) as the unified toolchain.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 24.14.1
- [Bun](https://bun.sh/) >= 1.3.11
- [Vite+](https://viteplus.dev/guide/) (`vp`) CLI installed globally

### Installing Vite+

```bash
curl -fsSL https://vite.plus | bash
```

Verify the installation:

```bash
vp -V
```

## Development

Install dependencies:

```bash
vp install
```

Run all checks (format, lint, test, build):

```bash
vp run ready
```

Run tests:

```bash
vp run -r test
```

Build:

```bash
vp run -r build
```

## Packages

- `@litmus/core` — Domain primitives, base classes, types
