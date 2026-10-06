import { refreshOAuthAccessToken } from '../../services/http/oauth.ts';
import { useAppStore } from '../../store/appStore.ts';
import { makeHistoryEntry, saveHistory } from '../../services/history.ts';
import { sendApiRequest, cancelApiRequest } from '../../services/http/transport.ts';
import { toEngineRequest } from '../../services/http/buildRequest.ts';
import { createId } from '../../lib/id.ts';
import type { ApiRequest } from '../../domain/request.ts';
import type { NetworkSettings } from '../../domain/network.ts';

export function useRequestExecution(request: ApiRequest | undefined, variables: Record<string, string>, networkSettings: NetworkSettings, operationId: string | null) {
  const startRequest = useAppStore((state) => state.startRequest);
  const completeRequest = useAppStore((state) => state.completeRequest);
  const failRequest = useAppStore((state) => state.failRequest);
  const prependHistory = useAppStore((state) => state.prependHistory);
  const send = async () => {
    if (!request) return;
    const requestId = request.id;
    const nextOperationId = createId('op');
    startRequest(requestId, nextOperationId);
    try {
      let requestToSend = request;
      if (request.auth.type === 'oauth2') {
        const auth = await refreshOAuthAccessToken(request.auth, variables, networkSettings);
        if (auth !== request.auth) {
          requestToSend = { ...request, auth };
          useAppStore.setState((state) => ({ requests: state.requests.map((item) => item.id === requestId ? { ...item, auth } : item) }));
        }
      }
      const engineRequest = toEngineRequest(requestToSend, variables, networkSettings);
      const response = await sendApiRequest(engineRequest, nextOperationId);
      completeRequest(requestId, response);
      const historyEntry = makeHistoryEntry(requestToSend, engineRequest, response);
      prependHistory(historyEntry);
      void saveHistory(historyEntry).catch(() => undefined);
    } catch (error) {
      failRequest(requestId, error instanceof Error ? error.message : String(error));
    }
  };

  const cancel = async () => {
    if (!request || !operationId) return;
    try {
      await cancelApiRequest(operationId);
    } catch (error) {
      failRequest(request.id, error instanceof Error ? error.message : String(error));
    }
  };

  return { send, cancel };
}
