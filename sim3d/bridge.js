/**
 * Pont WEAVE-SIM — à importer dans src/main.js (branch P2).
 * Mode bridge : la sim 3D ne dispatch plus ; elle affiche l'état du coordinateur Weave.
 *
 * Usage dans main.js :
 *   import { initWeaveBridge, isBridgeMode } from './bridge.js';
 *   const bridge = initWeaveBridge({ onIncidentRequest, onAck, applyState, applyDispatch, applyGuidance, applyReset });
 *   if (isBridgeMode()) { /* skip engine.triggerIncident in bindUi *\/ }
 */

const PARENT_ORIGIN = '*'; // restreindre à location.origin en prod démo

export function isBridgeMode() {
  try {
    return window.parent !== window && new URLSearchParams(location.search).get('bridge') !== '0';
  } catch {
    return false;
  }
}

export function initWeaveBridge(handlers = {}) {
  if (!isBridgeMode()) return null;

  const send = (type, payload = {}) => {
    window.parent.postMessage({ type, payload, source: 'weave-sim3d' }, PARENT_ORIGIN);
  };

  window.addEventListener('message', (event) => {
    const { type, payload, source } = event.data || {};
    if (source !== 'weave-demo') return;

    switch (type) {
      case 'weave:init':
        handlers.onInit?.(payload);
        break;
      case 'weave:state':
        handlers.applyState?.(payload);
        break;
      case 'weave:incident':
        handlers.applyIncident?.(payload);
        break;
      case 'weave:dispatch':
        handlers.applyDispatch?.(payload);
        break;
      case 'weave:guidance':
        handlers.applyGuidance?.(payload);
        break;
      case 'weave:coverage_warning':
        handlers.applyWarning?.(payload);
        break;
      case 'weave:reset':
        handlers.applyReset?.(payload);
        break;
      default:
        break;
    }
  });

  send('sim:ready', { version: '1', bridge: true });
  return { send };
}

/** Émettre une demande d'incident vers le parent (remplace engine.triggerIncident en mode bridge). */
export function requestIncident(zoneId, options = {}) {
  if (!isBridgeMode()) return false;
  window.parent.postMessage(
    {
      type: 'sim:incident_request',
      payload: { zoneId, transcript: options.transcript, lang: options.lang },
      source: 'weave-sim3d',
    },
    PARENT_ORIGIN,
  );
  return true;
}
