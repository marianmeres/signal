// deno-lint-ignore-file no-explicit-any

import { assertEquals, assertThrows } from "@std/assert";
import {
	_signalCurrentEffect,
	_signalDebugContext,
	derived,
	effect,
	state,
} from "../signal.ts";

Deno.test("signal", () => {
	_signalDebugContext();

	const log: any[] = [];
	const count = state(0);

	assertEquals(count.value, 0);

	effect(
		() => {
			// simulating double getter access, which must be ran only once
			let v = count.value;
			v += count.value;
			log.push(v);
		},
		{ name: "a" }
	);

	count.value = 1;

	// clog(log);
	assertEquals(log, [0, 2]);

	assertEquals(_signalCurrentEffect(), null);
});

Deno.test("derived", () => {
	_signalDebugContext();
	const log: any[] = [];

	const a = state(0);
	const b = state(0);
	const sum = derived(() => a.value + b.value);

	effect(
		() => {
			log.push(`${a.value} + ${b.value} = ${sum.value}`);
		},
		{ name: "log sum" }
	);

	assertEquals(log, ["0 + 0 = 0"]);
	// assertEquals(a.meta.size, 2);

	a.value = 1;
	b.value = 2;

	// console.log(log);

	// The two different signal changes above, must be logged just once!
	assertEquals(log, ["0 + 0 = 0", "1 + 0 = 1", "1 + 2 = 3"]);

	// derived's value cannot be set directly
	assertThrows(() => (sum.value = 123));

	assertEquals(_signalCurrentEffect(), null);
});

Deno.test("derived non reactive", () => {
	_signalDebugContext();
	// this logically makes no sense, but is technically valid... (in our implementation
	// we can't detect)
	const foo = derived(() => "bar");
	assertEquals(foo.value, "bar");
	assertEquals(_signalCurrentEffect(), null);
});

Deno.test("new signal inside an effect is forbidden", () => {
	_signalDebugContext();
	assertThrows(() => effect(() => state(123)));
	assertThrows(() => derived(() => state(123)));
	assertEquals(_signalCurrentEffect(), null);
});

Deno.test("circular update inside one effect throws", () => {
	_signalDebugContext();

	const log: any[] = [];

	const a = state(0);
	const b = state(0);
	const sum = derived(() => a.value + b.value);

	effect(
		() => {
			log.push(`${a.value} + ${b.value} = ${sum.value}`);
		},
		{ name: "log sum" }
	);

	assertEquals(a.meta.version, 0);
	assertEquals(a.meta.effects.length, 2);
	assertEquals(b.meta.effects.length, 2);
	assertEquals(sum.meta.effects.length, 1);
	// console.log(sum.meta);

	// sanity check - this obviously must not be considered circular
	let i = 0;
	while (i++ < 101) {
		a.value = i;
	}

	// this will trigger infinite loop inside one effect
	// The effect itself is normally added, and called until limit.
	assertThrows(() => {
		effect(
			() => {
				a.value = b.value + 1;
				b.value = a.value;
			},
			{ name: "thrower" }
		);
	});
	assertEquals(_signalCurrentEffect(), null);

	// console.log(a.meta, b.meta);
	// "thrower" was added
	assertEquals(a.meta.effects.length, 3);
	assertEquals(b.meta.effects.length, 3);

	//
	assertThrows(() => (a.value = 1));
	assertEquals(_signalCurrentEffect(), null);
	assertThrows(() => (b.value = 1));

	// console.log(log);
	assertEquals(_signalCurrentEffect(), null);
});

Deno.test("circular update across multiple effects throws", () => {
	_signalDebugContext();

	const a = state(0);
	const b = state(0);
	const c = state(0);

	effect(() => {
		if (c.value) a.value = b.value + 1;
	});

	effect(() => {
		if (c.value) b.value = c.value + 1;
	});

	effect(() => {
		if (c.value) c.value = a.value + 1;
	});

	assertEquals(_signalCurrentEffect(), null);

	// now setting c must trigger the circular update loop
	assertThrows(() => (c.value = 1));

	assertEquals(_signalCurrentEffect(), null);
});

Deno.test("nested effects are forbidden", () => {
	_signalDebugContext();
	const log: any[] = [];

	const a = state(0);
	const b = state(0);
	const sum = derived(() => a.value + b.value);

	assertThrows(() => {
		effect(() => {
			log.push(`${a.value} + ${b.value}`);
			effect(() => {
				log.push(sum.value);
			});
		});
	});

	assertEquals(_signalCurrentEffect(), null);
});

Deno.test("effect return result", () => {
	_signalDebugContext();
	let log: any[] = [];

	const a = state(0);
	const destroy = effect(() => {
		log.push(a.value);
		// we can return a fn, which, let's say, does the cleanup
		return () => (log = []);
	});

	a.value = 1;
	a.value = 2;

	assertEquals(log, [0, 1, 2]);
	destroy();
	assertEquals(log, []);
});
