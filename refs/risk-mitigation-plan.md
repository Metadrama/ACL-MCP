# ACL-MCP Risk Mitigation Plan

**Project:** Agent Context Lifecycle (ACL) MCP  
**Date:** December 31, 2025  
**Status:** Draft for Review

---

## Overview

This document identifies key risks to successful delivery of ACL-MCP and proposes mitigation strategies. Risks are organized by the three core pillars: **Cartographer**, **Shadow**, and **Anchor**, plus cross-cutting concerns.

---

## Risk Summary Matrix

| # | Risk | Likelihood | Impact | Mitigation Priority |
|---|------|------------|--------|---------------------|
| R1 | Proactive relevance heuristics are hard to tune | High | High | **Critical** |
| R2 | Large codebase performance degradation | Medium | High | **High** |
| R3 | Context staleness after rapid edits | Medium | Medium | Medium |
| R4 | Tree-sitter grammar gaps for niche languages | Low | Medium | Low |
| R5 | MCP adoption uncertainty | Low | High | Medium |

---

## Detailed Risk Analysis

### R1: Proactive Relevance Heuristics (The Shadow)

**Risk:** The Shadow's value proposition depends on surfacing *relevant* context before the user prompts. Poor relevance → noise → user distrust → feature disable.

**Root Cause:** Relevance is subjective and context-dependent. Import relationships alone don't capture semantic relevance.

**Mitigation Strategy:**

| Approach | Description |
|----------|-------------|
| **Start conservative** | V1 surfaces only direct imports/exports of active file. No transitive expansion initially. |
| **User feedback loop** | Add simple "was this helpful?" signal to tune ranking over time. |
| **Opt-in expansion** | Let agents request deeper context explicitly rather than auto-surfacing. |
| **Fallback to on-demand** | If proactive fails, ensure the Cartographer's on-demand query is always available. |

**Acceptance Criteria:** Shadow suggestions should have >70% perceived relevance in user testing before enabling by default.

---

### R2: Large Codebase Performance (The Cartographer)

**Risk:** Full AST parsing of a 50k+ file monorepo could take minutes, blocking initial context readiness.

**Root Cause:** Tree-sitter is fast per-file, but aggregate I/O and parsing at scale adds up.

**Mitigation Strategy:**

| Approach | Description |
|----------|-------------|
| **Lazy/incremental parsing** | Parse files on first access, not at startup. Cache aggressively. |
| **Workspace scoping** | Allow users to define "active zones" (e.g., `src/`, exclude `vendor/`). |
| **Background indexing** | Index in a worker thread; never block agent prompts. |
| **Skeleton depth limits** | By default, extract only module-level exports, not nested function bodies. |

**Acceptance Criteria:** Cold-start indexing of 10k files completes in <30 seconds on commodity hardware.

---

### R3: Context Staleness (The Anchor + Cartographer)

**Risk:** After rapid code changes, the cached structural data may be stale, leading to incorrect context.

**Root Cause:** File watchers may lag; batch updates create race conditions.

**Mitigation Strategy:**

| Approach | Description |
|----------|-------------|
| **Hash-based invalidation** | Store file content hash with each cached skeleton; invalidate on mismatch. |
| **Debounced re-parse** | On file change, debounce 500ms before re-parsing to avoid thrashing. |
| **Explicit refresh command** | Provide an MCP tool for agents to force-refresh specific files. |
| **Staleness TTL** | Mark cached entries with timestamp; warn if >N minutes old. |

**Acceptance Criteria:** After a file save, updated context is available within 2 seconds.

---

### R4: Tree-sitter Grammar Gaps

**Risk:** Some languages or frameworks (e.g., newer DSLs, templating languages) may lack mature Tree-sitter grammars.

**Root Cause:** Tree-sitter grammar quality varies; community maintenance is uneven.

**Mitigation Strategy:**

| Approach | Description |
|----------|-------------|
| **Prioritize core languages** | V1 targets TypeScript, JavaScript, Python, Go, Rust. Others are stretch goals. |
| **Graceful degradation** | For unsupported files, fall back to regex-based import extraction. |
| **Grammar health check** | At startup, log which grammars are available vs. missing. |

**Acceptance Criteria:** Unsupported file types are logged but never crash the service.

---

### R5: MCP Adoption Uncertainty

**Risk:** If major IDE agents (Cursor, Antigravity, Copilot) don't expose MCP hooks, ACL has limited distribution.

**Root Cause:** MCP is an emerging standard; vendor adoption is incomplete.

**Mitigation Strategy:**

| Approach | Description |
|----------|-------------|
| **Target MCP-native IDEs first** | Antigravity (clearly supports MCP), Claude Desktop, Cline/Roo. |
| **Fallback HTTP API** | Expose core functionality via REST alongside MCP for non-MCP clients. |
| **Monitor ecosystem** | Track Cursor/Copilot announcements for MCP support signals. |
| **Open-source early** | Community adoption can pressure vendors to support the protocol. |

**Acceptance Criteria:** At least 2 major MCP-compatible clients can integrate ACL at launch.

---

## Cross-Cutting Mitigations

| Area | Mitigation |
|------|------------|
| **Observability** | Add structured logging for all cache hits/misses, parse times, and invalidations. |
| **Testing strategy** | Unit test parsers per-language; integration test with real-world repos (VSCode, React, Laravel). |
| **Escape hatch** | Always allow full file read bypass if skeleton is insufficient. |

---

## Recommended Next Steps

1. **Validate R1 early** — Build a minimal Shadow prototype and test relevance with 3-5 real projects.
2. **Benchmark R2** — Run Tree-sitter against a known large repo (e.g., VSCode source) to establish baseline metrics.
3. **Proceed to Implementation Plan** — Use this risk analysis to inform architectural decisions.

---

## Revision History

| Date | Author | Notes |
|------|--------|-------|
| 2025-12-31 | Gemini | Initial draft |
