# Litmus

A framework for building applications with agentic AI capabilities.

Monorepo powered by [Vite+](https://viteplus.dev) (`vp`) as the unified toolchain.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 24.14.1
- [Bun](https://bun.sh/) >= 1.3.11
- [Vite+](https://viteplus.dev/guide/) (`vp`) CLI installed globally

### Installing Vite+ (alpha)

```bash
curl -fsSL https://vite.plus | VITE_PLUS_VERSION=0.1.15-alpha.7 bash
```

> **Note:** The Vite+ GitHub releases page incorrectly documents the env var as `VP_VERSION`. The install script actually reads `VITE_PLUS_VERSION`. Without the correct env var, the script silently installs the latest stable release instead.

Verify the correct version is installed:

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
