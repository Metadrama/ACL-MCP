## MEMORANDUM

**TO:** Project Stakeholders
**FROM:** Mino
**DATE:** December 31, 2025
**SUBJECT:** Proposal for Agent Context Lifecycle (ACL) MCP

---

## 1. Executive Summary

This memorandum proposes the **Agent Context Lifecycle (ACL) MCP**, a local infrastructure component designed to address structural limitations in current agentic Integrated Development Environments (IDEs). Specifically, ACL targets three recurring failure modes observed in contemporary AI coding assistants: **context fragmentation**, **reactive context acquisition latency**, and **session discontinuity**.

ACL introduces an explicit, persistent, and artifact-driven context lifecycle layer that operates independently of the agent’s inference window. By externalizing architectural knowledge, contextual metadata, and session state into a local, authoritative store, ACL enables agents to operate against a validated project context during a session and to restore relevant state across sessions in a deterministic manner.

The objective is not to replace reasoning or inference, but to provide agents with a stable and inspectable context substrate suitable for long-running development work.

---

## 2. Problem Statement

Despite recent advances, current AI coding assistants exhibit three systemic weaknesses that limit their effectiveness in real-world software projects.

### 2.1 Context Fragmentation (“Blind Spot”)

Agents primarily rely on keyword search and raw file ingestion. This approach frequently fails to capture implicit architectural relationships such as control flow, dependency direction, or coupling patterns.

As a result, agents may understand individual files while lacking awareness of how those files participate in the broader system structure.

### 2.2 Reactive Context Acquisition (“Lag”)

Context is typically assembled only after a user submits a prompt. This reactive model leads to repeated file reads, redundant token usage, and unnecessary latency, particularly in large codebases.

### 2.3 Session Discontinuity (“Reset Trap”)

When an agent’s context window is exhausted or a session is restarted, accumulated architectural understanding and prior decisions are lost. Users must re-establish context manually, often consuming a significant portion of subsequent sessions.

These issues are not user-error problems; they are architectural limitations of prompt-bounded agents.

---

## 3. Proposed Solution

The **Agent Context Lifecycle (ACL) MCP** is proposed as a local, MCP-compliant service that manages context as a first-class, persistent artifact with an explicit lifecycle.

ACL shifts context from a transient, prompt-scoped buffer into a durable infrastructure layer that supports:

* Structured context representation
* Proactive context readiness
* Deterministic session restoration

The system is implemented as a Node.js/TypeScript service and integrates with IDE-based agents via the Model Context Protocol (MCP).

---

## 4. Core Design Pillars

### I. The Cartographer — Structural Mapping and Efficiency

**Feature:** AST-Based Skeleton Mapping
**Mechanism:**
ACL uses Tree-sitter to parse source code into abstract syntax trees, extracting structural elements such as module boundaries, class definitions, function signatures, and exports.

**Purpose:**
This approach allows the agent to reason over project architecture without ingesting full file contents.

**Outcome:**

* Orders-of-magnitude reduction in token usage compared to raw text ingestion
* Improved architectural awareness
* Mitigation of context fragmentation

---

### II. The Shadow — Proactive Context Awareness

**Feature:** Proactive Context Signaling
**Mechanism:**
A lightweight filesystem watcher monitors user file focus. When a file is opened or modified, ACL identifies relevant dependencies and contextual relationships based on pre-computed structural data.

**Purpose:**
To prepare and signal relevant context before a prompt is issued.

**Outcome:**

* Reduced reactive latency
* More relevant first responses
* Less redundant context gathering

---

### III. The Anchor — Persistence and Continuity

**Feature:** Session State Registry
**Mechanism:**
Architectural summaries, context artifacts, and prior decisions are stored in a local SQLite database located within the project workspace.

**Design Rationale:**
SQLite is intentionally selected as a **local-first, authoritative context registry**, prioritizing determinism, inspectability, and zero operational overhead over distributed concurrency.

**Purpose:**
To enable agents to restore relevant project context across sessions without relying on prompt history.

**Outcome:**

* Deterministic session handoff
* Reduced re-briefing overhead
* Explicit continuity across agent restarts

---

## 5. Technical Stack

* **Runtime:** Node.js (v20+) with TypeScript
* **Protocol:** @modelcontextprotocol/sdk
* **Storage:** SQLite via better-sqlite3 (synchronous, local, file-based)
* **Parsing:** Tree-sitter for high-performance AST generation

This stack emphasizes reliability, portability, and low operational complexity.

---

## 6. Scope Boundaries and Non-Goals

To avoid ambiguity, ACL explicitly does **not** attempt to:

* Act as a reasoning engine or inference memory
* Provide real-time multi-agent state synchronization
* Replace semantic search or vector databases
* Serve as a distributed or cloud-hosted memory system

ACL is designed as **context infrastructure**, not cognitive machinery.

---

## 7. Strategic Value

The ACL MCP enables AI agents to function as sustained project collaborators rather than disposable, prompt-bounded tools. By externalizing and managing context explicitly, developers can engage in multi-day or multi-week development tasks without repeatedly reconstructing architectural understanding.

This approach improves productivity, reduces cognitive overhead, and establishes a foundation for more reliable agent-assisted software engineering.

---

## 8. Conclusion

The Agent Context Lifecycle MCP addresses fundamental limitations in current agentic IDEs through a focused, infrastructure-level solution. By formalizing context as a managed lifecycle rather than an incidental prompt artifact, ACL provides a practical and defensible path toward persistent, context-aware AI tooling.

---