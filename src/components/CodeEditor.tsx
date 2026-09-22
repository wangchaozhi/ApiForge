import { useEffect, useRef } from 'react';
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

export type EditorLanguage = 'json' | 'plaintext' | 'html' | 'xml' | 'javascript' | 'css';

type Props = {
  value: string;
  language: EditorLanguage;
  onChange?: (value: string) => void;
  height?: number | string;
  readOnly?: boolean;
  searchQuery?: string;
};

export function CodeEditor({ value, language, onChange, height = 180, readOnly = false, searchQuery = '' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReturnType<typeof monaco.editor.create> | null>(null);
  const onChangeRef = useRef(onChange);

  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value,
      language,
      readOnly,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      lineHeight: 19,
      fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, monospace',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      padding: { top: 10, bottom: 10 },
      overviewRulerLanes: 0,
      renderLineHighlight: readOnly ? 'none' : 'line',
      fixedOverflowWidgets: true,
      folding: true,
    });
    editorRef.current = editor;
    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });

    return () => {
      subscription.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, language);
  }, [language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, renderLineHighlight: readOnly ? 'none' : 'line' });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !searchQuery) return;
    const matches = model.findMatches(searchQuery, false, false, false, null, true);
    const first = matches[0];
    if (first) {
      editor.setSelection(first.range);
      editor.revealRangeInCenterIfOutsideViewport(first.range);
    }
  }, [searchQuery, value]);

  return <div className="monaco-editor-shell" ref={containerRef} style={{ height }} />;
}
