---
name: artifact-structure-outline
description: "Skeleton for the structure-outline document in a pi-artifacts task."
---

# Structure Outline: <Feature>

## Overview

<The change in a few sentences.>

## What We Are NOT Doing

<Explicitly excluded work.>

## Implementation Approach

<High-level slice strategy.>

## Phase 1: <Descriptive Name>

- [ ] Phase 1

### Overview

<What this vertical slice delivers, crossing module boundaries.>

### Changes

<Short note on why this shape matters and how it connects to the rest of the phase.>

```
src/feature/
├── handler.ts        # new: request handling
├── handler.test.ts   # new: covers the handler
└── types.ts          # changed: add Feature type
```

```diff
 export interface Config {
   name: string;
+  featureEnabled: boolean;
 }
```

<Use the smallest set of views that explains the phase — a tree for file ownership, a diff block for changes to an existing shape, a plain block for a new shape. Not every phase needs both.>

### Validation

#### Automated Verification

- <Runnable commands and expected results>

#### Manual Verification

- <Human steps, only when justified>

## Phase 2: <Descriptive Name>

- [ ] Phase 2

### Overview

<...>

### Changes

#### 2.1 ...

### Validation

#### Automated Verification

- ...

#### Manual Verification

- ...

_Outline is the "c header files" of the task: phase intent and verification, not exact code. Phases are thin vertical slices, each independently verifiable, no horizontal phases, no phase depending on a later phase._
