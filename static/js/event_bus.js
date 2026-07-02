/**
 * Frontend event bus — mirrors the Python-side pattern.
 * Components communicate through events rather than direct coupling.
 *
 * Usage:
 *   EventBus.on('contacts:changed', handler)
 *   EventBus.emit('contacts:changed', { count: 5 })
 *   EventBus.off('contacts:changed', handler)
 */
const EventBus = (() => {
  const _listeners = {};
  const _wildcards = [];

  function on(event, callback) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(callback);
  }

  function off(event, callback) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(cb => cb !== callback);
  }

  // Register a listener for ALL events. Returns an unsubscribe function.
  function onAny(callback) {
    _wildcards.push(callback);
    return () => {
      const i = _wildcards.indexOf(callback);
      if (i >= 0) _wildcards.splice(i, 1);
    };
  }

  function emit(event, data) {
    _wildcards.forEach(fn => { try { fn(event, data); } catch {} });
    (_listeners[event] || []).forEach(cb => {
      try { cb(data); }
      catch (e) { console.error(`EventBus listener error on '${event}':`, e); }
    });
  }

  function clear(event) {
    if (event) delete _listeners[event];
    else Object.keys(_listeners).forEach(k => delete _listeners[k]);
  }

  return { on, off, onAny, emit, clear };
})();
