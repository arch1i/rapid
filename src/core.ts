import { create_deep_immutable_proxy, create_deep_writable_proxy } from './proxy';
import { unsafe_parse_object } from './parse-object';

// K: emitter, V: event_key
const event_keys_storage = new WeakMap<EventEmitter<any>, string>();

// K: proxy_target, V: event_key
const store_changed_event_keys_storage = new WeakMap<ProxyTarget, string>();

const system = new EventTarget();

const create_scheduler = () => {
	const jobs = new Map<ProxyTarget, Array<Job>>();

	return {
		init_target(target: ProxyTarget) {
			jobs.set(target, []);
		},
		post_job(target: ProxyTarget, job: Job) {
			jobs.get(target)?.push(job);
		},
		execute_jobs(target: ProxyTarget) {
			const target_jobs = jobs.get(target);
			if (target_jobs?.length) {
				for (let i = 0; i < target_jobs.length; ++i) {
					target_jobs[i]();
				}
				system.dispatchEvent(new Event(store_changed_event_keys_storage.get(target)!));
			}
		},
	};
};

export const scheduler = create_scheduler();

export function createEvent<T extends EventPayload | void = void>() {
	const key = crypto.randomUUID();
	const emitter = (payload: T) => {
		system.dispatchEvent(new CustomEvent(key, { detail: payload }));
	};

	event_keys_storage.set(emitter, key);
	return emitter;
}

export function createStore<S extends ProxyTarget>(initial: S = {} as S) {
	const store_changed_event_key = crypto.randomUUID();
	const proxy_target = unsafe_parse_object(initial);

	scheduler.init_target(proxy_target);
	store_changed_event_keys_storage.set(proxy_target, store_changed_event_key);

	const $ = create_deep_writable_proxy(proxy_target);

	const immutable_proxy = create_deep_immutable_proxy(proxy_target);

	return {
		/**
		 * @description $.get() return an immutable store snapshot
		 * */
		get: () => immutable_proxy,
		/**
		 * @description $.on(event, handler) - allow to handle emitted events.
		 * Handler has an access to the store and event details.
		 * */
		on: <E extends EventEmitter<any>>(
			event_emitter: E,
			handler: (
				store: typeof $,
				event: {
					payload: ExtractEventPayload<E>;
				}
			) => void
		) => {
			const event_key = event_keys_storage.get(event_emitter);

			function _handler(kernel_event: Event) {
				handler($, {
					payload: (kernel_event as CustomEvent).detail,
				});
				scheduler.execute_jobs(proxy_target);
			}

			system.addEventListener(event_key!, _handler);
		},
		/**
		 * @description $.watch(handler) - runs an effect after the store has changed.
		 * Handler has an access to immutable snapshot.
		 * */
		watch: (handler: (snapshot: typeof immutable_proxy) => void) => {
			const _handler = () => {
				handler(immutable_proxy);
			};
			system.addEventListener(store_changed_event_key, _handler);
		},
	};
}

export interface ProxyTarget {
	[key: string]: any;
}

export type EventEmitter<P extends EventPayload | void = void> = ReturnType<typeof createEvent<P>>;

export type EventPayload = Record<string, any> | string | number | boolean | BigInt | null;

export type ExtractEventPayload<Emitter> = Emitter extends EventEmitter<infer P> ? P : never;

type Job = () => void;
