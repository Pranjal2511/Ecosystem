export class BaseNexaShareApi {
    listeners = new Map();
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        return () => {
            this.listeners.get(event)?.delete(callback);
        };
    }
    emit(event) {
        this.listeners.get(event.type)?.forEach((cb) => cb(event));
    }
}
