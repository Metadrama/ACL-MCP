# ACL-MCP: Agent Context Lifecycle

**Persistent, structured context management for AI coding agents.**

ACL-MCP is a local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that addresses three fundamental limitations in current AI coding assistants:

1. **Context Fragmentation** — Agents understand individual files but miss architectural relationships
2. **Reactive Latency** — Context is assembled only after prompts, causing delay and wasted tokens
3. **Session Discontinuity** — Each new session loses accumulated understanding

## Features

### 🗺️ Cartographer — Structural Mapping
- AST-based skeleton extraction (exports, imports, classes, functions)
- Orders-of-magnitude reduction in token usage vs. raw file ingestion
- Lazy parsing with LRU cache and hash-based invalidation

### 👁️ Shadow — Proactive Context
- File watcher detects file focus and modifications
- Relevance engine surfaces related files based on import graph
- Prepares context *before* you prompt

### ⚓ Anchor — Persistence
- SQLite-based session state storage
- Save/restore context across agent restarts
- Store architectural summaries and decisions

## MCP Tools

| Tool | Description |
|------|-------------|
| `acl_get_context` | Get structural skeleton for a file or directory |
| `acl_get_related` | Find related files based on import/dependency graph |
| `acl_refresh` | Force re-parse of specified files |
| `acl_save_session` | Persist session state (active files, decisions, summaries) |
| `acl_restore_session` | Restore a previous session state |
| `acl_list_sessions` | List all saved sessions for the workspace |
| `acl_get_stats` | Get server statistics (cache size, index status) |

## Installation

```bash
# Clone and install
git clone https://github.com/your-org/acl-mcp.git
cd acl-mcp
npm install

# Build
npm run build
```

## Usage

### Running the Server

```bash
# Set workspace path and run
export ACL_WORKSPACE_PATH=/path/to/your/project
npm start

# Or for development with hot reload
npm run dev
```

### Integrating with MCP Clients

Add ACL-MCP to your MCP client configuration. For example, in Antigravity or Claude Desktop:

```json
{
  "mcpServers": {
    "acl": {
      "command": "node",
      "args": ["/path/to/acl-mcp/dist/index.js"],
      "env": {
        "ACL_WORKSPACE_PATH": "/path/to/your/project"
      }
    }
  }
}
```

## Configuration

ACL-MCP can be configured via `.acl/config.json` in your workspace:

```json
{
  "includeZones": ["src", "lib"],
  "excludeZones": ["node_modules", "dist", "vendor"],
  "languages": ["typescript", "javascript", "python", "go", "rust"],
  "maxFileSizeBytes": 1048576,
  "cache": {
    "maxSkeletons": 5000,
    "debounceMs": 500
  }
}
```

## Supported Languages

| Language | Status |
|----------|--------|
| TypeScript/JavaScript | ✅ Full support |
| Python | ✅ Full support |
| Go | ✅ Full support |
| Rust | ✅ Full support |
| Other | 🔄 Regex fallback |

## Architecture

```
┌─────────────────────────────────────────┐
│            ACL-MCP Server               │
├─────────────────────────────────────────┤
│  MCP Protocol Layer                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │Cartog-  │ │ Shadow  │ │ Anchor  │   │
│  │rapher   │ │         │ │         │   │
│  │─────────│ │─────────│ │─────────│   │
│  │Parser   │ │Watcher  │ │SQLite   │   │
│  │Cache    │ │Relevance│ │Sessions │   │
│  └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────┘
```

## Development

```bash
# Run tests
npm test

# Run with watch mode
npm run test:watch

# Build for production
npm run build
```

## License

MIT
