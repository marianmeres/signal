# @marianmeres/signal

Signals implementation. A naive one. But now I understand the concept better.

## Installation

### Deno

```bash
deno add jsr:@marianmeres/signal
```

### Node

```bash
npx jsr add @marianmeres/signal
```

### Usage

```ts
import { state, derived, effect } from "@marianmeres/signal";

const a = state(0);
const b = state(0);
const sum = derived(() => a.value + b.value);

// logs now (a.k.a. onMount): "0 + 0 = 0"
effect(() => {
    console.log(`${a.value} + ${b.value} = ${sum.value}`)
});

// logs: "1 + 0 = 1"
a.value = 1;
```