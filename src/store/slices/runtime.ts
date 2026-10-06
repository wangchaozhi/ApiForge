import type { AppSlice } from '../types.ts';

export const createRuntimeSlice: AppSlice<'startRequest' | 'completeRequest' | 'failRequest'> = (set) => ({
  startRequest: (requestId, operationId) =>
    set((state) => ({
      runtimeByRequest: {
        ...state.runtimeByRequest,
        [requestId]: { response: null, error: null, sending: true, operationId },
      },
    })),
  completeRequest: (requestId, response) =>
    set((state) => ({
      runtimeByRequest: {
        ...state.runtimeByRequest,
        [requestId]: { response, error: null, sending: false, operationId: null },
      },
    })),
  failRequest: (requestId, error) =>
    set((state) => ({
      runtimeByRequest: {
        ...state.runtimeByRequest,
        [requestId]: { response: null, error, sending: false, operationId: null },
      },
    })),
});
