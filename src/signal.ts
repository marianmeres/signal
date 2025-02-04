// deno-lint-ignore-file no-explicit-any

interface EffectFn {
	(): any;
	_name: string;
	id: string;
}

/** quick-n-dirty global debug context */
let _id = 0;
let _depth = 0;
let _debugEnabled = false;

/**
 * For debugging/testing only. Do not use elsewhere.
 */
export function _signalDebugContext(enable = false, reset = true): void {
	_debugEnabled = !!enable;
	if (reset) {
		_id = 0;
		_depth = 0;
	}
}

/** Internal DRY debug utils */
const eid = (e: EffectFn) => `${e.id}[${e._name}]`;
const depth = () => "    ".repeat(Math.max(0, Math.min(_depth, 6)));

/** Well known global var where to temporarily reference the currently
 * running external effect, so this signal can recognize it and add as it's subscriber */
let __currentEffect: EffectFn | null = null;

/** Accessor for debugging. */
export function _signalCurrentEffect(): EffectFn | null {
	return __currentEffect;
}

/**
 * Internal Signal class.
 * To create an instance, use the conventional exported factory functions `state` and `derived`.
 */
class Signal<T> {
	static readonly UPDATE_COUNT_LIMIT = 1000;

	/** Actual signal's value accessible on the `value` getter/setter from the outside */
	protected _value: T;

	/** Set of effect functions subscribed to listen to the signal's value change */
	protected _effects: Set<EffectFn> = new Set();

	/** Every change increments this version counter. Just a meta info. */
	protected _version = 0;

	/** (potentially circular) update tracker */
	protected _updateCount = 0;

	/**  */
	constructor(
		initialValue: T,
		public readonly id = `#s${_id++}` // "s" as "signal"
	) {
		// this is a best practice violation error, rather than purely technical one
		if (__currentEffect) {
			throw new Error(`Creating a signal inside an effect is not allowed.`);
		}
		this._debug("new Signal", initialValue);
		this._value = initialValue;
		this._effects = new Set();
	}

	/** Internal debug logger (activated via global context see _signalDebugContext ) */
	protected _debug(...args: any[]) {
		// quick-n-dirty debug logging - just to visualize the call flow
		if (_debugEnabled) {
			// prettier-ignore
			const colors = ["orange",  "green", "magenta", "teal", "skyblue", "yellow", "purple", "olive" ];
			const idNum = parseInt(this.id.replaceAll(/\D/g, ""));
			const color = colors[idNum % colors.length];
			console.debug(
				`%c[${this.id}] ${depth() + args.join(" ")}`,
				`color:${color}`
			);
		}
	}

	/**
	 * Main api.
	 * Core functionality - when this signal's value is accessed from an effect function
	 * we add that function as this signal's dependency.
	 */
	get value(): T {
		this._debug("<-> get value", this._value);
		_depth++;

		// We are able to recognize the initiator (accessor) as an effect just by
		// looking at a well known global reference.
		if (__currentEffect && !this._effects.has(__currentEffect)) {
			this._debug(
				`added ${__currentEffect.id} -> ${this.id} as effect (total: ${this._effects.size})`
			);
			this._effects.add(__currentEffect);
		}

		_depth--;
		return this._value;
	}

	/**
	 * Main api. Will set the new value. If the value has changed (strict shallow compare)
	 * will call all of its subscribed effect fns.
	 */
	set value(newValue: T) {
		// shallow strict compare... no-op if equal
		if (this._value === newValue) return;

		this._debug("--> START: set value", newValue);
		_depth++;

		this._value = newValue;
		this._version++;

		// create a snapshot of subscribers to avoid modification during iteration
		// hm... perhaps not needed if we are not allowing nested effects
		const effects = Array.from(this._effects);

		// hm... is this good enough?
		if (this._updateCount++ > Signal.UPDATE_COUNT_LIMIT) {
			throw new Error(
				"Possible circular update dependency detected. " +
					`(Signal: ${this.id}; Effects: ${effects.length}; Limit: ${Signal.UPDATE_COUNT_LIMIT})`
			);
		}

		try {
			for (const [i, effect] of effects.entries()) {
				this._debug(
					`will run effect ${effect.id} (${i + 1}/${effects.length})`
				);
				effect();
			}
		} finally {
			this._updateCount = 0;
		}

		_depth--;
		this._debug("<-- END: set value");
	}

	/**
	 * Will get some internal meta info, including the value.
	 * Note, that getting the value here will not trigger the effect subscription features.
	 * In other words, even if accessing signal.meta from inside of a effect fn,
	 * that effect won't become reactive.
	 **/
	get meta() {
		return {
			id: this.id,
			effects: [...this._effects.values().map((e) => `${eid(e)}`)],
			version: this._version,
			value: this._value,
		};
	}
}

/**
 * Almost the same as Signal except that its value is calculated by the provided function
 * which is called from inside of an effect. Critical point is, that the calculated value
 * is not set via setter, but directly on the protected prop, making it much more efficient
 * compared to regular effect.
 */
class DerivedSignal<T> extends Signal<T> {
	constructor(computeFn: () => any) {
		super(undefined as T, `#d${_id++}`); // "d" as "derived"
		const name = computeFn.name || "derived";
		effect(
			() => {
				// this is critical, that we set the "raw" value, and not via setter
				this._value = computeFn();
				this._debug("<-> set derived value", this._value);
			},
			{ name }
		);
	}

	override set value(val: any) {
		throw new Error("Cannot mutate a derived signal directly");
	}

	// ?!? if I don't override this getter as well, I'm getting undefined... not sure why
	override get value(): T {
		return super.value;
	}
}

/** Conventionally named Signal class factory. */
export function state<T>(initialValue: T): Signal<T> {
	return new Signal(initialValue);
}

/** Conventionally named DerivedSignal class factory */
export function derived<T>(computeFn: () => T): DerivedSignal<T> {
	return new DerivedSignal(computeFn);
}

/**
 * Will always call the provided effectFn immediately at least once (for the first time,
 * a.k.a. onMount).
 */
export function effect(
	/** The actual effect worker. MUST be synchronous. */
	fn: () => void,
	options?: Partial<{ name: string }>
) {
	if (__currentEffect) {
		// This is not worth the dance... it smells anyway.
		throw new Error(
			"Nested effects are not supported. Consider using a derived signal or moving the nested effect outside."
		);
	}

	// debug
	const id = "#e" + _id++;
	const name = options?.name || "anonymous";
	const debug = (...args: any[]) =>
		_debugEnabled &&
		console.debug(
			`%c${[`[${id}]${depth()}`, ...args, `[${name}]`].join(" ")}`,
			`color:gray`
		);

	// the trick is:
	// 1. our effect fn is wrapped... (follow to 2. down below)
	const effectFn: EffectFn = () => {
		debug(`START EFFECT`);
		_depth++;

		// 3. Each time we're running this effect wrapper, its reference is temporarily
		//    saved in a well known place. This temporary reference is crucial for
		//    signal's ability to recognize it as a dependency (and add it to its subscribers)
		//
		// but first we must save a potential previous one, which will be typically null,
		// unless in case of circular dependencies
		const prevEffect = __currentEffect;
		__currentEffect = effectFn;

		let result;
		try {
			// 4. if our inner effect `fn` is accessing any signal's value getters, it will be
			//    subscribed to the signal instance subscribers
			//
			//    If our effect `fn` is not accessing any signals getters, it will just run
			//    once (this time) as any other function call and no dependency is saved
			result = fn();
		} finally {
			// 5. after our effect ends, the global reference is no longer desired
			__currentEffect = prevEffect;
		}
		_depth--;
		debug(`END EFFECT`);

		return result;
	};

	// or debugging
	effectFn._name = name;
	effectFn.id = id;

	// 2. call it immediately (then follow to 3. above)
	// by returning the result we're allowing further features, like "onDestroy"...
	return effectFn();
}
