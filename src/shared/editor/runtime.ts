import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';

type MonacoWorkerEnvironment = {
  getWorker: (_moduleId: string, label: string) => Worker;
};

const monacoGlobal = self as typeof self & { MonacoEnvironment?: MonacoWorkerEnvironment };
if (!monacoGlobal.MonacoEnvironment) {
  monacoGlobal.MonacoEnvironment = {
    getWorker: (_moduleId, label) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
  };
}

export { monaco };
