---
name: artifact-tdd
description: Skeleton for the technical design document (TDD) in a pi-artifacts task.
---

# TDD: <Feature>

## System Design

<Cross-component design: services, data flow, endpoints, data contracts. Mermaid diagrams for control/data flow.>

## Program Design

<In-code design: modules, seams, dependency-injection map, call-stack trees, signatures, test seams. Nearly every message carries a code shape.>

## Patterns to Follow

<Existing codebase patterns to model after, from the pattern-finder research.>

## Testing

<Test strategy per seam; what makes a good test; prior art.>

## Gates

- [ ] User signed off System Design (before Program Design opens)
- [ ] User signed off Program Design

_Process: two ordered phases. One question per message with options and diagrams. The system-design gate must be signed before program design starts; the program-design gate before the document resolves. Resolve, then patch; never keep a Q&A log._
